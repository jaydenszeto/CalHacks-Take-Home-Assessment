const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// SVG icons for progress grid
const ICON_ACCEPTED = '<svg width="22" height="22" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#2cbb5d"/><path d="M6 10l3 3 5-5" stroke="#fff" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_CROWN = '<svg width="22" height="22" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#2cbb5d"/><path d="M5 13l1.5-5L10 10.5 13.5 8 15 13z" fill="#ffd700" stroke="#fff" stroke-width="0.5"/></svg>';
const ICON_SOLVING = '<svg width="22" height="22" viewBox="0 0 20 20"><path d="M2 10h3l2-5 3 10 2-5h6" stroke="#ffc01e" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_IDLE = '<svg width="22" height="22" viewBox="0 0 20 20"><line x1="6" y1="10" x2="14" y2="10" stroke="#555" stroke-width="2" stroke-linecap="round"/></svg>';

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

// track last state for live tooltip updates
let lastState = null;
let stateReceivedAt = 0;

// chip labels for display in room view
const topicLabels = {};
$$('#topic-chips .chip').forEach((el) => {
  topicLabels[el.dataset.value] = el.textContent;
});

// chip toggling
$$('.chip').forEach((chip) => {
  chip.onclick = () => chip.classList.toggle('selected');
});

// load saved state
chrome.storage.local.get(['roomState', 'username'], ({ roomState, username }) => {
  if (username) $('#username').value = username;
  if (roomState?.code) showRoom(roomState);
});

// count picker
let problemCount = 3;
$('#count-up').onclick = () => {
  if (problemCount < 10) { problemCount++; $('#count-val').textContent = problemCount; }
};
$('#count-down').onclick = () => {
  if (problemCount > 1) { problemCount--; $('#count-val').textContent = problemCount; }
};

$('#create-btn').onclick = () => {
  const name = $('#username').value.trim();
  if (!name) return;

  const settings = {
    difficulty: [...$$('#diff-chips .chip.selected')].map((el) => el.dataset.value),
    topics: [...$$('#topic-chips .chip.selected')].map((el) => el.dataset.value),
    count: problemCount,
  };

  chrome.storage.local.set({ username: name });
  chrome.runtime.sendMessage({ action: 'create', name, settings });
};

$('#join-btn').onclick = () => {
  const name = $('#username').value.trim();
  const code = $('#room-code').value.trim().toUpperCase();
  if (!name || !code) return;
  chrome.storage.local.set({ username: name });
  chrome.runtime.sendMessage({ action: 'join', name, code });
};

$('#leave-btn').onclick = () => {
  chrome.runtime.sendMessage({ action: 'leave' });
  showLobby();
};

// live updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'room-state' && msg.code) showRoom(msg);
  if (msg.type === 'room-state' && !msg.code) showLobby();
  if (msg.type === 'error') showError(msg.message);
});

function showRoom(state) {
  $('#error').hidden = true;
  $('#lobby').hidden = true;
  $('#room').hidden = false;

  // header switches to room mode
  $('#head-title').hidden = true;
  $('#head-code').hidden = false;
  $('#head-code').textContent = 'Room ' + state.code;
  $('#leave-btn').hidden = false;

  lastState = state;
  stateReceivedAt = Date.now();

  renderTags(state.settings);
  renderProblems(state.settings?.problems, state.members || [], state.rerolledSlots || []);
  renderMembers(state.members || [], state.name, state.settings?.problems, state.firstSolvers);
}

function showLobby() {
  $('#lobby').hidden = false;
  $('#room').hidden = true;
  lastState = null;

  // header switches back to title
  $('#head-title').hidden = false;
  $('#head-code').hidden = true;
  $('#leave-btn').hidden = true;
}

// Update tooltips every second for active timers
setInterval(() => {
  if (!lastState?.members) return;
  const now = Date.now();
  const elapsed = now - stateReceivedAt;
  lastState.members.forEach((m) => {
    if (!m.activeSlug) return;
    const cell = document.querySelector(`.progress-cell[data-member="${m.name}"][data-slug="${m.activeSlug}"]`);
    if (!cell) return;
    const baseMs = m.timeSpent?.[m.activeSlug] || 0;
    const time = formatTime(baseMs + elapsed);
    if (time) {
      cell.classList.add('has-tooltip');
      cell.dataset.tooltip = time;
    }
  });
}, 1000);

function showError(message) {
  const el = $('#error');
  el.textContent = message;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 4000);
}

function renderTags(settings) {
  const el = $('#room-tags');
  if (!settings) { el.hidden = true; return; }

  let html = '';
  (settings.difficulty || []).forEach((d) => {
    html += `<span class="tag ${d}">${d[0].toUpperCase() + d.slice(1)}</span>`;
  });
  (settings.topics || []).forEach((t) => {
    html += `<span class="tag">${topicLabels[t] || t}</span>`;
  });

  el.innerHTML = html;
  el.hidden = !html;
}

function renderProblems(problems, members, rerolledSlots) {
  const el = $('#room-problems');
  if (!problems?.length) { el.hidden = true; return; }

  el.innerHTML = '<div class="problems-title">Problems</div>' +
    problems.map((p, i) => {
      const diff = (p.difficulty || '').toLowerCase();
      const url = `https://leetcode.com/problems/${p.titleSlug}/`;
      const hasProgress = members.some(m => m.progress?.[p.titleSlug]);
      const alreadyRerolled = rerolledSlots.includes(i);
      const disabled = hasProgress || alreadyRerolled;
      return `
      <div class="problem-row-wrap">
        <a class="problem-row" href="${url}" data-url="${url}">
          <span class="problem-diff ${diff}">${p.difficulty}</span>
          <span class="problem-name">${p.title}</span>
        </a>
        <button class="problem-reroll${disabled ? ' disabled' : ''}" data-slug="${p.titleSlug}" title="${alreadyRerolled ? 'Already rerolled' : hasProgress ? 'Someone started this problem' : 'Reroll problem'}"${disabled ? ' disabled' : ''}>&#x27F3;</button>
      </div>`;
    }).join('');

  el.hidden = false;

  el.querySelectorAll('.problem-row').forEach((row) => {
    row.onclick = (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: row.dataset.url });
    };
  });

  el.querySelectorAll('.problem-reroll').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: 'reroll', slug: btn.dataset.slug });
    };
  });
}

function renderMembers(members, myName, problems, firstSolvers) {
  if (problems?.length) {
    // Progress grid view
    $('#members').innerHTML = '<div class="progress-grid">' +
      members.map((m) => {
        const you = m.name === myName;
        let cells = '';
        problems.forEach((p) => {
          const status = m.progress?.[p.titleSlug];
          let icon;
          if (status === 'accepted') icon = firstSolvers?.[p.titleSlug] === m.name ? ICON_CROWN : ICON_ACCEPTED;
          else if (status === 'solving') icon = ICON_SOLVING;
          else icon = ICON_IDLE;
          const baseMs = m.timeSpent?.[p.titleSlug] || 0;
          const isActive = m.activeSlug === p.titleSlug;
          const liveMs = baseMs + (isActive ? Date.now() - stateReceivedAt : 0);
          const time = formatTime(liveMs);
          const tooltip = time ? ` data-tooltip="${time}"` : '';
          cells += `<span class="progress-cell${time ? ' has-tooltip' : ''}"${tooltip} data-member="${m.name}" data-slug="${p.titleSlug}">${icon}</span>`;
        });
        return `<div class="progress-row">` +
          `<span class="progress-name ${you ? 'you' : ''}">${m.name}</span>` +
          `<span class="progress-cells">${cells}</span>` +
          `</div>`;
      }).join('') +
      '</div>';
    return;
  }

  // Fallback to original member list
  $('#members').innerHTML = members
    .map((m) => {
      const you = m.name === myName;
      const label =
        m.status === 'accepted' ? 'Accepted' :
        m.status === 'solving' ? 'Solving...' :
        m.status === 'browsing' ? 'Browsing' : 'Idle';
      return `
      <div class="member-row">
        <span class="member-name ${you ? 'you' : ''}">${m.name}</span>
        <div class="member-right">
          <div class="member-problem">${m.problem || '\u2014'}</div>
          <div class="member-status ${m.status}">${label}</div>
        </div>
      </div>`;
    })
    .join('');
}
