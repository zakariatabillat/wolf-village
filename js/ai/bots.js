// ============================================================
//  CERVEAU DES BOTS — joueurs contrôlés par l'ordinateur
//  Chaque bot garde une "suspicion" (0 → 1) envers chaque autre joueur.
//  Les bots répondent à la même interface ask() que les humains.
// ============================================================
import { EVENTS } from '../core/bus.js';
import { pick } from '../core/rng.js';
import { getPlayer, alivePlayers } from '../core/state.js';

export function createBrain(state, bus, rng = Math.random) {
  const sus = {};          // sus[botId][targetId] = suspicion
  const seerKnows = {};    // ce que la voyante bot a découvert : targetId -> role
  const claims = [];       // accusations publiques { by, target, asSeer }
  let seerClaimedBy = null;

  const S = (a, b) => (sus[a] ??= {})[b] ??= 0.3 + rng() * 0.2;
  const bump = (a, b, d) => { S(a, b); sus[a][b] = Math.min(1, Math.max(0, sus[a][b] + d)); };
  const isWolf = (id) => getPlayer(state, id)?.role === 'loup';

  // Les bots écoutent le bus pour apprendre
  bus.on(EVENTS.NIGHT_SEER, ({ seerId, targetId, role }) => { seerKnows[targetId] = role; void seerId; });
  const ballots = []; // bulletins du dernier vote
  bus.on(EVENTS.PHASE_CHANGE, ({ phase }) => { if (phase === 'vote') ballots.length = 0; });
  bus.on(EVENTS.VOTE_CAST, ({ voterId, targetId }) => {
    if (!targetId) return;
    ballots.push({ voterId, targetId });
    // Voter contre quelqu'un rend légèrement suspect aux yeux de la cible
    bump(targetId, voterId, 0.12);
  });
  bus.on(EVENTS.PLAYER_DIED, ({ id, role, cause }) => {
    // Après un vote : qui a fait condamner un innocent devient suspect, qui a visé un loup est blanchi
    if (cause === 'vote') {
      for (const b of ballots) for (const p of state.players) {
        if (b.targetId === id) bump(p.id, b.voterId, role === 'loup' ? -0.2 : 0.18);
        else if (role === 'loup') bump(p.id, b.voterId, 0.08);
      }
      ballots.length = 0;
    }
    // Quand un villageois meurt sur un vote, ceux qui l'ont accusé deviennent suspects
    for (const c of claims) {
      if (c.target === id && role !== 'loup') for (const p of state.players) bump(p.id, c.by, 0.25);
      if (c.target === id && role === 'loup') for (const p of state.players) bump(p.id, c.by, -0.3);
    }
    if (role === 'voyante') seerClaimedBy = seerClaimedBy === id ? null : seerClaimedBy;
  });
  bus.on(EVENTS.CHAT, ({ id, text, accuse, asSeer }) => {
    void text;
    if (!accuse) return;
    claims.push({ by: id, target: accuse, asSeer: !!asSeer });
    if (asSeer) seerClaimedBy = id;
    for (const p of alivePlayers(state)) {
      if (p.id === accuse || p.id === id) continue;
      bump(p.id, accuse, asSeer ? 0.6 : 0.15);
    }
    bump(accuse, id, 0.4); // l'accusé se méfie de l'accusateur
  });

  /** Le joueur le plus suspect pour ce bot (avec un peu de bruit). */
  function mostSuspect(botId, candidates, noise = 0.15) {
    let best = null; let bestScore = -Infinity;
    for (const c of candidates) {
      const score = S(botId, c) + rng() * noise;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }
  const leastSuspect = (botId, candidates) => {
    let best = null; let bestScore = Infinity;
    for (const c of candidates) { const s = S(botId, c) + rng() * 0.1; if (s < bestScore) { bestScore = s; best = c; } }
    return best;
  };

  /** Répond à une requête ask() pour un bot. */
  function decide({ kind, player, candidates, context }) {
    const me = player;
    const wolf = me.role === 'loup';
    const nonWolves = candidates.filter(c => !isWolf(c));

    switch (kind) {
      case 'wolf-target': {
        // La meute suit le premier choix d'un complice ; sinon cible la "voyante" déclarée, ou un accusateur.
        const prior = Object.values(context.votesSoFar ?? {}).find(Boolean);
        if (prior && rng() < 0.85) return prior;
        if (seerClaimedBy && candidates.includes(seerClaimedBy)) return seerClaimedBy;
        const accusers = claims.filter(c => isWolf(c.target)).map(c => c.by).filter(id => candidates.includes(id));
        return pick(accusers.length ? accusers : candidates, rng);
      }
      case 'seer-target': {
        const unknown = candidates.filter(c => !seerKnows[c]);
        return mostSuspect(me.id, unknown.length ? unknown : candidates, 0.4);
      }
      case 'seer-result': return true;
      case 'witch-save': {
        if (context.victimId === me.id) return true;
        return rng() < (state.day <= 1 ? 0.7 : 0.45);
      }
      case 'witch-poison': {
        const known = candidates.filter(c => claims.some(cl => cl.asSeer && cl.target === c));
        if (known.length && rng() < 0.7) return known[0];
        const target = mostSuspect(me.id, candidates, 0.05);
        return target && S(me.id, target) > 0.8 && state.day >= 2 && rng() < 0.5 ? target : null;
      }
      case 'vote':
      case 'mayor-tiebreak':
      case 'hunter-shot': {
        if (wolf) {
          // Le loup suit la foule contre un non-loup, ou vise la voyante déclarée
          if (seerClaimedBy && nonWolves.includes(seerClaimedBy) && rng() < 0.7) return seerClaimedBy;
          const tally = {};
          for (const v of context.votesSoFar ?? []) if (v.targetId && nonWolves.includes(v.targetId)) tally[v.targetId] = (tally[v.targetId] ?? 0) + 1;
          const crowd = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
          return crowd && rng() < 0.6 ? crowd : pick(nonWolves.length ? nonWolves : candidates, rng);
        }
        // Voyante : vote pour un loup qu'elle connaît
        const knownWolf = candidates.find(c => seerKnows[c] === 'loup');
        if (me.role === 'voyante' && knownWolf) return knownWolf;
        return mostSuspect(me.id, candidates, kind === 'vote' ? 0.12 : 0.05);
      }
      case 'mayor-vote': {
        if (wolf) {
          const mates = candidates.filter(c => isWolf(c));
          return rng() < 0.6 ? pick(mates, rng) : leastSuspect(me.id, candidates);
        }
        return leastSuspect(me.id, candidates.filter(c => c !== me.id)) ?? me.id;
      }
      case 'mayor-successor': {
        if (wolf) { const mates = candidates.filter(c => isWolf(c)); if (mates.length) return pick(mates, rng); }
        return leastSuspect(me.id, candidates);
      }
      case 'role-reveal': return true;
      default: return pick(candidates, rng);
    }
  }

  // ---------- PAROLES pendant le débat ----------
  const LINES = {
    vague: [
      (t) => `Je trouve ${t} bien silencieux depuis ce matin…`,
      (t) => `${t}, tu étais où cette nuit ?`,
      (t) => `Quelque chose cloche chez ${t}.`,
      (t) => `Je ne fais pas confiance à ${t}.`,
      (t) => `${t} a changé d'avis trop vite hier.`,
    ],
    calm: [
      () => 'Restons calmes, ne votons pas au hasard.',
      () => 'Quelqu\'un a entendu des hurlements cette nuit ?',
      () => 'Il faut réfléchir à qui profite ce meurtre.',
      () => 'Je suis un simple villageois, je le jure.',
      () => 'La meute se cache parmi nous, ouvrez l\'œil.',
    ],
    seer: [(t) => `Je suis la Voyante. J'ai sondé ${t} : c'est un LOUP !`],
    counter: [(t) => `Mensonge ! C'est ${t} le vrai loup, ne vous laissez pas berner.`],
    defend: [(t) => `Moi ? Non ! ${t} essaie de détourner l'attention !`],
  };

  /** Une réplique pour un bot (ou null). Renvoie { text, accuse, asSeer }. */
  function speak(bot) {
    const others = alivePlayers(state).filter(p => p.id !== bot.id).map(p => p.id);
    if (!others.length) return null;
    const nm = (id) => getPlayer(state, id).name;

    // Voyante qui connaît un loup vivant : elle se dévoile (souvent à partir du jour 2)
    const knownWolf = others.find(id => seerKnows[id] === 'loup');
    if (bot.role === 'voyante' && knownWolf && !claims.some(c => c.by === bot.id && c.target === knownWolf)) {
      return { text: LINES.seer[0](nm(knownWolf)), accuse: knownWolf, asSeer: true };
    }
    // Loup accusé : contre-attaque
    const accusedMe = claims.filter(c => c.target === bot.id).map(c => c.by).find(id => others.includes(id));
    if (accusedMe && rng() < 0.7) {
      const line = bot.role === 'loup' && rng() < 0.5 ? LINES.counter[0] : LINES.defend[0];
      return { text: line(nm(accusedMe)), accuse: accusedMe, asSeer: false };
    }
    if (rng() < 0.55) {
      const pool = bot.role === 'loup' ? others.filter(id => !isWolf(id)) : others;
      const t = mostSuspect(bot.id, pool.length ? pool : others, 0.3);
      return { text: pick(LINES.vague, rng)(nm(t)), accuse: t, asSeer: false };
    }
    return { text: pick(LINES.calm, rng)(), accuse: null, asSeer: false };
  }

  return { decide, speak, suspicion: sus };
}
