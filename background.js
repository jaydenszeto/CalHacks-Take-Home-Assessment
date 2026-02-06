// --- CONFIG ---
// For local dev: 'ws://localhost:3000'
// For production: 'wss://your-app.onrender.com'
// For local dev: 'ws://localhost:3000'
// For production: replace with your Render URL
const SERVER = 'wss://calhacks-take-home-assessment.onrender.com';

let ws = null;
let state = { code: null, name: null, members: [], settings: null, firstSolvers: {}, rerolledSlots: [] };

// --- LeetCode problem fetching ---

const TOPIC_SLUG_MAP = { heap: 'heap-priority-queue' };

function toApiSlug(topic) {
  if (TOPIC_SLUG_MAP[topic]) return TOPIC_SLUG_MAP[topic];
  return topic.replace(/_/g, '-');
}

async function fetchProblems(settings, count = 3, exclude = []) {
  try {
    const cookie = await chrome.cookies.get({ url: 'https://leetcode.com', name: 'csrftoken' });
    const csrf = cookie?.value || '';

    const difficulties = (settings.difficulty || []).map(d => d.toUpperCase());
    const topics = (settings.topics || []).map(toApiSlug);

    // questionList filter only accepts a single difficulty string
    const filters = {};
    if (difficulties.length === 1) filters.difficulty = difficulties[0];
    if (topics.length) filters.tags = topics;

    const query = `
      query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
        problemsetQuestionList: questionList(
          categorySlug: $categorySlug
          limit: $limit
          skip: $skip
          filters: $filters
        ) {
          total: totalNum
          questions: data {
            title
            titleSlug
            difficulty
            isPaidOnly
            status
          }
        }
      }
    `;

    const resp = await fetch('https://leetcode.com/graphql/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrftoken': csrf,
      },
      body: JSON.stringify({
        query,
        variables: { categorySlug: '', limit: 50, skip: 0, filters },
      }),
    });

    if (!resp.ok) return [];

    const data = await resp.json();
    let questions = data?.data?.problemsetQuestionList?.questions || [];

    // Filter out premium and solved
    questions = questions.filter(q => !q.isPaidOnly && q.status !== 'ac');

    // If multiple difficulties selected, filter client-side
    if (difficulties.length > 1) {
      questions = questions.filter(q =>
        difficulties.includes((q.difficulty || '').toUpperCase())
      );
    }

    if (exclude.length) {
      const excludeSet = new Set(exclude);
      questions = questions.filter(q => !excludeSet.has(q.titleSlug));
    }

    if (questions.length === 0) return [];

    // Pick random problems
    const picked = [];
    const pool = [...questions];
    count = Math.min(count, pool.length);
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      picked.push(pool.splice(idx, 1)[0]);
    }

    return picked.map(q => ({
      title: q.title,
      titleSlug: q.titleSlug,
      difficulty: q.difficulty,
    }));
  } catch (e) {
    console.error('fetchProblems failed:', e);
    return [];
  }
}

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
      state.settings = msg.settings || null;
      saveState();
    } else if (msg.type === 'room-state') {
      state.members = msg.members;
      if (msg.settings) state.settings = msg.settings;
      if (msg.firstSolvers) state.firstSolvers = msg.firstSolvers;
      if (msg.rerolledSlots) state.rerolledSlots = msg.rerolledSlots;
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
    const settings = msg.settings || { difficulty: [], topics: [] };
    const count = settings.count || 3;
    // Fetch problems and ensure WS connection in parallel
    const problemsReady = fetchProblems(settings, count);
    const wsReady = new Promise((resolve) => connectWS(resolve));
    Promise.all([problemsReady, wsReady]).then(([problems]) => {
      settings.problems = problems;
      send({ type: 'create', name: msg.name, settings });
    });
  }

  if (msg.action === 'join') {
    state.name = msg.name;
    connectWS(() => send({ type: 'join', name: msg.name, code: msg.code }));
  }

  if (msg.action === 'leave') {
    send({ type: 'leave' });
    state = { code: null, name: null, members: [], settings: null, firstSolvers: {}, rerolledSlots: [] };
    saveState();
    ws?.close();
  }

  if (msg.action === 'update') {
    send({ type: 'update', problem: msg.problem, problemSlug: msg.problemSlug, status: msg.status });
  }

  if (msg.action === 'reroll') {
    const problems = state.settings?.problems || [];
    const idx = problems.findIndex(p => p.titleSlug === msg.slug);
    if (idx === -1) return;
    // Block if slot already rerolled
    if (state.rerolledSlots.includes(idx)) return;
    // Block if any member has progress on this problem
    const hasProgress = (state.members || []).some(m => m.progress?.[msg.slug]);
    if (hasProgress) return;
    const exclude = problems.map(p => p.titleSlug).filter(s => s !== msg.slug);
    fetchProblems(state.settings, 1, exclude).then((picked) => {
      if (!picked.length) return;
      state.settings.problems[idx] = picked[0];
      send({ type: 'update-settings', settings: state.settings, rerolledSlot: idx });
      saveState();
    });
  }
});

// restore state if the service worker restarts
chrome.storage.local.get('roomState', ({ roomState }) => {
  if (roomState?.code) {
    state = roomState;
    connectWS(() => send({ type: 'join', name: state.name, code: state.code }));
  } else {
    // Pre-connect so the server is warm when the user clicks Create/Join
    connectWS(() => {});
  }
});
