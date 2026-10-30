// ============================================================
//  CLIENT EN LIGNE — le navigateur d'un joueur
//  Il ne connaît PAS les règles : il affiche ce que le serveur envoie
//  et renvoie les choix du joueur. Le serveur est l'arbitre.
//
//  Messages reçus : welcome, room, game:init, players, view, ask, ask:cancel, end, error, toast
//  Messages envoyés : create, join, leave, settings, start, restart, lobby, answer, chat, accuse, debate
// ============================================================
import { ROLES } from './modules/roles.js';
import { WINNER_TEXT } from './modules/endgame.js';
import { showAskPanel } from './ui/ask-panel.js';

export function createOnline({ ui, getScene, narrator, ambience, onExit }) {
  let ws = null;
  let room = null;          // dernier état du salon reçu
  let me = null;            // { id, role } dans la partie en cours
  let players = [];         // liste publique (rôles masqués par le serveur)
  let counts = {};
  let phase = 'lobby';
  let day = 0;
  let gameId = null;
  let currentAskId = null;
  let debateOn = false;
  let paused = false;
  let wantClose = false;
  let lastJoin = null;      // pour se reconnecter automatiquement

  const token = getToken();
  const scene = () => getScene();
  const send = (msg) => { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); };
  const byId = (id) => players.find(p => p.id === id);
  const lookup = (id) => { const p = byId(id); return p ? { id: p.id, name: p.name, color: p.color } : { id, name: '—', color: '#888' }; };

  function getToken() {
    try {
      let t = localStorage.getItem('lg3d-token');
      if (!t) { t = crypto.getRandomValues(new Uint32Array(4)).join('-'); localStorage.setItem('lg3d-token', t); }
      return t;
    } catch { return `t-${Math.random().toString(36).slice(2)}-${Date.now()}`; }
  }

  // ---------------- Connexion ----------------
  function connect() {
    return new Promise((resolve, reject) => {
      if (ws && ws.readyState === 1) return resolve();
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      ws = new WebSocket(url);
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Serveur injoignable'));
      ws.onmessage = (ev) => { try { handle(JSON.parse(ev.data)); } catch (err) { console.error(err); } };
      ws.onclose = () => {
        ws = null;
        if (wantClose || !lastJoin) return;
        ui.toast('Connexion perdue… reconnexion 🔄', 2500);
        setTimeout(() => connect().then(() => send({ type: 'join', ...lastJoin, token })).catch(() => ws?.onclose?.()), 1500);
      };
    });
  }

  async function create({ name, voice, sound }) {
    setAudio(voice, sound);
    try { await connect(); } catch { return ui.onlineError('Serveur injoignable. Lance « node server/server.js » (voir README).'); }
    wantClose = false;
    send({ type: 'create', name, token });
    lastJoin = { name, code: null };
  }

  async function join({ code, name, voice, sound }) {
    setAudio(voice, sound);
    try { await connect(); } catch { return ui.onlineError('Serveur injoignable. Lance « node server/server.js » (voir README).'); }
    wantClose = false;
    lastJoin = { name, code };
    send({ type: 'join', code, name, token });
  }

  function setAudio(voice, sound) {
    ambience.start(); ambience.setEnabled(sound); narrator.setEnabled(voice);
    ui.setButtonState('#btn-voice', narrator.enabled); ui.setButtonState('#btn-sound', sound);
  }

  function leave() {
    wantClose = true; lastJoin = null;
    send({ type: 'leave' });
    try { ws?.close(); } catch { /* */ }
    reset();
    onExit();
  }

  function reset() {
    room = null; me = null; players = []; gameId = null; currentAskId = null; debateOn = false;
    ui.cancelAll(); ui.cancelOverlay(); ui.setChat({ visible: false });
    scene().setSelectable(null); scene().clearVoteLines(); scene().clearBadges(); scene().wolves(false);
  }

  // ---------------- Réception ----------------
  function handle(msg) {
    switch (msg.type) {
      case 'welcome': return;
      case 'error':
        if (room) { ui.lobbyError(msg.message); ui.toast(msg.message, 3500); } else ui.onlineError(msg.message);
        return;
      case 'toast': ui.toast(msg.text); return;
      case 'room': return onRoom(msg);
      case 'game:init': return onInit(msg);
      case 'players': players = msg.players; counts = msg.counts ?? {}; return renderPlayers();
      case 'view': return onView(msg);
      case 'ask': return onAsk(msg);
      case 'ask:cancel':
        if (msg.askId === currentAskId) { currentAskId = null; ui.cancelAsk(); ui.cancelOverlay(); if (msg.reason) ui.toast(msg.reason); }
        return;
      case 'end': return onEnd(msg);
      default:
    }
  }

  function onRoom(r) {
    const first = !room;
    room = r;
    if (lastJoin) lastJoin.code = r.code;
    if (first) history.replaceState(null, '', `${location.pathname}?salle=${r.code}`);
    if (r.phase === 'lobby') { gameId = null; me = null; ui.hideEndIfAny?.(); ui.showLobby(r); }
    else if (r.phase === 'game' && r.you.spectator && !gameId) ui.toast('Partie en cours : tu regardes en spectateur 👀', 4000);
  }

  function onInit(g) {
    gameId = g.gameId;
    me = g.you; players = g.players; counts = g.counts ?? {}; phase = g.phase; day = g.day;
    ui.hideLobby(); ui.hideEnd(); ui.cancelAll(); ui.cancelOverlay();
    ui.enterGame();
    ui.setButtonVisible('#btn-roles', false);
    ui.setPhase(phase === 'setup' ? 'night' : phase, Math.max(1, day));
    scene().setPlayers(players); scene().setTimeOfDay(g.timeOfDay); scene().resetCamera(); scene().clearVoteLines(); scene().clearBadges();
    for (const e of g.journal) ui.addJournal(e);
    renderPlayers();
    updateChat();
    if (g.debate?.on) startDebate(g.debate); else stopDebate();
    if (!me) ui.subtitle('Tu regardes la partie en spectateur 👀', 'Tu joueras à la prochaine.');
  }

  function renderPlayers() {
    const viewer = me ? { ...byId(me.id), role: me.role } : null;
    const known = Object.fromEntries(players.filter(p => p.role).map(p => [p.id, true]));
    ui.renderRoster({ players }, { counts, viewer, revealAll: false, known });
    for (const p of players) { if (p.role) scene().showRole(p.id, p.role); else scene().hideRole(p.id); }
    if (me) { const self = byId(me.id); if (self && !self.alive) updateChat(); }
  }

  function updateChat() {
    const self = me ? byId(me.id) : null;
    if (!self) return ui.setChat({ visible: true, enabled: false, placeholder: 'Les spectateurs ne parlent pas 👀' });
    if (!self.alive) return ui.setChat({ visible: true, enabled: false, placeholder: 'Les morts ne parlent pas… 👻' });
    if (phase === 'night') {
      return me.role === 'loup'
        ? ui.setChat({ visible: true, enabled: true, placeholder: '🐺 Chuchoter à la meute…' })
        : ui.setChat({ visible: true, enabled: false, placeholder: 'Chut… c\'est la nuit 🌙' });
    }
    if (phase === 'end') return ui.setChat({ visible: true, enabled: false, placeholder: 'Partie terminée' });
    ui.setChat({ visible: true, enabled: true, placeholder: 'Écrire au village…' });
  }

  // Les "view" sont des ordres d'affichage envoyés par le serveur
  function onView(v) {
    const sc = scene();
    switch (v.op) {
      case 'phase':
        phase = v.phase; day = v.day;
        ui.setPhase(v.phase, v.day); ambience.setNight(v.phase === 'night'); updateChat();
        if (v.phase !== 'debate') stopDebate();
        return;
      case 'narrate': ui.subtitle(v.text, v.small); narrator.say(v.small ? `${v.text} ${v.small}` : v.text); return;
      case 'time': sc.setTimeOfDay(v.mode); return;
      case 'kill': sc.kill(v.id, v.role); ui.flash(); ambience.chime(110, 2.4); return;
      case 'beam': sc.beam(v.id, v.color, 2.2); return;
      case 'voteLine': sc.voteLine(v.from, v.to, v.color); return;
      case 'badge': sc.setBadge(v.id, v.n, v.gold); return;
      case 'clearVotes': sc.clearVoteLines(); sc.clearBadges(); return;
      case 'mayor': sc.setMayor(v.id); ambience.chime(330, 2); return;
      case 'focus': sc.focus(v.id); return;
      case 'resetCamera': sc.resetCamera(); return;
      case 'wolves':
        sc.wolves(v.on);
        if (v.on) { ambience.howl(); ui.flash('rgba(120,0,10,0.45)'); }
        return;
      case 'say': sc.say(v.id, v.text, 4300, !!v.accuse); return;
      case 'journal': ui.addJournal(v.entry); return;
      case 'chat': // chuchotement de la meute (seuls les loups le reçoivent)
        ui.addJournal({ icon: '🐺', text: `${lookup(v.id).name} (meute) : « ${v.text} »`, type: 'chat', secret: true });
        sc.say(v.id, v.text, 4000);
        return;
      case 'timer': ui.setTimer(v.remaining, v.total); return;
      case 'debate': if (v.on) startDebate(v); else stopDebate(); return;
      case 'debate-paused': paused = v.paused; ui.toast(paused ? '⏸ Débat en pause' : '▶ Le débat reprend'); return;
      case 'sound': if (v.name === 'howl') ambience.howl(); else ambience.chime(262, 3); return;
      default:
    }
  }

  function startDebate(d) {
    debateOn = true; paused = !!d.paused;
    const self = me ? byId(me.id) : null;
    const isHost = !!room?.you.isHost;
    const remote = { // le chrono vit sur le serveur : ces boutons lui envoient des ordres
      skip: () => send({ type: 'debate', action: 'skip' }),
      addTime: () => send({ type: 'debate', action: 'add' }),
      pause: () => { paused = true; send({ type: 'debate', action: 'pause' }); },
      resume: () => { paused = false; send({ type: 'debate', action: 'resume' }); },
      get paused() { return paused; },
    };
    ui.showDebate({
      timer: remote, total: d.total, controls: isHost,
      note: 'Écris dans le chat 📜 pour convaincre le village',
      accusers: self?.alive ? [self] : [],
      candidates: self?.alive ? players.filter(p => p.alive && p.id !== self.id).map(p => ({ id: p.id, name: p.name, color: p.color })) : [],
      onAccuse: (id) => send({ type: 'accuse', id }),
    });
    ui.setTimer(d.remaining ?? d.total, d.total);
    if (self?.alive) ui.openJournal();
  }
  function stopDebate() { if (debateOn) { debateOn = false; ui.hideDebate(); ui.setTimer(null); } }

  async function onAsk(a) {
    currentAskId = a.askId;
    const self = byId(a.playerId) ?? { id: a.playerId, name: 'Toi' };
    const req = { kind: a.kind, player: self, candidates: a.candidates, context: a.context ?? {} };
    const value = await showAskPanel({ ui, scene: scene(), req, lookup, seconds: a.seconds });
    if (value === undefined || currentAskId !== a.askId) return; // annulé (temps écoulé, reconnexion…)
    currentAskId = null;
    send({ type: 'answer', askId: a.askId, value });
  }

  function onEnd(e) {
    players = e.players; phase = 'end';
    stopDebate(); ui.cancelAll(); ui.cancelOverlay(); updateChat();
    for (const p of players) scene().showRole(p.id, p.role);
    const isHost = !!room?.you.isHost;
    ui.showEnd({
      winner: e.winner, state: { players }, stats: e.stats,
      journal: { entries: e.entries, toText: () => e.entries.map(x => `[J${x.day}] ${x.icon} ${x.text}${x.secret ? ' (secret)' : ''}`).join('\n') },
      onReplay: () => send({ type: 'restart' }),
      onMenu: () => (isHost ? send({ type: 'lobby' }) : leave()),
      replayLabel: isHost ? '⟳ Rejouer (même salle)' : 'En attente de l\'hôte…',
      replayDisabled: !isHost,
      menuLabel: isHost ? 'Retour au salon' : 'Quitter la salle',
    });
    narrator.say(WINNER_TEXT[e.winner].title);
    void ROLES;
  }

  return {
    create, join, leave,
    get active() { return !!room; },
    settings: (s) => send({ type: 'settings', ...s }),
    start: () => send({ type: 'start' }),
    chat: (text) => send({ type: 'chat', text }),
  };
}

/** Le serveur Node est-il là ? (sur la page publiée sans serveur, la réponse est non) */
export async function checkServer() {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    if (!r.ok) return false;
    return (await r.json()).ok === true;
  } catch { return false; }
}
