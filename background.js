// --- CONFIG ---
// For local dev: 'ws://localhost:3000'
// For production: 'wss://your-app.onrender.com'
const SERVER = 'ws://localhost:3000';

let ws = null;
let state = { code: null, name: null, members: [] };

function send(obj) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(obj));
}

function saveState() {
  chrome.storage.local.set({ roomState: state });

  // push to leetcode tabs
  chrome.tabs.query({ url: 'https://leetcode.com/*' }, (tabs) => {
    const msg = { type: 'room-state', ...state };
    tabs.forEach((t) => chrome.tabs.sendMessage(t.id, msg).catch(() => {}));
  });

  // push to popup (if open)
  chrome.runtime.sendMessage({ type: 'room-state', ...state }).catch(() => {});
}

function sendError(message) {
  chrome.runtime.sendMessage({ type: 'error', message }).catch(() => {});
}

function connectWS(then) {
  if (ws?.readyState === 1) return then();

  ws = new WebSocket(SERVER);
  ws.onopen = then;
  ws.onerror = () => sendError('Could not connect to server');

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'joined') {
      state.code = msg.code;
      saveState();
    } else if (msg.type === 'room-state') {
      state.members = msg.members;
      saveState();
    } else if (msg.type === 'error') {
      sendError(msg.message);
    }
  };

  ws.onclose = () => {
    ws = null;
    // auto-reconnect if we were in a room
    if (state.code) {
      setTimeout(() => {
        connectWS(() => send({ type: 'join', name: state.name, code: state.code }));
      }, 2000);
    }
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.action === 'get-state') {
    reply(state);
    return;
  }

  if (msg.action === 'create') {
    state.name = msg.name;
    connectWS(() => send({ type: 'create', name: msg.name }));
  }

  if (msg.action === 'join') {
    state.name = msg.name;
    connectWS(() => send({ type: 'join', name: msg.name, code: msg.code }));
  }

  if (msg.action === 'leave') {
    send({ type: 'leave' });
    state = { code: null, name: null, members: [] };
    saveState();
    ws?.close();
  }

  if (msg.action === 'update') {
    send({ type: 'update', problem: msg.problem, status: msg.status });
  }
});

// restore state if the service worker restarts
chrome.storage.local.get('roomState', ({ roomState }) => {
  if (roomState?.code) {
    state = roomState;
    connectWS(() => send({ type: 'join', name: state.name, code: state.code }));
  }
});
