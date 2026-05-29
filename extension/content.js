const TRACKER_BASE = "https://shell-kappa-lilac.vercel.app";

function uuid() {
  return crypto.randomUUID();
}

function findCompose(el) {
  return (
    (el && el.closest && el.closest('[role="dialog"]')) ||
    (el && el.closest && el.closest("form")) ||
    document
  );
}

function readField(container, selector) {
  const el = container.querySelector(selector);
  if (!el) return "";
  return (el.value || el.textContent || "").trim();
}

function injectPixel(container) {
  const body = container.querySelector(
    '[contenteditable="true"][role="textbox"], [g_editable="true"], [aria-label="Message Body"]'
  );
  if (!body) return null;

  const existing = body.querySelector('img[data-track-pixel="1"]');
  if (existing) return existing.dataset.trackId;

  const id = uuid();
  const img = document.createElement("img");
  img.src = `${TRACKER_BASE}/api/pixel?id=${id}`;
  img.width = 1;
  img.height = 1;
  img.alt = "";
  img.style.cssText = "width:1px;height:1px;border:0;";
  img.setAttribute("data-track-pixel", "1");
  img.dataset.trackId = id;
  body.appendChild(img);
  return id;
}

function recordSend(container, id) {
  const entry = {
    id,
    to: readField(container, 'textarea[name="to"]'),
    subject: readField(container, 'input[name="subjectbox"]'),
    sentAt: Date.now(),
  };

  chrome.storage.local.get({ tracked: [] }, (data) => {
    const tracked = data.tracked;
    tracked.unshift(entry);
    chrome.storage.local.set({ tracked: tracked.slice(0, 200) });
  });
}

function matchSendButton(target) {
  const btn = target.closest && target.closest('[role="button"]');
  if (!btn) return null;

  const label = (
    btn.getAttribute("data-tooltip") ||
    btn.getAttribute("aria-label") ||
    ""
  ).trim();

  return /^send\b/i.test(label) ? btn : null;
}

document.addEventListener(
  "click",
  (e) => {
    const btn = matchSendButton(e.target);
    if (!btn) return;

    const container = findCompose(btn);
    const id = injectPixel(container);
    if (id) recordSend(container, id);
  },
  true
);

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
