# Build Plan: Private Gmail Open Tracker (MV3 extension \+ Vercel backend)

Hand this whole file to Cursor. Build it exactly as specified. Where code is given, use it close to verbatim. The "Traps" section lists mistakes to avoid.

## Goal

A personal Gmail open tracker. A Chrome extension (Manifest V3) injects a unique 1x1 pixel into emails I send. A tiny Next.js backend on Vercel serves the pixel, logs each open by ID into Upstash Redis, and exposes the data back to the extension popup.

No external paid accounts. Free Vercel hosting \+ free Upstash Redis (provisioned through the Vercel Marketplace, which auto-injects env vars).

## Stack decisions (locked, do not substitute)

- Backend: Next.js App Router, Node runtime, deployed to Vercel.  
- Storage: Upstash Redis via `@upstash/redis`.  
- DO NOT use `@vercel/kv`. It was deprecated Dec 2024 and stores were migrated to Upstash. New projects use Upstash directly.  
- DO NOT use Supabase. Overkill. This is key/value ping logging.  
- Extension: vanilla JS, MV3. No frameworks, no build step.

## Repo structure

gmail-tracker/

  extension/

    manifest.json

    content.js

    popup.html

    popup.js

  backend/

    package.json

    next.config.js

    app/

      api/

        pixel/route.js

        opens/route.js

---

## Backend

### backend/package.json

{

  "name": "gmail-tracker-backend",

  "private": true,

  "scripts": {

    "dev": "next dev",

    "build": "next build",

    "start": "next start"

  },

  "dependencies": {

    "@upstash/redis": "^1.34.0",

    "next": "^15.0.0",

    "react": "^19.0.0",

    "react-dom": "^19.0.0"

  }

}

### backend/next.config.js

/\*\* @type {import('next').NextConfig} \*/

module.exports \= {};

### Redis client (used by both routes)

Create both routes with this client init. Use a fallback because the Vercel Marketplace Upstash integration may inject either `UPSTASH_REDIS_REST_*` or `KV_REST_API_*` depending on setup.

import { Redis } from "@upstash/redis";

const redis \= new Redis({

  url: process.env.UPSTASH\_REDIS\_REST\_URL || process.env.KV\_REST\_API\_URL,

  token: process.env.UPSTASH\_REDIS\_REST\_TOKEN || process.env.KV\_REST\_API\_TOKEN,

});

### backend/app/api/pixel/route.js

Returns a 1x1 transparent GIF and logs the open. Must be uncacheable or Gmail's image proxy will cache it and you stop seeing opens.

import { Redis } from "@upstash/redis";

const redis \= new Redis({

  url: process.env.UPSTASH\_REDIS\_REST\_URL || process.env.KV\_REST\_API\_URL,

  token: process.env.UPSTASH\_REDIS\_REST\_TOKEN || process.env.KV\_REST\_API\_TOKEN,

});

// 43-byte transparent 1x1 GIF

const PIXEL \= Buffer.from(

  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",

  "base64"

);

export const dynamic \= "force-dynamic";

export const runtime \= "nodejs";

export async function GET(request) {

  const { searchParams } \= new URL(request.url);

  const id \= searchParams.get("id");

  if (id) {

    const event \= {

      ts: Date.now(),

      ua: request.headers.get("user-agent") || "",

      ip: request.headers.get("x-forwarded-for") || "",

    };

    // Fire and forget; never block the image response on Redis.

    try {

      await redis.rpush(\`opens:${id}\`, JSON.stringify(event));

    } catch (e) {

      // swallow, still return pixel

    }

  }

  return new Response(PIXEL, {

    status: 200,

    headers: {

      "Content-Type": "image/gif",

      "Content-Length": String(PIXEL.length),

      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",

      Pragma: "no-cache",

      Expires: "0",

    },

  });

}

### backend/app/api/opens/route.js

Returns open events for a comma-separated list of IDs. The popup fetches this cross-origin from `chrome-extension://...`, so it needs permissive CORS.

import { Redis } from "@upstash/redis";

const redis \= new Redis({

  url: process.env.UPSTASH\_REDIS\_REST\_URL || process.env.KV\_REST\_API\_URL,

  token: process.env.UPSTASH\_REDIS\_REST\_TOKEN || process.env.KV\_REST\_API\_TOKEN,

});

export const dynamic \= "force-dynamic";

export const runtime \= "nodejs";

const CORS \= {

  "Access-Control-Allow-Origin": "\*",

  "Access-Control-Allow-Methods": "GET, OPTIONS",

  "Access-Control-Allow-Headers": "Content-Type",

};

export async function OPTIONS() {

  return new Response(null, { status: 204, headers: CORS });

}

export async function GET(request) {

  const { searchParams } \= new URL(request.url);

  const ids \= (searchParams.get("ids") || "").split(",").filter(Boolean);

  const result \= {};

  for (const id of ids) {

    let events \= \[\];

    try {

      const raw \= await redis.lrange(\`opens:${id}\`, 0, \-1);

      // @upstash/redis may auto-parse JSON; handle string or object.

      events \= raw.map((e) \=\> (typeof e \=== "string" ? JSON.parse(e) : e));

    } catch (e) {

      events \= \[\];

    }

    result\[id\] \= { count: events.length, events };

  }

  return new Response(JSON.stringify(result), {

    status: 200,

    headers: { "Content-Type": "application/json", ...CORS },

  });

}

---

## Extension

### extension/manifest.json

Replace `YOUR-APP.vercel.app` with the real deployed domain in BOTH host\_permissions here and the constant in content.js / popup.js.

{

  "manifest\_version": 3,

  "name": "Mini Gmail Open Tracker",

  "version": "1.0.0",

  "description": "Private 1x1 pixel open tracking for emails you send in Gmail.",

  "permissions": \["storage"\],

  "host\_permissions": \[

    "https://mail.google.com/\*",

    "https://YOUR-APP.vercel.app/\*"

  \],

  "content\_scripts": \[

    {

      "matches": \["https://mail.google.com/\*"\],

      "js": \["content.js"\],

      "run\_at": "document\_idle"

    }

  \],

  "action": {

    "default\_popup": "popup.html",

    "default\_title": "Gmail Open Tracker"

  }

}

### extension/content.js

Key logic: a CAPTURE-PHASE click listener on `document`. Capture phase matters so the pixel is appended to the compose body BEFORE Gmail's own send handler reads/serializes the body. Gmail's send button is a `[role="button"]` whose `data-tooltip` or `aria-label` starts with "Send". The compose body is `[contenteditable="true"][role="textbox"]` (fallbacks `[g_editable="true"]`, `[aria-label="Message Body"]`). Recipient and subject come from the stable named fields `textarea[name="to"]` and `input[name="subjectbox"]`.

const TRACKER\_BASE \= "https://YOUR-APP.vercel.app";

function uuid() {

  return crypto.randomUUID();

}

function findCompose(el) {

  return (el && el.closest && el.closest('\[role="dialog"\]')) ||

    (el && el.closest && el.closest("form")) ||

    document;

}

function readField(container, selector) {

  const el \= container.querySelector(selector);

  if (\!el) return "";

  return (el.value || el.textContent || "").trim();

}

function injectPixel(container) {

  const body \= container.querySelector(

    '\[contenteditable="true"\]\[role="textbox"\], \[g\_editable="true"\], \[aria-label="Message Body"\]'

  );

  if (\!body) return null;

  const existing \= body.querySelector('img\[data-track-pixel="1"\]');

  if (existing) return existing.dataset.trackId;

  const id \= uuid();

  const img \= document.createElement("img");

  img.src \= \`${TRACKER\_BASE}/api/pixel?id=${id}\`;

  img.width \= 1;

  img.height \= 1;

  img.alt \= "";

  img.style.cssText \= "width:1px;height:1px;border:0;";

  img.setAttribute("data-track-pixel", "1");

  img.dataset.trackId \= id;

  body.appendChild(img);

  return id;

}

function recordSend(container, id) {

  const entry \= {

    id,

    to: readField(container, 'textarea\[name="to"\]'),

    subject: readField(container, 'input\[name="subjectbox"\]'),

    sentAt: Date.now(),

  };

  chrome.storage.local.get({ tracked: \[\] }, (data) \=\> {

    const tracked \= data.tracked;

    tracked.unshift(entry);

    chrome.storage.local.set({ tracked: tracked.slice(0, 200\) });

  });

}

function matchSendButton(target) {

  const btn \= target.closest && target.closest('\[role="button"\]');

  if (\!btn) return null;

  const label \= (

    btn.getAttribute("data-tooltip") ||

    btn.getAttribute("aria-label") ||

    ""

  ).trim();

  return /^send\\b/i.test(label) ? btn : null;

}

document.addEventListener(

  "click",

  (e) \=\> {

    const btn \= matchSendButton(e.target);

    if (\!btn) return;

    const container \= findCompose(btn);

    const id \= injectPixel(container);

    if (id) recordSend(container, id);

  },

  true

);

document.addEventListener(

  "keydown",

  (e) \=\> {

    if (\!((e.ctrlKey || e.metaKey) && e.key \=== "Enter")) return;

    const container \= findCompose(document.activeElement);

    const id \= injectPixel(container);

    if (id) recordSend(container, id);

  },

  true

);

### extension/popup.html

\<\!DOCTYPE html\>

\<html\>

  \<head\>

    \<meta charset="utf-8" /\>

    \<style\>

      body { font: 13px/1.4 \-apple-system, system-ui, sans-serif; width: 360px; margin: 0; padding: 12px; }

      h1 { font-size: 14px; margin: 0 0 8px; }

      button { font-size: 11px; margin-bottom: 10px; cursor: pointer; }

      .row { border-bottom: 1px solid \#eee; padding: 8px 0; }

      .subj { font-weight: 600; }

      .meta { color: \#666; font-size: 11px; }

      .opens { color: \#137333; font-weight: 600; }

      .none { color: \#999; }

    \</style\>

  \</head\>

  \<body\>

    \<h1\>Tracked emails\</h1\>

    \<button id="refresh"\>Refresh opens\</button\>

    \<div id="list"\>\</div\>

    \<script src="popup.js"\>\</script\>

  \</body\>

\</html\>

### extension/popup.js

No HTML `<form>` tags, plain event handlers. Reads local sends, fetches open counts from the backend, renders a list.

const TRACKER\_BASE \= "https://YOUR-APP.vercel.app";

function fmt(ts) {

  return new Date(ts).toLocaleString();

}

function esc(s) {

  return (s || "").replace(/\[&\<\>\]/g, (c) \=\> ({ "&": "\&amp;", "\<": "\&lt;", "\>": "\&gt;" }\[c\]));

}

async function render() {

  const { tracked \= \[\] } \= await chrome.storage.local.get({ tracked: \[\] });

  const list \= document.getElementById("list");

  if (\!tracked.length) {

    list.innerHTML \= '\<div class="none"\>No tracked emails yet.\</div\>';

    return;

  }

  let opensData \= {};

  try {

    const ids \= tracked.map((t) \=\> t.id).join(",");

    const res \= await fetch(\`${TRACKER\_BASE}/api/opens?ids=${ids}\`);

    opensData \= await res.json();

  } catch (e) {

    // backend not reachable yet; show sends without open data

  }

  list.innerHTML \= tracked

    .map((t) \=\> {

      const info \= opensData\[t.id\] || { count: 0, events: \[\] };

      const last \= info.events.length ? fmt(info.events\[info.events.length \- 1\].ts) : null;

      const opensLine \= info.count

        ? \`\<span class="opens"\>Opened ${info.count}x\</span\>${last ? " \- last " \+ last : ""}\`

        : '\<span class="none"\>Not opened\</span\>';

      return \`\<div class="row"\>

        \<div class="subj"\>${esc(t.subject) || "(no subject)"}\</div\>

        \<div class="meta"\>To: ${esc(t.to) || "?"} \- Sent ${fmt(t.sentAt)}\</div\>

        \<div class="meta"\>${opensLine}\</div\>

      \</div\>\`;

    })

    .join("");

}

document.getElementById("refresh").addEventListener("click", render);

render();

---

## Setup and deploy order (do these in sequence)

1. `cd backend && npm install`  
2. Push `backend/` to a GitHub repo, import it into Vercel as a new project (root \= `backend`).  
3. In the Vercel project: Storage tab to Marketplace to add Upstash for Redis (free tier). It auto-injects the REST URL \+ token env vars. Redeploy so the functions pick them up.  
4. Note the production domain, e.g. `https://gmail-tracker-xyz.vercel.app`.  
5. Find/replace `YOUR-APP.vercel.app` with that domain in three places: `manifest.json` host\_permissions, `content.js` TRACKER\_BASE, `popup.js` TRACKER\_BASE.  
6. Load the extension: chrome://extensions to enable Developer mode to "Load unpacked" to select the `extension/` folder.  
7. Open Gmail, send a test email to a second address you control, open it there, then click the extension icon and hit "Refresh opens".

## Acceptance tests

- Sending an email injects exactly one `img[data-track-pixel="1"]` into the body (check via DevTools on the compose window before send).  
- `GET /api/pixel?id=test123` returns a 1x1 GIF with `Cache-Control: no-store` and pushes an event to `opens:test123`.  
- `GET /api/opens?ids=test123` returns `{ "test123": { "count": 1, "events": [...] } }`.  
- Popup lists sent emails and reflects open counts after Refresh.

## Traps to avoid

- Do NOT import `@vercel/kv`. Use `@upstash/redis` only.  
- Do NOT add `Cache-Control: public` or omit no-store on the pixel route. Gmail's image proxy caches aggressively and you will miss repeat opens.  
- Do NOT use a `<form>` element in the popup.  
- Use CAPTURE phase (`addEventListener(..., true)`) for the send listeners, or the pixel gets appended after Gmail already serialized the body.  
- The `opens` route MUST return CORS headers, or the popup fetch fails silently from the extension origin.

## Known limitations (real, do not over-engineer around them)

- Gmail proxies images through Google's cache, so the open registers when Gmail loads the proxy, and you see Google's IP/UA, not the recipient's. Treat opens as "opened in Gmail," not precise geolocation.  
- Your own view of the sent message can trigger a false open. If this becomes annoying, add a filter later that ignores events within \~10s of `sentAt`.  
- Image-blocking clients (some Outlook configs, "ask before loading images") will never fire the pixel, so a "Not opened" is not proof it was unread.  
- Pixel tracking can hurt deliverability if a domain flags the tracking host. Fine for low-volume personal use; do not blast it across a 500-person cold list on a domain you care about.

