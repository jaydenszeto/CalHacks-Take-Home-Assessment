// LeetCode Together — content script
// Injects a floating panel showing room members on leetcode.com

(function () {
  if (window !== window.top) return; // skip iframes

  // try to grab the current problem from the URL
  function getCurrentProblem() {
    const m = location.pathname.match(/\/problems\/([^/]+)/);
    if (!m) return null;
    return m[1]
      .split("-")
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ");
  }

  // mock data — swap this out for real state later
  const inRoom = true;
  let collapsed = false;

  const members = [
    { name: "You", problem: getCurrentProblem() || "—", status: "solving" },
    { name: "Alice", problem: "3Sum", status: "accepted" },
    { name: "Bob", problem: "Valid Parentheses", status: "solving" },
  ];

  const panel = document.createElement("div");
  panel.id = "lct-panel";
  document.body.appendChild(panel);

  function render() {
    let rows = "";

    if (!inRoom) {
      rows = '<div class="lct-empty">Open the extension to join a room</div>';
    } else {
      rows = members
        .map((m, i) => {
          const you = i === 0;
          const statusText = m.status === "accepted" ? "Accepted" : "Solving...";
          return `
          <div class="lct-row">
            <span class="lct-name ${you ? "you" : ""}">${m.name}</span>
            <div class="lct-right">
              <div class="lct-problem">${m.problem}</div>
              <div class="lct-status ${m.status}">${statusText}</div>
            </div>
          </div>`;
        })
        .join("");
    }

    panel.innerHTML = `
      <div class="lct-head">
        <span class="lct-title">LeetCode Together</span>
        <span class="lct-chevron ${collapsed ? "up" : ""}">▼</span>
      </div>
      <div class="lct-body ${collapsed ? "collapsed" : ""}">
        ${rows}
      </div>`;

    panel.querySelector(".lct-head").onclick = () => {
      collapsed = !collapsed;
      render();
    };
  }

  render();
})();
