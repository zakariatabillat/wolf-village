// ============================================================
//  SALLES — création, code à 4 lettres, salon d'attente, hôte
//  Un "membre" = une personne connectée (ou momentanément déconnectée).
//  Le jeton (token) stocké dans son navigateur lui permet de revenir
//  à sa place après un rechargement de page.
// ============================================================
import crypto from 'node:crypto';
import { createOnlineGame } from './game.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sans I ni O (confusion avec 1 et 0)
const BOT_NAMES = ['Aldric', 'Bérénice', 'Corentin', 'Doriane', 'Elouan', 'Fantine', 'Gaspard', 'Hortense', 'Ismaël', 'Joséphine', 'Kilian', 'Léonie', 'Maël', 'Noémie', 'Octave', 'Perrine'];
const MAX_SEATS = 16;
const MIN_SEATS = 4;
const DEBATES = [30, 60, 90, 120];

const randomId = () => crypto.randomBytes(9).toString('base64url');
const cleanName = (s) => String(s ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
const send = (client, msg) => { try { client.ws.send(JSON.stringify(msg)); } catch { /* socket fermée */ } };

export function createLobby() {
  const rooms = new Map(); // code → salle

  function newCode() {
    for (;;) {
      const code = Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
      if (!rooms.has(code)) return code;
    }
  }

  function connect(ws) {
    const client = { id: randomId(), ws, room: null, member: null };
    send(client, { type: 'welcome' });
    ws.on('message', (text) => {
      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      try { handle(client, msg); } catch (err) { console.error(err); send(client, { type: 'error', message: 'Erreur du serveur.' }); }
    });
    ws.on('close', () => client.room?.disconnect(client));
  }

  function handle(client, msg) {
    if (msg.type === 'create' || msg.type === 'join') {
      const name = cleanName(msg.name);
      if (!name) return send(client, { type: 'error', message: 'Choisis un pseudo.' });
      const token = typeof msg.token === 'string' && msg.token.length >= 8 ? msg.token.slice(0, 64) : randomId();
      let room;
      if (msg.type === 'create') {
        room = createRoom(newCode(), (code) => rooms.delete(code));
        rooms.set(room.code, room);
        console.log(`[salle ${room.code}] créée par ${name}`);
      } else {
        room = rooms.get(String(msg.code ?? '').toUpperCase().trim());
        if (!room) return send(client, { type: 'error', message: 'Salle introuvable. Vérifie le code.' });
      }
      if (client.room && client.room !== room) client.room.leave(client);
      room.join(client, name, token);
      return;
    }
    if (msg.type === 'leave') { client.room?.leave(client); client.room = null; client.member = null; return; }
    client.room?.handle(client, msg);
  }

  return { connect, count: () => rooms.size };
}

function createRoom(code, onDelete) {
  const members = []; // { token, name, client, spectator, playerId }
  let hostToken = null;
  let phase = 'lobby'; // lobby | game | ended
  let game = null;
  let deleteTimer = null;
  const settings = { bots: 3, debate: 60 };

  const humans = () => members.filter(m => !m.spectator);
  const connected = () => members.filter(m => m.client);
  const isHost = (m) => m?.token === hostToken;

  const room = {
    code,
    get members() { return members; },
    isHost,
    sendTo(member, msg) { if (member?.client) send(member.client, msg); },
    broadcast(msg) { for (const m of members) if (m.client) send(m.client, msg); },
    join, leave, disconnect, handle,
    onGameEnd() { phase = 'ended'; broadcastRoom(); },
  };

  function roomStateFor(m) {
    return {
      type: 'room', code, phase, settings,
      you: { token: m.token, name: m.name, isHost: isHost(m), spectator: m.spectator },
      members: members.map(x => ({ name: x.name, connected: !!x.client, isHost: isHost(x), spectator: x.spectator })),
    };
  }
  function broadcastRoom() { for (const m of members) if (m.client) send(m.client, roomStateFor(m)); }

  function uniqueName(name, except) {
    const taken = new Set(members.filter(m => m !== except).map(m => m.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) { const n = `${name.slice(0, 13)} ${i}`; if (!taken.has(n.toLowerCase())) return n; }
  }

  function join(client, name, token) {
    clearTimeout(deleteTimer);
    let m = members.find(x => x.token === token);
    if (m) {
      // Retour d'un joueur (rechargement de page, coupure Wi-Fi…)
      if (m.client && m.client !== client) { try { m.client.ws.close(); } catch { /* */ } }
      m.client = client;
      if (phase === 'lobby') m.name = uniqueName(name, m);
    } else {
      const seatsTaken = humans().length + (phase === 'lobby' ? 0 : 0);
      if (phase === 'lobby' && seatsTaken >= MAX_SEATS) return send(client, { type: 'error', message: 'Salle pleine (16 joueurs).' });
      m = { token, name: uniqueName(name), client, spectator: phase !== 'lobby', playerId: null };
      members.push(m);
      if (phase === 'lobby') settings.bots = Math.min(settings.bots, MAX_SEATS - humans().length);
    }
    if (!hostToken || !members.find(x => x.token === hostToken)?.client) hostToken = m.token;
    client.room = room; client.member = m;
    broadcastRoom();
    if (game && phase !== 'lobby') game.resync(m);
    game?.onConnectionChange();
  }

  function leave(client) {
    const m = client.member; if (!m) return;
    const i = members.indexOf(m);
    if (i >= 0) members.splice(i, 1);
    if (m.playerId) game?.onLeave(m.playerId); // sa place continue en mode automatique
    client.room = null; client.member = null;
    afterChange();
  }

  function disconnect(client) {
    const m = client.member;
    if (!m || m.client !== client) return;
    m.client = null;
    if (phase === 'lobby') members.splice(members.indexOf(m), 1); // au salon, on libère la place
    afterChange();
  }

  function afterChange() {
    if (!members.find(x => x.token === hostToken)?.client) hostToken = connected()[0]?.token ?? null;
    game?.onConnectionChange();
    broadcastRoom();
    if (connected().length === 0) {
      deleteTimer = setTimeout(() => { game?.abort(); onDelete(code); console.log(`[salle ${code}] fermée`); }, phase === 'lobby' ? 5000 : 120000);
    }
  }

  function startGame() {
    const players = humans().filter(m => m.client);
    const total = players.length + settings.bots;
    if (total < MIN_SEATS) return `Il faut au moins ${MIN_SEATS} joueurs (humains + bots).`;
    if (total > MAX_SEATS) return `Maximum ${MAX_SEATS} joueurs.`;
    const used = new Set(players.map(m => m.name.toLowerCase()));
    const bots = BOT_NAMES.filter(n => !used.has(n.toLowerCase())).slice(0, settings.bots);
    const seats = [...players.map(m => ({ name: m.name, isBot: false })), ...bots.map(name => ({ name, isBot: true }))];
    // Les spectateurs et les absents ne jouent pas cette partie
    for (const m of members) { m.playerId = null; m.spectator = !players.includes(m); }
    players.forEach((m, i) => { m.playerId = `p${i + 1}`; }); // même ordre que createGameState
    game?.abort();
    game = createOnlineGame(room, seats, { ...settings });
    phase = 'game';
    broadcastRoom();
    game.start();
    console.log(`[salle ${code}] partie lancée : ${players.length} humains + ${bots.length} bots`);
    return null;
  }

  function handle(client, msg) {
    const m = client.member; if (!m) return;
    switch (msg.type) {
      case 'settings': {
        if (!isHost(m) || phase === 'game') return;
        if (Number.isInteger(msg.bots)) settings.bots = Math.max(0, Math.min(MAX_SEATS - humans().length, msg.bots));
        if (DEBATES.includes(msg.debate)) settings.debate = msg.debate;
        broadcastRoom();
        return;
      }
      case 'start':
      case 'restart': {
        if (!isHost(m)) return send(client, { type: 'error', message: 'Seul l\'hôte peut lancer la partie.' });
        if (phase === 'game') return;
        for (const x of members) x.spectator = false; // tout le monde rejoue
        const err = startGame();
        if (err) send(client, { type: 'error', message: err });
        return;
      }
      case 'lobby': { // retour au salon après une partie
        if (!isHost(m) || phase !== 'ended') return;
        phase = 'lobby'; game = null;
        for (const x of members) { x.spectator = false; x.playerId = null; }
        broadcastRoom();
        return;
      }
      default:
        if (game) game.handle(m, msg);
    }
  }

  return room;
}
