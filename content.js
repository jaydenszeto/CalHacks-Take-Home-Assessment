(function () {
  if (window !== window.top) return;

  let state = { code: null, name: null, members: [], settings: null };
  let collapsed = false;
  let currentProblem = null;
  let reportedSub = null;
  let acceptedProblem = null;

  // --- problem & page detection ---

  function getProblem() {
    const m = location.pathname.match(/\/problems\/([^/]+)/);
    if (!m) return null;
    return m[1].split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  }

  function getPageInfo() {
    const path = location.pathname;
    if (path.startsWith('/problemset')) return 'Problem List';
    if (path.startsWith('/contest')) return 'Contests';
    if (path.startsWith('/discuss')) return 'Discussion';
    if (path.startsWith('/explore')) return 'Explore';
    if (path === '/' || path === '') return 'Home';
    return 'Browsing';
  }

  function sendUpdate() {
    if (!state.code) return;
    const problem = getProblem();
    if (problem) {
      // Don't downgrade from 'accepted' back to 'solving' for the same problem
      const status = (acceptedProblem === problem) ? 'accepted' : 'solving';
      chrome.runtime.sendMessage({ action: 'update', problem, status });
    } else {
      acceptedProblem = null;
      chrome.runtime.sendMessage({ action: 'update', problem: getPageInfo(), status: 'browsing' });
    }
  }

  // --- submission detection (DOM-based) ---
  // LeetCode's CSP blocks inject.js in most cases, so we detect
  // accepted submissions by watching the page content on /submissions/ URLs

  function checkAccepted() {
    // Method 1: submission URL with numeric ID (e.g. /submissions/12345/)
    const m = location.pathname.match(/\/submissions\/(\d+)/);
    if (m && m[1] !== reportedSub) {
      const text = document.body.innerText;
      if (text.includes('Accepted') && text.includes('testcases passed')) {
        reportedSub = m[1];
        acceptedProblem = getProblem();
        if (state.code) {
          chrome.runtime.sendMessage({ action: 'update', status: 'accepted' });
        }
        return;
      }
    }

    // Method 2: detect acceptance on the problem page itself
    // (modern LeetCode shows results inline without a submission ID in the URL)
    const problem = getProblem();
    if (!problem || problem === acceptedProblem) return;

    const text = document.body.innerText;
    if (text.includes('Accepted') && text.includes('testcases passed')) {
      acceptedProblem = problem;
      reportedSub = 'dom-' + problem;
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
      const newProblem = getProblem();
      if (newProblem !== currentProblem) {
        acceptedProblem = null;
      }
      currentProblem = newProblem;
      sendUpdate();
    }
    checkAccepted();
  }, 1000);

  // --- get initial state from background ---

  chrome.runtime.sendMessage({ action: 'get-state' }, (s) => {
    if (chrome.runtime.lastError) return;
    if (s) state = s;
    currentProblem = getProblem();
    if (state.code) sendUpdate();
    render();
  });

  // --- listen for room state updates ---

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'room-state') {
      const wasInRoom = !!state.code;
      state = msg;
      render();
      // just joined? tell the server where we are
      if (!wasInRoom && state.code) {
        sendUpdate();
      }
    }
  });

  // --- floating panel ---

  const panel = document.createElement('div');
  panel.id = 'lct-panel';
  document.body.appendChild(panel);

  function renderPanelProblems() {
    const problems = state.settings?.problems;
    if (!problems?.length) return '';
    return '<div class="lct-problems">' +
      '<div class="lct-problems-title">Problems</div>' +
      problems.map((p) => {
        const diff = (p.difficulty || '').toLowerCase();
        const url = `https://leetcode.com/problems/${p.titleSlug}/`;
        return `<a class="lct-prob-row" href="${url}">` +
          `<span class="lct-prob-diff ${diff}">${p.difficulty}</span>` +
          `<span class="lct-prob-name">${p.title}</span></a>`;
      }).join('') +
      '</div>';
  }

  function render() {
    let rows = '';

    if (!state.code) {
      rows = '<div class="lct-empty">Open the extension to join a room</div>';
    } else {
      rows = renderPanelProblems() + (state.members || [])
        .map((m) => {
          const you = m.name === state.name;
          const label =
            m.status === 'accepted' ? 'Accepted' :
            m.status === 'solving' ? 'Solving...' :
            m.status === 'browsing' ? 'Browsing' : 'Idle';
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
