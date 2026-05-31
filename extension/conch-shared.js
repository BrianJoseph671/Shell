(function (global) {
  const TRACKER_BASE = "https://shell-kappa-lilac.vercel.app";
  const GRACE_MS = 15000;

  const GENERIC_RECIPIENT_NAMES =
    /^(university|college|school|team|support|info|admin|noreply|no-reply|mail|email|contact|helpdesk)$/i;

  function hasGmailThreadInReferer(referer) {
    return /#(?:inbox|sent|label\/[^/]+|search\/[^/]+)\/[a-zA-Z0-9]{10,}/i.test(
      referer || ""
    );
  }

  function isGmailReferer(referer) {
    return (referer || "").toLowerCase().includes("mail.google.com");
  }

  function isLikelySenderView(event) {
    const ref = (event?.referer || "").toLowerCase();
    return ref.includes("mail.google.com") && /#sent(?:\/|$)/.test(ref);
  }

  function isRecipientGmailThreadView(event) {
    const ref = event?.referer || "";
    if (!isGmailReferer(ref)) return false;
    return (
      /#(?:inbox|category\/[^/]+)\/[a-zA-Z0-9]{10,}/i.test(ref) ||
      /#search\/[^#]+\/[a-zA-Z0-9]{10,}/i.test(ref) ||
      /#label\/[^#]+\/[a-zA-Z0-9]{10,}/i.test(ref)
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

  function hasValidFetchDest(event) {
    const dest = (event?.secFetchDest || "").toLowerCase();
    if (!dest) return true;
    // Gmail often omits or varies this; only block obvious non-image loads.
    return !["document", "iframe", "object", "embed", "script", "style"].includes(dest);
  }

  function countsAsOpen(event) {
    if (!hasValidFetchDest(event)) return false;
    if (isLikelySenderView(event)) return false;
    if (isLikelyInboxPrefetch(event)) return false;

    const ref = (event?.referer || "").trim().toLowerCase();

    // Browsers usually strip the #hash from Referer, so real Gmail thread opens
    // often arrive with no referer or mail.google.com without a fragment.
    if (!ref) return true;

    if (!isGmailReferer(ref)) return true;

    if (isRecipientGmailThreadView(event)) return true;

    // Gmail page without hash: allow (can't distinguish); sent/list still caught above when hash present.
    return true;
  }

  function maxOpenTsForEntry(entry, allTracked) {
    if (!entry?.threadId || !Array.isArray(allTracked)) return Infinity;
    let cap = Infinity;
    for (const t of allTracked) {
      if (t.id === entry.id) continue;
      if (t.threadId !== entry.threadId) continue;
      if (t.sentAt > entry.sentAt && t.sentAt < cap) cap = t.sentAt;
    }
    return cap;
  }

  function validOpens(events, sentAt, opts = {}) {
    if (!sentAt || !Array.isArray(events)) return [];
    const graceMs = opts.graceMs ?? GRACE_MS;
    const maxTs = opts.maxTs ?? Infinity;
    const cutoff = sentAt + graceMs;
    return events.filter(
      (e) =>
        e &&
        typeof e.ts === "number" &&
        e.ts >= cutoff &&
        e.ts < maxTs &&
        countsAsOpen(e)
    );
  }

  function opensSummary(events, sentAt, opts = {}) {
    const valid = validOpens(events, sentAt, opts);
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

  function isGenericRecipientName(name) {
    if (!name) return true;
    const first = name.trim().split(/\s+/)[0];
    if (!first) return true;
    return GENERIC_RECIPIENT_NAMES.test(first);
  }

  function nameFromToField(to) {
    const raw = (to || "").trim();
    if (!raw) return "";

    const parts = raw.split(",").map((p) => p.trim());
    for (const part of parts) {
      const angle = part.match(/^([^<]+)</);
      if (angle) {
        const n = angle[1].trim().replace(/"/g, "");
        if (n && !isGenericRecipientName(n)) return n.split(/\s+/)[0];
      }
    }
    return "";
  }

  function displayName(entry) {
    const to = entry?.to || "";
    const stored = entry?.recipientName;
    if (stored && !isGenericRecipientName(stored)) {
      const first = stored.trim().split(/\s+/)[0];
      if (first) return first;
    }

    const fromTo = nameFromToField(to);
    if (fromTo) return fromTo;

    const email = parseEmail(to);
    if (email) return email;
    return "Recipient";
  }

  global.ConchShared = {
    TRACKER_BASE,
    GRACE_MS,
    validOpens,
    opensSummary,
    maxOpenTsForEntry,
    countsAsOpen,
    isLikelyInboxPrefetch,
    isLikelySenderView,
    isGenericRecipientName,
    normSubject,
    parseEmail,
    displayName,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
