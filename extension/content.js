const TRACKER_BASE = "https://shell-kappa-lilac.vercel.app";

const BODY_SELECTORS = [
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"][aria-label="Message Body"]',
  '[g_editable="true"]',
  '[aria-label="Message Body"][contenteditable="true"]',
].join(", ");

function uuid() {
  return crypto.randomUUID();
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

function readTo(container) {
  return readField(container, [
    'textarea[name="to"]',
    'input[name="to"]',
    '[aria-label="To recipients"]',
    '[aria-label^="To"]',
  ]);
}

function readSubject(container) {
  return readField(container, [
    'input[name="subjectbox"]',
    'input[name="subject"]',
    '[aria-label^="Subject"]',
    'input[placeholder*="Subject"]',
  ]);
}

function injectInRoot(root) {
  const body = root.querySelector(BODY_SELECTORS);
  if (!body) return null;

  const existing = body.querySelector('img[data-track-pixel="1"]');
  if (existing) return existing.dataset.trackId;

  const id = uuid();
  const doc = root.ownerDocument || document;
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

function injectPixel(container) {
  const roots = [];
  if (container && container.querySelector) roots.push(container);

  const doc = container?.ownerDocument || document;
  if (!roots.includes(doc)) roots.push(doc);

  for (const root of roots) {
    const id = injectInRoot(root);
    if (id) return id;
  }

  for (const iframe of doc.querySelectorAll("iframe")) {
    try {
      const inner = iframe.contentDocument;
      if (inner) {
        const id = injectInRoot(inner);
        if (id) return id;
      }
    } catch (_) {
      // cross-origin iframe
    }
  }

  return null;
}

function recordSend(container, id) {
  const entry = {
    id,
    to: readTo(container),
    subject: readSubject(container),
    sentAt: Date.now(),
  };

  chrome.storage.local.get({ tracked: [] }, (data) => {
    const tracked = data.tracked;
    tracked.unshift(entry);
    chrome.storage.local.set({ tracked: tracked.slice(0, 200) });
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
  for (let i = 0; i < 15 && el; i++, el = el.parentElement) {
    if (el.getAttribute?.("role") === "button" || el.tagName === "BUTTON") {
      if (isSendControl(el)) return el;
    }
    if (isSendControl(el)) {
      return el.closest('[role="button"]') || el;
    }
  }
  return null;
}

function onSendAttempt(eventTarget) {
  const btn = matchSendButton(eventTarget);
  if (!btn) return;

  const container = findCompose(btn);
  const id = injectPixel(container);
  if (id) recordSend(container, id);
}

function handlePointer(e) {
  onSendAttempt(e.target);
}

document.addEventListener("mousedown", handlePointer, true);
document.addEventListener("click", handlePointer, true);

document.addEventListener(
  "keydown",
  (e) => {
    if (!((e.ctrlKey || e.metaKey) && e.key === "Enter")) return;
    const container = findCompose(document.activeElement);
    const id = injectPixel(container);
    if (id) recordSend(container, id);
  },
  true
);
