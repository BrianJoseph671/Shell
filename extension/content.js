const TRACKER_BASE = "https://shell-kappa-lilac.vercel.app";
const LOG = "[Magic Conch]";

const BODY_SELECTORS = [
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"][aria-label="Message Body"]',
  '[contenteditable="true"][aria-label*="Message"]',
  '[contenteditable="true"][aria-label*="message"]',
  '[g_editable="true"]',
  '[aria-label="Message Body"][contenteditable="true"]',
].join(", ");

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

function injectIntoBody(body) {
  const existing = body.querySelector('img[data-track-pixel="1"]');
  if (existing) return existing.dataset.trackId;

  const id = uuid();
  const doc = body.ownerDocument || document;
  const img = doc.createElement("img");
  img.src = `${TRACKER_BASE}/api/pixel?id=${id}`;
  img.width = 1;
  img.height = 1;
  img.alt = "";
  img.style.cssText = "width:1px;height:1px;border:0;display:block;";
  img.setAttribute("data-track-pixel", "1");
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

function findCompose(el) {
  if (!el || !el.closest) return document;
  return (
    el.closest('[role="dialog"]') ||
    el.closest("form") ||
    el.closest('[role="main"]') ||
    document
  );
}

function readField(root, selectors) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  for (const selector of list) {
    const el = root.querySelector(selector);
    if (!el) continue;
    const val = (el.value ?? el.textContent ?? "").trim();
    if (val) return val;
  }
  return "";
}

function readTo() {
  for (const doc of getAllDocuments()) {
    const val = readField(doc, [
      'textarea[name="to"]',
      'input[name="to"]',
      '[aria-label="To recipients"]',
      '[aria-label^="To"]',
      '[name="to"]',
    ]);
    if (val) return val;
  }
  return "";
}

function readSubject() {
  for (const doc of getAllDocuments()) {
    const val = readField(doc, [
      'input[name="subjectbox"]',
      'input[name="subject"]',
      '[aria-label^="Subject"]',
      'input[placeholder*="Subject"]',
    ]);
    if (val) return val;
  }
  return "";
}

function recordSend(id) {
  const entry = {
    id,
    to: readTo(),
    subject: readSubject(),
    sentAt: Date.now(),
  };

  chrome.storage.local.get({ tracked: [] }, (data) => {
    const tracked = data.tracked || [];
    tracked.unshift(entry);
    chrome.storage.local.set({ tracked: tracked.slice(0, 200) }, () => {
      if (chrome.runtime.lastError) {
        console.warn(LOG, "storage error", chrome.runtime.lastError);
      } else {
        console.log(LOG, "saved send", entry);
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
  const btn = matchSendButton(eventTarget);
  if (!btn) return;

  let id = findExistingTrackId() || injectPixelAggressive();
  if (!id) {
    console.warn(LOG, "Send clicked but could not inject pixel");
    return;
  }

  recordSend(id);
}

function handlePointer(e) {
  onSendAttempt(e.target);
}

document.addEventListener("pointerdown", handlePointer, true);
document.addEventListener("mousedown", handlePointer, true);
document.addEventListener("click", handlePointer, true);

document.addEventListener(
  "keydown",
  (e) => {
    if (!((e.ctrlKey || e.metaKey) && e.key === "Enter")) return;
    let id = findExistingTrackId() || injectPixelAggressive();
    if (id) recordSend(id);
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
  setInterval(injectPixelAggressive, 3000);

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

  console.log(LOG, "content script ready on Gmail");
}
