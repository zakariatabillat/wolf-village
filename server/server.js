// ============================================================
//  SERVEUR EN LIGNE — node server/server.js
//  1) sert les fichiers du jeu (index.html, css, js…)
//  2) accepte les connexions WebSocket sur /ws
//  3) aiguille chaque message vers la bonne salle
//  Aucune dépendance : pas besoin de "npm install".
// ============================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { acceptWebSocket } from './ws.js';
import { createLobby } from './room.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const lobby = createLobby();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, rooms: lobby.count() }));
    return;
  }
  // Fichiers statiques — on refuse de sortir du dossier du jeu et de servir le code serveur
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || file.startsWith(path.join(ROOT, 'server')) || file.includes('node_modules')) {
    res.writeHead(403); res.end('Interdit'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Introuvable'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.on('upgrade', (req, socket) => {
  if (new URL(req.url, 'http://localhost').pathname !== '/ws') { socket.destroy(); return; }
  const ws = acceptWebSocket(req, socket);
  if (ws) lobby.connect(ws);
});

server.listen(PORT, () => {
  console.log('\n🐺  Loup-Garou 3D — serveur en ligne prêt\n');
  console.log(`   Sur cet ordinateur : http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets ?? []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`   Même Wi-Fi         : http://${n.address}:${PORT}`);
    }
  }
  console.log('\n   Partage une de ces adresses, crée une salle, donne le code. Ctrl+C pour arrêter.\n');
});
