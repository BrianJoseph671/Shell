const TRACKER_BASE = "https://shell-kappa-lilac.vercel.app";
const OPENS_BATCH_SIZE = 20;

async function fetchOpensBatch(ids) {
  const result = {};
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return result;

  for (let i = 0; i < unique.length; i += OPENS_BATCH_SIZE) {
    const chunk = unique.slice(i, i + OPENS_BATCH_SIZE);
    const url = `${TRACKER_BASE}/api/opens?ids=${encodeURIComponent(chunk.join(","))}&_=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`opens HTTP ${res.status}`);
    }
    const data = await res.json();
    Object.assign(result, data);
  }

  return result;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "fetchOpens") {
    fetchOpensBatch(msg.ids)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => {
        console.warn("[Magic Conch background] fetchOpens failed", err);
        sendResponse({ ok: false, error: String(err?.message || err) });
      });
    return true;
  }
});
