// ============================================================
//  MINI SERVEUR WEBSOCKET — zéro dépendance (module 'node:crypto' uniquement)
//  Implémente juste ce qu'il faut du protocole RFC 6455 :
//  poignée de main, trames texte, ping/pong, fermeture.
// ============================================================
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'; // constante fixée par la norme
const MAX_PAYLOAD = 64 * 1024;                         // 64 Ko par message, largement assez

/** Transforme une requête HTTP "Upgrade" en connexion WebSocket. */
export function acceptWebSocket(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return null; }

  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '', '',
  ].join('\r\n'));
  socket.setNoDelay(true);

  const ws = new EventEmitter();
  let buffer = Buffer.alloc(0);
  let fragments = [];
  let open = true;
  let lastPong = Date.now();

  function frame(opcode, payload = Buffer.alloc(0)) {
    const len = payload.length;
    let header;
    if (len < 126) header = Buffer.from([0x80 | opcode, len]);
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
    return Buffer.concat([header, payload]); // le serveur n'applique jamais de masque
  }

  ws.send = (text) => { if (open && !socket.destroyed) socket.write(frame(0x1, Buffer.from(text))); };
  ws.close = () => {
    if (!open) return;
    open = false;
    try { socket.end(frame(0x8)); } catch { /* déjà fermé */ }
    clearInterval(heartbeat);
    ws.emit('close');
  };

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let len = buffer[1] & 0x7f;
      let offset = 2;
      if (len === 126) { if (buffer.length < 4) return; len = buffer.readUInt16BE(2); offset = 4; }
      else if (len === 127) { if (buffer.length < 10) return; len = Number(buffer.readBigUInt64BE(2)); offset = 10; }
      if (len > MAX_PAYLOAD) { ws.close(); socket.destroy(); return; }
      const maskLen = masked ? 4 : 0;
      if (buffer.length < offset + maskLen + len) return; // trame incomplète : on attend la suite
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      const payload = Buffer.from(buffer.subarray(offset + maskLen, offset + maskLen + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]; // le client masque toujours
      buffer = buffer.subarray(offset + maskLen + len);

      if (opcode === 0x8) { ws.close(); return; }                       // fermeture
      if (opcode === 0x9) { socket.write(frame(0xA, payload)); continue; } // ping → pong
      if (opcode === 0xA) { lastPong = Date.now(); continue; }           // pong
      if (opcode === 0x1 || opcode === 0x0) {                            // texte (éventuellement en morceaux)
        fragments.push(payload);
        if (fin) { const text = Buffer.concat(fragments).toString('utf8'); fragments = []; ws.emit('message', text); }
      }
    }
  });

  // Battement de cœur : un ping toutes les 20 s, coupure si pas de réponse en 60 s
  const heartbeat = setInterval(() => {
    if (Date.now() - lastPong > 60000) { socket.destroy(); return; }
    if (!socket.destroyed) socket.write(frame(0x9));
  }, 20000);

  socket.on('close', () => { if (open) { open = false; clearInterval(heartbeat); ws.emit('close'); } });
  socket.on('error', () => socket.destroy());
  return ws;
}
