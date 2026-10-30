// ============================================================
//  SQUAD 2 — TOUR DE NUIT (Loups → Voyante → Sorcière)
//  Reçoit : state, ask(requête) → Promise<réponse>, bus
//  Renvoie : { deaths: [{ id, cause }] }   (personne n'est encore marqué mort)
//  Émet    : night:wolves, night:seer, night:witch, night:end
//  Stocke  : state.potions (potions de la sorcière), state.lastWolfTarget
// ============================================================
import { EVENTS } from '../core/bus.js';
import { pick } from '../core/rng.js';
import { alivePlayers, aliveWithRole } from '../core/state.js';

/**
 * Votes des loups → une seule cible.
 * votes = { idLoup: idCible }. Égalité → tirage au sort parmi les ex-aequo. Aucun vote → null.
 */
export function tallyWolfVotes(votes, rng = Math.random) {
  const counts = {};
  for (const target of Object.values(votes)) {
    if (target) counts[target] = (counts[target] ?? 0) + 1;
  }
  const max = Math.max(0, ...Object.values(counts));
  if (max === 0) return null;
  const leaders = Object.keys(counts).filter(id => counts[id] === max);
  return pick(leaders, rng);
}

/**
 * Règle de résolution de la nuit (fonction PURE, facile à tester).
 * - la victime des loups meurt, sauf si la sorcière la sauve
 * - la cible du poison meurt
 * - un même joueur ne meurt qu'une fois
 */
export function resolveNight({ wolfTarget = null, witchSave = false, witchPoison = null }) {
  const deaths = [];
  if (wolfTarget && !witchSave) deaths.push({ id: wolfTarget, cause: 'loups' });
  if (witchPoison && !deaths.some(d => d.id === witchPoison)) {
    deaths.push({ id: witchPoison, cause: 'poison' });
  }
  return deaths;
}

/** Déroule toute la nuit en demandant les choix via ask(). */
export async function runNight(state, ask, bus, hooks = {}) {
  const step = hooks.step ?? (async () => {});

  // 1) LES LOUPS
  const wolves = aliveWithRole(state, 'loup');
  const preys = alivePlayers(state).filter(p => p.role !== 'loup').map(p => p.id);
  let wolfTarget = null;
  if (wolves.length && preys.length) {
    await step('loups', wolves);
    const votes = {};
    for (const wolf of wolves) {
      votes[wolf.id] = await ask({
        kind: 'wolf-target', player: wolf, candidates: preys,
        context: { pack: wolves.map(w => w.id), votesSoFar: { ...votes } },
      });
    }
    wolfTarget = tallyWolfVotes(votes);
  }
  state.lastWolfTarget = wolfTarget;
  bus?.emit(EVENTS.NIGHT_WOLVES, { targetId: wolfTarget });

  // 2) LA VOYANTE
  const [seer] = aliveWithRole(state, 'voyante');
  if (seer) {
    await step('voyante', [seer]);
    const others = alivePlayers(state).filter(p => p.id !== seer.id).map(p => p.id);
    const targetId = await ask({ kind: 'seer-target', player: seer, candidates: others, context: {} });
    if (targetId) {
      const role = state.players.find(p => p.id === targetId).role;
      bus?.emit(EVENTS.NIGHT_SEER, { seerId: seer.id, targetId, role });
      await ask({ kind: 'seer-result', player: seer, candidates: [], context: { targetId, role } });
    }
  }

  // 3) LA SORCIÈRE
  const [witch] = aliveWithRole(state, 'sorciere');
  let witchSave = false;
  let witchPoison = null;
  if (witch && (state.potions.life || state.potions.death)) {
    await step('sorciere', [witch]);
    if (state.potions.life && wolfTarget) {
      witchSave = !!(await ask({ kind: 'witch-save', player: witch, candidates: [], context: { victimId: wolfTarget } }));
      if (witchSave) state.potions.life = false;
    }
    if (state.potions.death) {
      const targets = alivePlayers(state)
        .filter(p => p.id !== witch.id && !(p.id === wolfTarget && !witchSave))
        .map(p => p.id);
      witchPoison = await ask({ kind: 'witch-poison', player: witch, candidates: targets, context: { victimId: witchSave ? null : wolfTarget } });
      if (witchPoison) state.potions.death = false;
    }
    bus?.emit(EVENTS.NIGHT_WITCH, { witchId: witch.id, saved: witchSave, poisonedId: witchPoison });
  }

  const deaths = resolveNight({ wolfTarget, witchSave, witchPoison });
  bus?.emit(EVENTS.NIGHT_END, { deaths });
  return { deaths };
}
