# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**PhysiQ-Report** (CIF-AFTA v4.0) is a single-file clinical documentation tool for physiotherapists. It takes audio recordings of sessions, transcribes them via a Cloudflare Worker backed by Whisper, and generates structured clinical reports (in Spanish) via another Cloudflare Worker backed by Claude.

## Running the app

No build step. Open `index.html` directly in a browser. There is no package.json, no dev server, no compilation.

## Architecture

The application is split across these files:
- `index.html` — markup and embedded CSS
- `app.js` — all JavaScript (~1036 lines)
- `lib/payload.js` — pure functions shared between the browser and tests (`decodePayload`, `buildClinicalContext`); no DOM, no globals
- `sw.js` — Service Worker (PWA: cache-first for CDN assets, network-first for app shell, network-only for workers)
- `manifest.json` — PWA manifest (standalone display, dark theme)
- `tests/unit.js` — Node-runnable unit tests for `lib/payload.js`

There is no framework, no bundler, no modules.

**External dependencies loaded at runtime:**
- `docx` v8.5.0 from CDN (jsdelivr → unpkg → cloudflare fallbacks) — used for `.docx` export
- Cloudflare Worker endpoints (hardcoded URLs):
  - `https://physiq-whisper.edu-gamboa-rodriguez.workers.dev` — audio transcription (Whisper)
  - `https://physiq-claude.edu-gamboa-rodriguez.workers.dev` — report generation (claude-sonnet-4-5); acts as a proxy that injects the Anthropic API key and forwards the same body shape as the Anthropic API (`model`, `max_tokens`, `messages`)

**Client-side persistence:**
- `localStorage` key `physiq_config` (JSON) — all UI/clinic settings
- `localStorage` key `physiq_logo` (base64) + `physiq_logo_mime` — uploaded logo
- IDB DB `'physiq'` v2, store `'session'`, key `'active'` — shared session written by satellite apps (physiq-motion, physiq-assessment); physiq-report is read-only on this store

**Key global variables in `app.js`:**
- `selectedFile` — audio file selected by the user
- `transcriptText` — transcript returned by Whisper
- `lastReportText` — generated report text (also used for `.docx`)
- `selectedTemplate` — `'brief'` or `'narrative'`
- `manualRegion` — region override set from the region-picker sheet (null if not set)
- `window._physiqAssessmentContext` — structured assessment payload from PhysiQ-Assessment

## Core pipeline

1. User uploads audio → `transcribeAudio()` POSTs to Whisper worker → raw transcript stored in `transcriptText`
2. `buildPrompt()` constructs a template-specific prompt (brief "ficha" vs. full CIF narrative) + patient info
3. `analyzeWithClaude()` POSTs transcript + prompt to Claude worker → returns markdown report text
4. `renderReport()` parses markdown (sections ##/###/####, tables, hyperlinks) and renders HTML preview
5. `downloadWord()` builds a `.docx` using the `docx` library with clinic branding (logo, colors, fonts)

## Key functions to know

| Function | File | Purpose |
|---|---|---|
| `buildPrompt()` | `app.js` | Constructs the Claude prompt; switches between `brief` and `narrative` templates with explicit CIF instructions |
| `buildClinicalContext()` | `lib/payload.js` | Formats `window._physiqAssessmentContext` into a structured text block injected before the transcript |
| `decodePayload()` | `lib/payload.js` | Decodes the `?v=<base64>` URL param sent by PhysiQ-Assessment |
| `renderReport()` | `app.js` | Parses markdown sections into collapsible HTML; calls `parseTablesInText()` and `parseHyperlinks()` |
| `downloadWord()` | `app.js` | Builds `.docx` with custom header (logo + clinic info), footer (page numbers), and section-aware styling |
| `loadDocx()` | `app.js` | Dynamic CDN loader with 3 fallbacks; must resolve before `downloadWord()` is called |
| `saveConfig()` / `loadConfig()` | `app.js` | Serializes the entire UI state to/from `physiq_config` in localStorage |
| `generateReport()` | `app.js` | Orchestrates the full pipeline; skips transcription step if no audio and `_physiqAssessmentContext` is present |
| `loadFromPhysiQAssessment()` | `app.js` | Reads and decodes `?v=<base64>` from the URL on startup |
| `applyPhysiQAssessmentContext()` | `app.js` | Prefills form fields from payload and stores it in `window._physiqAssessmentContext` |
| `showImportedBadge()` | `app.js` | Injects a green confirmation banner in `<main>` when a payload is detected |
| `initTurnstile()` / `getTurnstileToken()` | `app.js` | Cloudflare Turnstile bot-protection widget; token is attached to every Worker request |
| `getWhisperPrompt()` | `app.js` | Returns a region-specific hint string sent to Whisper to improve transcription accuracy |
| `setManualRegion()` / `openRegionSheet()` | `app.js` | Region-picker bottom sheet for manual override of the anatomical region hint |
| `_loadAudioFromIDB()` / `_applyImportedAudio()` | `app.js` | Load a previously imported audio file from IndexedDB (cross-app handoff from PhysiQ-Assessment) |
| `copyReport()` | `app.js` | Copies the rendered report text to the clipboard |

## Report templates

`selectedTemplate` is either `'brief'` or `'narrative'` (default). This controls which prompt is built in `buildPrompt()`. The narrative template follows the CIF biopsychosocial framework with specific sections the truncation-detection logic checks for.

## Truncation detection

After Claude responds, the app inspects `lastReportText` for expected final sections. If the text ends abruptly or is missing expected closing sections, a warning is shown. Token limit is user-configurable (1000–7000 tokens via a slider).

## Cloudflare Workers

The two workers are external to this repo. They proxy requests to the Whisper API and Anthropic API respectively. If either endpoint changes, update the hardcoded URLs in `app.js` (inside `transcribeAudio` and `analyzeWithClaude`).

Every request to a worker includes a Cloudflare Turnstile token (`cf-turnstile-response` header). The widget is rendered in `interaction-only` mode — it appears only when a challenge is required. `getTurnstileToken()` returns a Promise that resolves once the token is available, refreshing the widget if expired.

## Code conventions

- HTML/CSS/JS split across `index.html` (markup + CSS) and `app.js` (all logic)
- No npm dependencies — libraries loaded via CDN (docx.js, etc.)
- CSS variables in `:root`: `--bg`, `--surface`, `--border`, `--accent` (green), `--accent2` (blue), `--text`, `--text-muted`, `--danger`
- Fonts: DM Serif Display (headings), DM Mono (code/labels), DM Sans (body)
- `localStorage` key: `physiq_config` — clinic configuration and style

## Commit format

```
git commit -m "short imperative title" -m "description when necessary"
```

- The first `-m` is the title (max ~72 characters)
- The second `-m` is only included when there is relevant context to add
- Never use `git commit` without flags or interactive editors
- Never add co-authorship (`Co-Authored-By`) under any circumstances

---

## Sibling repos

| Repo | URL | Role |
|------|-----|------|
| physiq-assessment | https://physiodevapp.github.io/physiq-assessment/ | 5-phase clinical assessment |
| physiq-motion | https://physiodevapp.github.io/physiq-motion/ | Joint ROM measurement |

---

## Integration: IDB shared session

physiq-report is **read-only** on the shared IDB session. On startup it calls `readSession()` and applies whatever data the satellite apps have written:

```js
readSession().then(session => {
  if (!session) return;
  if (session.assessment) applyPhysiQAssessmentContext(session.assessment);
  if (session.rom)        applyROMContext(session.rom);
  updateSessionChip(session);
});
```

- `session.assessment` — written by physiq-assessment on export; pre-fills patient/date/diagnosis fields and injects structured clinical context into the Claude prompt via `buildClinicalContext()` (`lib/payload.js`)
- `session.rom` — written by physiq-motion on export; injects ROM summary into the Claude prompt

Both payloads persist across page reloads (TTL 24h). URL params (`?v=`, `?rom=`) are kept for backward compatibility.

**Session chip** in the header shows `● patient · date [×]` when a session is active. `[×]` triggers `promptClearSession()` → `showConfirmBanner` → `resetApp()` + clears `window._physiqROMContext` + removes import badges + `clearSession()`.

## Dialogs

Use `showConfirmBanner(title, text, actionLabel, callback)` — never use the native `confirm()` or `alert()`.