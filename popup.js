const $ = (s) => document.querySelector(s);

// load saved name + room state on open
chrome.storage.local.get(['roomState', 'username'], ({ roomState, username }) => {
  if (username) $('#username').value = username;
  if (roomState?.code) showRoom(roomState);
});

$('#create-btn').onclick = () => {
  const name = $('#username').value.trim();
  if (!name) return;
  chrome.storage.local.set({ username: name });
  chrome.runtime.sendMessage({ action: 'create', name });
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

// live updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'room-state' && msg.code) showRoom(msg);
  if (msg.type === 'room-state' && !msg.code) showLobby();
  if (msg.type === 'error') showError(msg.message);
});

function showRoom(state) {
  $('#error').hidden = true;
  $('#lobby').hidden = true;
  $('#room').hidden = false;
  $('.room-code').textContent = 'Room ' + state.code;
  renderMembers(state.members || [], state.name);
}

function showLobby() {
  $('#lobby').hidden = false;
  $('#room').hidden = true;
}

function showError(message) {
  const el = $('#error');
  el.textContent = message;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 4000);
}

function renderMembers(members, myName) {
  $('#members').innerHTML = members
    .map((m) => {
      const you = m.name === myName;
      const label =
        m.status === 'accepted' ? 'Accepted' :
        m.status === 'solving' ? 'Solving...' : 'Idle';
      return `
      <div class="member">
        <div class="member-info">
          <span class="member-name ${you ? 'is-you' : ''}">${m.name}${you ? ' (you)' : ''}</span>
          <span class="member-problem">${m.problem || '\u2014'}</span>
        </div>
        <span class="status ${m.status}">${label}</span>
      </div>`;
    })
    .join('');
}
