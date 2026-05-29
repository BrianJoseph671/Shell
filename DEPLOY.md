# Deploy and wire up

1. `cd backend && npm install`
2. Push this repo to GitHub. Import into Vercel with **Root Directory** set to `backend`.
3. In the Vercel project: **Storage** → **Marketplace** → add **Upstash Redis** (free tier). Redeploy so env vars are injected.
4. Copy your production URL (e.g. `https://gmail-tracker-xyz.vercel.app`).
5. Replace `YOUR-APP.vercel.app` in these three files:
   - `extension/manifest.json` (`host_permissions`)
   - `extension/content.js` (`TRACKER_BASE`)
   - `extension/popup.js` (`TRACKER_BASE`)
6. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select the `extension/` folder.
7. Send a test email, open it on another account, then use the extension popup → **Refresh opens**.
