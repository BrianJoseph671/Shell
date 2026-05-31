(function (global) {
  const TRACKER_BASE = "https://shell-kappa-lilac.vercel.app";
  const GRACE_MS = 15000;

  function hasGmailThreadInReferer(referer) {
    return /#(?:inbox|sent|label\/[^/]+|search\/[^/]+)\/[a-zA-Z0-9]{10,}/i.test(
      referer || ""
    );
  }

  function isLikelyInboxPrefetch(event) {
    const ref = (event?.referer || "").toLowerCase();
    if (!ref) return false;
    if (!ref.includes("mail.google.com")) return false;
    if (hasGmailThreadInReferer(ref)) return false;

    if (/#inbox$|#sent$/.test(ref)) return true;
    if (/#category\//.test(ref) && !hasGmailThreadInReferer(ref)) return true;
    return false;
  }

  function validOpens(events, sentAt, graceMs = GRACE_MS) {
    if (!sentAt || !Array.isArray(events)) return [];
    const cutoff = sentAt + graceMs;
    return events.filter(
      (e) =>
        e &&
        typeof e.ts === "number" &&
        e.ts >= cutoff &&
        !isLikelyInboxPrefetch(e)
    );
  }

  function opensSummary(events, sentAt) {
    const valid = validOpens(events, sentAt);
    const last = valid.length ? valid[valid.length - 1].ts : null;
    return { count: valid.length, last, valid };
  }

  function normSubject(s) {
    return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function parseEmail(str) {
    const raw = (str || "").trim();
    const angle = raw.match(/<([^>]+@[^>]+)>/);
    if (angle) return angle[1].trim();
    const email = raw.match(/[\w.+-]+@[\w.-]+\.\w+/);
    return email ? email[0] : "";
  }

  function displayName(entry) {
    if (entry?.recipientName) {
      const first = entry.recipientName.trim().split(/\s+/)[0];
      if (first) return first;
    }
    const email = parseEmail(entry?.to);
    if (email) return email;
    return "Recipient";
  }

  global.ConchShared = {
    TRACKER_BASE,
    GRACE_MS,
    validOpens,
    opensSummary,
    isLikelyInboxPrefetch,
    normSubject,
    parseEmail,
    displayName,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
