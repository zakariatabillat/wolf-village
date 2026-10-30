// ============================================================
//  PARTIE EN LIGNE — tourne sur le serveur
//  Réutilise EXACTEMENT les modules des squads (rôles, nuit, vote, maire,
//  chrono, fin, journal) et les bots. Seule différence avec le mode local :
//  ask() envoie la question au navigateur du bon joueur, et l'affichage
//  est diffusé sous forme de messages "view".
//  Le serveur est l'arbitre : un navigateur ne reçoit que ce qu'il a le droit de voir.
// ============================================================
import { createBus, EVENTS } from '../js/core/bus.js';
import { pick } from '../js/core/rng.js';
import { createGameState, getPlayer, alivePlayers, aliveIds, aliveWithRole, getMayor, markDead } from '../js/core/state.js';
import { assignRoles, ROLES } from '../js/modules/roles.js';
import { runNight } from '../js/modules/night.js';
import { runVote } from '../js/modules/vote.js';
import { runMayorElection, runSuccession, setMayor } from '../js/modules/mayor.js';
import { createTimer } from '../js/modules/timer.js';
import { announceWinner, WINNER_TEXT } from '../js/modules/endgame.js';
import { createJournal } from '../js/modules/journal.js';
import { createBrain } from '../js/ai/bots.js';

const ABORT = Symbol('partie-annulée');
// Temps maximum (secondes) pour répondre ; ensuite un choix automatique est fait.
const TIMEOUT = { 'role-reveal': 25, 'wolf-target': 45, 'seer-target': 45, 'seer-result': 20, 'witch-save': 35, 'witch-poison': 35, vote: 45, 'mayor-vote': 40, 'mayor-tiebreak': 30, 'hunter-shot': 30, 'mayor-successor': 30 };
const BOT_DELAY = { 'role-reveal': 0, 'wolf-target': 1200, 'seer-target': 1100, 'seer-result': 0, 'witch-save': 900, 'witch-poison': 900, vote: 900, 'mayor-vote': 800, 'mayor-tiebreak': 1300, 'hunter-shot': 1500, 'mayor-successor': 1300 };
const BOOLEAN = new Set(['role-reveal', 'seer-result', 'witch-save']);
const NULLABLE = new Set(['vote', 'witch-poison']);
const DEATH_TEXT = {
  loups: (n) => `${n} a été dévoré·e par les loups.`,
  poison: (n) => `${n} a été retrouvé·e empoisonné·e.`,
  vote: (n) => `Le village a condamné ${n}.`,
  chasseur: (n) => `La flèche du chasseur transperce ${n}.`,
};
let gameCounter = 0;

export function createOnlineGame(room, seats, settings) {
  const gameId = `g${++gameCounter}`;
  const bus = createBus();
  const state = createGameState(seats);
  const journal = createJournal(bus, (id) => getPlayer(state, id));
  bus.emit(EVENTS.GAME_START, { players: state.players });
  state.players = assignRoles(state.players, { bus }).players; // ← module Rôles
  const brain = createBrain(state, bus);

  const known = {};            // ce que chaque voyante a découvert : known[seerId][targetId] = role
  const pending = new Map();   // questions en attente : askId → { playerId, req, resolve, timer, deadline }
  let askSeq = 0;
  let aborted = false;
  let ended = false;
  let counts = {};
  let timeOfDay = 'night';
  let timer = null;
  let debate = { on: false, total: 0, remaining: 0, paused: false };
  let chatter = null;
  const accused = new Set();

  // ---------- Outils ----------
  const guard = () => { if (aborted) throw ABORT; };
  const wait = async (ms) => { await new Promise(r => setTimeout(r, ms)); guard(); };
  const memberOf = (pid) => room.members.find(m => m.playerId === pid);
  const isConnected = (pid) => !!memberOf(pid)?.client;
  const all = (op) => room.broadcast({ type: 'view', ...op });
  const toPlayers = (pids, op) => { for (const pid of pids) room.sendTo(memberOf(pid), { type: 'view', ...op }); };
  const narrate = (text, small = '') => all({ op: 'narrate', text, small });
  const nameOf = (id) => getPlayer(state, id)?.name ?? '—';
  const setTime = (mode) => { timeOfDay = mode; all({ op: 'time', mode }); };
  function setPhase(phase) {
    state.phase = phase;
    all({ op: 'phase', phase, day: state.day });
    bus.emit(EVENTS.PHASE_CHANGE, { phase, day: state.day });
  }

  /** La liste des joueurs telle que CE joueur a le droit de la voir (rôles masqués). */
  function viewFor(pid) {
    const me = pid ? getPlayer(state, pid) : null;
    return state.players.map(p => ({
      id: p.id, name: p.name, color: p.color, isBot: p.isBot, alive: p.alive, isMayor: p.isMayor,
      connected: p.isBot || isConnected(p.id),
      role: (ended || !p.alive || p.id === pid || (me?.role === 'loup' && p.role === 'loup') || known[pid]?.[p.id]) ? p.role : null,
    }));
  }
  function pushPlayers() { for (const m of room.members) room.sendTo(m, { type: 'players', players: viewFor(m.playerId), counts }); }

  function initFor(m) {
    const me = m.playerId ? getPlayer(state, m.playerId) : null;
    return {
      type: 'game:init', gameId,
      you: me ? { id: me.id, role: me.role } : null,
      players: viewFor(m.playerId), counts, phase: state.phase, day: state.day, timeOfDay, debate,
      journal: journal.publicEntries(),
    };
  }

  // ---------- Événements du bus → messages ----------
  let shown = journal.entries.length;
  bus.onAny(() => {
    for (; shown < journal.entries.length; shown++) {
      const e = journal.entries[shown];
      if (!e.secret) all({ op: 'journal', entry: e });
    }
  });
  bus.on(EVENTS.NIGHT_WOLVES, ({ targetId }) => { if (targetId) toPlayers(aliveWithRole(state, 'loup').map(p => p.id), { op: 'beam', id: targetId, color: '#e63946' }); });
  bus.on(EVENTS.NIGHT_SEER, ({ seerId, targetId, role }) => {
    (known[seerId] ??= {})[targetId] = role;
    toPlayers([seerId], { op: 'beam', id: targetId, color: '#b388ff' });
    pushPlayers();
  });
  bus.on(EVENTS.NIGHT_WITCH, ({ witchId, saved, poisonedId }) => {
    if (saved && state.lastWolfTarget) toPlayers([witchId], { op: 'beam', id: state.lastWolfTarget, color: '#5ee6a0' });
    if (poisonedId) toPlayers([witchId], { op: 'beam', id: poisonedId, color: '#9dff4f' });
  });
  bus.on(EVENTS.DEBATE_TICK, ({ remaining }) => { debate.remaining = remaining; all({ op: 'timer', remaining, total: debate.total }); });

  // ---------- Questions aux joueurs ----------
  async function ask(req) {
    guard();
    if (req.kind === 'mayor-tiebreak') narrate('Égalité !', `${req.player.name}, en tant que maire, doit trancher.`);
    // Bot, ou humain déconnecté : le cerveau du bot répond à sa place
    if (req.player.isBot || !isConnected(req.player.id)) {
      await wait(BOT_DELAY[req.kind] ?? 700);
      return brain.decide(req);
    }
    const answer = await new Promise((resolve) => {
      const askId = `a${++askSeq}`;
      const seconds = TIMEOUT[req.kind] ?? 40;
      const entry = { playerId: req.player.id, req, resolve, deadline: Date.now() + seconds * 1000 };
      entry.timer = setTimeout(() => settle(askId, brain.decide(req), 'Temps écoulé : choix automatique.'), seconds * 1000);
      pending.set(askId, entry);
      sendAsk(askId, entry);
    });
    guard();
    return answer;
  }
  function sendAsk(askId, e) {
    const seconds = Math.max(1, Math.round((e.deadline - Date.now()) / 1000));
    room.sendTo(memberOf(e.playerId), { type: 'ask', askId, kind: e.req.kind, playerId: e.playerId, candidates: e.req.candidates, context: e.req.context, seconds });
  }
  function settle(askId, value, cancelReason = null) {
    const e = pending.get(askId); if (!e) return;
    pending.delete(askId); clearTimeout(e.timer);
    if (cancelReason) room.sendTo(memberOf(e.playerId), { type: 'ask:cancel', askId, reason: cancelReason });
    e.resolve(value);
  }
  /** Une réponse venant d'un navigateur n'est jamais crue sur parole : on la vérifie. */
  function sanitize(req, value) {
    if (BOOLEAN.has(req.kind)) return value === true;
    if (value === null && NULLABLE.has(req.kind)) return null;
    if (req.candidates.includes(value)) return value;
    return brain.decide(req);
  }

  // ---------- Boucle de jeu (même déroulé que le mode local) ----------
  async function play() {
    narrate('Les cartes sont distribuées…', 'Chacun découvre son rôle en secret.');
    await Promise.all(state.players.map(p => ask({
      kind: 'role-reveal', player: p, candidates: [],
      context: { role: p.role, mates: p.role === 'loup' ? state.players.filter(x => x.role === 'loup' && x.id !== p.id).map(x => x.name) : [] },
    })));
    for (;;) {
      state.day += 1;
      setPhase('night'); setTime('night'); all({ op: 'resetCamera' });
      narrate('La nuit tombe sur Brumeval…', 'Le village s\'endort. Fermez les yeux.');
      await wait(2800);
      const { deaths } = await runNight(state, ask, bus, { step: nightStep }); // ← module Nuit
      all({ op: 'wolves', on: false });

      setPhase('day'); setTime('day');
      narrate('Le soleil se lève sur Brumeval.', deaths.length ? 'Le village découvre l\'horreur de la nuit…' : '');
      await wait(2800);
      if (!deaths.length) { narrate('Miracle : personne n\'est mort cette nuit !', 'Quelqu\'un veillait peut-être dans l\'ombre…'); await wait(2600); }
      await processDeaths(deaths);
      if (announceWinner(state, bus)) return endGame(); // ← module Fin

      if (state.day === 1 && !getMayor(state)) await mayorPhase();
      await debatePhase();
      await votePhase();
      if (announceWinner(state, bus)) return endGame();

      narrate('Le soir tombe sur le village…', 'Qui verra le prochain matin ?');
      await wait(1800);
    }
  }

  async function nightStep(role) {
    const lines = {
      loups: ['Les Loups-Garous se réveillent…', 'Ils se reconnaissent et choisissent leur victime.'],
      voyante: ['La Voyante se réveille…', 'Elle peut découvrir le vrai visage d\'un joueur.'],
      sorciere: ['La Sorcière se réveille…', 'Elle se penche sur ses deux potions.'],
    };
    narrate(...lines[role]);
    all({ op: 'wolves', on: role === 'loups' });
    await wait(1900);
  }

  async function processDeaths(deaths) {
    for (const d of deaths) {
      const p = getPlayer(state, d.id);
      if (!p || !markDead(state, d.id)) continue;
      all({ op: 'focus', id: p.id }); await wait(900);
      all({ op: 'kill', id: p.id, role: p.role });
      bus.emit(EVENTS.PLAYER_DIED, { id: p.id, name: p.name, role: p.role, cause: d.cause });
      narrate(DEATH_TEXT[d.cause](p.name), `Son rôle : ${ROLES[p.role].label} ${ROLES[p.role].icon}`);
      pushPlayers();
      await wait(3200);

      if (p.role === 'chasseur') {
        const cands = aliveIds(state);
        if (cands.length) {
          narrate(`${p.name} était le Chasseur !`, 'Dans un dernier souffle, il bande son arc…');
          await wait(1500);
          const t = await ask({ kind: 'hunter-shot', player: p, candidates: cands, context: {} });
          if (t && cands.includes(t)) {
            bus.emit(EVENTS.HUNTER_SHOT, { hunterId: p.id, targetId: t });
            all({ op: 'voteLine', from: p.id, to: t, color: '#ffd166' }); await wait(900);
            await processDeaths([{ id: t, cause: 'chasseur' }]);
            all({ op: 'clearVotes' });
          }
        }
      }
      if (p.isMayor) {
        if (aliveIds(state).length) {
          narrate(`${p.name} était le maire.`, 'Il transmet son écharpe avant de partir…');
          await wait(1500);
          const to = await runSuccession(state, p.id, ask, bus); // ← module Maire
          all({ op: 'mayor', id: to }); pushPlayers();
          narrate(`${nameOf(to)} devient maire.`);
          await wait(2200);
        } else setMayor(state, null);
      }
    }
    all({ op: 'resetCamera' });
  }

  async function mayorPhase() {
    setPhase('mayor');
    narrate('Le village doit élire son maire.', 'Tout le monde vote en même temps. Sa voix comptera double.');
    await wait(2600);
    counts = {};
    const mayorId = await runMayorElection(state, ask, bus, {
      parallel: true,
      afterVote: async (voter, target) => {
        if (!target) return;
        counts[target] = (counts[target] ?? 0) + 1;
        all({ op: 'voteLine', from: voter.id, to: target, color: '#e9c46a' });
        all({ op: 'badge', id: target, n: counts[target], gold: true });
        pushPlayers();
        await wait(250);
      },
    });
    await wait(1000);
    counts = {}; all({ op: 'clearVotes' });
    if (mayorId) {
      all({ op: 'mayor', id: mayorId }); all({ op: 'focus', id: mayorId });
      narrate(`${nameOf(mayorId)} reçoit l'écharpe de maire !`, 'Que sa sagesse guide le village.');
      await wait(3000);
      all({ op: 'resetCamera' });
    }
    pushPlayers();
  }

  async function debatePhase() {
    setPhase('debate');
    const humansAlive = alivePlayers(state).filter(p => !p.isBot && isConnected(p.id));
    const total = humansAlive.length ? settings.debate : Math.min(settings.debate, 20);
    narrate('Le village débat.', 'Écrivez dans le chat, accusez, défendez-vous !');
    accused.clear();
    timer = createTimer({ duration: total, bus }); // ← module Chrono
    debate = { on: true, total, remaining: total, paused: false };
    all({ op: 'debate', ...debate });
    chatter = startChatter();
    await timer.start();
    chatter.stop(); timer = null;
    debate = { on: false, total: 0, remaining: 0, paused: false };
    all({ op: 'debate', ...debate });
    guard();
  }

  function startChatter() {
    let stopped = false; let to;
    const loop = () => {
      if (stopped || aborted) return;
      const bot = pick(alivePlayers(state).filter(p => p.isBot));
      if (bot) {
        const line = brain.speak(bot);
        if (line) { bus.emit(EVENTS.CHAT, { id: bot.id, ...line }); all({ op: 'say', id: bot.id, text: line.text, accuse: !!line.accuse }); }
      }
      to = setTimeout(loop, 3000 + Math.random() * 3500);
    };
    to = setTimeout(loop, 1500);
    return { stop() { stopped = true; clearTimeout(to); } };
  }

  async function votePhase() {
    setPhase('vote');
    narrate('L\'heure du vote a sonné.', 'Tout le monde vote en même temps.');
    await wait(2200);
    const mayor = getMayor(state);
    counts = {};
    const result = await runVote(state, ask, bus, { // ← module Vote
      parallel: true,
      afterVote: async (voter, target) => {
        if (!target) { all({ op: 'say', id: voter.id, text: 'Je m\'abstiens.' }); return; }
        counts[target] = (counts[target] ?? 0) + (mayor && voter.id === mayor.id ? 2 : 1);
        all({ op: 'voteLine', from: voter.id, to: target, color: voter.color });
        all({ op: 'badge', id: target, n: counts[target] });
        pushPlayers();
        await wait(350);
      },
    });
    await wait(1300);
    counts = {};
    if (result.eliminatedId) {
      narrate('Le verdict est tombé…'); await wait(1300);
      all({ op: 'clearVotes' });
      await processDeaths([{ id: result.eliminatedId, cause: 'vote' }]);
    } else {
      narrate(result.tie ? 'Égalité parfaite !' : 'Personne n\'a voté.', 'Le village ne parvient pas à se décider : personne n\'est éliminé.');
      await wait(3000);
      all({ op: 'clearVotes' });
    }
    pushPlayers();
  }

  async function endGame() {
    ended = true;
    const w = state.winner;
    setPhase('end'); setTime(w === 'loups' ? 'blood' : 'day');
    pushPlayers();
    narrate(WINNER_TEXT[w].title, WINNER_TEXT[w].sub);
    all({ op: 'sound', name: w === 'loups' ? 'howl' : 'victory' });
    await wait(3800);
    const dead = state.players.filter(p => !p.alive).length;
    room.broadcast({ type: 'end', gameId, winner: w, players: viewFor(null), entries: journal.entries, stats: { nights: state.day, deaths: dead, survivors: state.players.length - dead } });
    room.onGameEnd();
  }

  // ---------- Messages venant des navigateurs ----------
  function handle(member, msg) {
    const pid = member.playerId;
    const me = pid ? getPlayer(state, pid) : null;
    switch (msg.type) {
      case 'answer': {
        const e = pending.get(msg.askId);
        if (e && e.playerId === pid) settle(msg.askId, sanitize(e.req, msg.value));
        return;
      }
      case 'chat': {
        const text = String(msg.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (!text || ended) return;
        const now = Date.now();
        if (now - (member.lastChat ?? 0) < 800) return; // anti-spam
        member.lastChat = now;
        if (!me || !me.alive) return room.sendTo(member, { type: 'toast', text: 'Les morts ne parlent pas… 👻' });
        if (state.phase === 'night') {
          // La nuit, seuls les loups peuvent parler, et seulement entre eux
          if (me.role !== 'loup') return room.sendTo(member, { type: 'toast', text: 'Chut… c\'est la nuit 🌙' });
          toPlayers(aliveWithRole(state, 'loup').map(p => p.id), { op: 'chat', id: pid, text, channel: 'meute' });
          return;
        }
        bus.emit(EVENTS.CHAT, { id: pid, text });
        all({ op: 'say', id: pid, text });
        return;
      }
      case 'accuse': {
        if (!me?.alive || !debate.on || accused.has(pid)) return;
        const target = getPlayer(state, msg.id);
        if (!target?.alive || target.id === pid) return;
        accused.add(pid);
        const text = `J'accuse ${target.name} !`;
        bus.emit(EVENTS.CHAT, { id: pid, text, accuse: target.id });
        all({ op: 'say', id: pid, text, accuse: true });
        return;
      }
      case 'debate': {
        if (!timer || !room.isHost(member)) return;
        if (msg.action === 'skip') timer.skip();
        if (msg.action === 'add') { timer.addTime(30); debate.total += 30; }
        if (msg.action === 'pause') timer.pause();
        if (msg.action === 'resume') timer.resume();
        debate.paused = timer.paused;
        all({ op: 'debate-paused', paused: debate.paused });
        return;
      }
      default:
    }
  }

  return {
    gameId,
    start() {
      for (const m of room.members) room.sendTo(m, initFor(m));
      play().catch((err) => {
        if (err === ABORT) return;
        console.error(err);
        room.broadcast({ type: 'error', message: `Erreur du serveur : ${err.message}` });
        room.onGameEnd();
      });
    },
    handle,
    /** Un joueur revient (rechargement) : on lui renvoie tout l'état et sa question en cours. */
    resync(member) {
      room.sendTo(member, initFor(member));
      for (const [askId, e] of pending) if (e.playerId === member.playerId) sendAsk(askId, e);
    },
    onConnectionChange() { if (!aborted) pushPlayers(); },
    onLeave(pid) { for (const [askId, e] of pending) if (e.playerId === pid) settle(askId, brain.decide(e.req)); },
    abort() {
      aborted = true; timer?.skip(); chatter?.stop();
      for (const [askId, e] of pending) { clearTimeout(e.timer); pending.delete(askId); e.resolve(undefined); }
    },
  };
}
