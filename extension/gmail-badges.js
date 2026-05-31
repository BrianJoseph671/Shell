(function () {
  if (window !== window.top) return;

  const { TRACKER_BASE, opensSummary, displayName, normSubject } = globalThis.ConchShared;
  const LOG = "[Magic Conch badges]";

  const LAPTOP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M2 19h20"/></svg>`;

  let tracked = [];
  let opensCache = {};
  let pollTimer = null;
  let paintTimer = null;
  let popover = null;
  let popoverEntry = null;
  let hoverPollTimer = null;
  let hideTimer = null;
  let hoverAnchor = null;
  let stopped = false;

  function extensionAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch (_) {
      return false;
    }
  }

  function isContextInvalidated(err) {
    const msg = String(err?.message || err || "");
    return msg.includes("Extension context invalidated");
  }

  function stopAllTimers() {
    stopped = true;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (paintTimer) clearTimeout(paintTimer);
    paintTimer = null;
    if (hoverPollTimer) clearInterval(hoverPollTimer);
    hoverPollTimer = null;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
    hidePopover();
  }

  function threadIdFromHash() {
    const hashMatch = location.hash.match(/#(?:sent|inbox|label\/[^/]+|search\/[^/]+)\/([a-zA-Z0-9]+)/);
    if (hashMatch) return hashMatch[1];
    const tail = location.hash.match(/\/([a-zA-Z0-9]{10,})$/);
    return tail ? tail[1] : "";
  }

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
    if (!extensionAlive()) {
      stopAllTimers();
      return [];
    }
    try {
      const data = await chrome.storage.local.get({ tracked: [] });
      const seen = new Set();
      tracked = [];
      for (const t of data.tracked || []) {
        if (!t?.id || seen.has(t.id)) continue;
        seen.add(t.id);
        tracked.push(t);
      }
      if (tracked.length !== (data.tracked || []).length) {
        await chrome.storage.local.set({ tracked });
      }
      return tracked;
    } catch (e) {
      if (isContextInvalidated(e)) {
        stopAllTimers();
        return [];
      }
      throw e;
    }
  }

  async function fetchOpens() {
    if (!extensionAlive()) {
      stopAllTimers();
      return {};
    }
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
      if (isContextInvalidated(e)) {
        stopAllTimers();
        return {};
      }
      console.warn(LOG, "opens fetch failed", e);
    }
    return opensCache;
  }

  function statusFor(entry) {
    const raw = opensCache[entry.id] || { events: [] };
    const { count, last, valid } = opensSummary(raw.events || [], entry.sentAt);
    return { count, last, valid, read: count > 0 };
  }

  function findEntryForThreadId(threadId) {
    if (!threadId) return null;
    const matches = tracked.filter((t) => t.threadId === threadId);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return matches.sort((a, b) => b.sentAt - a.sentAt)[0];
    return null;
  }

  function findEntryForSubject(subjectText) {
    const norm = normSubject(subjectText);
    if (!norm) return null;
    const candidates = tracked.filter((t) => normSubject(t.subject) === norm);
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.sentAt - a.sentAt);
    return candidates[0];
  }

  function getRowThreadId(row) {
    return (
      row.getAttribute("data-thread-id") ||
      row.getAttribute("data-legacy-thread-id") ||
      row.querySelector("[data-thread-id]")?.getAttribute("data-thread-id") ||
      row.querySelector("[data-legacy-thread-id]")?.getAttribute("data-legacy-thread-id") ||
      ""
    );
  }

  function findEntryForRow(row) {
    const tid = getRowThreadId(row);
    const byThread = findEntryForThreadId(tid);
    if (byThread) return byThread;

    const subject = getRowSubject(row);
    return findEntryForSubject(subject);
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
    document.body.appendChild(popover);

    popover.addEventListener("mouseenter", () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    });

    popover.addEventListener("mouseleave", () => hidePopover());

    document.addEventListener(
      "mousedown",
      (e) => {
        if (!popover?.classList.contains("is-open")) return;
        if (popover.contains(e.target)) return;
        if (e.target.closest(".conch-receipt")) return;
        hidePopover();
      },
      true
    );

    return popover;
  }

  function positionPopover(anchor) {
    const pop = ensurePopover();
    pop.classList.add("is-open");

    const rect = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth || 220;
    const ph = pop.offsetHeight || 120;
    let left = rect.left;
    let top = rect.bottom + 4;

    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (left < 8) left = 8;
    if (top + ph > window.innerHeight - 8) top = rect.top - ph - 4;

    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  function renderPopover(entry) {
    const pop = ensurePopover();
    const st = statusFor(entry);
    const name = displayName(entry);

    if (!st.read) {
      pop.innerHTML = `
        <div class="conch-popover-header">Not opened yet</div>
        <div class="conch-popover-empty">Sent ${fmtSuperhuman(entry.sentAt)}.</div>
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

    pop.innerHTML = `
      <div class="conch-popover-header">${openCountLabel(st.count)}</div>
      <div class="conch-popover-list">${rows}</div>
    `;
  }

  function showPopover(anchor, entry) {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }

    hoverAnchor = anchor;
    popoverEntry = entry;
    renderPopover(entry);
    positionPopover(anchor);

    fetchOpens().then(() => {
      if (popoverEntry?.id === entry.id) renderPopover(entry);
    });

    if (hoverPollTimer) clearInterval(hoverPollTimer);
    hoverPollTimer = setInterval(() => {
      fetchOpens().then(() => {
        if (popoverEntry?.id === entry.id) {
          renderPopover(entry);
          if (hoverAnchor) positionPopover(hoverAnchor);
        }
      });
    }, 3000);
  }

  function hidePopover() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (hoverPollTimer) {
      clearInterval(hoverPollTimer);
      hoverPollTimer = null;
    }
    popoverEntry = null;
    hoverAnchor = null;
    if (popover) popover.classList.remove("is-open");
  }

  function scheduleHidePopover() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (popover?.matches(":hover")) return;
      hidePopover();
    }, 150);
  }

  function makeChecks(read) {
    if (!read) {
      const single = document.createElement("span");
      single.className = "conch-check-single";
      single.textContent = "✓";
      return single;
    }

    const wrap = document.createElement("span");
    wrap.className = "conch-checks";
    for (let i = 0; i < 2; i++) {
      const c = document.createElement("span");
      c.className = "conch-check";
      c.textContent = "✓";
      wrap.appendChild(c);
    }
    return wrap;
  }

  function badgeEl(entry, placement) {
    const st = statusFor(entry);
    const wrap = document.createElement("span");
    wrap.className = `conch-receipt ${st.read ? "read" : "sent"} ${placement || ""}`;
    wrap.setAttribute("data-conch-id", entry.id);

    wrap.appendChild(makeChecks(st.read));

    wrap.addEventListener("mouseenter", () => showPopover(wrap, entry));
    wrap.addEventListener("mouseleave", (e) => {
      if (e.relatedTarget && popover?.contains(e.relatedTarget)) return;
      scheduleHidePopover();
    });

    return wrap;
  }

  function updateBadgeInPlace(wrap, entry) {
    const st = statusFor(entry);
    wrap.classList.toggle("read", st.read);
    wrap.classList.toggle("sent", !st.read);

    const oldChecks = wrap.querySelector(".conch-checks, .conch-check-single");
    if (oldChecks) oldChecks.remove();
    wrap.appendChild(makeChecks(st.read));
  }

  function attachBadge(anchor, entry, placement) {
    if (!anchor || !entry) return;
    const existing = anchor.querySelector(`[data-conch-id="${entry.id}"]`);
    if (existing) {
      updateBadgeInPlace(existing, entry);
      return;
    }

    const next = badgeEl(entry, placement);
    anchor.appendChild(next);
  }

  function updateAllBadges() {
    document.querySelectorAll(".conch-receipt[data-conch-id]").forEach((wrap) => {
      const id = wrap.getAttribute("data-conch-id");
      const entry = tracked.find((t) => t.id === id);
      if (entry) updateBadgeInPlace(wrap, entry);
    });
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
      const entry = findEntryForRow(row);
      if (!entry) continue;

      const cell =
        row.querySelector("span.bog")?.parentElement ||
        row.querySelector(".y6") ||
        row.querySelector('[role="gridcell"]');
      if (cell) attachBadge(cell, entry, "");
    }
  }

  function paintThreadHeader() {
    const tid = threadIdFromHash();
    let entry = findEntryForThreadId(tid);

    if (!entry) {
      const header =
        document.querySelector("h2.hP") ||
        document.querySelector("[data-legacy-thread-id]")?.closest("div")?.querySelector("h2") ||
        document.querySelector(".ha h2");
      if (header) {
        entry = findEntryForSubject((header.textContent || "").trim());
      }
    }

    if (!entry) return;

    const header =
      document.querySelector("h2.hP") ||
      document.querySelector("[data-legacy-thread-id]")?.closest("div")?.querySelector("h2") ||
      document.querySelector(".ha h2");
    if (header) attachBadge(header, entry, "conch-receipt-thread");
  }

  function paintThreadSentMessages() {
    const tid = threadIdFromHash();
    let entry = findEntryForThreadId(tid);

    if (!entry) {
      const header = document.querySelector("h2.hP");
      if (header) entry = findEntryForSubject((header.textContent || "").trim());
    }
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

  async function fetchAndPaint() {
    if (stopped || !extensionAlive()) {
      stopAllTimers();
      return;
    }
    try {
      await loadTracked();
      await fetchOpens();
      if (stopped) return;
      updateAllBadges();
      paintAll();
      if (popoverEntry) {
        renderPopover(popoverEntry);
        if (hoverAnchor) positionPopover(hoverAnchor);
      }
    } catch (e) {
      if (isContextInvalidated(e)) stopAllTimers();
      else console.warn(LOG, "fetchAndPaint failed", e);
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (!extensionAlive()) {
        stopAllTimers();
        return;
      }
      fetchAndPaint();
    }, 5000);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (stopped || !extensionAlive()) return;
    if (area === "local" && changes.tracked) fetchAndPaint();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "refreshBadges" || msg?.type === "trackedUpdated") {
      fetchAndPaint()
        .then(() => sendResponse({ ok: true }))
        .catch((e) => {
          if (isContextInvalidated(e)) stopAllTimers();
          sendResponse({ ok: false });
        });
      return true;
    }
  });

  const domObserver = new MutationObserver(schedulePaint);
  domObserver.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("hashchange", () => {
    hidePopover();
    fetchAndPaint();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") fetchAndPaint();
  });

  window.addEventListener("focus", () => fetchAndPaint());

  fetchAndPaint();
  startPolling();
  console.log(LOG, "badges ready");
})();
