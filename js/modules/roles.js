// ============================================================
//  SQUAD 1 — ATTRIBUTION DES RÔLES
//  Reçoit : liste de joueurs (sans rôle) + rng optionnel
//  Renvoie : { ok: true, players } ou { ok: false, error }
//  Émet    : roles:assigned { players }
//  Stocke  : rien (le rôle est écrit dans chaque joueur)
// ============================================================
import { EVENTS } from '../core/bus.js';
import { shuffle } from '../core/rng.js';

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 16;

export const ROLES = Object.freeze({
  loup:       { label: 'Loup-Garou', team: 'loups',   icon: '🐺', desc: 'Chaque nuit, dévore un villageois avec ta meute. Gagne quand les loups sont aussi nombreux que les autres.' },
  villageois: { label: 'Villageois', team: 'village', icon: '🧑‍🌾', desc: "Aucun pouvoir, mais ton vote compte. Démasque les loups pendant le débat." },
  voyante:    { label: 'Voyante',    team: 'village', icon: '🔮', desc: 'Chaque nuit, découvre le vrai rôle d\'un joueur.' },
  sorciere:   { label: 'Sorcière',   team: 'village', icon: '🧪', desc: 'Une potion de vie pour sauver la victime des loups, une potion de mort pour éliminer quelqu\'un. Une seule fois chacune.' },
  chasseur:   { label: 'Chasseur',   team: 'village', icon: '🏹', desc: 'Quand tu meurs, tu tires une dernière flèche et emportes un joueur avec toi.' },
});

/**
 * Calcule la composition des rôles pour n joueurs.
 * 4-7 joueurs → 1 loup, 8-11 → 2 loups, 12+ → 3 loups (≈ 1/4 du village).
 */
export function composeRoles(n) {
  const wolves = Math.max(1, Math.floor(n / 4));
  const roles = Array(wolves).fill('loup');
  if (n >= 4) roles.push('voyante');
  if (n >= 5) roles.push('sorciere');
  if (n >= 6) roles.push('chasseur');
  while (roles.length < n) roles.push('villageois');
  return roles;
}

/** Distribue les rôles au hasard. Ne modifie pas le tableau reçu (renvoie des copies). */
export function assignRoles(players, { rng = Math.random, bus = null } = {}) {
  if (!Array.isArray(players)) {
    return { ok: false, error: 'La liste des joueurs est invalide.' };
  }
  if (players.length < MIN_PLAYERS) {
    return { ok: false, error: `Il faut au moins ${MIN_PLAYERS} joueurs (reçu : ${players.length}).` };
  }
  if (players.length > MAX_PLAYERS) {
    return { ok: false, error: `Maximum ${MAX_PLAYERS} joueurs (reçu : ${players.length}).` };
  }
  const names = players.map(p => p.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) {
    return { ok: false, error: 'Deux joueurs portent le même nom.' };
  }

  const roles = shuffle(composeRoles(players.length), rng);
  const result = players.map((p, i) => ({ ...p, role: roles[i] }));

  bus?.emit(EVENTS.ROLES_ASSIGNED, { players: result });
  return { ok: true, players: result };
}
