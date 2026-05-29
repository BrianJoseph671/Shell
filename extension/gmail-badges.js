(function () {
  if (window !== window.top) return;

  const { TRACKER_BASE, opensSummary, normSubject } = globalThis.ConchShared;
  const LOG = "[Magic Conch badges]";

  let tracked = [];
  let opensCache = {};
  let pollTimer = null;
  let paintTimer = null;

  function isSentView() {
    const h = location.hash;
    return (
      h.includes("#sent") ||
      h.includes("#label/Sent") ||
      h.includes("#label/sent") ||
      document.querySelector('[aria-label="Sent"]')?.getAttribute("aria-selected") === "true"
    );
  }

  async function loadTracked() {
    const data = await chrome.storage.local.get({ tracked: [] });
    const seen = new Set();
    tracked = [];
    for (const t of data.tracked || []) {
      if (!t?.id || seen.has(t.id)) continue;
      seen.add(t.id);
      tracked.push(t);
    }
    if (tracked.length !== (data.tracked || []).length) {
      chrome.storage.local.set({ tracked });
    }
    return tracked;
  }

  async function fetchOpens() {
    if (!tracked.length) {
      opensCache = {};
      return opensCache;
    }
    const ids = tracked.map((t) => t.id).join(",");
    try {
      const res = await fetch(`${TRACKER_BASE}/api/opens?ids=${encodeURIComponent(ids)}`);
      opensCache = await res.json();
    } catch (e) {
      console.warn(LOG, "opens fetch failed", e);
    }
    return opensCache;
  }

  function statusFor(entry) {
    const raw = opensCache[entry.id] || { events: [] };
    const { count, last } = opensSummary(raw.events || [], entry.sentAt);
    return { count, last, read: count > 0 };
  }

  function findEntryForSubject(subjectText) {
    const hash = location.hash;
    const threadInUrl = hash.match(/\/([a-zA-Z0-9]+)$/);
    if (threadInUrl) {
      const byThread = tracked.find((t) => t.threadId && t.threadId === threadInUrl[1]);
      if (byThread) return byThread;
    }

    const norm = normSubject(subjectText);
    if (!norm) return null;

    const candidates = tracked.filter((t) => normSubject(t.subject) === norm);
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.sentAt - a.sentAt);
    return candidates[0];
  }

  function badgeEl(entry, placement) {
    const st = statusFor(entry);
    const wrap = document.createElement("span");
    wrap.className = `conch-receipt ${st.read ? "read" : "sent"} ${placement || ""}`;
    wrap.setAttribute("data-conch-id", entry.id);
    wrap.title = st.read
      ? `Read ${st.count}×${st.last ? " · last " + new Date(st.last).toLocaleString() : ""}`
      : "Sent — not read yet (15s+ after send)";

    const mark = document.createElement("span");
    mark.className = "conch-mark";
    mark.textContent = st.read ? "✓✓" : "✓";
    wrap.appendChild(mark);
    return wrap;
  }

  function attachBadge(anchor, entry, placement) {
    if (!anchor || !entry) return;
    const existing = anchor.querySelector(`[data-conch-id="${entry.id}"]`);
    const next = badgeEl(entry, placement);
    if (existing) {
      existing.replaceWith(next);
    } else {
      anchor.appendChild(next);
    }
  }

  function getRowSubject(row) {
    const subj =
      row.querySelector("span.bog") ||
      row.querySelector("span.bqe") ||
      row.querySelector("[data-thread-id] span") ||
      row.querySelector(".y6 span");
    return (subj?.textContent || "").trim();
  }

  function paintSentList() {
    if (!isSentView()) return;

    const rows = document.querySelectorAll('tr.zA, tr[role="row"]');
    for (const row of rows) {
      const subject = getRowSubject(row);
      const entry = findEntryForSubject(subject);
      if (!entry) continue;

      const cell =
        row.querySelector("span.bog")?.parentElement ||
        row.querySelector(".y6") ||
        row.querySelector('[role="gridcell"]');
      if (cell) attachBadge(cell, entry, "");
    }
  }

  function paintThreadHeader() {
    const header =
      document.querySelector("h2.hP") ||
      document.querySelector('[data-legacy-thread-id]')?.closest("div")?.querySelector("h2") ||
      document.querySelector(".ha h2");

    if (!header) return;

    const subject = (header.textContent || "").trim();
    const entry = findEntryForSubject(subject);
    if (!entry) return;

    attachBadge(header, entry, "conch-receipt-thread");
  }

  function paintAll() {
    paintSentList();
    paintThreadHeader();
  }

  function schedulePaint() {
    if (paintTimer) return;
    paintTimer = setTimeout(() => {
      paintTimer = null;
      paintAll();
    }, 300);
  }

  async function refresh() {
    await loadTracked();
    await fetchOpens();
    schedulePaint();
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refresh, 30000);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.tracked) refresh();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "refreshBadges" || msg?.type === "trackedUpdated") {
      refresh().then(() => sendResponse({ ok: true }));
      return true;
    }
  });

  const domObserver = new MutationObserver(schedulePaint);
  domObserver.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("hashchange", () => {
    refresh();
  });

  refresh();
  startPolling();
  console.log(LOG, "badges ready");
})();
