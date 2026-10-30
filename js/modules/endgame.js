// ============================================================
//  SQUAD 6 — FIN DE PARTIE
//  Reçoit : la liste des joueurs
//  Renvoie : { winner: 'loups' | 'village' | 'personne' | null, wolves, others }
//  Émet    : game:over { winner, survivors } (via announceWinner)
//  Stocke  : state.winner
// ============================================================
import { EVENTS } from '../core/bus.js';

export function checkWinner(players) {
  const alive = players.filter(p => p.alive);
  const wolves = alive.filter(p => p.role === 'loup').length;
  const others = alive.length - wolves;

  let winner = null;
  if (alive.length === 0) winner = 'personne';      // tout le monde est mort (ex. chasseur + poison)
  else if (wolves === 0) winner = 'village';        // tous les loups éliminés
  else if (wolves >= others) winner = 'loups';      // les loups ne peuvent plus perdre un vote
  return { winner, wolves, others };
}

export function announceWinner(state, bus) {
  const { winner } = checkWinner(state.players);
  if (!winner) return null;
  state.winner = winner;
  state.phase = 'end';
  bus?.emit(EVENTS.GAME_OVER, { winner, survivors: state.players.filter(p => p.alive).map(p => p.id) });
  return winner;
}

export const WINNER_TEXT = {
  village:  { title: 'Le village triomphe', sub: 'Les derniers loups ont été démasqués. Brumeval dort enfin en paix.' },
  loups:    { title: 'La meute a gagné',    sub: 'Les loups-garous sont maintenant aussi nombreux que les villageois. Brumeval leur appartient.' },
  personne: { title: 'Personne ne survit',  sub: 'Le silence est retombé sur un village vide.' },
};
