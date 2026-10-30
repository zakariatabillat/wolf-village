// Générateur aléatoire "seedable" : même graine = même partie (utile pour les tests).
export function createRng(seed = Date.now()) {
  let s = seed >>> 0;
  return function rng() {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Choisit un élément au hasard dans un tableau (null si vide). */
export function pick(arr, rng = Math.random) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(rng() * arr.length)];
}

/** Mélange de Fisher-Yates (renvoie une COPIE, ne modifie pas l'original). */
export function shuffle(arr, rng = Math.random) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
