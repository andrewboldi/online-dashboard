# Doctor Outreach Dashboard (front-end)

Static dashboard for tracking physician outreach. **Public front-end only** — it
contains no data. All doctor records are served at runtime from a private,
Google-sign-in-gated Cloudflare Worker (D1 + KV), so only authorized accounts can
see anything.

- `index.html`, `app.js`, `styles.css` — the entire app
- Auth: Google Identity Services; the Worker validates the ID token against an
  email allowlist before returning any data.
- Data source/system-of-record lives in a separate private repository.

Hosted via GitHub Pages. Offline/demo view: append `?local=1` (expects local
`data/*.json`, not shipped here).
