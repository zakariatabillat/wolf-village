// ============================================================
//  BUS D'ÉVÉNEMENTS — le "câble" commun entre toutes les squads
//  Chaque module émet ses événements ici ; les autres écoutent.
// ============================================================

/** Noms officiels des événements (contrat commun). Ne jamais écrire le nom en dur ailleurs. */
export const EVENTS = Object.freeze({
  GAME_START:      'game:start',       // { players }
  ROLES_ASSIGNED:  'roles:assigned',   // { players }
  PHASE_CHANGE:    'phase:change',     // { phase, day }
  NIGHT_WOLVES:    'night:wolves',     // { targetId }               (secret)
  NIGHT_SEER:      'night:seer',       // { seerId, targetId, role } (secret)
  NIGHT_WITCH:     'night:witch',      // { witchId, saved, poisonedId } (secret)
  NIGHT_END:       'night:end',        // { deaths: [{ id, cause }] }
  PLAYER_DIED:     'player:died',      // { id, name, role, cause }
  MAYOR_ELECTED:   'mayor:elected',    // { id, counts }
  MAYOR_SUCCESSOR: 'mayor:successor',  // { fromId, toId }
  DEBATE_START:    'debate:start',     // { duration }
  DEBATE_TICK:     'debate:tick',      // { remaining }
  DEBATE_END:      'debate:end',       // { skipped }
  VOTE_CAST:       'vote:cast',        // { voterId, targetId }
  VOTE_RESULT:     'vote:result',      // { eliminatedId, counts, tie, leaders }
  HUNTER_SHOT:     'hunter:shot',      // { hunterId, targetId }
  CHAT:            'chat:say',         // { id, text }
  GAME_OVER:       'game:over',        // { winner, survivors }
});

/**
 * Crée un bus : on(), off(), emit(), onAny().
 * Un écouteur qui plante ne doit JAMAIS casser les autres modules → try/catch.
 */
export function createBus({ debug = false } = {}) {
  const listeners = new Map(); // nom -> Set(callback)
  const anyListeners = new Set();

  function on(name, cb) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(cb);
    return () => off(name, cb); // renvoie une fonction de désabonnement
  }

  function off(name, cb) {
    listeners.get(name)?.delete(cb);
  }

  function onAny(cb) {
    anyListeners.add(cb);
    return () => anyListeners.delete(cb);
  }

  function emit(name, payload = {}) {
    if (debug) console.log(`%c[bus] ${name}`, 'color:#e0a040', payload);
    for (const cb of listeners.get(name) ?? []) safeCall(cb, payload, name);
    for (const cb of anyListeners) safeCall(cb, name, payload);
  }

  function safeCall(cb, a, b) {
    try { cb(a, b); } catch (err) { console.error('[bus] écouteur en erreur', err); }
  }

  return { on, off, onAny, emit };
}
