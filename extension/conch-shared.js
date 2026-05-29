(function (global) {
  const TRACKER_BASE = "https://shell-kappa-lilac.vercel.app";
  const GRACE_MS = 15000;

  function validOpens(events, sentAt, graceMs = GRACE_MS) {
    if (!sentAt || !Array.isArray(events)) return [];
    const cutoff = sentAt + graceMs;
    return events.filter((e) => e && typeof e.ts === "number" && e.ts >= cutoff);
  }

  function opensSummary(events, sentAt) {
    const valid = validOpens(events, sentAt);
    const last = valid.length ? valid[valid.length - 1].ts : null;
    return { count: valid.length, last, valid };
  }

  function normSubject(s) {
    return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  global.ConchShared = {
    TRACKER_BASE,
    GRACE_MS,
    validOpens,
    opensSummary,
    normSubject,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
