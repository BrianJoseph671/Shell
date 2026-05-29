const TRACKER_BASE = "https://shell-kappa-lilac.vercel.app";

function fmt(ts) {
  return new Date(ts).toLocaleString();
}

function esc(s) {
  return (s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function emptyState() {
  return `<div class="empty">
    <img class="empty-icon" src="conch.png" width="48" height="48" alt="Magic Conch Shell" />
    <h2>No prophecies yet</h2>
    <p>Send from Gmail on mail.google.com, then click Refresh. If sends still do not appear, reload the extension on edge://extensions.</p>
  </div>`;
}

async function updateStatus(trackedCount) {
  const status = document.getElementById("status");
  const ver = chrome.runtime.getManifest().version;
  let gmail = "open Gmail tab to connect";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.includes("mail.google.com")) {
      const ping = await chrome.tabs.sendMessage(tab.id, { type: "ping" });
      gmail = ping?.ok
        ? `Gmail connected · ${ping.bodies} compose area(s)`
        : "Gmail tab open but script not loaded — refresh Gmail";
    }
  } catch (_) {
    gmail = "refresh Gmail tab, then reload extension";
  }

  status.textContent = `v${ver} · ${trackedCount} saved · ${gmail}`;
}

async function render() {
  const btn = document.getElementById("refresh");
  const list = document.getElementById("list");
  btn.disabled = true;

  const { tracked = [] } = await chrome.storage.local.get({ tracked: [] });
  updateStatus(tracked.length);

  if (!tracked.length) {
    list.innerHTML = emptyState();
    btn.disabled = false;
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
      const opened = info.count > 0;
      const opensLine = opened
        ? `<span class="opens">Opened ${info.count}×</span>${last ? `<span class="meta"> · last ${last}</span>` : ""}`
        : '<span class="none">Not opened yet</span>';

      return `<article class="row${opened ? " opened" : ""}">
        <div class="subj">${esc(t.subject) || "(no subject)"}</div>
        <div class="meta">To: ${esc(t.to) || "?"} · sent ${fmt(t.sentAt)}</div>
        <div class="meta">${opensLine}</div>
      </article>`;
    })
    .join("");

  btn.disabled = false;
}

document.getElementById("refresh").addEventListener("click", render);
render();
