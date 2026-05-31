const { TRACKER_BASE } = globalThis.ConchShared;
const LOG = "[Magic Conch]";

const BODY_SELECTORS = [
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"][aria-label="Message Body"]',
  '[contenteditable="true"][aria-label*="Message"]',
  '[contenteditable="true"][aria-label*="message"]',
  '[g_editable="true"]',
  '[aria-label="Message Body"][contenteditable="true"]',
].join(", ");

let lastRecordAt = 0;
let lastRecordId = "";

function uuid() {
  return crypto.randomUUID();
}

function getAllDocuments(rootDoc = document, seen = new Set()) {
  if (!rootDoc || seen.has(rootDoc)) return [];
  seen.add(rootDoc);
  const docs = [rootDoc];
  for (const iframe of rootDoc.querySelectorAll("iframe")) {
    try {
      if (iframe.contentDocument) {
        docs.push(...getAllDocuments(iframe.contentDocument, seen));
      }
    } catch (_) {}
  }
  return docs;
}

function findMessageBodies(doc) {
  const bodies = new Set();
  for (const el of doc.querySelectorAll(BODY_SELECTORS)) bodies.add(el);
  for (const el of doc.querySelectorAll('[contenteditable="true"]')) {
    const label = (el.getAttribute("aria-label") || "").toLowerCase();
    if (label.includes("message") || el.getAttribute("g_editable")) bodies.add(el);
  }
  return [...bodies].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 80 && r.height > 24;
  });
}

function isComposeBody(body) {
  if (!body) return false;
  if (body.closest("div.gA.acV, div.gA.gt")) return false;
  if (body.closest('[role="dialog"]')) return true;
  if (body.closest(".AD, .aoI, .M9, .aoP, .I5")) return true;
  if (body.closest(".a3s.aiL") && !body.closest(".aoP")) return false;
  const doc = body.ownerDocument || document;
  const active = doc.activeElement;
  if (active && (body === active || body.contains(active))) return true;
  const root = body.closest('[role="dialog"]') || body.closest(".AD");
  if (root?.querySelector('[data-tooltip^="Send"], [aria-label^="Send"]')) return true;
  return false;
}

function findComposeBodies(doc) {
  return findMessageBodies(doc).filter(isComposeBody);
}

function findComposeBodyNear(el) {
  if (!el) return null;
  const roots = [
    el.closest('[role="dialog"]'),
    el.closest(".AD"),
    el.closest(".aoI"),
    el.closest(".M9"),
    el.closest("form"),
  ].filter(Boolean);

  for (const root of roots) {
    const doc = root.ownerDocument || document;
    for (const body of findMessageBodies(doc)) {
      if (root.contains(body)) return body;
    }
  }
  return findFocusedComposeBody();
}

function findFocusedComposeBody() {
  for (const doc of getAllDocuments()) {
    const active = doc.activeElement;
    if (!active) continue;
    for (const body of findMessageBodies(doc)) {
      if ((body === active || body.contains(active)) && isComposeBody(body)) return body;
    }
  }
  return null;
}

function pixelUrl(id) {
  return `${TRACKER_BASE}/api/pixel?id=${encodeURIComponent(id)}`;
}

// Spacer pushes the pixel below Gmail inbox preview so it loads when the full message is opened.
const SPACER_HEIGHT_PX = 1000;

function createSpacerElement(doc) {
  const wrap = doc.createElement("div");
  wrap.setAttribute("data-conch-spacer", "1");
  wrap.setAttribute("aria-hidden", "true");
  wrap.style.cssText =
    "display:block;line-height:0;font-size:0;max-height:0;overflow:hidden;mso-hide:all;";

  const table = doc.createElement("table");
  table.setAttribute("role", "presentation");
  table.setAttribute("cellpadding", "0");
  table.setAttribute("cellspacing", "0");
  table.setAttribute("border", "0");
  table.style.borderCollapse = "collapse";

  const td = doc.createElement("td");
  td.setAttribute("height", String(SPACER_HEIGHT_PX));
  td.style.height = `${SPACER_HEIGHT_PX}px`;
  td.style.lineHeight = `${SPACER_HEIGHT_PX}px`;
  td.style.fontSize = "0";
  td.innerHTML = "&#8203;";

  const tr = doc.createElement("tr");
  tr.appendChild(td);
  const tbody = doc.createElement("tbody");
  tbody.appendChild(tr);
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function injectIntoBody(body, { forceNew = false } = {}) {
  if (forceNew) {
    body.querySelectorAll("[data-conch-track-block]").forEach((n) => n.remove());
  } else {
    const img = body.querySelector('img[data-track-pixel="1"]');
    if (img?.dataset.trackId && !img.getAttribute("src")) {
      return img.dataset.trackId;
    }
    if (img) {
      body.querySelectorAll("[data-conch-track-block]").forEach((n) => n.remove());
    }
  }

  const id = uuid();
  const doc = body.ownerDocument || document;

  const block = doc.createElement("div");
  block.setAttribute("data-conch-track-block", "1");
  block.setAttribute("contenteditable", "false");

  block.appendChild(createSpacerElement(doc));

  const img = doc.createElement("img");
  img.width = 1;
  img.height = 1;
  img.alt = "";
  img.loading = "lazy";
  img.style.cssText = "width:1px;height:1px;border:0;display:block;";
  img.setAttribute("data-track-pixel", "1");
  img.setAttribute("data-track-pending", "1");
  img.dataset.trackId = id;
  block.appendChild(img);

  body.appendChild(block);
  return id;
}

function injectPixelAggressive() {
  for (const doc of getAllDocuments()) {
    for (const body of findComposeBodies(doc)) {
      const id = injectIntoBody(body);
      if (id) return id;
    }
  }
  return null;
}

function findExistingTrackId() {
  for (const doc of getAllDocuments()) {
    for (const body of findComposeBodies(doc)) {
      const img = body.querySelector('img[data-track-pixel="1"]');
      if (img?.dataset.trackId) return img.dataset.trackId;
    }
  }
  return null;
}

function preparePixelForSend(sendButton) {
  const body =
    (sendButton && findComposeBodyNear(sendButton)) || findFocusedComposeBody();
  if (!body) return null;
  return injectIntoBody(body, { forceNew: true });
}

function activatePixel(id) {
  for (const doc of getAllDocuments()) {
    for (const img of doc.querySelectorAll('img[data-track-pixel="1"]')) {
      if (img.dataset.trackId !== id) continue;
      if (!img.getAttribute("src")) {
        img.src = pixelUrl(id);
        img.removeAttribute("data-track-pending");
      }
    }
  }
}

function readField(root, selectors) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  for (const selector of list) {
    const el = root.querySelector(selector);
    if (!el) continue;
    if (el.getAttribute?.("contenteditable") === "true") continue;
    const val = (el.value ?? "").trim();
    if (val) return val;
    const text = (el.textContent ?? "").trim();
    if (text && text.length < 200 && !/^to$/i.test(text)) return text;
  }
  return "";
}

function readRecipient() {
  let to = "";
  let recipientName = "";

  for (const doc of getAllDocuments()) {
    const val = readField(doc, [
      'textarea[name="to"]',
      'input[name="to"]',
      'input[email]',
      '[name="to"]',
    ]);
    if (val) to = val;

    for (const chip of doc.querySelectorAll(".vR, .afV, [email], [data-email]")) {
      const email = chip.getAttribute("email") || chip.getAttribute("data-email") || "";
      const nameEl = chip.querySelector(".vT, .afW, span[email]");
      const chipName = nameEl
        ? (nameEl.textContent || "").trim()
        : (chip.textContent || "").replace(email, "").trim();

      if (email && !to.includes(email)) {
        to = to ? `${to}, ${email}` : email;
      }
      if (chipName && chipName.length > 1 && !chipName.includes("@") && !recipientName) {
        recipientName = chipName;
      }
    }

    if (!recipientName && to) {
      const angle = to.match(/^([^<]+)</);
      if (angle) recipientName = angle[1].trim().replace(/"/g, "");
      else if (!to.includes("@")) recipientName = to.split(",")[0].trim();
    }
  }

  return { to, recipientName };
}

function readSubject() {
  for (const doc of getAllDocuments()) {
    const val = readField(doc, [
      'input[name="subjectbox"]',
      'input[name="subject"]',
      'input[placeholder*="Subject"]',
    ]);
    if (val) return val;

    const labeled = doc.querySelector('[aria-label^="Subject"]');
    if (labeled?.value) return labeled.value.trim();
  }
  return "";
}

function captureThreadId() {
  const hashMatch = location.hash.match(/#(?:sent|inbox|label\/[^/]+|search\/[^/]+)\/([a-zA-Z0-9]+)/);
  if (hashMatch) return hashMatch[1];

  const tail = location.hash.match(/\/([a-zA-Z0-9]{10,})$/);
  if (tail) return tail[1];

  const el = document.querySelector("[data-legacy-thread-id], [data-thread-perm-id]");
  return el?.getAttribute("data-legacy-thread-id") || el?.getAttribute("data-thread-perm-id") || "";
}

function updateThreadId(entryId, threadId) {
  if (!threadId) return;
  chrome.storage.local.get({ tracked: [] }, (data) => {
    const tracked = data.tracked || [];
    const idx = tracked.findIndex((t) => t.id === entryId);
    if (idx === -1) return;
    if (tracked[idx].threadId === threadId) return;
    tracked[idx].threadId = threadId;
    chrome.storage.local.set({ tracked }, () => {
      chrome.runtime.sendMessage({ type: "trackedUpdated" }).catch(() => {});
    });
  });
}

function scheduleThreadIdCapture(entryId) {
  [2000, 5000].forEach((ms) => {
    setTimeout(() => {
      const tid = captureThreadId();
      if (tid) updateThreadId(entryId, tid);
    }, ms);
  });
}

function recordSend(id) {
  const now = Date.now();
  if (id === lastRecordId && now - lastRecordAt < 3000) return;
  lastRecordId = id;
  lastRecordAt = now;

  const { to, recipientName } = readRecipient();

  const entry = {
    id,
    to,
    recipientName,
    subject: readSubject(),
    sentAt: now,
    threadId: captureThreadId() || "",
  };

  chrome.storage.local.get({ tracked: [] }, (data) => {
    const tracked = data.tracked || [];
    if (tracked.some((t) => t.id === id)) return;

    tracked.unshift(entry);
    chrome.storage.local.set({ tracked: tracked.slice(0, 200) }, () => {
      if (chrome.runtime.lastError) {
        console.warn(LOG, "storage error", chrome.runtime.lastError);
      } else {
        console.log(LOG, "saved send", entry);
        chrome.runtime.sendMessage({ type: "trackedUpdated" }).catch(() => {});
        scheduleThreadIdCapture(id);
      }
    });
  });
}

function sendLabel(el) {
  return (
    el.getAttribute("data-tooltip") ||
    el.getAttribute("aria-label") ||
    el.textContent ||
    ""
  )
    .replace(/[\u200e\u202a\u202c]/g, "")
    .trim();
}

function isSendControl(el) {
  const label = sendLabel(el);
  if (!label) return false;
  if (/^send\b/i.test(label)) return true;
  if (/^send\s*\(/i.test(label)) return true;
  return /^send$/i.test(label.split("(")[0].trim());
}

function matchSendButton(target) {
  let el = target;
  for (let i = 0; i < 20 && el; i++, el = el.parentElement) {
    if (el.getAttribute?.("role") === "button" || el.tagName === "BUTTON") {
      if (isSendControl(el)) return el;
    }
    if (isSendControl(el)) {
      return el.closest('[role="button"]') || el.closest("button") || el;
    }
    const tip = el.getAttribute?.("data-tooltip") || "";
    if (/^send\b/i.test(tip)) {
      return el.closest('[role="button"]') || el;
    }
  }
  return null;
}

function onSendAttempt(eventTarget) {
  if (window !== window.top) return;

  const btn = matchSendButton(eventTarget);
  if (!btn) return;

  const id = preparePixelForSend(btn);
  if (!id) {
    console.warn(LOG, "Send clicked but could not find compose body");
    return;
  }

  activatePixel(id);
  recordSend(id);
}

document.addEventListener("mousedown", (e) => onSendAttempt(e.target), true);

document.addEventListener(
  "keydown",
  (e) => {
    if (window !== window.top) return;
    if (!((e.ctrlKey || e.metaKey) && e.key === "Enter")) return;

    const body = findFocusedComposeBody();
    const id = body
      ? injectIntoBody(body, { forceNew: true })
      : preparePixelForSend(null) || injectPixelAggressive();
    if (!id) return;
    activatePixel(id);
    recordSend(id);
  },
  true
);

if (window === window.top) {
  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      injectPixelAggressive();
    }, 400);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleScan();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "ping") {
      sendResponse({
        ok: true,
        bodies: getAllDocuments().reduce((n, d) => n + findMessageBodies(d).length, 0),
        pixels: findExistingTrackId() ? 1 : 0,
      });
      return true;
    }
  });

  console.log(LOG, "content script ready");
}
