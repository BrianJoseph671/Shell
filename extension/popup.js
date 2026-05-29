const TRACKER_BASE = "https://YOUR-APP.vercel.app";

function fmt(ts) {
  return new Date(ts).toLocaleString();
}

function esc(s) {
  return (s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

async function render() {
  const { tracked = [] } = await chrome.storage.local.get({ tracked: [] });
  const list = document.getElementById("list");

  if (!tracked.length) {
    list.innerHTML = '<div class="none">No tracked emails yet.</div>';
    return;
  }

  let opensData = {};
  try {
    const ids = tracked.map((t) => t.id).join(",");
    const res = await fetch(`${TRACKER_BASE}/api/opens?ids=${ids}`);
    opensData = await res.json();
  } catch (e) {
    // backend not reachable yet; show sends without open data
  }

  list.innerHTML = tracked
    .map((t) => {
      const info = opensData[t.id] || { count: 0, events: [] };
      const last = info.events.length ? fmt(info.events[info.events.length - 1].ts) : null;
      const opensLine = info.count
        ? `<span class="opens">Opened ${info.count}x</span>${last ? " - last " + last : ""}`
        : '<span class="none">Not opened</span>';

      return `<div class="row">
        <div class="subj">${esc(t.subject) || "(no subject)"}</div>
        <div class="meta">To: ${esc(t.to) || "?"} - Sent ${fmt(t.sentAt)}</div>
        <div class="meta">${opensLine}</div>
      </div>`;
    })
    .join("");
}

document.getElementById("refresh").addEventListener("click", render);
render();
