# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**PhysiQ-Report** (CIF-APTA v4.0) is a single-file clinical documentation tool for physiotherapists. It takes audio recordings of sessions, transcribes them via a Cloudflare Worker backed by Whisper, and generates structured clinical reports (in Spanish) via another Cloudflare Worker backed by Claude.

**Deployment:** Push to `main` triggers `deploy-to-hub.yml`, which copies the app files into the central PhysiQ hub repo (`physiodevapp/physiq`). The hub's own GitHub Pages deployment serves the app at `physiodevapp.github.io/physiq/report/`. There is no standalone Pages deployment for this repo.

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
- Cloudflare Worker endpoint (hardcoded as `ORCHESTRATOR_URL` in `app.js`):
  - `https://physiq-orchestrator.edu-gamboa-rodriguez.workers.dev` — single worker that handles Turnstile validation, Whisper transcription, optional doc summarization (Haiku, 2000-token ceiling), and Claude report generation (Sonnet, SSE stream). Also exposes `/email` for report delivery by email.

**Client-side persistence:**
- `localStorage` key `physiq_config` (JSON) — all UI/clinic settings
- `localStorage` key `physiq_logo` (base64) + `physiq_logo_mime` — uploaded logo
- IDB DB `'physiq'` v3, store `'session'`, key `'active'` — shared session; physiq-report writes `patient`, `date`, `diagnosis`, `manualRegion` via `updateSession` (never creates a session, only updates an existing one)
- IDB DB `'physiq'` v3, store `'audio'`, key `'pending'` — audio blob written by the hub recorder; physiq-report reads and optionally consumes it

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
| `decodePayload()` | `lib/payload.js` | Decodes the `?v=<base64>` URL param sent by PhysiQ-Assessment (backward-compat fallback) |
| `renderReport()` | `app.js` | Parses markdown sections into collapsible HTML; calls `parseTablesInText()` and `parseHyperlinks()` |
| `downloadWord()` | `app.js` | Builds `.docx` with custom header (logo + clinic info), footer (page numbers), and section-aware styling |
| `loadDocx()` | `app.js` | Dynamic CDN loader with 3 fallbacks; must resolve before `downloadWord()` is called |
| `saveConfig()` / `loadConfig()` | `app.js` | Serializes the entire UI state to/from `physiq_config` in localStorage |
| `generateReport()` | `app.js` | Orchestrates the full pipeline; skips transcription step if no audio and `_physiqAssessmentContext` is present |
| `applyPhysiQAssessmentContext()` | `app.js` | Pre-fills form fields from the assessment payload, stores in `window._physiqAssessmentContext`, calls `setManualRegion()`, shows `assessmentBadge` |
| `applyROMContext()` | `app.js` | Applies ROM data from physiq-motion; removes old `romBadge`, creates new one, calls `_syncImportedCard()` |
| `_showAssessmentIncompleteBadge(phase)` | `app.js` | Shows amber badge when assessment is in progress (phases 1–5 not yet finalized) |
| `_syncImportedCard()` | `app.js` | Shows/hides `#imported-card` based on whether any clinical badges are present; auto-opens card when first badge appears |
| `showImportedBadge(data)` | `app.js` | Shows green badge when a complete assessment payload arrives; removes incomplete badge |
| `initTurnstile()` / `getTurnstileToken()` | `app.js` | Cloudflare Turnstile bot-protection widget; token is attached to every Worker request |
| `getWhisperPrompt()` | `app.js` | Returns a region-specific hint string sent to Whisper to improve transcription accuracy |
| `setManualRegion()` / `openRegionSheet()` | `app.js` | Region-picker bottom sheet for manual override of the anatomical region hint |
| `_peekAudioFromIDB()` | `app.js` | Reads hub audio from IDB without consuming it |
| `_consumeAudioFromIDB()` | `app.js` | Reads and deletes hub audio from IDB (called only when user confirms use) |
| `_showRecordingHint(duration)` | `app.js` | Shows `#session-rec-hint` hint when hub recording stops with audio available |
| `copyReport()` | `app.js` | Copies the rendered report text to the clipboard |
| `callOrchestrator()` | `app.js` | Main pipeline call: POSTs audio file, Whisper hint, prompt, and optional doc list to the orchestrator; streams SSE response and calls `onTranscript` callback when the transcript chunk arrives |
| `_summarizeAttachedDocs()` | `app.js` | Summarizes attached documents using a priority-ordered physiotherapy extraction prompt (diagnoses → procedures → treatments → objective findings → evolution → functional limits → context); always uses 2000-token ceiling with Haiku via the orchestrator |

## Report templates

`selectedTemplate` is either `'brief'` or `'narrative'` (default). This controls which prompt is built in `buildPrompt()`. The narrative template follows the CIF biopsychosocial framework with specific sections the truncation-detection logic checks for.

`buildPrompt()` forces `'brief'` when `getTokens() === 1000` (slider 1 at the lowest step), regardless of the user's template selection. The narrative prompt also injects a `PRESUPUESTO DE EXTENSIÓN` instruction with the word budget from `sliderMeta.words` so Claude self-limits and closes all sections cleanly.

`sliderMeta` has 4 steps (1000/3000/5000/7000 tokens). Its `words` field (400/1200/2000/2750) is the internal word budget injected into the narrative prompt — it uses a lower ~0.4 words/token ratio to leave headroom. The UI displays `Math.round(tokens × 0.7)` instead (Spanish estimate), computed inline in `updateSliderLabel()`.

## Truncation detection

After Claude responds, `detectTruncation(reportText)` checks whether the expected closing section is present (`## SEGUIMIENTO FUNCIONAL` for narrative, `OBJETIVOS Y PLAN` for brief) and whether the text ends on a sentence-final character. If either check fails, an amber warning is shown inline inside `#result-body`. Token limit is user-configurable (1000–7000 tokens via slider 1).

## Cloudflare Workers

The orchestrator worker lives in `workers/` and deploys via `wrangler deploy`. It handles the full pipeline: Turnstile validation → Whisper transcription → (optional) Haiku doc summarization → Sonnet report generation via SSE. If the endpoint changes, update `ORCHESTRATOR_URL` at the top of `app.js`.

⚠ It is no longer a single file — it imports `workers/demo/`, so pasting `physiq-orchestrator.js` into the dashboard editor is not a valid deploy path any more.

Every request to a worker includes a Cloudflare Turnstile token (`cf-turnstile-response` header). The widget is rendered in `always` mode — always visible. `getTurnstileToken()` returns a Promise that resolves once the token is available, refreshing the widget if expired. The widget **replaces the "Generar informe" button** until verified; once verified, the real button appears. Turnstile only runs in real mode: it guards paid work, and demo blocks nothing by design, so verifying there would be a wasted subrequest. `RL_DEMO` covers scripted replay of the demo.

### Demo mode

Without a verifiable license the worker serves fixtures instead of calling paid APIs. Full rationale in README → "Demo mode"; the rules that matter when editing this repo:

- **The mode is decided in `fetch()`**, by `modeFor()` in `workers/physiq-orchestrator.js`, before any handler. Fail-closed: `real` needs no `DEMO_ONLY`, a valid key in the `LICENSES` KV *and* the secrets that route uses.
- **`workers/demo/handlers.js` must never receive `env`.** That is the zero-cost guarantee — no `env` means no API keys to authenticate a paid call with. Do not pass `env` through, and do not import anything into that module other than `fixtures.js`.
- **There is no license gate in `app.js` any more.** A visitor without a key gets demo mode, not a redirect to the hub. `_setDemoMode` only mirrors what the worker announced (`X-PhysiQ-Mode`, or the hub's `PHYSIQ_MODE` postMessage) — never let the client decide the mode.
- The demo report fixture ends with its own "generado en MODO DEMO" note. Keep it there: that is what makes the disclaimer survive into the `.docx`, the PDF and the email without touching each exporter.
- The demo patient must stay in sync with the hub's copilot fixtures (`physiq/worker/demo/fixtures.js`) — same fictional patient, same case.

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

## Pull request format

- PR body: plain description only — no `🤖 Generated with Claude Code` line, no session URLs, no co-authorship footers

---

## Integration: IDB shared session

physiq-report reads the shared IDB session on startup and writes only a limited set of fields (`patient`, `date`, `diagnosis`, `manualRegion`) via `updateSession` — which is a no-op if no session exists. It never calls `writeSession` (which would create a session from scratch). On startup it calls `readSession()` and applies data in this priority order:

```js
readSession().then(session => {
  if (!session) return;
  if (session.assessment) applyPhysiQAssessmentContext(session.assessment);  // complete — green badge
  else if (session.assessmentState && session.assessmentState.maxVisitedIdx > 0)
    _showAssessmentIncompleteBadge(phase);  // in progress — amber badge
  if (session.rom)        applyROMContext(session.rom);
  updateSessionChip(session);
});
```

- `session.assessment` — written by physiq-assessment on `finalizarValoracion()`; pre-fills patient/date/region/diagnosis fields and injects structured clinical context into the Claude prompt via `buildClinicalContext()`. Also calls `setManualRegion()` with the assessment region.
- `session.assessmentState` — continuous draft written by physiq-assessment on every interaction **only when a patient name is set**; used to show the incomplete badge and apply the region even before finalization. Without a patient name, phases still emit `SESSION_ASSESSMENT_PARTIAL` via BroadcastChannel (real-time only, not persisted).
- `session.rom` — written by physiq-motion on every measurement save **only when a patient name is set**; shows `romBadge`, injects ROM summary into the Claude prompt. Without a patient name, `SESSION_ROM` is still broadcast in real time but not written to IDB.

Both payloads persist across page reloads (TTL 24h). URL params (`?v=`, `?rom=`) are kept for backward compatibility.

## Imported context badges

Clinical context badges live inside a collapsible card `#imported-card` (shown at top of `<main>`):

| Badge ID | Color | Trigger | Meaning |
|----------|-------|---------|---------|
| `romBadge` | blue | `applyROMContext()` | ROM data from physiq-motion |
| `assessmentBadge` | green | `showImportedBadge()` | Complete assessment (finalized) |
| `assessmentIncompleteBadge` | amber | `_showAssessmentIncompleteBadge()` | Assessment in progress |
| `forceBadge` | orange | `applyForceContext()` | Force data from physiq-force |
| `jumpBadge` | purple | `applyJumpContext()` | Jump data from physiq-jump |
| `balanceBadge` | cyan | `applyBalanceContext()` | Balance data from physiq-balance |
| `audioBadge` | green | `_applyImportedAudio()` | Audio from hub recorder loaded |

`_syncImportedCard()` updates `#imported-card` visibility and summary text whenever badges change. It is called at the end of every function that adds or removes a badge.

`audioBadge` is inserted via `main.prepend()` outside `#imported-card` — audio is a recording event, not a clinical data import.

**Cleanup rules:**
- `applyROMContext()` removes the old `romBadge` before creating a new one
- `applyForceContext()` removes the old `forceBadge` before creating a new one
- `applyJumpContext()` removes the old `jumpBadge` before creating a new one
- `applyBalanceContext()` removes the old `balanceBadge` before creating a new one
- `showImportedBadge()` removes `assessmentIncompleteBadge` before creating the complete badge
- `_showAssessmentIncompleteBadge()` removes `assessmentBadge` before creating the incomplete badge
- `promptClearSession()` removes all 7 badges, then calls `_syncImportedCard()`

## BroadcastChannel protocol

physiq-report listens on `BroadcastChannel('physiq-session')` for real-time updates:

| Type | Source | Action in report |
|------|--------|-----------------|
| `SESSION_PATIENT` | any satellite | updates session chip patient name |
| `SESSION_ROM` | physiq-motion | calls `applyROMContext(data.rom)` or removes `romBadge` if null |
| `SESSION_ASSESSMENT` | physiq-assessment (`finalizarValoracion`) | calls `applyPhysiQAssessmentContext(data.assessment)` → green badge |
| `SESSION_ASSESSMENT_PARTIAL` | physiq-assessment (every phase) | calls `_showAssessmentIncompleteBadge(data.phase)` + `setManualRegion()` from `data.region` |
| `SESSION_FORCE` | physiq-force | calls `applyForceContext(data.force)` or removes `forceBadge` if null |
| `SESSION_JUMP` | physiq-jump | calls `applyJumpContext(data.jump)` or removes `jumpBadge` if null |
| `SESSION_BALANCE` | physiq-balance | calls `applyBalanceContext(data.balance)` or removes `balanceBadge` if null |
| `SESSION_CLEAR` | any satellite | resets app, removes all badges |

**Ghost-write protection** — `_sessionGen` (integer, incremented on clear) and `_sessionCleared` (boolean, set on clear) prevent stale async writes from recreating a deleted session. The `patient-name` input handler captures the gen before calling `writeSession`; if `_sessionGen !== gen` at resolve time, it calls `clearSession()` to undo the write. `_sessionCleared` blocks new writes from starting until the user types a patient name.

physiq-report writes to IDB only via `writeSession` (patient-name input, creates session if absent) and `updateSession` (diagnosis, manualRegion — no-op if session doesn't exist). `SESSION_PATIENT` BC messages do **not** trigger any IDB write.

## Hub audio handoff

The hub saves the audio blob to IDB `physiq` v3, store `'audio'`, key `'pending'` after stopping recording and emits `{ type: 'RECORDER_STATE', state: 'stopped', hasAudio: true, duration: N }` on `BroadcastChannel('physiq-recorder')`.

physiq-report:
- On BC `stopped` with `hasAudio: true` → `_showRecordingHint(duration)` — hint shows "Usar" / "Reemplazar"
- On BC `idle → recording` → hides the hint
- On confirm: `_consumeAudioFromIDB()` reads and deletes the blob, then calls `_applyImportedAudio()`

## Session chip & clear

Header button `#sessionBtn` (person SVG) shows when a session is active. Clicking → `promptClearSession()` → `showConfirmBanner` → `resetApp()` + clears `window._physiqROMContext` + removes all badges + calls `_syncImportedCard()` + `clearSession()`.

## Dialogs

Use `showConfirmBanner(title, text, actionLabel, callback)` — never use the native `confirm()` or `alert()`.

## Hub integration

physiq-report runs inside an iframe in the PhysiQ hub. On load:

```js
if (window.self !== window.top) {
  document.body.classList.add('in-hub');
  document.querySelector('.logo-main').addEventListener('click', () => {
    window.parent.postMessage({ type: 'PHYSIQ_GO_HOME' }, '*');
  });
}
```

CSS `.in-hub .logo-main` adds a `‹` back-arrow hint. `showConfirmBanner` sends `{ type: 'PHYSIQ_WIDGET_HIDE' }` / `{ type: 'PHYSIQ_WIDGET_SHOW' }` to the parent to hide/show the recorder widget during modals.

---

## Sibling repos

The hub at `physiodevapp.github.io/physiq/` is the primary entry point for the ecosystem.

| Repo | Hub path | Role |
|------|----------|------|
| physiq-assessment | /physiq/assessment/ | 5-phase clinical assessment |
| physiq-motion | /physiq/motion/ | Joint ROM measurement |
