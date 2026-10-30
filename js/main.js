// ============================================================
//  ORCHESTRATEUR — branche les modules des squads entre eux
//  Ordre d'une partie : rôles → [nuit → jour → (maire) → débat → vote] × N → fin
// ============================================================
import { createBus, EVENTS } from './core/bus.js';
import { pick } from './core/rng.js';
import { createGameState, getPlayer, alivePlayers, aliveIds, aliveWithRole, getMayor, humans, markDead } from './core/state.js';
import { assignRoles, ROLES } from './modules/roles.js';
import { runNight } from './modules/night.js';
import { runVote } from './modules/vote.js';
import { runMayorElection, runSuccession, setMayor } from './modules/mayor.js';
import { createTimer } from './modules/timer.js';
import { announceWinner, WINNER_TEXT } from './modules/endgame.js';
import { createJournal } from './modules/journal.js';
import { createBrain } from './ai/bots.js';
import { createUI, DEFAULT_NAMES } from './ui/ui.js';
import { createNarrator, createAmbience } from './ui/audio.js';
import { showAskPanel } from './ui/ask-panel.js';
import { createOnline, checkServer } from './online.js';

const stageEl = document.getElementById('stage');
const labelsEl = document.getElementById('labels');
const narrator = createNarrator();
const ambience = createAmbience();
const ABORT = Symbol('partie-annulée');

let scene = createNullScene();
let G = null;          // contexte de la partie en cours
let gameCounter = 0;
let lastCfg = null;

// ---------------- Réglages mémorisés ----------------
const DEFAULT_CFG = {
  players: DEFAULT_NAMES.slice(0, 8).map((name, i) => ({ name: i === 0 ? 'Moi' : name, isBot: i !== 0 })),
  debate: 60, speed: 1, voice: false, sound: true,
};
function loadSettings() {
  try { return { ...DEFAULT_CFG, ...JSON.parse(localStorage.getItem('lg3d-settings')) }; } catch { return DEFAULT_CFG; }
}
function saveSettings(cfg) { try { localStorage.setItem('lg3d-settings', JSON.stringify(cfg)); } catch { /* stockage indisponible */ } }

// ---------------- Interface ----------------
let online = null; // client du mode en ligne (créé juste après l'interface)
const ui = createUI({
  onStart: startGame,
  onReplay: () => lastCfg && startGame(lastCfg),
  onMenu: () => (online?.active ? online.leave() : backToMenu()),
  onToggleVoice: () => { narrator.setEnabled(!narrator.enabled); return narrator.enabled; },
  onToggleSound: () => { ambience.setEnabled(!ambience.enabled); return ambience.enabled; },
  onToggleRoles: () => { if (!G) return false; G.revealAll = !G.revealAll; refresh(G); return G.revealAll; },
  // ----- mode en ligne -----
  onCreateRoom: (o) => { abortCurrent(); online.create(o); },
  onJoinRoom: (o) => { abortCurrent(); online.join(o); },
  onLobbySettings: (s) => online.settings(s),
  onStartOnline: () => online.start(),
  onLeaveRoom: () => online.leave(),
  onChat: (text) => online?.chat(text),
});
online = createOnline({
  ui, getScene: () => scene, narrator, ambience,
  onExit: () => {
    scene.setPlayers([]); scene.setTimeOfDay('night'); scene.setAutoRotate(true); scene.resetCamera();
    history.replaceState(null, '', location.pathname);
    ui.showSetup(lastCfg ?? loadSettings()); ui.setTab('online');
  },
});
ui.showSetup(loadSettings());
loadScene();

// Le serveur en ligne est-il disponible ? Un lien ?salle=ABCD ouvre directement l'onglet "En ligne".
const sharedCode = new URLSearchParams(location.search).get('salle');
if (sharedCode) { ui.setTab('online'); ui.prefillCode(sharedCode.toUpperCase().slice(0, 4)); }
checkServer().then((ok) => ui.setOnlineStatus(ok
  ? 'Serveur connecté ✔ Crée une salle, ou entre le code d\'un ami.'
  : 'Mode en ligne indisponible ici : lance « node server/server.js » puis ouvre l\'adresse affichée (voir README).', ok));

async function loadScene() {
  try {
    const mod = await import('./scene/scene3d.js');
    scene = mod.createVillageScene(stageEl, labelsEl, { onPick: (id) => ui.select(id) });
    ui.setThreeStatus('Village 3D prêt ✨ Fais glisser pour tourner autour du feu, molette pour zoomer.');
    if (G) { scene.setPlayers(G.state.players); refresh(G); }
  } catch (err) {
    console.warn('Three.js indisponible → mode 2D', err);
    document.body.classList.add('no-3d');
    ui.setThreeStatus('Mode 2D : la 3D n\'a pas pu charger (connexion ?). Le jeu reste entièrement jouable.');
  }
}

// ---------------- Outils de partie ----------------
function guard(g) { if (g !== G || g.aborted) throw ABORT; }
async function wait(g, ms) { await new Promise(r => setTimeout(r, ms * g.settings.speed)); guard(g); }
const nameOf = (g, id) => getPlayer(g.state, id)?.name ?? '—';
const chip = (p) => ({ id: p.id, name: p.name, color: p.color });
const soloHuman = (g) => { const h = humans(g.state); return h.length === 1 ? h[0] : null; };
/** Peut-on montrer une action secrète à l'écran ? (mode démo, ou le seul humain est l'acteur) */
function canSee(g, actorIds) {
  const h = humans(g.state);
  if (h.length === 0) return true;
  return h.length === 1 && actorIds.includes(h[0].id);
}
function narrate(g, text, small = '') { ui.subtitle(text, small); narrator.say(small ? `${text} ${small}` : text); }
function setPhase(g, phase) { g.state.phase = phase; ui.setPhase(phase, g.state.day); g.bus.emit(EVENTS.PHASE_CHANGE, { phase, day: g.state.day }); }

function refresh(g, counts = {}) {
  const viewer = soloHuman(g);
  ui.renderRoster(g.state, { counts, viewer, revealAll: g.revealAll, known: g.known });
  for (const p of g.state.players) {
    const show = g.revealAll || !p.alive || g.known[p.id]
      || (viewer && (p.id === viewer.id || (viewer.role === 'loup' && p.role === 'loup')));
    if (show) scene.showRole(p.id, p.role); else scene.hideRole(p.id);
  }
}

// ---------------- Démarrage ----------------
async function startGame(cfg) {
  lastCfg = cfg; saveSettings(cfg);
  abortCurrent();
  ambience.start(); ambience.setEnabled(cfg.sound); narrator.setEnabled(cfg.voice);
  ui.setButtonState('#btn-voice', narrator.enabled); ui.setButtonState('#btn-sound', cfg.sound);

  const bus = createBus({ debug: true });
  const state = createGameState(cfg.players);
  const journal = createJournal(bus, (id) => getPlayer(state, id));
  bus.emit(EVENTS.GAME_START, { players: state.players });
  const res = assignRoles(state.players, { bus }); // ← module Rôles (émet roles:assigned)
  if (!res.ok) { ui.setupError(res.error); journal.destroy(); return; }
  state.players = res.players;

  const g = G = { id: ++gameCounter, bus, state, journal, settings: cfg, known: {}, revealAll: humans(state).length === 0, aborted: false };
  g.brain = createBrain(state, bus);
  ui.setButtonState('#btn-roles', g.revealAll);
  wireListeners(g);

  ui.enterGame();
  ui.setChat({ visible: false }); ui.setButtonVisible('#btn-roles', true);
  for (const e of journal.publicEntries()) ui.addJournal(e);
  scene.setPlayers(state.players); scene.setMayor(null); scene.setTimeOfDay('night'); scene.resetCamera();
  refresh(g);

  try { await playGame(g); }
  catch (err) { if (err !== ABORT) { console.error(err); ui.toast(`Erreur : ${err.message}`, 6000); } }
}

function wireListeners(g) {
  // Journal → panneau (les secrets ne s'affichent qu'en mode démo)
  let shown = g.journal.entries.length;
  g.bus.onAny(() => {
    const spectator = humans(g.state).length === 0;
    for (; shown < g.journal.entries.length; shown++) {
      const e = g.journal.entries[shown];
      if (!e.secret || spectator) ui.addJournal(e);
    }
  });
  // Effets visuels des actions secrètes
  g.bus.on(EVENTS.NIGHT_WOLVES, ({ targetId }) => {
    if (targetId && canSee(g, aliveWithRole(g.state, 'loup').map(p => p.id))) scene.beam(targetId, '#e63946', 1.8);
  });
  g.bus.on(EVENTS.NIGHT_SEER, ({ seerId, targetId, role }) => {
    if (!canSee(g, [seerId])) return;
    g.known[targetId] = role; scene.beam(targetId, '#b388ff', 2.4); refresh(g);
  });
  g.bus.on(EVENTS.NIGHT_WITCH, ({ witchId, saved, poisonedId }) => {
    if (!canSee(g, [witchId])) return;
    if (saved && g.state.lastWolfTarget) scene.beam(g.state.lastWolfTarget, '#5ee6a0', 2);
    if (poisonedId) scene.beam(poisonedId, '#9dff4f', 2);
  });
}

function abortCurrent() {
  if (G) { G.aborted = true; G.timer?.skip(); G.journal.destroy(); }
  G = null;
  ui.cancelAll();
  scene.setSelectable(null); scene.clearVoteLines(); scene.clearBadges(); scene.wolves(false);
}
function backToMenu() {
  abortCurrent();
  scene.setPlayers([]); scene.setTimeOfDay('night'); scene.setAutoRotate(true); scene.resetCamera();
  ui.showSetup(lastCfg ?? loadSettings());
}

// ---------------- Boucle de jeu ----------------
async function playGame(g) {
  const { state } = g;
  const ask = makeAsk(g);
  await revealRoles(g);

  for (;;) {
    state.day += 1;

    // ===== NUIT =====
    setPhase(g, 'night');
    scene.setTimeOfDay('night'); ambience.setNight(true); scene.setAutoRotate(true); scene.resetCamera();
    narrate(g, 'La nuit tombe sur Brumeval…', 'Le village s\'endort. Fermez les yeux.');
    await wait(g, 2800);
    const { deaths } = await runNight(state, ask, g.bus, { step: (role) => nightStep(g, role) });
    guard(g);
    scene.wolves(false);

    // ===== JOUR =====
    setPhase(g, 'day');
    scene.setTimeOfDay('day'); ambience.setNight(false);
    narrate(g, 'Le soleil se lève sur Brumeval.', deaths.length ? 'Le village découvre l\'horreur de la nuit…' : '');
    await wait(g, 2800);
    if (!deaths.length) { narrate(g, 'Miracle : personne n\'est mort cette nuit !', 'Quelqu\'un veillait peut-être dans l\'ombre…'); ambience.chime(440); await wait(g, 2600); }
    await processDeaths(g, deaths, ask);
    if (announceWinner(state, g.bus)) return endGame(g);

    if (state.day === 1 && !getMayor(state)) await mayorPhase(g, ask);
    await debatePhase(g);
    await votePhase(g, ask);
    if (announceWinner(state, g.bus)) return endGame(g);

    narrate(g, 'Le soir tombe sur le village…', 'Qui verra le prochain matin ?');
    await wait(g, 1800);
  }
}

async function revealRoles(g) {
  const hs = humans(g.state);
  narrate(g, 'Les cartes sont distribuées…', hs.length ? 'Chacun découvre son rôle en secret.' : 'Mode démo : tous les rôles sont visibles.');
  await wait(g, 2000);
  for (const h of hs) {
    if (hs.length > 1) { await ui.curtain(h, 'Tu vas découvrir ton rôle'); guard(g); }
    const mates = h.role === 'loup' ? g.state.players.filter(p => p.role === 'loup' && p.id !== h.id).map(p => p.name) : [];
    await ui.roleCard(h.role, { mates }); guard(g);
  }
  refresh(g);
}

async function nightStep(g, role) {
  const lines = {
    loups: ['Les Loups-Garous se réveillent…', 'Ils se reconnaissent et choisissent leur victime.'],
    voyante: ['La Voyante se réveille…', 'Elle peut découvrir le vrai visage d\'un joueur.'],
    sorciere: ['La Sorcière se réveille…', 'Elle se penche sur ses deux potions.'],
  };
  narrate(g, ...lines[role]);
  if (role === 'loups') { scene.wolves(true); ambience.howl(); ui.flash('rgba(120,0,10,0.45)'); } else scene.wolves(false);
  await wait(g, 1900);
}

const DEATH_TEXT = {
  loups: (n) => `${n} a été dévoré·e par les loups.`,
  poison: (n) => `${n} a été retrouvé·e empoisonné·e.`,
  vote: (n) => `Le village a condamné ${n}.`,
  chasseur: (n) => `La flèche du chasseur transperce ${n}.`,
};

/** Applique les morts une par une (avec chasseur et succession du maire en cascade). */
async function processDeaths(g, deaths, ask) {
  const { state } = g;
  for (const d of deaths) {
    const p = getPlayer(state, d.id);
    if (!p || !markDead(state, d.id)) continue;
    scene.focus(p.id); await wait(g, 900);
    scene.kill(p.id, p.role); ambience.chime(110, 2.4); ui.flash();
    g.bus.emit(EVENTS.PLAYER_DIED, { id: p.id, name: p.name, role: p.role, cause: d.cause });
    narrate(g, DEATH_TEXT[d.cause](p.name), `Son rôle : ${ROLES[p.role].label} ${ROLES[p.role].icon}`);
    refresh(g);
    await wait(g, 3200);

    if (p.role === 'chasseur') {
      const cands = aliveIds(state);
      if (cands.length) {
        narrate(g, `${p.name} était le Chasseur !`, 'Dans un dernier souffle, il bande son arc…');
        await wait(g, 1500);
        const t = await ask({ kind: 'hunter-shot', player: p, candidates: cands, context: {} });
        if (t && cands.includes(t)) {
          g.bus.emit(EVENTS.HUNTER_SHOT, { hunterId: p.id, targetId: t });
          scene.voteLine(p.id, t, '#ffd166'); await wait(g, 900);
          await processDeaths(g, [{ id: t, cause: 'chasseur' }], ask);
          scene.clearVoteLines();
        }
      }
    }
    if (p.isMayor) {
      if (aliveIds(state).length) {
        narrate(g, `${p.name} était le maire.`, 'Il transmet son écharpe avant de partir…');
        await wait(g, 1500);
        const to = await runSuccession(state, p.id, ask, g.bus); // ← module Maire
        scene.setMayor(to); refresh(g);
        narrate(g, `${nameOf(g, to)} devient maire.`); ambience.chime(330);
        await wait(g, 2200);
      } else setMayor(state, null);
    }
  }
  scene.resetCamera();
}

async function mayorPhase(g, ask) {
  setPhase(g, 'mayor');
  narrate(g, 'Le village doit élire son maire.', 'Sa voix comptera double et il tranchera les égalités.');
  await wait(g, 2600);
  const counts = {};
  const mayorId = await runMayorElection(g.state, ask, g.bus, {
    afterVote: async (voter, target) => {
      if (!target) return;
      counts[target] = (counts[target] ?? 0) + 1;
      scene.voteLine(voter.id, target, '#e9c46a'); scene.setBadge(target, counts[target], true); refresh(g, counts);
      await wait(g, voter.isBot ? 260 : 60);
    },
  });
  await wait(g, 1000);
  scene.clearVoteLines(); scene.clearBadges();
  if (mayorId) {
    scene.setMayor(mayorId); scene.focus(mayorId); ambience.chime(330, 2);
    narrate(g, `${nameOf(g, mayorId)} reçoit l'écharpe de maire !`, 'Que sa sagesse guide le village.');
    await wait(g, 3000);
    scene.resetCamera();
  }
  refresh(g);
}

async function debatePhase(g) {
  setPhase(g, 'debate');
  const alive = humans(g.state).filter(p => p.alive);
  const total = alive.length ? g.settings.debate : Math.min(g.settings.debate, 25);
  narrate(g, 'Le village débat.', alive.length ? 'Discutez, accusez, défendez-vous !' : 'Les villageois s\'accusent mutuellement…');
  setTimeout(() => { if (g === G && g.state.phase === 'debate') ui.subtitle(''); }, 4000);

  const timer = createTimer({ duration: total, bus: g.bus }); // ← module Chrono
  g.timer = timer;
  const solo = alive.length === 1 ? alive[0] : null;
  ui.showDebate({
    timer, total,
    accusers: solo ? [solo] : [],
    candidates: solo ? alivePlayers(g.state).filter(p => p.id !== solo.id).map(chip) : [],
    onAccuse: (id) => {
      const text = `J'accuse ${nameOf(g, id)} !`;
      g.bus.emit(EVENTS.CHAT, { id: solo.id, text, accuse: id });
      scene.say(solo.id, text, 4000, true);
    },
  });
  const offTick = g.bus.on(EVENTS.DEBATE_TICK, ({ remaining }) => ui.setTimer(remaining, total));
  const chatter = startChatter(g);
  await timer.start();
  offTick(); chatter.stop(); ui.hideDebate(); ui.setTimer(null);
  guard(g);
}

/** Les bots parlent pendant le débat (bulles 3D + journal). */
function startChatter(g) {
  let stopped = false; let to;
  const loop = () => {
    if (stopped || g !== G) return;
    const bots = alivePlayers(g.state).filter(p => p.isBot);
    const bot = pick(bots);
    if (bot) {
      const line = g.brain.speak(bot);
      if (line) { g.bus.emit(EVENTS.CHAT, { id: bot.id, ...line }); scene.say(bot.id, line.text, 4300, !!line.accuse); }
    }
    to = setTimeout(loop, 2300 + Math.random() * 2600);
  };
  to = setTimeout(loop, 1300);
  return { stop() { stopped = true; clearTimeout(to); } };
}

async function votePhase(g, ask) {
  setPhase(g, 'vote');
  narrate(g, 'L\'heure du vote a sonné.', 'Chacun désigne celui qu\'il soupçonne.');
  await wait(g, 2200);
  const mayor = getMayor(g.state);
  const counts = {};
  const result = await runVote(g.state, ask, g.bus, { // ← module Vote
    afterVote: async (voter, target) => {
      if (!target) { scene.say(voter.id, 'Je m\'abstiens.', 1800); return; }
      counts[target] = (counts[target] ?? 0) + (mayor && voter.id === mayor.id ? 2 : 1);
      scene.voteLine(voter.id, target, voter.color); scene.setBadge(target, counts[target]); refresh(g, counts);
      await wait(g, voter.isBot ? 400 : 60);
    },
  });
  await wait(g, 1300);
  if (result.eliminatedId) {
    narrate(g, 'Le verdict est tombé…'); await wait(g, 1300);
    scene.clearVoteLines(); scene.clearBadges();
    await processDeaths(g, [{ id: result.eliminatedId, cause: 'vote' }], ask);
  } else {
    narrate(g, result.tie ? 'Égalité parfaite !' : 'Personne n\'a voté.', 'Le village ne parvient pas à se décider : personne n\'est éliminé.');
    await wait(g, 3000);
    scene.clearVoteLines(); scene.clearBadges();
  }
  refresh(g);
}

async function endGame(g) {
  const { state } = g;
  const w = state.winner;
  setPhase(g, 'end');
  scene.setTimeOfDay(w === 'loups' ? 'blood' : 'day');
  g.revealAll = true; refresh(g);
  scene.resetCamera(); scene.setAutoRotate(true);
  narrate(g, WINNER_TEXT[w].title, WINNER_TEXT[w].sub);
  if (w === 'loups') ambience.howl(); else ambience.chime(262, 3);
  await wait(g, 3800);
  ui.subtitle('');
  const dead = state.players.filter(p => !p.alive).length;
  ui.showEnd({ winner: w, state, journal: g.journal, stats: { nights: state.day, deaths: dead, survivors: state.players.length - dead } });
}

// ---------------- Routeur des choix : bot ou humain ----------------
const BOT_DELAY = { 'wolf-target': 1200, 'seer-target': 1100, 'seer-result': 0, 'witch-save': 900, 'witch-poison': 900, vote: 450, 'mayor-vote': 400, 'mayor-tiebreak': 1300, 'hunter-shot': 1500, 'mayor-successor': 1300 };
const SECRET = new Set(['wolf-target', 'seer-target', 'seer-result', 'witch-save', 'witch-poison']);
const CURTAIN_TEXT = { 'wolf-target': 'La meute t\'appelle', 'seer-target': 'La Voyante se réveille', 'seer-result': 'Ta vision arrive', 'witch-save': 'La Sorcière se réveille', 'witch-poison': 'La Sorcière hésite encore' };

function makeAsk(g) {
  return async function ask(req) {
    guard(g);
    if (req.kind === 'mayor-tiebreak') { narrate(g, 'Égalité !', `${req.player.name}, en tant que maire, doit trancher.`); }
    let answer;
    if (req.player.isBot) {
      await wait(g, BOT_DELAY[req.kind] ?? 600);
      answer = g.brain.decide(req);
    } else {
      answer = await humanAsk(g, req);
    }
    guard(g);
    return answer;
  };
}

async function humanAsk(g, req) {
  if (SECRET.has(req.kind) && humans(g.state).length > 1 && req.kind !== 'seer-result') { await ui.curtain(req.player, CURTAIN_TEXT[req.kind]); guard(g); }
  return showAskPanel({ ui, scene, req, lookup: (id) => chip(getPlayer(g.state, id)) }); // panneau partagé avec le mode en ligne
}

/** Scène "vide" si Three.js ne charge pas : le jeu reste jouable en 2D. */
function createNullScene() {
  const noop = () => {};
  return { ok: false, setPlayers: noop, kill: noop, beam: noop, burst: noop, voteLine: noop, clearVoteLines: noop, setBadge: noop, clearBadges: noop, showRole: noop, hideRole: noop, say: noop, setMayor: noop, setSelectable: noop, setSelected: noop, focus: noop, resetCamera: noop, setAutoRotate: noop, setTimeOfDay: noop, wolves: noop, destroy: noop };
}

// Accès console pour déboguer pendant la démo : window.lg.state()
window.lg = { state: () => G?.state, journal: () => G?.journal.toText(), bus: () => G?.bus };
