# PhysiQ — ICF-APTA Reports

A clinical tool for physiotherapists that generates structured session reports from audio. It transcribes the recording with Whisper and drafts the report in Spanish following the ICF-APTA framework using Claude.

**[→ Open app](https://physiodevapp.github.io/physiq-report/)**

## Demo

Open `index.html` directly in the browser. No installation, server, or build step required.

## Workflow

1. Configure your clinic details (name, logo, colors) — saved to localStorage.
2. Patient data and clinical context are pre-filled automatically if a shared PhysiQ session is active (written by PhysiQ Assessment or PhysiQ Motion). Otherwise enter them manually.
3. Upload the session audio (drag & drop or file picker).
4. Choose a template:
   - **Brief note** — concise session note.
   - **Institutional narrative** — full report with ICF biopsychosocial structure.
5. Generate the report → preview on screen → download as `.docx` with a custom clinical header.

## External requirements

The app requires two active **Cloudflare Workers**:

| Worker | Role |
|---|---|
| `physiq-whisper` | Proxy to the Whisper API (audio transcription) |
| `physiq-claude` | Proxy to the Anthropic API (report generation, model `claude-sonnet-4-5`) |

Worker URLs are hardcoded in `app.js` (near `transcribeAudio` and `analyzeWithClaude`). Update them if you deploy your own workers.

## Self-hosting

1. Create both workers on [Cloudflare](https://workers.cloudflare.com/) with access to the Whisper and Anthropic APIs.
2. Update the worker URLs in `index.html`.
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
