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

  function getProblemSlug() {
    const m = location.pathname.match(/\/problems\/([^/]+)/);
    return m ? m[1] : null;
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
    const problemSlug = getProblemSlug();
    if (problem) {
      const status = (acceptedProblem === problem) ? 'accepted' : 'solving';
      chrome.runtime.sendMessage({ action: 'update', problem, problemSlug, status });
    } else {
      acceptedProblem = null;
      chrome.runtime.sendMessage({ action: 'update', problem: getPageInfo(), status: 'browsing' });
    }
  }

  // --- submission detection (DOM-based) ---

  function checkAccepted() {
    const m = location.pathname.match(/\/submissions\/(\d+)/);
    if (m && m[1] !== reportedSub) {
      const text = document.body.innerText;
      if (text.includes('Accepted') && text.includes('testcases passed')) {
        reportedSub = m[1];
        acceptedProblem = getProblem();
        if (state.code) {
          chrome.runtime.sendMessage({ action: 'update', problem: getProblem(), problemSlug: getProblemSlug(), status: 'accepted' });
        }
        return;
      }
    }

    const problem = getProblem();
    if (!problem || problem === acceptedProblem) return;

    const text = document.body.innerText;
    if (text.includes('Accepted') && text.includes('testcases passed')) {
      acceptedProblem = problem;
      reportedSub = 'dom-' + problem;
      if (state.code) {
        chrome.runtime.sendMessage({ action: 'update', problem, problemSlug: getProblemSlug(), status: 'accepted' });
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
      acceptedProblem = getProblem();
      chrome.runtime.sendMessage({ action: 'update', problem: getProblem(), problemSlug: getProblemSlug(), status: 'accepted' });
    }
  });

  // --- poll for URL changes + check submissions ---

  let lastUrl = location.href;
  let lastStateRefresh = 0;
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

    const now = Date.now();
    if (state.code && now - lastStateRefresh > 5000) {
      lastStateRefresh = now;
      chrome.runtime.sendMessage({ action: 'get-state' }, (s) => {
        if (chrome.runtime.lastError) return;
        if (s && JSON.stringify(s.members) !== JSON.stringify(state.members)) {
          state = s;
          render();
        }
      });
    }
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
      if (!wasInRoom && state.code) {
        sendUpdate();
      }
    }
  });

  // --- floating panel ---

  const panel = document.createElement('div');
  panel.id = 'lct-panel';
  document.body.appendChild(panel);

  // restore saved position
  try {
    const savedPos = localStorage.getItem('lct-panel-pos');
    if (savedPos) {
      const pos = JSON.parse(savedPos);
      panel.style.left = pos.left;
      panel.style.top = pos.top;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }
  } catch {}

  // --- drag support ---

  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragStartX = 0;
  let dragStartY = 0;

  panel.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.lct-head')) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const rect = panel.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const x = Math.max(0, Math.min(window.innerWidth - 50, e.clientX - dragOffsetX));
    const y = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dragOffsetY));
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  });

  document.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
      collapsed = !collapsed;
      render();
    } else {
      try {
        localStorage.setItem('lct-panel-pos', JSON.stringify({
          left: panel.style.left,
          top: panel.style.top,
        }));
      } catch {}
    }
  });

  // --- SVG icons for progress grid ---

  const ICON_ACCEPTED = '<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#2cbb5d"/><path d="M6 10l3 3 5-5" stroke="#fff" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_SOLVING = '<svg width="20" height="20" viewBox="0 0 20 20"><path d="M2 10h3l2-5 3 10 2-5h6" stroke="#ffc01e" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_IDLE = '<svg width="20" height="20" viewBox="0 0 20 20"><line x1="6" y1="10" x2="14" y2="10" stroke="#555" stroke-width="2" stroke-linecap="round"/></svg>';

  function formatTime(ms) {
    if (!ms || ms < 1000) return null;
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    const rs = s % 60;
    if (m < 60) return m + 'm ' + (rs ? rs + 's' : '');
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return h + 'h ' + (rm ? rm + 'm' : '');
  }

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

  function renderProgressGrid() {
    const problems = state.settings?.problems;
    const members = state.members || [];
    if (!problems?.length || !members.length) return '';

    let rows = '';
    members.forEach((m) => {
      const you = m.name === state.name;
      let cells = '';
      problems.forEach((p) => {
        const status = m.progress?.[p.titleSlug];
        let icon;
        if (status === 'accepted') icon = ICON_ACCEPTED;
        else if (status === 'solving') icon = ICON_SOLVING;
        else icon = ICON_IDLE;
        const time = formatTime(m.timeSpent?.[p.titleSlug]);
        const tooltip = time ? ` data-tooltip="${time}"` : '';
        cells += `<span class="lct-grid-cell${time ? ' has-tooltip' : ''}"${tooltip}>${icon}</span>`;
      });
      rows += `<div class="lct-grid-row">` +
        `<span class="lct-grid-name ${you ? 'you' : ''}">${m.name}</span>` +
        `<span class="lct-grid-cells">${cells}</span>` +
        `</div>`;
    });

    return '<div class="lct-grid">' + rows + '</div>';
  }

  function renderMemberRows() {
    return (state.members || [])
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

  function render() {
    let body = '';

    if (!state.code) {
      body = '<div class="lct-empty">Open the extension to join a room</div>';
    } else {
      const problems = state.settings?.problems;
      if (problems?.length) {
        body = renderPanelProblems() + renderProgressGrid();
      } else {
        body = renderMemberRows();
      }
    }

    panel.innerHTML = `
      <div class="lct-head">
        <span class="lct-title">LeetCode Together</span>
        <span class="lct-chevron ${collapsed ? 'up' : ''}">▼</span>
      </div>
      <div class="lct-body ${collapsed ? 'collapsed' : ''}">${body}</div>`;
  }

  render();
})();
