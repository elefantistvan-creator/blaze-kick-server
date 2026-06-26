const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Blaze Kick Server OK');
});

const wss = new WebSocket.Server({ server });

// Szobák tárolása: { code: { host: ws, guest: ws } }
const rooms = {};

wss.on('connection', (ws) => {
  ws.role = null;
  ws.code = null;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'create') {
        // Host létrehozza a szobát
        ws.code = msg.code;
        ws.role = 'host';
        rooms[msg.code] = { host: ws, guest: null };
        ws.send(JSON.stringify({ type: 'created', code: msg.code }));
      }

      else if (msg.type === 'join') {
        // Guest csatlakozik
        const room = rooms[msg.code];
        if (!room || !room.host) {
          ws.send(JSON.stringify({ type: 'error', msg: 'Nem találom a szobát!' }));
          return;
        }
        ws.code = msg.code;
        ws.role = 'guest';
        room.guest = ws;
        // Mindkettőnek jelezzük hogy készen állnak
        ws.send(JSON.stringify({ type: 'start', role: 'guest' }));
        room.host.send(JSON.stringify({ type: 'start', role: 'host' }));
      }

      else if (msg.type === 'state') {
        // Játék állapot továbbítása az ellenfélnek
        const room = rooms[ws.code];
        if (!room) return;
        const target = ws.role === 'host' ? room.guest : room.host;
        if (target && target.readyState === WebSocket.OPEN) {
          target.send(JSON.stringify(msg));
        }
      }

    } catch(e) {}
  });

  ws.on('close', () => {
    if (ws.code && rooms[ws.code]) {
      const room = rooms[ws.code];
      const other = ws.role === 'host' ? room.guest : room.host;
      if (other && other.readyState === WebSocket.OPEN) {
        other.send(JSON.stringify({ type: 'disconnect' }));
      }
      delete rooms[ws.code];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Blaze Kick szerver fut: ' + PORT);
});
