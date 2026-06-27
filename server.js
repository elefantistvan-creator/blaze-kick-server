
const WebSocket = require('ws');
const http = require('http');
 
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Blaze Kick Server OK');
});
 
const wss = new WebSocket.Server({ server });
 
const rooms = {};
 
function createBall() {
  var dir = Math.random() > 0.5 ? 1 : -1;
  return { x: 0.5, y: 0.5, vx: 0.004 * dir, vy: (Math.random() - 0.5) * 0.003 };
}
 
function gameLoop(room) {
  var b = room.ball;
  var s = room.state;
 
  // Labda mozgás
  b.x += b.vx;
  b.y += b.vy;
 
  // Fal ütközés fel/le
  if (b.y < 0.04) { b.y = 0.04; b.vy = Math.abs(b.vy); }
  if (b.y > 0.96) { b.y = 0.96; b.vy = -Math.abs(b.vy); }
 
  var BR = 0.028; // labda sugár (arányos)
  var PW = 0.018; // pálcika szélesség
  var PR = 0.12;  // kapus magasság fele
  var MR = 0.07;  // mezőnyjátékos magasság fele
 
  // Host kapus ütközés (bal oldal)
  if (b.x - BR < 0.04 + PW && b.x > 0.02 &&
      b.y > s.h_py - PR && b.y < s.h_py + PR) {
    b.vx = Math.abs(b.vx) * 1.05;
    b.x = 0.04 + PW + BR;
  }
  // Host mezőnyjátékos
  if (b.x - BR < 0.42 + PW && b.x > 0.38 &&
      b.y > s.h_my - MR && b.y < s.h_my + MR) {
    b.vx = Math.abs(b.vx) * 1.05;
    b.x = 0.42 + PW + BR;
  }
 
  // Guest kapus ütközés (jobb oldal)
  if (b.x + BR > 0.96 - PW && b.x < 0.98 &&
      b.y > s.g_py - PR && b.y < s.g_py + PR) {
    b.vx = -Math.abs(b.vx) * 1.05;
    b.x = 0.96 - PW - BR;
  }
  // Guest mezőnyjátékos
  if (b.x + BR > 0.58 - PW && b.x < 0.62 &&
      b.y > s.g_my - MR && b.y < s.g_my + MR) {
    b.vx = -Math.abs(b.vx) * 1.05;
    b.x = 0.58 - PW - BR;
  }
 
  // Sebesség limit
  var maxV = 0.018;
  if (Math.abs(b.vx) > maxV) b.vx = b.vx > 0 ? maxV : -maxV;
  if (Math.abs(b.vy) > maxV) b.vy = b.vy > 0 ? maxV : -maxV;
 
  // Gól
  var GY = 0.32, GH = 0.36;
  if (b.x < 0.02 && b.y > GY && b.y < GY + GH) {
    s.sc2++;
    room.ball = createBall();
    room.ball.vx = Math.abs(room.ball.vx); // guest felé indul
  }
  if (b.x > 0.98 && b.y > GY && b.y < GY + GH) {
    s.sc1++;
    room.ball = createBall();
    room.ball.vx = -Math.abs(room.ball.vx); // host felé indul
  }
 
  // Meccs vége
  if (s.sc1 >= 15 || s.sc2 >= 15) {
    sendToRoom(room, { type: 'gameover', sc1: s.sc1, sc2: s.sc2 });
    clearInterval(room.loop);
    delete rooms[room.code];
    return;
  }
 
  // Állapot küldés mindkét félnek
  sendToRoom(room, {
    type: 'state',
    bx: room.ball.x, by: room.ball.y,
    bvx: room.ball.vx, bvy: room.ball.vy,
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
        // Játék indul
        room.host.send(JSON.stringify({ type: 'start', role: 'host' }));
        ws.send(JSON.stringify({ type: 'start', role: 'guest' }));
        // Game loop 30fps
        room.loop = setInterval(() => gameLoop(room), 33);
      }
 
      else if (msg.type === 'input') {
        var room = rooms[ws.code];
        if (!room) return;
        if (ws.role === 'host') {
          room.state.h_py = Math.max(0.1, Math.min(0.9, msg.py));
          room.state.h_my = Math.max(0.1, Math.min(0.9, msg.my));
        } else {
          room.state.g_py = Math.max(0.1, Math.min(0.9, msg.py));
          room.state.g_my = Math.max(0.1, Math.min(0.9, msg.my));
        }
      }
 
    } catch(e) {}
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
 
