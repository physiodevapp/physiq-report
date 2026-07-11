# PhysiQ — ICF-APTA Reports

A clinical tool for physiotherapists that generates structured session reports from audio. It transcribes the recording with Whisper and drafts the report in Spanish following the ICF-APTA framework using Claude.

**Primary entry point: [PhysiQ Hub](https://physiodevapp.github.io/physiq/)** — installs as a single PWA covering all PhysiQ apps.

**Standalone: [→ Open app](https://physiodevapp.github.io/physiq-report/)**

## Demo

Open `index.html` directly in the browser. No installation, server, or build step required.

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
