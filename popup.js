const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// SVG icons for progress grid
const ICON_ACCEPTED = '<svg width="22" height="22" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#2cbb5d"/><path d="M6 10l3 3 5-5" stroke="#fff" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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

$('#create-btn').onclick = () => {
  const name = $('#username').value.trim();
  if (!name) return;

  const settings = {
    difficulty: [...$$('#diff-chips .chip.selected')].map((el) => el.dataset.value),
    topics: [...$$('#topic-chips .chip.selected')].map((el) => el.dataset.value),
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

  renderTags(state.settings);
  renderProblems(state.settings?.problems);
  renderMembers(state.members || [], state.name, state.settings?.problems);
}

function showLobby() {
  $('#lobby').hidden = false;
  $('#room').hidden = true;

  // header switches back to title
  $('#head-title').hidden = false;
  $('#head-code').hidden = true;
  $('#leave-btn').hidden = true;
}

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

function renderProblems(problems) {
  const el = $('#room-problems');
  if (!problems?.length) { el.hidden = true; return; }

  el.innerHTML = '<div class="problems-title">Problems</div>' +
    problems.map((p) => {
      const diff = (p.difficulty || '').toLowerCase();
      const url = `https://leetcode.com/problems/${p.titleSlug}/`;
      return `
      <a class="problem-row" href="${url}" data-url="${url}">
        <span class="problem-diff ${diff}">${p.difficulty}</span>
        <span class="problem-name">${p.title}</span>
      </a>`;
    }).join('');

  el.hidden = false;

  el.querySelectorAll('.problem-row').forEach((row) => {
    row.onclick = (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: row.dataset.url });
    };
  });
}

function renderMembers(members, myName, problems) {
  if (problems?.length) {
    // Progress grid view
    $('#members').innerHTML = '<div class="progress-grid">' +
      members.map((m) => {
        const you = m.name === myName;
        let cells = '';
        problems.forEach((p) => {
          const status = m.progress?.[p.titleSlug];
          let icon;
          if (status === 'accepted') icon = ICON_ACCEPTED;
          else if (status === 'solving') icon = ICON_SOLVING;
          else icon = ICON_IDLE;
          const time = formatTime(m.timeSpent?.[p.titleSlug]);
          const tooltip = time ? ` data-tooltip="${time}"` : '';
          cells += `<span class="progress-cell${time ? ' has-tooltip' : ''}"${tooltip}>${icon}</span>`;
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
