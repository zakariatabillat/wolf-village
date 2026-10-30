// ============================================================
//  ÉTAT DE LA PARTIE — forme officielle (contrat commun)
// ============================================================
//  player = { id, name, role, alive, isBot, isMayor, color }
//  role   ∈ 'loup' | 'villageois' | 'voyante' | 'sorciere' | 'chasseur'

export const PLAYER_COLORS = [
  '#e4572e', '#29a3a3', '#f3a712', '#7b5ea7', '#4caf50', '#d64590',
  '#3d7dd8', '#c97b3a', '#8bc34a', '#e05d5d', '#5cc8d6', '#b08968',
  '#9c6ade', '#e8c547', '#5a8f7b', '#ff8c61',
];

/** Crée un état vierge à partir d'une liste [{ name, isBot }]. */
export function createGameState(entries) {
  return {
    players: entries.map((e, i) => ({
      id: `p${i + 1}`,
      name: e.name,
      role: null,
      alive: true,
      isBot: !!e.isBot,
      isMayor: false,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    })),
    phase: 'setup', // setup | night | day | debate | vote | end
    day: 0,
    potions: { life: true, death: true },
    lastWolfTarget: null,
    winner: null,
  };
}

export const getPlayer = (state, id) => state.players.find(p => p.id === id) ?? null;
export const alivePlayers = (state) => state.players.filter(p => p.alive);
export const aliveIds = (state) => alivePlayers(state).map(p => p.id);
export const aliveWithRole = (state, role) => alivePlayers(state).filter(p => p.role === role);
export const getMayor = (state) => state.players.find(p => p.isMayor && p.alive) ?? null;
export const humans = (state) => state.players.filter(p => !p.isBot);

/** Marque un joueur mort. Renvoie false s'il l'était déjà (évite les doubles morts). */
export function markDead(state, id) {
  const p = getPlayer(state, id);
  if (!p || !p.alive) return false;
  p.alive = false;
  return true;
}
