const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// room code -> { settings, members: Map<clientId, { name, problem, status }> }
const rooms = new Map();
// ws -> { id, room, name }
const clients = new Map();
let nextId = 1;

app.get('/', (_req, res) => res.json({ status: 'ok' }));

wss.on('connection', (ws) => {
  const id = String(nextId++);
  clients.set(ws, { id, room: null, name: null });

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    onMessage(ws, msg);
  });

  ws.on('close', () => {
    leave(ws);
    clients.delete(ws);
  });
});

// kill dead connections
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

function onMessage(ws, msg) {
  const client = clients.get(ws);

  if (msg.type === 'create') {
    leave(ws);
    const code = makeCode();
    client.name = msg.name;
    client.room = code;
    const settings = msg.settings || { difficulty: [], topics: [] };
    rooms.set(code, {
      settings,
      members: new Map([[client.id, { name: msg.name, problem: null, status: 'idle' }]]),
    });
    send(ws, { type: 'joined', code, settings });
    broadcast(code);
  }

  else if (msg.type === 'join') {
    const code = (msg.code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return send(ws, { type: 'error', message: 'Room not found' });
    leave(ws);
    client.name = msg.name;
    client.room = code;
    room.members.set(client.id, { name: msg.name, problem: null, status: 'idle' });
    send(ws, { type: 'joined', code, settings: room.settings });
    broadcast(code);
  }

  else if (msg.type === 'leave') {
    leave(ws);
    send(ws, { type: 'left' });
  }

  else if (msg.type === 'update') {
    if (!client.room) return;
    const room = rooms.get(client.room);
    if (!room) return;
    const member = room.members.get(client.id);
    if (!member) return;
    if (msg.problem !== undefined) member.problem = msg.problem;
    if (msg.status !== undefined) member.status = msg.status;
    broadcast(client.room);
  }
}

function leave(ws) {
  const client = clients.get(ws);
  if (!client?.room) return;
  const code = client.room;
  const room = rooms.get(code);
  client.room = null;
  if (!room) return;
  room.members.delete(client.id);
  if (room.members.size === 0) rooms.delete(code);
  else broadcast(code);
}

function broadcast(code) {
  const room = rooms.get(code);
  if (!room) return;
  const members = [...room.members.values()];
  for (const [ws, c] of clients) {
    if (c.room === code) send(ws, { type: 'room-state', members, settings: room.settings });
  }
}

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

server.listen(process.env.PORT || 3000, () => {
  console.log('listening on', process.env.PORT || 3000);
});
