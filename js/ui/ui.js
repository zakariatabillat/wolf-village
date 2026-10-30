// ============================================================
//  INTERFACE (DOM) — écrans, panneaux, cartes, journal
//  Le DOM fait 3 gestes : trouver un élément, écouter, modifier.
// ============================================================
import { ROLES, composeRoles, MIN_PLAYERS, MAX_PLAYERS } from '../modules/roles.js';
import { PLAYER_COLORS } from '../core/state.js';
import { formatTime } from '../modules/timer.js';
import { WINNER_TEXT } from '../modules/endgame.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const DEFAULT_NAMES = ['Aldric', 'Bérénice', 'Corentin', 'Doriane', 'Elouan', 'Fantine', 'Gaspard', 'Hortense', 'Ismaël', 'Joséphine', 'Kilian', 'Léonie', 'Maël', 'Noémie', 'Octave', 'Perrine'];

export function createUI(handlers) {
  const el = {
    setup: $('#setup'), form: $('#setup-form'), list: $('#player-list'), count: $('#player-count'), compo: $('#compo'), error: $('#setup-error'),
    hud: $('#hud'), phaseIcon: $('#phase-icon'), phaseLabel: $('#phase-label'), timer: $('#timer'), alive: $('#alive-count'),
    roster: $('#roster'), journal: $('#journal'), journalList: $('#journal-list'),
    subtitle: $('#subtitle'), panel: $('#action-panel'), debate: $('#debate-bar'), overlay: $('#overlay'),
    end: $('#endscreen'), flash: $('#flash'), threeStatus: $('#three-status'),
  };
  let setupPlayers = [];
  let currentAsk = null; // { resolve, candidates, selected, onSelect }

  // ======================= CONFIGURATION =======================
  function renderSetupList() {
    el.list.innerHTML = '';
    setupPlayers.forEach((p, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--c', PLAYER_COLORS[i % PLAYER_COLORS.length]);
      li.innerHTML = `<span class="dot"></span>
        <input maxlength="16" value="${esc(p.name)}" aria-label="Nom du joueur ${i + 1}" data-i="${i}" />
        <button type="button" class="kind ${p.isBot ? '' : 'human'}" data-kind="${i}">${p.isBot ? '🤖 IA' : '👤 Humain'}</button>
        <button type="button" class="rm" data-rm="${i}" title="Retirer">✕</button>`;
      el.list.appendChild(li);
    });
    el.count.textContent = setupPlayers.length;
    const roles = composeRoles(Math.max(setupPlayers.length, MIN_PLAYERS));
    const counts = roles.reduce((acc, r) => ({ ...acc, [r]: (acc[r] ?? 0) + 1 }), {});
    el.compo.innerHTML = Object.entries(counts).map(([r, n]) => `<span class="${r === 'loup' ? 'w' : ''}">${ROLES[r].icon} ${ROLES[r].label}${n > 1 ? ` ×${n}` : ''}</span>`).join('');
  }

  // Délégation d'événements : UN écouteur sur la liste gère tous les boutons, même ajoutés plus tard
  el.list.addEventListener('click', (e) => {
    const kind = e.target.closest('[data-kind]');
    const rm = e.target.closest('[data-rm]');
    if (kind) { const p = setupPlayers[+kind.dataset.kind]; p.isBot = !p.isBot; renderSetupList(); }
    if (rm) { setupPlayers.splice(+rm.dataset.rm, 1); renderSetupList(); }
  });
  el.list.addEventListener('input', (e) => { if (e.target.dataset.i) setupPlayers[+e.target.dataset.i].name = e.target.value; });
  $('#add-player').addEventListener('click', () => {
    if (setupPlayers.length >= MAX_PLAYERS) return toast(`Maximum ${MAX_PLAYERS} joueurs`);
    const used = new Set(setupPlayers.map(p => p.name));
    setupPlayers.push({ name: DEFAULT_NAMES.find(n => !used.has(n)) ?? `Joueur ${setupPlayers.length + 1}`, isBot: true });
    renderSetupList();
  });
  document.querySelector('.presets').addEventListener('click', (e) => {
    const preset = e.target.dataset.preset; if (!preset) return;
    const n = preset === 'group' ? 8 : 8;
    setupPlayers = DEFAULT_NAMES.slice(0, n).map((name, i) => ({ name, isBot: preset === 'demo' ? true : preset === 'group' ? false : i !== 0 }));
    if (preset === 'solo') setupPlayers[0].name = 'Moi';
    renderSetupList();
  });
  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const cfg = {
      players: setupPlayers.map(p => ({ name: p.name.trim() || 'Sans-nom', isBot: p.isBot })),
      debate: +$('#opt-debate').value,
      speed: +$('#opt-speed').value,
      voice: $('#opt-voice').checked,
      sound: $('#opt-sound').checked,
    };
    handlers.onStart(cfg);
  });

  function showSetup(cfg) {
    setupPlayers = cfg.players.map(p => ({ ...p }));
    $('#opt-debate').value = String(cfg.debate);
    $('#opt-speed').value = String(cfg.speed);
    $('#opt-voice').checked = cfg.voice;
    $('#opt-sound').checked = cfg.sound;
    renderSetupList();
    el.error.textContent = '';
    el.setup.classList.remove('hidden');
    for (const x of [el.hud, el.roster, el.journal, el.panel, el.debate, el.overlay, el.end]) x.classList.add('hidden');
    document.getElementById('lobby').classList.add('hidden');
    subtitle('');
  }

  // ======================= EN JEU =======================
  function enterGame() {
    el.setup.classList.add('hidden'); el.end.classList.add('hidden'); document.getElementById('lobby').classList.add('hidden');
    el.hud.classList.remove('hidden'); el.roster.classList.remove('hidden');
    if (window.innerWidth > 980) el.journal.classList.remove('hidden');
    el.journalList.innerHTML = '';
  }

  function setPhase(phase, day) {
    const map = { night: ['🌙', `Nuit ${day}`], day: ['☀️', `Jour ${day}`], mayor: ['🎖️', `Élection du maire`], debate: ['💬', `Débat · Jour ${day}`], vote: ['🗳️', `Vote · Jour ${day}`], end: ['🏁', 'Fin de partie'] };
    const [icon, label] = map[phase] ?? ['•', phase];
    el.phaseIcon.textContent = icon; el.phaseLabel.textContent = label;
    document.body.classList.toggle('is-night', phase === 'night');
    document.body.classList.toggle('is-day', phase !== 'night');
  }

  function setTimer(sec, total) {
    el.timer.textContent = sec == null ? '--:--' : formatTime(sec);
    el.timer.classList.toggle('urgent', sec != null && sec <= 10);
    const bar = el.debate.querySelector('.progress i');
    if (bar && total) bar.style.width = `${(sec / total) * 100}%`;
  }

  function renderRoster(state, { counts = {}, viewer = null, revealAll = false, known = {} } = {}) {
    const alive = state.players.filter(p => p.alive).length;
    el.alive.textContent = `${alive} en vie`;
    el.roster.innerHTML = `<div class="panel-title">Villageois · ${alive}/${state.players.length}</div>` + state.players.map(p => {
      const showRole = revealAll || !p.alive || (viewer && p.id === viewer.id) || known[p.id]
        || (viewer?.role === 'loup' && p.role === 'loup');
      const role = showRole && p.role ? `<span class="rl" title="${ROLES[p.role].label}">${ROLES[p.role].icon}</span>` : '';
      return `<div class="r-player ${p.alive ? '' : 'dead'} ${viewer?.id === p.id ? 'me' : ''}" style="--c:${p.color}">
        <span class="dot"></span><span class="nm">${esc(p.name)}</span>
        ${p.isMayor && p.alive ? '<span title="Maire">🎖️</span>' : ''}
        ${counts[p.id] ? `<span class="vc">${counts[p.id]}</span>` : ''}
        ${role}<span class="tag" title="${p.connected === false ? 'Déconnecté' : ''}">${p.isBot ? '🤖' : p.connected === false ? '📴' : '👤'}</span></div>`;
    }).join('');
  }

  let subTimer = null;
  function subtitle(text, small = '', ms = 0) {
    clearTimeout(subTimer);
    if (!text) { el.subtitle.classList.remove('show'); return; }
    el.subtitle.innerHTML = `${esc(text)}${small ? `<small>${esc(small)}</small>` : ''}`;
    el.subtitle.classList.add('show');
    if (ms) subTimer = setTimeout(() => el.subtitle.classList.remove('show'), ms);
  }

  function addJournal(entry) {
    const li = document.createElement('li');
    li.className = `${entry.type} ${entry.secret ? 'secret' : ''}`;
    li.innerHTML = `<span class="ic">${entry.icon}</span><span>${esc(entry.text)}</span>`;
    el.journalList.appendChild(li);
    el.journalList.scrollTop = el.journalList.scrollHeight;
  }

  function flash(color = 'rgba(230,57,70,0.6)') {
    el.flash.style.background = `radial-gradient(ellipse at center, transparent 20%, ${color})`;
    el.flash.classList.remove('on'); void el.flash.offsetWidth; el.flash.classList.add('on');
  }

  function toast(text, ms = 2200) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
    document.body.appendChild(t); setTimeout(() => t.remove(), ms);
  }

  // ======================= CHOIX DU JOUEUR HUMAIN =======================
  /**
   * Affiche un panneau de choix et renvoie une promesse.
   * opts = { title, sub, candidates:[{id,name,color}], noneLabel, confirmLabel, boolean:{yes,no}, onSelect }
   */
  function choose(opts) {
    cancelAsk();
    return new Promise((resolve) => {
      currentAsk = { resolve, candidates: new Set((opts.candidates ?? []).map(c => c.id)), selected: null, onSelect: opts.onSelect };
      const p = el.panel;
      p.classList.remove('hidden');
      if (opts.boolean) {
        p.innerHTML = `<h3>${opts.title}</h3><p class="sub">${opts.sub ?? ''}</p>
          <div class="actions"><button class="btn" data-bool="0">${opts.boolean.no}</button><button class="btn ${opts.boolean.cls ?? 'primary'}" data-bool="1">${opts.boolean.yes}</button></div>`;
      } else {
        p.innerHTML = `<h3>${opts.title}</h3><p class="sub">${opts.sub ?? ''}</p>
          <div class="chips">${opts.candidates.map(c => `<button class="chip" data-id="${c.id}" style="--c:${c.color}"><span class="dot"></span>${esc(c.name)}</button>`).join('')}
          ${opts.noneLabel ? `<button class="chip none" data-none="1">${opts.noneLabel}</button>` : ''}</div>
          <div class="actions"><button class="btn primary" data-confirm disabled>${opts.confirmLabel ?? 'Confirmer'}</button></div>
          <p class="hint">Astuce : tu peux aussi cliquer directement sur un villageois dans la scène 3D.</p>`;
      }
      if (opts.deadline) {
        const h3 = p.querySelector('h3');
        const cd = document.createElement('span'); cd.className = 'countdown'; h3.appendChild(cd);
        const tick = () => { const s = Math.max(0, Math.ceil((opts.deadline - Date.now()) / 1000)); cd.textContent = `⏳ ${s} s`; cd.classList.toggle('urgent', s <= 10); };
        tick(); currentAsk.countdown = setInterval(tick, 500);
      }
      p.onclick = (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.bool) return finish(b.dataset.bool === '1');
        if (b.dataset.none) return finish(null);
        if (b.dataset.id) return select(b.dataset.id);
        if (b.hasAttribute('data-confirm') && currentAsk?.selected) return finish(currentAsk.selected);
      };
    });
  }
  function select(id) {
    if (!currentAsk || !currentAsk.candidates.has(id)) return;
    currentAsk.selected = id;
    el.panel.querySelectorAll('.chip').forEach(c => c.classList.toggle('selected', c.dataset.id === id));
    const btn = el.panel.querySelector('[data-confirm]'); if (btn) btn.disabled = false;
    currentAsk.onSelect?.(id);
  }
  function finish(value) {
    const a = currentAsk; currentAsk = null;
    clearInterval(a?.countdown);
    el.panel.classList.add('hidden'); el.panel.onclick = null;
    a?.resolve(value);
  }
  function cancelAsk() { if (currentAsk) finish(undefined); }

  /** Rideau "passe l'appareil" pour garder les rôles secrets. */
  function curtain(player, what = 'C\'est ton tour') {
    return new Promise((resolve) => {
      el.overlay.classList.remove('hidden');
      el.overlay.innerHTML = `<div class="curtain"><div class="moon-glyph"></div>
        <h2>Passe l'appareil à <span class="who">${esc(player.name)}</span></h2>
        <p>${what}. Les autres, fermez les yeux…</p>
        <button class="btn primary" id="curtain-ok">Je suis ${esc(player.name)}</button></div>`;
      $('#curtain-ok').onclick = () => { el.overlay.classList.add('hidden'); resolve(); };
      el.overlay._cancel = () => { el.overlay.classList.add('hidden'); resolve(); };
    });
  }

  /** Carte de rôle qui se retourne (révélation au début, résultat de la voyante). */
  function roleCard(role, { heading = 'Ton rôle', mates = [], button = 'J\'ai compris', subject = '' } = {}) {
    const R = ROLES[role];
    const team = role === 'loup' ? '#e63946' : role === 'voyante' ? '#b388ff' : role === 'sorciere' ? '#5ee6a0' : '#e9c46a';
    return new Promise((resolve) => {
      el.overlay.classList.remove('hidden');
      el.overlay.innerHTML = `<div class="card-scene">
        <div class="end-kicker">${esc(heading)}</div>
        <div class="role-card" id="rc" style="--team:${team}">
          <div class="face back"><span>BRUMEVAL</span></div>
          <div class="face front">
            <div class="ricon">${R.icon}</div>
            ${subject ? `<div class="team">${esc(subject)} est</div>` : `<div class="team">Camp ${R.team === 'loups' ? 'des loups' : 'du village'}</div>`}
            <h3>${R.label}</h3>
            ${subject ? '' : `<p>${R.desc}</p>`}
            ${mates.length ? `<div class="mates">Ta meute : ${mates.map(esc).join(', ')}</div>` : ''}
          </div>
        </div>
        <div class="tap" id="rc-tap">Touche la carte pour la retourner</div>
        <button class="btn primary hidden" id="rc-ok">${button}</button></div>`;
      const card = $('#rc');
      const flip = () => { card.classList.add('flipped'); $('#rc-tap').classList.add('hidden'); $('#rc-ok').classList.remove('hidden'); };
      card.onclick = flip; setTimeout(flip, 900);
      $('#rc-ok').onclick = () => { el.overlay.classList.add('hidden'); resolve(); };
      el.overlay._cancel = () => { el.overlay.classList.add('hidden'); resolve(); };
    });
  }

  // ======================= DÉBAT =======================
  function showDebate({ timer, total, accusers = [], candidates = [], onAccuse, controls = true, note = '' }) {
    el.debate.classList.remove('hidden');
    el.debate.innerHTML = `<div class="row"><span class="lbl">💬 Le village débat</span>
        ${controls ? '<button class="btn" data-a="pause">⏸ Pause</button><button class="btn" data-a="add">+30 s</button><button class="btn primary" data-a="skip">Passer au vote ⏭</button>' : `<span class="muted" style="font-size:13px">${note}</span>`}</div>
      <div class="progress"><i style="width:100%"></i></div>
      ${accusers.length && candidates.length ? `<div class="row"><span class="muted" style="font-size:13px">Accuser publiquement :</span>
        <div class="chips">${candidates.map(c => `<button class="chip" data-acc="${c.id}" style="--c:${c.color}"><span class="dot"></span>${esc(c.name)}</button>`).join('')}</div></div>` : ''}`;
    el.debate.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.a === 'skip') timer.skip();
      if (b.dataset.a === 'add') timer.addTime(30);
      if (b.dataset.a === 'pause') { if (timer.paused) { timer.resume(); b.textContent = '⏸ Pause'; } else { timer.pause(); b.textContent = '▶ Reprendre'; } }
      if (b.dataset.acc) { onAccuse?.(b.dataset.acc); b.disabled = true; }
    };
    setTimer(total, total);
  }
  function hideDebate() { el.debate.classList.add('hidden'); el.debate.onclick = null; }

  // ======================= FIN =======================
  function showEnd({ winner, state, journal, stats, onReplay = handlers.onReplay, onMenu = handlers.onMenu, replayLabel = '⟳ Rejouer avec les mêmes joueurs', menuLabel = 'Nouvelle partie', replayDisabled = false }) {
    const W = WINNER_TEXT[winner];
    el.hud.classList.add('hidden'); el.roster.classList.add('hidden'); el.journal.classList.add('hidden');
    hideDebate(); el.panel.classList.add('hidden');
    const winTeam = winner === 'loups' ? 'loups' : 'village';
    el.end.innerHTML = `<div class="end-kicker">Fin de la partie · ${stats.nights} nuit${stats.nights > 1 ? 's' : ''}</div>
      <h1 class="end-title ${winner}">${W.title}</h1><p class="end-sub">${W.sub}</p>
      <div class="end-stats"><div><b>${stats.nights}</b>nuits</div><div><b>${stats.deaths}</b>morts</div><div><b>${stats.survivors}</b>survivants</div></div>
      <div class="end-grid">${state.players.map((p, i) => {
        const R = ROLES[p.role]; const won = winner !== 'personne' && R.team === winTeam;
        return `<div class="end-card ${won ? 'win' : ''} ${p.alive ? '' : 'dead'}" style="animation-delay:${i * 60}ms">
          <span class="st">${p.alive ? '❤️' : '⚰️'}</span><div class="ri">${R.icon}</div><div class="n" style="color:${p.color}">${esc(p.name)}</div><div class="r">${R.label}${p.isMayor ? ' · 🎖️' : ''}</div></div>`;
      }).join('')}</div>
      <div class="end-actions"><button class="btn primary" data-e="replay" ${replayDisabled ? 'disabled' : ''}>${replayLabel}</button><button class="btn" data-e="menu">${menuLabel}</button><button class="btn" data-e="copy">📋 Copier le journal</button></div>
      <div class="end-log glass">${journal.entries.map(e => `<div class="${e.secret ? 'secret' : ''}">[J${e.day}] ${e.icon} ${esc(e.text)}</div>`).join('')}</div>`;
    el.end.classList.remove('hidden');
    el.end.onclick = async (e) => {
      const b = e.target.closest('[data-e]'); if (!b) return;
      if (b.dataset.e === 'replay') onReplay();
      if (b.dataset.e === 'menu') onMenu();
      if (b.dataset.e === 'copy') {
        try { await navigator.clipboard.writeText(journal.toText()); toast('Journal copié ✔'); } catch { toast('Copie refusée par le navigateur'); }
      }
    };
  }

  // ======================= MODE EN LIGNE =======================
  const tabs = document.querySelector('.mode-tabs');
  const onlineCard = $('#online-card');
  function setTab(tab) {
    tabs.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    el.form.classList.toggle('hidden', tab !== 'local');
    onlineCard.classList.toggle('hidden', tab !== 'online');
  }
  tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });

  const onlineName = $('#online-name');
  const joinCode = $('#join-code');
  const onlineError = $('#online-error');
  try { onlineName.value = localStorage.getItem('lg3d-name') ?? ''; } catch { /* */ }
  function onlineOpts() {
    const name = onlineName.value.trim();
    if (!name) { onlineError.textContent = 'Choisis d\'abord un pseudo.'; onlineName.focus(); return null; }
    try { localStorage.setItem('lg3d-name', name); } catch { /* */ }
    onlineError.textContent = '';
    return { name, voice: $('#opt-voice').checked, sound: $('#opt-sound').checked };
  }
  $('#btn-create').onclick = () => { const o = onlineOpts(); if (o) handlers.onCreateRoom(o); };
  $('#btn-join').onclick = () => {
    const code = joinCode.value.trim().toUpperCase();
    if (code.length !== 4) { onlineError.textContent = 'Le code fait 4 lettres.'; joinCode.focus(); return; }
    const o = onlineOpts(); if (o) handlers.onJoinRoom({ ...o, code });
  };
  joinCode.addEventListener('input', () => { joinCode.value = joinCode.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  joinCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join').click(); });
  onlineName.addEventListener('keydown', (e) => { if (e.key === 'Enter') (joinCode.value.length === 4 ? $('#btn-join') : $('#btn-create')).click(); });

  function setOnlineStatus(text, ok) {
    $('#online-status').textContent = text;
    $('#btn-create').disabled = !ok; $('#btn-join').disabled = !ok;
  }

  // Salon d'attente
  const lobby = $('#lobby');
  let lobbySettings = { bots: 3, debate: 60 };
  lobby.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.bots) handlers.onLobbySettings({ bots: lobbySettings.bots + Number(b.dataset.bots) });
    if (b.id === 'btn-start-online') handlers.onStartOnline();
    if (b.id === 'btn-leave') handlers.onLeaveRoom();
    if (b.id === 'btn-copy-link') {
      try { await navigator.clipboard.writeText($('#room-link').textContent); toast('Lien copié ✔'); } catch { toast('Copie refusée : recopie le code à la main'); }
    }
  });
  $('#lobby-debate').addEventListener('change', (e) => handlers.onLobbySettings({ debate: Number(e.target.value) }));

  function showLobby(room) {
    lobbySettings = room.settings;
    el.setup.classList.add('hidden'); el.end.classList.add('hidden');
    for (const x of [el.hud, el.roster, el.journal, el.panel, el.debate]) x.classList.add('hidden');
    lobby.classList.remove('hidden');
    $('#room-code').textContent = room.code;
    $('#room-link').textContent = `${location.origin}${location.pathname}?salle=${room.code}`;
    const players = room.members.filter(m => !m.spectator || room.phase !== 'game');
    $('#lobby-count').textContent = players.length;
    $('#lobby-total').textContent = `${players.length + room.settings.bots} joueurs au total`;
    $('#lobby-players').innerHTML = players.map((m, i) => `<li style="--c:${PLAYER_COLORS[i % PLAYER_COLORS.length]}"><span class="dot"></span>
      <span class="nm">${esc(m.name)}${m.name === room.you.name ? ' <span class="muted">(toi)</span>' : ''}</span>
      ${m.isHost ? '<span class="kind human">👑 Hôte</span>' : ''}${m.connected ? '' : '<span class="kind">📴</span>'}</li>`).join('');
    $('#bots-count').textContent = room.settings.bots;
    $('#lobby-debate').value = String(room.settings.debate);
    $('#lobby-host').querySelectorAll('button, select').forEach(x => { x.disabled = !room.you.isHost; });
    const n = Math.max(players.length + room.settings.bots, MIN_PLAYERS);
    const counts = composeRoles(n).reduce((acc, r) => ({ ...acc, [r]: (acc[r] ?? 0) + 1 }), {});
    $('#lobby-compo').innerHTML = Object.entries(counts).map(([r, k]) => `<span class="${r === 'loup' ? 'w' : ''}">${ROLES[r].icon} ${ROLES[r].label}${k > 1 ? ` ×${k}` : ''}</span>`).join('');
    $('#btn-start-online').classList.toggle('hidden', !room.you.isHost);
    $('#lobby-wait').textContent = room.you.isHost
      ? (players.length + room.settings.bots < MIN_PLAYERS ? `Il faut au moins ${MIN_PLAYERS} joueurs : ajoute des bots ou attends tes amis.` : 'Tout le monde est là ? Lance la partie !')
      : 'En attente de l\'hôte… 👑';
    $('#lobby-error').textContent = '';
  }
  function hideLobby() { lobby.classList.add('hidden'); }

  // Chat (dans le panneau du journal)
  const chatForm = $('#chat-form');
  const chatInput = $('#chat-input');
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim(); if (!text) return;
    handlers.onChat?.(text); chatInput.value = '';
  });
  function setChat({ visible = true, enabled = true, placeholder = 'Écrire au village…' } = {}) {
    chatForm.classList.toggle('hidden', !visible);
    chatInput.disabled = !enabled; chatForm.querySelector('button').disabled = !enabled;
    chatInput.placeholder = placeholder;
  }
  function openJournal() { el.journal.classList.remove('hidden'); }

  function cancelOverlay() { if (!el.overlay.classList.contains('hidden')) el.overlay._cancel?.(); }

  function cancelAll() {
    cancelAsk(); hideDebate();
    if (!el.overlay.classList.contains('hidden')) el.overlay._cancel?.();
    subtitle('');
  }

  // Boutons du HUD
  $('#btn-menu').onclick = () => handlers.onMenu();
  $('#btn-journal').onclick = () => el.journal.classList.toggle('hidden');
  $('#btn-voice').onclick = (e) => e.currentTarget.classList.toggle('off', !handlers.onToggleVoice());
  $('#btn-sound').onclick = (e) => e.currentTarget.classList.toggle('off', !handlers.onToggleSound());
  $('#btn-roles').onclick = (e) => e.currentTarget.classList.toggle('off', !handlers.onToggleRoles());

  return {
    showSetup, setupError: (m) => { el.error.textContent = m; }, setThreeStatus: (t) => { el.threeStatus.textContent = t; },
    enterGame, setPhase, setTimer, renderRoster, subtitle, addJournal, flash, toast,
    choose, select, cancelAsk, curtain, roleCard, showDebate, hideDebate, showEnd, cancelAll,
    setButtonState: (id, on) => $(id).classList.toggle('off', !on),
    setButtonVisible: (id, on) => $(id).classList.toggle('hidden', !on),
    setTab, setOnlineStatus, showLobby, hideLobby, setChat, openJournal, cancelOverlay,
    onlineError: (m) => { onlineError.textContent = m; },
    lobbyError: (m) => { $('#lobby-error').textContent = m; },
    prefillCode: (c) => { joinCode.value = c; },
    hideEnd: () => el.end.classList.add('hidden'),
  };
}
