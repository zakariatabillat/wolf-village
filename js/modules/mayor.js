// ============================================================
//  SQUAD 4 — MAIRE
//  Reçoit : state, ask(), bus
//  Renvoie : id du maire (ou null)
//  Émet    : mayor:elected, mayor:successor
//  Stocke  : player.isMayor (un seul joueur à la fois)
// ============================================================
import { EVENTS } from '../core/bus.js';
import { pick } from '../core/rng.js';
import { alivePlayers, getPlayer } from '../core/state.js';

/** Élection (fonction PURE). Égalité → tirage au sort. Aucun vote → null. */
export function electMayor(votes, rng = Math.random) {
  const counts = {};
  for (const { targetId } of votes) {
    if (targetId) counts[targetId] = (counts[targetId] ?? 0) + 1;
  }
  const max = Math.max(0, ...Object.values(counts));
  if (max === 0) return { mayorId: null, counts, tie: false };
  const leaders = Object.keys(counts).filter(id => counts[id] === max);
  return { mayorId: pick(leaders, rng), counts, tie: leaders.length > 1 };
}

/** Donne l'écharpe à un joueur (et l'enlève à tous les autres). */
export function setMayor(state, id) {
  for (const p of state.players) p.isMayor = p.id === id;
}

export async function runMayorElection(state, ask, bus, hooks = {}) {
  const votes = [];
  const candidates = alivePlayers(state).map(p => p.id); // on peut voter pour soi
  const askOne = (voter) => ask({ kind: 'mayor-vote', player: voter, candidates, context: { votesSoFar: [...votes] } });
  const castOne = async (voter, targetId) => {
    votes.push({ voterId: voter.id, targetId: targetId ?? null });
    await hooks.afterVote?.(voter, targetId);
  };
  if (hooks.parallel) { // mode en ligne : tout le monde vote en même temps
    let chain = Promise.resolve();
    await Promise.all(alivePlayers(state).map(v => askOne(v).then(t => { chain = chain.then(() => castOne(v, t)); return chain; })));
    await chain;
  } else {
    for (const voter of alivePlayers(state)) await castOne(voter, await askOne(voter));
  }
  const { mayorId, counts, tie } = electMayor(votes);
  if (mayorId) {
    setMayor(state, mayorId);
    bus?.emit(EVENTS.MAYOR_ELECTED, { id: mayorId, counts, tie });
  }
  return mayorId;
}

/** Le maire meurt : il désigne son successeur parmi les vivants. */
export async function runSuccession(state, deadMayorId, ask, bus) {
  const dead = getPlayer(state, deadMayorId);
  const candidates = alivePlayers(state).map(p => p.id);
  if (!dead || candidates.length === 0) { setMayor(state, null); return null; }
  let toId = await ask({ kind: 'mayor-successor', player: dead, candidates, context: {} });
  if (!candidates.includes(toId)) toId = candidates[0]; // sécurité : réponse invalide
  setMayor(state, toId);
  bus?.emit(EVENTS.MAYOR_SUCCESSOR, { fromId: deadMayorId, toId });
  return toId;
}
