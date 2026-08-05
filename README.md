# PhysiQ — ICF-APTA Reports

A clinical tool for physiotherapists that generates structured session reports from audio. It transcribes the recording with Whisper and drafts the report in Spanish following the ICF-APTA framework using Claude.

**Primary entry point: [PhysiQ Hub](https://physiodevapp.github.io/physiq/)** — installs as a single PWA covering all PhysiQ apps.

**Standalone: [→ Open app](https://physiodevapp.github.io/physiq-report/)**

## Running it locally

Open `index.html` directly in the browser. No installation, server, or build step required.

## Demo mode

PhysiQ is a public portfolio project whose AI features run on a personal API
budget. Rather than gating the app behind a license key that turns it into a blank
wall when disabled, the orchestrator serves a **demo mode**: a visitor without a
license walks the entire report flow — transcript, streamed report, Word export,
email — on preloaded fixtures, with **zero calls to Whisper, Claude or Resend**.

The report describes a fictional patient — the same case the hub's copilot uses, so
a visitor exploring both finds one coherent patient rather than two. The demo report
text carries its own closing note stating it was generated in demo mode over a
fictional case, so that notice survives into the `.docx`, the PDF and the email *by
construction*, instead of depending on each export path remembering to add it.
Email delivery answers `{ ok: true, demo: true }` and the UI says "envío simulado":
claiming a clinical report was emailed when it was not would be worse than not
sending it at all.

### How the mode is decided

**In the worker, never in the client.** The decision runs in the router before any
handler and is fail-closed — `real` requires *all* of: no `DEMO_ONLY` kill switch,
an `X-License-Key` present, that key active in the `LICENSES` KV namespace, and the
secrets that route needs. Anything else degrades to demo instead of a 401.

The client cannot influence it: it never sends a mode. It reads one from the
`X-PhysiQ-Mode` response header (and from the hub's `PHYSIQ_MODE` postMessage) and
uses it only to render the badge. Forcing `_demoMode` from devtools produces a UI
that lies while the worker keeps serving fixtures.

Demo handlers in `workers/demo/handlers.js` **never receive `env`**, which is where
the API keys live — so no demo path can reach a paid provider even by mistake. That
is the zero-cost guarantee, and it is a property of the function signatures rather
than of remembering to write an early return.

Turnstile now runs only in real mode, on both sides. On the server it exists to
guard paid work, and in demo nothing is blocked by design, so a check whose
failure cannot reject the request would just be a wasted subrequest. On the
client the gate is lifted too: the "Generar informe" button used to appear only
after Turnstile's callback fired, so a visitor with an ad blocker — exactly the
privacy-minded visitor this project wants to reach — would have seen no button at
all. Scripted replay of the demo is contained by the demo rate limiter instead,
which costs nothing to enforce.

Because the button is rendered according to the mode, the client cannot wait for
a response header to learn it. `GET /validate` reports the mode up front, before
any real request; it needs no Turnstile token and no license, and it never
reveals *why* a visitor is in demo.

### Rate limiting

Second layer, protecting the budget if a license key ever leaks. Report generation
is the most expensive call in the ecosystem, so its window is the tightest. Limits
are keyed by hashed license when there is one and by IP otherwise; see
`workers/wrangler.toml`. Every binding is optional in code — unbound means "no
limiting", never a runtime error.

### Enabling real mode

Set the worker secrets (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`,
`TURNSTILE_SECRET`), keep `DEMO_ONLY` at `"0"`, and add a license key to the
`physiq-licenses` KV namespace as `{"clinic":"Nombre","active":true}`. Enter it from
the hub's front screen. Flipping `active` to `false` — or setting `DEMO_ONLY=1` —
drops every visitor back to demo instantly, with no deploy.

## Workflow

1. Configure your clinic details (name, logo, colors) — saved to localStorage.
2. Patient data and clinical context are pre-filled automatically if a shared PhysiQ session is active (written by PhysiQ Assessment or PhysiQ Motion). Otherwise enter them manually.
3. Upload the session audio (drag & drop or file picker), or use audio recorded via the hub's built-in recorder.
4. Choose a template:
   - **Brief note** — concise session note.
   - **Institutional narrative** — full report with ICF biopsychosocial structure.
5. Generate the report → preview on screen → download as `.docx` with a custom clinical header.

## Ecosystem integration

When a PhysiQ session is active, context is imported automatically:

| Source | Badge | What arrives |
|--------|-------|--------------|
| PhysiQ Assessment (complete) | green | Full clinical context injected into Claude prompt |
| PhysiQ Assessment (in progress) | amber | Anatomical region applied to Whisper hint |
| PhysiQ Motion | blue | ROM data injected into Claude prompt |
| Hub recorder | green | Audio blob ready to use |

All context updates happen in real time via `BroadcastChannel('physiq-session')` — no page reload needed.

## External requirements

The app requires one active **Cloudflare Worker**:

| Worker | Role |
|---|---|
| `physiq-orchestrator` | Full pipeline: Turnstile validation, Whisper transcription, optional doc summarization (Haiku), and Claude report generation (Sonnet) via SSE. Also handles report delivery by email (`/email`). |

The worker URL is hardcoded as `ORCHESTRATOR_URL` at the top of `app.js`. Update it if you deploy your own worker.

## Self-hosting

1. Create the orchestrator worker on [Cloudflare](https://workers.cloudflare.com/) with access to the Whisper and Anthropic APIs.
2. Update `ORCHESTRATOR_URL` in `app.js`.
3. Serve `index.html` from any static host (Cloudflare Pages, GitHub Pages, etc.) or use it locally.

## Report customization

From the configuration panel (collapsible in the app) you can adjust:

- Clinic logo (PNG/JPG, embedded in the `.docx`)
- Colors, typography, and header style of the Word document
- Intro text with automatic patient name substitution
- GDPR clause

All settings persist in the browser's `localStorage`.

## Tech stack

- Plain HTML/CSS/JS — no framework, no bundler
- [`docx`](https://github.com/dolanmiu/docx) v8.5.0 (loaded from CDN at runtime)
- Cloudflare Workers (Whisper + Anthropic Claude)
- Cloudflare Turnstile (bot protection on Worker requests)
- Service Worker (`sw.js`) — installable as a PWA, works offline for cached app shell
