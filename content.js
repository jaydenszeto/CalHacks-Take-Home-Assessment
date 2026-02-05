(function () {
  if (window !== window.top) return;

  let state = { code: null, name: null, members: [] };
  let collapsed = false;
  let currentProblem = null;
  let reportedSub = null;

  // --- problem detection ---

  function getProblem() {
    const m = location.pathname.match(/\/problems\/([^/]+)/);
    if (!m) return null;
    return m[1].split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  }

  function sendProblem(problem) {
    if (!state.code) return;
    chrome.runtime.sendMessage({
      action: 'update',
      problem: problem,
      status: problem ? 'solving' : 'idle',
    });
  }

  // --- submission detection (DOM-based) ---
  // LeetCode's CSP blocks inject.js in most cases, so we detect
  // accepted submissions by watching the page content on /submissions/ URLs

  function checkAccepted() {
    const m = location.pathname.match(/\/submissions\/(\d+)/);
    if (!m || m[1] === reportedSub) return;

    const text = document.body.innerText;
    if (text.includes('Accepted') && text.includes('testcases passed')) {
      reportedSub = m[1];
      if (state.code) {
        chrome.runtime.sendMessage({ action: 'update', status: 'accepted' });
      }
    }
  }

  // also try the fetch-interception approach as a backup
  try {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('inject.js');
    document.documentElement.appendChild(s);
    s.onload = () => s.remove();
  } catch {}

  document.addEventListener('__lct_submission', (e) => {
    if (e.detail?.status === 'Accepted' && state.code) {
      chrome.runtime.sendMessage({ action: 'update', status: 'accepted' });
    }
  });

  // --- poll for URL changes + check submissions ---

  let lastUrl = location.href;
  setInterval(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      reportedSub = null;
      const p = getProblem();
      if (p !== currentProblem) {
        currentProblem = p;
        sendProblem(p);
      }
    }
    checkAccepted();
  }, 1000);

  // --- get initial state from background ---

  chrome.runtime.sendMessage({ action: 'get-state' }, (s) => {
    if (chrome.runtime.lastError) return;
    if (s) state = s;
    currentProblem = getProblem();
    // if already in a room, immediately report what problem we're on
    if (state.code && currentProblem) {
      sendProblem(currentProblem);
    }
    render();
  });

  // --- listen for room state updates ---

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'room-state') {
      const wasInRoom = !!state.code;
      state = msg;
      render();
      // just joined? tell the server what problem we're on
      if (!wasInRoom && state.code && currentProblem) {
        sendProblem(currentProblem);
      }
    }
  });

  // --- floating panel ---

  const panel = document.createElement('div');
  panel.id = 'lct-panel';
  document.body.appendChild(panel);

  function render() {
    let rows = '';

    if (!state.code) {
      rows = '<div class="lct-empty">Open the extension to join a room</div>';
    } else {
      rows = (state.members || [])
        .map((m) => {
          const you = m.name === state.name;
          const label =
            m.status === 'accepted' ? 'Accepted' :
            m.status === 'solving' ? 'Solving...' : 'Idle';
          return `
          <div class="lct-row">
            <span class="lct-name ${you ? 'you' : ''}">${m.name}</span>
            <div class="lct-right">
              <div class="lct-problem">${m.problem || '\u2014'}</div>
              <div class="lct-status ${m.status}">${label}</div>
            </div>
          </div>`;
        })
        .join('');
    }

    panel.innerHTML = `
      <div class="lct-head">
        <span class="lct-title">LeetCode Together</span>
        <span class="lct-chevron ${collapsed ? 'up' : ''}">▼</span>
      </div>
      <div class="lct-body ${collapsed ? 'collapsed' : ''}">${rows}</div>`;

    panel.querySelector('.lct-head').onclick = () => {
      collapsed = !collapsed;
      render();
    };
  }

  render();
})();
