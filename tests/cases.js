// ============================================================
//  SCÉNARIOS DE TEST — 1 nominal + des cas limites par module
//  Utilisé par tests/index.html (navigateur) ET tests/run-node.mjs (terminal).
// ============================================================
import { createBus, EVENTS } from '../js/core/bus.js';
import { createRng } from '../js/core/rng.js';
import { createGameState } from '../js/core/state.js';
import { assignRoles, composeRoles } from '../js/modules/roles.js';
import { tallyWolfVotes, resolveNight, runNight } from '../js/modules/night.js';
import { tallyVotes, runVote } from '../js/modules/vote.js';
import { electMayor, runSuccession, setMayor } from '../js/modules/mayor.js';
import { createTimer, formatTime } from '../js/modules/timer.js';
import { checkWinner } from '../js/modules/endgame.js';
import { createJournal } from '../js/modules/journal.js';

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} — attendu ${JSON.stringify(b)}, reçu ${JSON.stringify(a)}`); }

const fake = (n) => Array.from({ length: n }, (_, i) => ({ name: `Joueur${i + 1}`, isBot: true }));
const P = (id, role, alive = true) => ({ id, name: id, role, alive });

export const cases = [
  // ---------------- RÔLES ----------------
  { module: 'Rôles', name: 'Nominal : 8 joueurs → 2 loups, 1 voyante, 1 sorcière, 1 chasseur', run() {
    const res = assignRoles(createGameState(fake(8)).players, { rng: createRng(1) });
    assert(res.ok, 'devrait réussir');
    const count = (r) => res.players.filter(p => p.role === r).length;
    eq([count('loup'), count('voyante'), count('sorciere'), count('chasseur'), count('villageois')], [2, 1, 1, 1, 3], 'composition');
  } },
  { module: 'Rôles', name: 'Cas limite : 1 seul joueur → erreur claire', run() {
    const res = assignRoles(createGameState(fake(1)).players);
    assert(!res.ok && /au moins 4/.test(res.error), 'doit refuser');
  } },
  { module: 'Rôles', name: 'Cas limite : noms en double → erreur', run() {
    const res = assignRoles([{ name: 'Ana' }, { name: 'ana' }, { name: 'B' }, { name: 'C' }]);
    assert(!res.ok, 'doit refuser les doublons');
  } },
  { module: 'Rôles', name: 'Toujours au moins 1 loup, jamais plus qu\'un quart', run() {
    for (let n = 4; n <= 16; n++) { const w = composeRoles(n).filter(r => r === 'loup').length; assert(w >= 1 && w <= n / 4 + 0.01, `n=${n}`); }
  } },
  { module: 'Rôles', name: 'Émet roles:assigned', run() {
    const bus = createBus(); let got = null; bus.on(EVENTS.ROLES_ASSIGNED, p => { got = p; });
    assignRoles(createGameState(fake(5)).players, { bus });
    assert(got && got.players.length === 5, 'événement reçu');
  } },

  // ---------------- NUIT ----------------
  { module: 'Nuit', name: 'Nominal : la victime des loups meurt', run() {
    eq(resolveNight({ wolfTarget: 'p3' }), [{ id: 'p3', cause: 'loups' }], 'morts');
  } },
  { module: 'Nuit', name: 'Sorcière sauve + empoisonne → seul l\'empoisonné meurt', run() {
    eq(resolveNight({ wolfTarget: 'p3', witchSave: true, witchPoison: 'p5' }), [{ id: 'p5', cause: 'poison' }], 'morts');
  } },
  { module: 'Nuit', name: 'Cas limite : poison sur la victime des loups → 1 seule mort', run() {
    eq(resolveNight({ wolfTarget: 'p3', witchPoison: 'p3' }).length, 1, 'pas de double mort');
  } },
  { module: 'Nuit', name: 'Cas limite : loups divisés à égalité → une des deux cibles', run() {
    const t = tallyWolfVotes({ w1: 'a', w2: 'b' }, createRng(3));
    assert(t === 'a' || t === 'b', 'cible valide');
    eq(tallyWolfVotes({}), null, 'aucun vote');
  } },
  { module: 'Nuit', name: 'runNight complet avec ask() factice', async run() {
    const state = { day: 1, potions: { life: true, death: true }, players: [P('w', 'loup'), P('s', 'voyante'), P('h', 'sorciere'), P('v', 'villageois')] };
    const answers = { 'wolf-target': 'v', 'seer-target': 'w', 'witch-save': false, 'witch-poison': null, 'seer-result': true };
    const { deaths } = await runNight(state, async (req) => answers[req.kind], createBus());
    eq(deaths, [{ id: 'v', cause: 'loups' }], 'v meurt');
    eq(state.potions, { life: true, death: true }, 'potions intactes');
  } },

  // ---------------- VOTE ----------------
  { module: 'Vote', name: 'Nominal : majorité claire', run() {
    const r = tallyVotes([{ voterId: 'a', targetId: 'c' }, { voterId: 'b', targetId: 'c' }, { voterId: 'c', targetId: 'a' }]);
    eq(r.eliminatedId, 'c', 'c éliminé');
  } },
  { module: 'Vote', name: 'Cas limite : égalité sans maire → personne', run() {
    const r = tallyVotes([{ voterId: 'a', targetId: 'b' }, { voterId: 'b', targetId: 'a' }]);
    assert(r.tie && r.eliminatedId === null, 'égalité');
    eq(r.leaders.sort(), ['a', 'b'], 'ex-aequo');
  } },
  { module: 'Vote', name: 'La voix du maire compte double', run() {
    const r = tallyVotes([{ voterId: 'm', targetId: 'x' }, { voterId: 'a', targetId: 'y' }], { mayorId: 'm' });
    eq(r.eliminatedId, 'x', 'le maire l\'emporte');
  } },
  { module: 'Vote', name: 'Cas limite : tout le monde s\'abstient', run() {
    const r = tallyVotes([{ voterId: 'a', targetId: null }, { voterId: 'b', targetId: null }]);
    assert(r.eliminatedId === null && !r.tie, 'personne');
  } },
  { module: 'Vote', name: 'Égalité avec maire vivant → le maire tranche', async run() {
    const state = { players: [{ ...P('m', 'villageois'), isMayor: true }, P('a', 'loup'), P('b', 'villageois'), P('c', 'villageois')] };
    // Le maire et c s'abstiennent ; a et b votent l'un contre l'autre → égalité 1-1
    const ballots = { m: null, a: 'b', b: 'a', c: null };
    const r = await runVote(state, async (req) => req.kind === 'mayor-tiebreak' ? 'b' : ballots[req.player.id], createBus());
    assert(r.tie, 'il y a bien égalité');
    eq(r.eliminatedId, 'b', 'le maire choisit b');
  } },

  { module: 'Vote', name: 'Mode en ligne (parallel) : réponses dans le désordre, tous les bulletins comptés', async run() {
    const state = { players: [P('a', 'loup'), P('b', 'villageois'), P('c', 'villageois'), P('d', 'voyante')] };
    const delay = { a: 30, b: 5, c: 15, d: 1 };
    const target = { a: 'b', b: 'a', c: 'a', d: 'a' };
    const order = [];
    const r = await runVote(state, (req) => new Promise(res => setTimeout(() => res(target[req.player.id]), delay[req.player.id])), createBus(),
      { parallel: true, afterVote: async (v) => { order.push(v.id); } });
    eq(r.eliminatedId, 'a', 'a éliminé (3 voix)');
    eq(order, ['d', 'b', 'c', 'a'], 'ordre d\'arrivée');
  } },

  // ---------------- MAIRE ----------------
  { module: 'Maire', name: 'Nominal : le plus de voix est élu', run() {
    eq(electMayor([{ targetId: 'a' }, { targetId: 'a' }, { targetId: 'b' }]).mayorId, 'a', 'a élu');
  } },
  { module: 'Maire', name: 'Cas limite : aucun vote → pas de maire', run() {
    eq(electMayor([]).mayorId, null, 'null');
  } },
  { module: 'Maire', name: 'Succession : un seul maire à la fois', async run() {
    const state = { players: [P('m', 'villageois', false), P('a', 'villageois'), P('b', 'loup')] };
    setMayor(state, 'm');
    const to = await runSuccession(state, 'm', async () => 'a', createBus());
    eq(to, 'a', 'successeur');
    eq(state.players.filter(p => p.isMayor).map(p => p.id), ['a'], 'unique');
  } },

  // ---------------- CHRONO ----------------
  { module: 'Chrono', name: 'Nominal : 3 ticks puis fin', async run() {
    const bus = createBus(); const ticks = [];
    bus.on(EVENTS.DEBATE_TICK, p => ticks.push(p.remaining));
    const t = createTimer({ duration: 3, bus, tickMs: 5 });
    const res = await t.start();
    eq(ticks, [2, 1, 0], 'ticks'); eq(res.skipped, false, 'fin naturelle');
  } },
  { module: 'Chrono', name: 'Cas limite : durée 0 → fin immédiate', async run() {
    const res = await createTimer({ duration: 0, tickMs: 5 }).start();
    eq(res.skipped, false, 'fini');
  } },
  { module: 'Chrono', name: 'Cas limite : skip() deux fois → une seule fin', async run() {
    const bus = createBus(); let ends = 0; bus.on(EVENTS.DEBATE_END, () => ends++);
    const t = createTimer({ duration: 10, bus, tickMs: 5 }); t.start(); t.skip(); t.skip();
    await t.done; eq(ends, 1, 'une fin'); eq(formatTime(75), '01:15', 'format');
  } },

  // ---------------- FIN DE PARTIE ----------------
  { module: 'Fin', name: 'Nominal : partie en cours → null', run() {
    eq(checkWinner([P('a', 'loup'), P('b', 'villageois'), P('c', 'voyante')]).winner, null, 'continue');
  } },
  { module: 'Fin', name: 'Cas limite : tous les loups éliminés → village', run() {
    eq(checkWinner([P('a', 'loup', false), P('b', 'villageois')]).winner, 'village', 'village');
  } },
  { module: 'Fin', name: 'Loups aussi nombreux que les autres → loups', run() {
    eq(checkWinner([P('a', 'loup'), P('b', 'villageois'), P('c', 'voyante', false)]).winner, 'loups', 'loups');
  } },
  { module: 'Fin', name: 'Cas limite : plus personne en vie → personne', run() {
    eq(checkWinner([P('a', 'loup', false), P('b', 'villageois', false)]).winner, 'personne', 'personne');
  } },

  // ---------------- JOURNAL ----------------
  { module: 'Journal', name: 'Nominal : écrit une ligne par événement, secrets masqués', run() {
    const bus = createBus();
    const players = { p1: { name: 'Aldric' }, p2: { name: 'Bérénice' } };
    const j = createJournal(bus, id => players[id]);
    bus.emit(EVENTS.PHASE_CHANGE, { phase: 'night', day: 1 });
    bus.emit(EVENTS.NIGHT_WOLVES, { targetId: 'p2' });
    bus.emit(EVENTS.PLAYER_DIED, { id: 'p2', name: 'Bérénice', role: 'villageois', cause: 'loups' });
    eq(j.entries.length, 3, '3 lignes');
    eq(j.publicEntries().length, 2, 'la cible des loups reste secrète');
    assert(j.toText().includes('Bérénice'), 'texte exporté');
  } },
  { module: 'Journal', name: 'Cas limite : événement inconnu → ignoré sans planter', run() {
    const bus = createBus(); const j = createJournal(bus, () => null);
    bus.emit('evenement:inconnu', {}); bus.emit(EVENTS.VOTE_CAST, { voterId: 'x', targetId: null });
    eq(j.entries.length, 1, 'seul le vote est écrit');
  } },
];

/** Lance tous les cas et renvoie [{ module, name, ok, error }]. */
export async function runAll() {
  const results = [];
  for (const c of cases) {
    try { await c.run(); results.push({ module: c.module, name: c.name, ok: true }); }
    catch (e) { results.push({ module: c.module, name: c.name, ok: false, error: e.message }); }
  }
  return results;
}
