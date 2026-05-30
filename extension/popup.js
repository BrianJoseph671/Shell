async function updateStatus() {
  const status = document.getElementById("status");
  const ver = chrome.runtime.getManifest().version;
  const { tracked = [] } = await chrome.storage.local.get({ tracked: [] });
  let gmail = "Open Gmail to see checkmarks";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.includes("mail.google.com")) {
      try {
        const ping = await chrome.tabs.sendMessage(tab.id, { type: "ping" });
        gmail = ping?.ok ? `${tracked.length} tracked · auto-refresh on` : "Reload Gmail tab";
      } catch (_) {
        gmail = "Reload Gmail tab, then extension";
      }
    }
  } catch (_) {}

  status.textContent = `v${ver} · ${gmail}`;
}

updateStatus();
