(function () {
  if (window !== window.top) return;

  const { TRACKER_BASE, opensSummary } = globalThis.ConchShared;
  const LOG = "[Magic Conch badges]";

  const LAPTOP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M2 19h20"/></svg>`;

  let tracked = [];
  let opensCache = {};
  let pollTimer = null;
  let paintTimer = null;
  let popover = null;
  let popoverEntry = null;
  let hoverPollTimer = null;

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
      const res = await fetch(
        `${TRACKER_BASE}/api/opens?ids=${encodeURIComponent(ids)}&_=${Date.now()}`
      );
      opensCache = await res.json();
    } catch (e) {
      console.warn(LOG, "opens fetch failed", e);
    }
    return opensCache;
  }

  function statusFor(entry) {
    const raw = opensCache[entry.id] || { events: [] };
    const { count, last, valid } = opensSummary(raw.events || [], entry.sentAt);
    return { count, last, valid, read: count > 0 };
  }

  function findEntryForSubject(subjectText) {
    const hash = location.hash;
    const threadInUrl = hash.match(/\/([a-zA-Z0-9]+)$/);
    if (threadInUrl) {
      const byThread = tracked.find((t) => t.threadId && t.threadId === threadInUrl[1]);
      if (byThread) return byThread;
    }

    const norm = globalThis.ConchShared.normSubject(subjectText);
    if (!norm) return null;

    const candidates = tracked.filter((t) => globalThis.ConchShared.normSubject(t.subject) === norm);
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.sentAt - a.sentAt);
    return candidates[0];
  }

  function displayName(toField) {
    const raw = (toField || "").trim();
    if (!raw) return "Recipient";
    const first = raw.split(",")[0].trim();
    if (first.includes("@")) {
      const local = first.split("@")[0];
      return local.charAt(0).toUpperCase() + local.slice(1);
    }
    return first;
  }

  function fmtSuperhuman(ts) {
    const d = new Date(ts);
    const wd = d.toLocaleDateString("en-US", { weekday: "short" });
    const mon = d.toLocaleDateString("en-US", { month: "short" });
    const day = d.getDate();
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `${wd} ${mon} ${day}, ${time}`;
  }

  function openCountLabel(count) {
    if (count >= 10) return "Opened 10+ times";
    if (count === 1) return "Opened 1 time";
    return `Opened ${count} times`;
  }

  function ensurePopover() {
    if (popover) return popover;
    popover = document.createElement("div");
    popover.className = "conch-popover";
    popover.hidden = true;
    document.body.appendChild(popover);

    document.addEventListener(
      "mousedown",
      (e) => {
        if (popover.hidden) return;
        if (popover.contains(e.target)) return;
        if (e.target.closest(".conch-receipt")) return;
        hidePopover();
      },
      true
    );

    popover.addEventListener("mouseleave", () => hidePopover());
    return popover;
  }

  function positionPopover(anchor) {
    const rect = anchor.getBoundingClientRect();
    const pop = ensurePopover();
    pop.style.visibility = "hidden";
    pop.hidden = false;

    const pw = pop.offsetWidth || 300;
    const ph = pop.offsetHeight || 200;
    let left = rect.left;
    let top = rect.bottom + 6;

    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (left < 8) left = 8;
    if (top + ph > window.innerHeight - 8) top = rect.top - ph - 6;

    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.style.visibility = "visible";
  }

  function renderPopover(entry) {
    const pop = ensurePopover();
    const st = statusFor(entry);
    const name = displayName(entry.to);

    if (!st.read) {
      pop.innerHTML = `
        <div class="conch-popover-header">Not opened yet</div>
        <div class="conch-popover-empty">Sent ${fmtSuperhuman(entry.sentAt)}.<br/>Opens appear 15+ seconds after send when the recipient loads images.</div>
      `;
      return;
    }

    const rows = [...st.valid]
      .sort((a, b) => b.ts - a.ts)
      .map(
        (ev) => `
        <div class="conch-popover-row">
          <span class="conch-popover-icon">${LAPTOP_SVG}</span>
          <span class="conch-popover-name">${name}</span>
          <span class="conch-popover-time">${fmtSuperhuman(ev.ts)}</span>
        </div>`
      )
      .join("");

    const note =
      st.valid.length < 2
        ? `<div class="conch-popover-note">Gmail often caches images after the first open, so repeat views may not register.</div>`
        : "";

    pop.innerHTML = `
      <div class="conch-popover-header">${openCountLabel(st.count)}</div>
      <div class="conch-popover-list">${rows}</div>
      ${note}
    `;
  }

  function showPopover(anchor, entry) {
    popoverEntry = entry;
    renderPopover(entry);
    positionPopover(anchor);
    ensurePopover().hidden = false;

    fetchOpens().then(() => {
      if (popoverEntry?.id === entry.id) renderPopover(entry);
    });

    if (hoverPollTimer) clearInterval(hoverPollTimer);
    hoverPollTimer = setInterval(() => {
      fetchOpens().then(() => {
        if (popoverEntry?.id === entry.id) renderPopover(entry);
      });
    }, 5000);
  }

  function hidePopover() {
    if (hoverPollTimer) {
      clearInterval(hoverPollTimer);
      hoverPollTimer = null;
    }
    popoverEntry = null;
    if (popover) popover.hidden = true;
  }

  function badgeEl(entry, placement) {
    const st = statusFor(entry);
    const wrap = document.createElement("span");
    wrap.className = `conch-receipt ${st.read ? "read" : "sent"} ${placement || ""}`;
    wrap.setAttribute("data-conch-id", entry.id);

    if (st.read) {
      const diamond = document.createElement("span");
      diamond.className = "conch-diamond";
      diamond.setAttribute("aria-hidden", "true");
      wrap.appendChild(diamond);
    }

    const mark = document.createElement("span");
    mark.className = "conch-mark";
    mark.textContent = st.read ? "✓✓" : "✓";
    wrap.appendChild(mark);

    wrap.addEventListener("mouseenter", () => showPopover(wrap, entry));
    wrap.addEventListener("mouseleave", (e) => {
      if (e.relatedTarget && popover?.contains(e.relatedTarget)) return;
      setTimeout(() => {
        if (popover?.matches(":hover")) return;
        hidePopover();
      }, 120);
    });

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

    const rows = document.querySelectorAll("tr.zA, tr[role='row']");
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
      document.querySelector("[data-legacy-thread-id]")?.closest("div")?.querySelector("h2") ||
      document.querySelector(".ha h2");

    if (!header) return;

    const subject = (header.textContent || "").trim();
    const entry = findEntryForSubject(subject);
    if (!entry) return;

    attachBadge(header, entry, "conch-receipt-thread");
  }

  function paintThreadSentMessages() {
    const header = document.querySelector("h2.hP");
    if (!header) return;

    const subject = (header.textContent || "").trim();
    const entry = findEntryForSubject(subject);
    if (!entry) return;

    const sentBlocks = document.querySelectorAll("div.gA.acV, div.gA.gt");
    for (const block of sentBlocks) {
      const sender =
        block.querySelector("span.gD") ||
        block.querySelector("span.go") ||
        block.querySelector(".gD");
      if (sender) attachBadge(sender, entry, "conch-receipt-inline");
    }
  }

  function paintAll() {
    paintSentList();
    paintThreadHeader();
    paintThreadSentMessages();
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
    if (popoverEntry) renderPopover(popoverEntry);
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refresh, 15000);
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
    hidePopover();
    refresh();
  });

  refresh();
  startPolling();
  console.log(LOG, "badges ready");
})();
