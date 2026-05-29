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

function pixelUrl(id) {
  return `${TRACKER_BASE}/api/pixel?id=${encodeURIComponent(id)}`;
}

function injectIntoBody(body) {
  const existing = body.querySelector('img[data-track-pixel="1"]');
  if (existing) return existing.dataset.trackId;

  const id = uuid();
  const doc = body.ownerDocument || document;
  const img = doc.createElement("img");
  img.width = 1;
  img.height = 1;
  img.alt = "";
  img.style.cssText = "width:1px;height:1px;border:0;display:block;";
  img.setAttribute("data-track-pixel", "1");
  img.setAttribute("data-track-pending", "1");
  img.dataset.trackId = id;
  body.appendChild(img);
  return id;
}

function injectPixelAggressive() {
  for (const doc of getAllDocuments()) {
    for (const body of findMessageBodies(doc)) {
      const id = injectIntoBody(body);
      if (id) return id;
    }
  }
  return null;
}

function findExistingTrackId() {
  for (const doc of getAllDocuments()) {
    for (const img of doc.querySelectorAll('img[data-track-pixel="1"]')) {
      if (img.dataset.trackId) return img.dataset.trackId;
    }
  }
  return null;
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

function readTo() {
  for (const doc of getAllDocuments()) {
    const val = readField(doc, [
      'textarea[name="to"]',
      'input[name="to"]',
      'input[email]',
      '[name="to"]',
    ]);
    if (val) return val;

    for (const el of doc.querySelectorAll('[aria-label="To recipients"], [data-hovercard-id]')) {
      const t = (el.value || el.textContent || "").trim();
      if (t && !/^to$/i.test(t)) return t;
    }

    const chips = doc.querySelectorAll('[email], [data-email]');
    const emails = [...chips]
      .map((el) => el.getAttribute("email") || el.getAttribute("data-email") || "")
      .filter(Boolean);
    if (emails.length) return emails.join(", ");
  }
  return "";
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
  const m = location.hash.match(/\/([a-zA-Z0-9]+)$/);
  if (m) return m[1];
  const el = document.querySelector("[data-legacy-thread-id], [data-thread-perm-id]");
  return el?.getAttribute("data-legacy-thread-id") || el?.getAttribute("data-thread-perm-id") || "";
}

function recordSend(id) {
  const now = Date.now();
  if (id === lastRecordId && now - lastRecordAt < 3000) return;
  lastRecordId = id;
  lastRecordAt = now;

  const entry = {
    id,
    to: readTo(),
    subject: readSubject(),
    sentAt: now,
    threadId: captureThreadId(),
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

  const id = findExistingTrackId() || injectPixelAggressive();
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

    const id = findExistingTrackId() || injectPixelAggressive();
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
