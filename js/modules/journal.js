// ============================================================
//  SQUAD 7 — JOURNAL D'ÉVÉNEMENTS
//  Reçoit : le bus + une fonction pour retrouver un joueur par id
//  Renvoie : { entries, publicEntries(), toText(), clear() }
//  Émet    : rien (il ÉCOUTE tout le monde)
//  Stocke  : entries = [{ day, phase, text, secret, icon, type }]
//  Les actions de nuit sont marquées secret: true → révélées seulement en fin de partie.
// ============================================================
import { EVENTS } from '../core/bus.js';
import { ROLES } from './roles.js';

const CAUSES = { loups: 'dévoré·e par les loups', poison: 'empoisonné·e par la sorcière', vote: 'éliminé·e par le village', chasseur: 'abattu·e par le chasseur' };

export function createJournal(bus, getPlayer) {
  const entries = [];
  let day = 0;
  let phase = 'setup';
  const name = (id) => getPlayer(id)?.name ?? '—';
  const role = (r) => ROLES[r] ? `${ROLES[r].icon} ${ROLES[r].label}` : r;

  function add(icon, text, { secret = false, type = 'info' } = {}) {
    entries.push({ day, phase, icon, text, secret, type, at: Date.now() });
  }

  /** Transforme un événement en ligne de journal (null = on n'écrit rien). */
  function format(evt, p) {
    switch (evt) {
      case EVENTS.GAME_START:     return add('🎲', `La partie commence avec ${p.players.length} joueurs.`);
      case EVENTS.ROLES_ASSIGNED: return add('🃏', 'Les rôles ont été distribués en secret.');
      case EVENTS.PHASE_CHANGE:
        day = p.day; phase = p.phase;
        if (p.phase === 'night') return add('🌙', `Nuit ${p.day}`, { type: 'phase' });
        if (p.phase === 'day')   return add('☀️', `Jour ${p.day}`, { type: 'phase' });
        return null;
      case EVENTS.NIGHT_WOLVES:   return p.targetId && add('🐺', `Les loups ciblent ${name(p.targetId)}.`, { secret: true });
      case EVENTS.NIGHT_SEER:     return add('🔮', `La voyante sonde ${name(p.targetId)} : ${role(p.role)}.`, { secret: true });
      case EVENTS.NIGHT_WITCH:
        if (p.saved) add('🧪', 'La sorcière utilise sa potion de vie.', { secret: true });
        if (p.poisonedId) add('☠️', `La sorcière empoisonne ${name(p.poisonedId)}.`, { secret: true });
        return null;
      case EVENTS.NIGHT_END:      return p.deaths.length === 0 && add('🕊️', 'Personne n\'est mort cette nuit.');
      case EVENTS.PLAYER_DIED:    return add('⚰️', `${p.name} est ${CAUSES[p.cause] ?? 'mort·e'}. C'était : ${role(p.role)}.`, { type: 'death' });
      case EVENTS.MAYOR_ELECTED:  return add('🎖️', `${name(p.id)} est élu·e maire${p.tie ? ' (au tirage au sort)' : ''}.`);
      case EVENTS.MAYOR_SUCCESSOR:return add('🎖️', `${name(p.fromId)} transmet l'écharpe de maire à ${name(p.toId)}.`);
      case EVENTS.DEBATE_START:   return add('⏳', `Débat : ${p.duration} secondes.`);
      case EVENTS.DEBATE_END:     return p.skipped && add('⏭️', 'Le débat est écourté.');
      case EVENTS.VOTE_CAST:      return add('🗳️', p.targetId ? `${name(p.voterId)} vote contre ${name(p.targetId)}.` : `${name(p.voterId)} s'abstient.`, { type: 'vote' });
      case EVENTS.VOTE_RESULT:
        if (p.eliminatedId) return add('⚖️', `Le village condamne ${name(p.eliminatedId)}.`);
        return add('⚖️', p.tie ? 'Égalité : personne n\'est éliminé.' : 'Aucun vote : personne n\'est éliminé.');
      case EVENTS.HUNTER_SHOT:    return add('🏹', `Dans un dernier souffle, ${name(p.hunterId)} tire sur ${name(p.targetId)}.`);
      case EVENTS.CHAT:           return add('💬', `${name(p.id)} : « ${p.text} »`, { type: 'chat' });
      case EVENTS.GAME_OVER:      return add('🏁', p.winner === 'village' ? 'Victoire du village !' : p.winner === 'loups' ? 'Victoire des loups-garous !' : 'Personne ne survit.');
      default: return null;
    }
  }

  const unsubscribe = bus.onAny(format);

  return {
    entries,
    format,
    publicEntries: () => entries.filter(e => !e.secret),
    toText: (withSecrets = true) => entries
      .filter(e => withSecrets || !e.secret)
      .map(e => `[J${e.day}] ${e.icon} ${e.text}${e.secret ? ' (secret)' : ''}`)
      .join('\n'),
    clear: () => { entries.length = 0; day = 0; phase = 'setup'; },
    destroy: unsubscribe,
  };
}
