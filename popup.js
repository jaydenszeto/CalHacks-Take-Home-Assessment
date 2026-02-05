const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

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
  renderMembers(state.members || [], state.name);
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

function renderMembers(members, myName) {
  $('#members').innerHTML = members
    .map((m) => {
      const you = m.name === myName;
      const label =
        m.status === 'accepted' ? 'Accepted' :
        m.status === 'solving' ? 'Solving...' : 'Idle';
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
