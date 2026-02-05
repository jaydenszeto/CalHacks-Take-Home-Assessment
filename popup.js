const $ = (s) => document.querySelector(s);

// mock room members for UI testing
const mockMembers = [
  { name: "You", problem: "Two Sum", status: "solving" },
  { name: "Alice", problem: "3Sum", status: "accepted" },
  { name: "Bob", problem: "Valid Parentheses", status: "solving" },
];

$("#create-btn").onclick = () => {
  const name = $("#username").value.trim();
  if (!name) return;

  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  enterRoom(code, name);
};

$("#join-btn").onclick = () => {
  const name = $("#username").value.trim();
  const code = $("#room-code").value.trim().toUpperCase();
  if (!name || !code) return;

  enterRoom(code, name);
};

$("#leave-btn").onclick = () => {
  $("#lobby").hidden = false;
  $("#room").hidden = true;
};

function enterRoom(code, name) {
  $("#lobby").hidden = true;
  $("#room").hidden = false;
  $(".room-code").textContent = "Room " + code;

  mockMembers[0].name = name;
  renderMembers();
}

function renderMembers() {
  const container = $("#members");
  container.innerHTML = mockMembers
    .map((m, i) => {
      const you = i === 0;
      const label = m.status === "accepted" ? "Accepted" : "Solving...";
      return `
      <div class="member">
        <div class="member-info">
          <span class="member-name ${you ? "is-you" : ""}">${m.name}${you ? " (you)" : ""}</span>
          <span class="member-problem">${m.problem}</span>
        </div>
        <span class="status ${m.status}">${label}</span>
      </div>`;
    })
    .join("");
}
