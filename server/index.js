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
      firstSolvers: {},
      rerolledSlots: [],
      members: new Map([[client.id, { name: msg.name, problem: null, problemSlug: null, status: 'idle', progress: {}, timeSpent: {}, activeTimer: null }]]),
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

    // Carry over progress and timeSpent from previous connection with same name (reconnect)
    let prevProgress = {};
    let prevTimeSpent = {};
    for (const [id, m] of room.members) {
      if (m.name === msg.name) {
        prevProgress = m.progress || {};
        // Flush any active timer before carrying over
        if (m.activeTimer) {
          const elapsed = Date.now() - m.activeTimer.start;
          m.timeSpent[m.activeTimer.slug] = (m.timeSpent[m.activeTimer.slug] || 0) + elapsed;
        }
        prevTimeSpent = m.timeSpent || {};
        room.members.delete(id);
        break;
      }
    }

    room.members.set(client.id, { name: msg.name, problem: null, problemSlug: null, status: 'idle', progress: prevProgress, timeSpent: prevTimeSpent, activeTimer: null });
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
    if (msg.problemSlug) member.problemSlug = msg.problemSlug;
    if (msg.status !== undefined) {
      const slug = msg.problemSlug || member.problemSlug;

      // Stop active timer if switching problem or no longer solving
      if (member.activeTimer) {
        const sameProblem = member.activeTimer.slug === slug;
        const stillSolving = msg.status === 'solving';
        if (!sameProblem || !stillSolving) {
          const elapsed = Date.now() - member.activeTimer.start;
          member.timeSpent[member.activeTimer.slug] = (member.timeSpent[member.activeTimer.slug] || 0) + elapsed;
          member.activeTimer = null;
        }
      }

      // Start timer if solving and no active timer
      if (msg.status === 'solving' && !member.activeTimer && slug) {
        member.activeTimer = { slug, start: Date.now() };
      }

      member.status = msg.status;
      if (slug) {
        if (msg.status === 'accepted') {
          member.progress[slug] = 'accepted';
          if (!room.firstSolvers[slug]) room.firstSolvers[slug] = member.name;
        } else if (msg.status === 'solving' && member.progress[slug] !== 'accepted') {
          member.progress[slug] = 'solving';
        }
      }
    }
    broadcast(client.room);
  }

  else if (msg.type === 'update-settings') {
    if (!client.room) return;
    const room = rooms.get(client.room);
    if (!room) return;

    // If this is a reroll, validate it
    if (msg.rerolledSlot !== undefined) {
      const idx = msg.rerolledSlot;
      // Block if slot already rerolled
      if (room.rerolledSlots.includes(idx)) return;
      // Block if any member has progress on the old problem at this slot
      const oldSlug = room.settings?.problems?.[idx]?.titleSlug;
      if (oldSlug) {
        for (const m of room.members.values()) {
          if (m.progress[oldSlug]) return;
        }
      }
      room.rerolledSlots.push(idx);
    }

    // Clean up firstSolvers for removed problems
    const newSlugs = new Set((msg.settings?.problems || []).map(p => p.titleSlug));
    for (const slug of Object.keys(room.firstSolvers)) {
      if (!newSlugs.has(slug)) delete room.firstSolvers[slug];
    }
    room.settings = msg.settings;
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
  // Flush active timer before removing
  const member = room.members.get(client.id);
  if (member?.activeTimer) {
    const elapsed = Date.now() - member.activeTimer.start;
    member.timeSpent[member.activeTimer.slug] = (member.timeSpent[member.activeTimer.slug] || 0) + elapsed;
    member.activeTimer = null;
  }
  room.members.delete(client.id);
  if (room.members.size === 0) rooms.delete(code);
  else broadcast(code);
}

function broadcast(code) {
  const room = rooms.get(code);
  if (!room) return;
  const now = Date.now();
  const members = [...room.members.values()].map((m) => {
    // Compute timeSpent with active timer included
    const timeSpent = { ...m.timeSpent };
    if (m.activeTimer) {
      const slug = m.activeTimer.slug;
      timeSpent[slug] = (timeSpent[slug] || 0) + (now - m.activeTimer.start);
    }
    return { name: m.name, problem: m.problem, problemSlug: m.problemSlug, status: m.status, progress: m.progress, timeSpent, activeSlug: m.activeTimer?.slug || null };
  });
  for (const [ws, c] of clients) {
    if (c.room === code) send(ws, { type: 'room-state', members, settings: room.settings, firstSolvers: room.firstSolvers, rerolledSlots: room.rerolledSlots });
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

  // Keep Render from spinning down the free-tier instance
  if (process.env.RENDER_EXTERNAL_URL) {
    setInterval(() => {
      http.get(process.env.RENDER_EXTERNAL_URL, () => {});
    }, 14 * 60 * 1000); // every 14 minutes
  }
});
