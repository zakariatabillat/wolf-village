// ============================================================
//  SQUAD 3 — VOTE DU VILLAGE
//  Reçoit : state, ask(), bus
//  Renvoie : { eliminatedId | null, counts, tie, leaders }
//  Émet    : vote:cast (chaque bulletin), vote:result
//  Stocke  : rien (les bulletins sont dans l'événement)
// ============================================================
import { EVENTS } from '../core/bus.js';
import { alivePlayers, getMayor } from '../core/state.js';

/**
 * Dépouillement (fonction PURE).
 * votes = [{ voterId, targetId }]  — targetId null = abstention.
 * La voix du maire compte double.
 */
export function tallyVotes(votes, { mayorId = null } = {}) {
  const counts = {};
  for (const { voterId, targetId } of votes) {
    if (!targetId) continue; // abstention
    const weight = voterId === mayorId ? 2 : 1;
    counts[targetId] = (counts[targetId] ?? 0) + weight;
  }
  const max = Math.max(0, ...Object.values(counts));
  const leaders = max === 0 ? [] : Object.keys(counts).filter(id => counts[id] === max);
  return {
    counts,
    leaders,
    tie: leaders.length > 1,
    eliminatedId: leaders.length === 1 ? leaders[0] : null,
  };
}

/**
 * Déroule le vote : chaque vivant vote, puis dépouillement. Égalité → le maire tranche.
 * hooks.parallel = true (mode en ligne) : tout le monde vote en même temps,
 * les bulletins sont enregistrés dans l'ordre où ils arrivent.
 */
export async function runVote(state, ask, bus, hooks = {}) {
  const voters = alivePlayers(state);
  const mayor = getMayor(state);
  const votes = [];

  const askOne = (voter) => {
    const candidates = alivePlayers(state).filter(p => p.id !== voter.id).map(p => p.id);
    return ask({ kind: 'vote', player: voter, candidates, context: { votesSoFar: [...votes] } });
  };
  const castOne = async (voter, targetId) => {
    votes.push({ voterId: voter.id, targetId: targetId ?? null });
    bus?.emit(EVENTS.VOTE_CAST, { voterId: voter.id, targetId: targetId ?? null });
    await hooks.afterVote?.(voter, targetId);
  };

  if (hooks.parallel) {
    let chain = Promise.resolve(); // file d'attente : un bulletin traité à la fois
    await Promise.all(voters.map(voter => askOne(voter).then(t => { chain = chain.then(() => castOne(voter, t)); return chain; })));
    await chain;
  } else {
    for (const voter of voters) await castOne(voter, await askOne(voter));
  }

  const result = tallyVotes(votes, { mayorId: mayor?.id ?? null });

  // Égalité : si un maire est vivant, il départage parmi les ex-aequo.
  if (result.tie && mayor) {
    const choice = await ask({ kind: 'mayor-tiebreak', player: mayor, candidates: result.leaders, context: { counts: result.counts } });
    if (result.leaders.includes(choice)) result.eliminatedId = choice;
  }

  bus?.emit(EVENTS.VOTE_RESULT, { ...result, votes });
  return { ...result, votes };
}
