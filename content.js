(function () {
  if (window !== window.top) return;

  let state = { code: null, name: null, members: [] };
  let collapsed = false;
  let currentProblem = null;

  // ask background for current room state
  chrome.runtime.sendMessage({ action: 'get-state' }, (s) => {
    if (s) state = s;
    render();
    checkProblem();
  });

  // --- problem detection ---

  function getProblem() {
    const m = location.pathname.match(/\/problems\/([^/]+)/);
    if (!m) return null;
    return m[1].split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  }

  function checkProblem() {
    const p = getProblem();
    if (p === currentProblem) return;
    currentProblem = p;
    if (state.code) {
      chrome.runtime.sendMessage({
        action: 'update',
        problem: p,
        status: p ? 'solving' : 'idle',
      });
    }
  }

  // LeetCode is a SPA so poll for URL changes
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      checkProblem();
    }
  }, 1000);

  // --- submission detection ---
  // inject a script into the page context that patches fetch
  // so we can catch submission results from LeetCode's API

  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('inject.js');
  document.documentElement.appendChild(s);
  s.onload = () => s.remove();

  document.addEventListener('__lct_submission', (e) => {
    if (e.detail?.status === 'Accepted') {
      chrome.runtime.sendMessage({ action: 'update', status: 'accepted' });
    }
  });

  // --- listen for room state updates ---

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'room-state') {
      state = msg;
      render();
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
