
const WebSocket = require('ws');
const http = require('http');
 
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Blaze Kick Server OK');
});
 
const wss = new WebSocket.Server({ server });
const rooms = {};
 
// Pálya arányok (0-1 között, mint a kliens)
var WL = 0.08;  // fal vastagság arány
var TW = 0.04;  // felső fal
var BW = 0.04;  // alsó fal
var GY = 0.32;  // kapu Y kezdete
var GH = 0.36;  // kapu magasság
var BR = 0.028; // labda sugár
var PR = 0.10;  // kapus fél magasság
var MR = 0.065; // mezőnyjátékos fél magasság
var PW = 0.02;  // ütő szélessége
 
function createBall() {
  var dir = Math.random() > 0.5 ? 1 : -1;
  return {
    x: 0.5, y: 0.5,
    vx: 0.005 * dir,
    vy: (Math.random() - 0.5) * 0.004
  };
}
 
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
 
function gameLoop(room) {
  var b = room.ball;
  var s = room.state;
 
  // Labda mozgás
  b.x += b.vx;
  b.y += b.vy;
 
  // Fel/le fal
  if (b.y - BR < TW)   { b.y = TW + BR;   b.vy =  Math.abs(b.vy); }
  if (b.y + BR > 1-BW) { b.y = 1-BW - BR; b.vy = -Math.abs(b.vy); }
 
  // Host kapus (bal oldal) - x ~0.08
  var hpx = WL + PW;
  if (b.x - BR < hpx && b.x > WL &&
      b.y > s.h_py - PR && b.y < s.h_py + PR) {
    b.vx = Math.abs(b.vx) * 1.05;
    b.x = hpx + BR;
  }
 
  // Host mezőnyjátékos - x ~0.42
  var hmx = 0.42 + PW;
  if (b.x - BR < hmx && b.x > 0.38 &&
      b.y > s.h_my - MR && b.y < s.h_my + MR) {
    b.vx = Math.abs(b.vx) * 1.05;
    b.x = hmx + BR;
  }
 
  // Guest kapus (jobb oldal) - x ~0.92
  var gpx = 1 - WL - PW;
  if (b.x + BR > gpx && b.x < 1-WL &&
      b.y > s.g_py - PR && b.y < s.g_py + PR) {
    b.vx = -Math.abs(b.vx) * 1.05;
    b.x = gpx - BR;
  }
 
  // Guest mezőnyjátékos - x ~0.58
  var gmx = 0.58 - PW;
  if (b.x + BR > gmx && b.x < 0.62 &&
      b.y > s.g_my - MR && b.y < s.g_my + MR) {
    b.vx = -Math.abs(b.vx) * 1.05;
    b.x = gmx - BR;
  }
 
  // Sebesség limit
  var maxV = 0.02;
  b.vx = clamp(b.vx, -maxV, maxV);
  b.vy = clamp(b.vy, -maxV, maxV);
 
  // Gól - bal kapu (host kapott)
  if (b.x < WL && b.y > GY && b.y < GY + GH) {
    s.sc2++;
    room.ball = createBall();
    room.ball.vx = Math.abs(room.ball.vx);
  }
  // Gól - jobb kapu (guest kapott)
  if (b.x > 1-WL && b.y > GY && b.y < GY + GH) {
    s.sc1++;
    room.ball = createBall();
    room.ball.vx = -Math.abs(room.ball.vx);
  }
 
  // Meccs vége
  if (s.sc1 >= 15 || s.sc2 >= 15) {
    sendToRoom(room, { type: 'gameover', sc1: s.sc1, sc2: s.sc2 });
    clearInterval(room.loop);
    delete rooms[room.code];
    return;
  }
 
  // Állapot küldés
  sendToRoom(room, {
    type: 'state',
    bx: room.ball.x, by: room.ball.y,
    h_py: s.h_py, h_my: s.h_my,
    g_py: s.g_py, g_my: s.g_my,
    sc1: s.sc1, sc2: s.sc2
  });
}
 
function sendToRoom(room, msg) {
  var data = JSON.stringify(msg);
  if (room.host && room.host.readyState === 1) room.host.send(data);
  if (room.guest && room.guest.readyState === 1) room.guest.send(data);
}
 
wss.on('connection', (ws) => {
  ws.role = null;
  ws.code = null;
 
  ws.on('message', (data) => {
    try {
      var msg = JSON.parse(data);
 
      if (msg.type === 'create') {
        ws.code = msg.code;
        ws.role = 'host';
        rooms[msg.code] = {
          code: msg.code,
          host: ws, guest: null,
          ball: createBall(),
          state: { h_py:0.5, h_my:0.5, g_py:0.5, g_my:0.5, sc1:0, sc2:0 },
          loop: null
        };
        ws.send(JSON.stringify({ type: 'created', code: msg.code }));
      }
 
      else if (msg.type === 'join') {
        var room = rooms[msg.code];
        if (!room || !room.host) {
          ws.send(JSON.stringify({ type: 'error', msg: 'Nem találom a szobát!' }));
          return;
        }
        ws.code = msg.code;
        ws.role = 'guest';
        room.guest = ws;
        room.host.send(JSON.stringify({ type: 'start', role: 'host' }));
        ws.send(JSON.stringify({ type: 'start', role: 'guest' }));
        room.loop = setInterval(() => gameLoop(room), 33);
      }
 
      else if (msg.type === 'input') {
        var room = rooms[ws.code];
        if (!room) return;
        if (ws.role === 'host') {
          room.state.h_py = clamp(msg.py, 0.1, 0.9);
          room.state.h_my = clamp(msg.my, 0.1, 0.9);
        } else {
          room.state.g_py = clamp(msg.py, 0.1, 0.9);
          room.state.g_my = clamp(msg.my, 0.1, 0.9);
        }
      }
 
    } catch(e) { console.error(e); }
  });
 
  ws.on('close', () => {
    if (ws.code && rooms[ws.code]) {
      var room = rooms[ws.code];
      if (room.loop) clearInterval(room.loop);
      var other = ws.role === 'host' ? room.guest : room.host;
      if (other && other.readyState === 1) {
        other.send(JSON.stringify({ type: 'disconnect' }));
      }
      delete rooms[ws.code];
    }
  });
});
 
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Blaze Kick szerver: ' + PORT));
 





