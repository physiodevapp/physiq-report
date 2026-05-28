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

## Sibling repo: physiq-assessment

`physiq-assessment-standalone.html` (separate repo, also GitHub Pages) is an assessment assistant that guides the physiotherapist through 5 phases:

- **Phase 1** — Triage and header (patient, mechanism, red flags)
- **Phase 2** — Systemic screening by anatomical region
- **Phase 3** — SINSS (severity, irritability, NRS)
- **Phase 4** — CIF decision tree → diagnostic hypotheses
- **Phase 4b** — Orthopaedic tests with likelihood ratios
- **Phase 5** — Summary with scores, recommended PROM, and plan notes

All data accumulates in a global `state` object (declared around line 3815 of the HTML).

---

## Integration: PhysiQ-Assessment → PhysiQ-Report

### Mechanism: URL param with Base64

At the end of Phase 5, PhysiQ-Assessment will add a **"Generar informe CIF-AFTA"** button that:

1. Builds a JSON payload with the relevant fields from `state`
2. Encodes it as Base64
3. Opens PhysiQ-Report with `?v=<base64>` in the URL

PhysiQ-Report detects `?v=` on load, decodes it, and:
- Pre-fills form fields (name, date, diagnosis)
- Injects the structured clinical context into the Claude prompt

**Measured payload size:** worst case ~3.2 KB in Base64. nginx GitHub Pages limit: 8 KB. No issue.

### Payload (function `buildPhysiQPayload()` — to add in PhysiQ-Assessment, Phase 5)

```js
function buildPhysiQPayload() {
  return {
    p:  state.patient,                   // always '' until Phase 1 UI input is added
    r:  state.region,
    d:  new Date().toLocaleDateString('es-ES'),
    mo: state.motivoConsulta,
    me: state.mecanismo,                 // 'Traumático' | 'Insidioso' | 'Post-quirúrgico'
    cr: state.cronologia,                // 'Agudo (<6 semanas)' | 'Subagudo' | 'Crónico (>3 meses)'
    rp: state.riesgoPsico,               // 'Bajo' | 'Medio' | 'Alto'
    nr: state.severidad ?? 0,            // NRS general (0–10) — único campo NRS en state
    ir: state.irritabilidadNivel,        // 'Baja' | 'Moderada' | 'Alta'
    na: state.naturaleza,
    si: state.sistemicoAlerta,           // boolean
    br: Object.entries(state.banderasRojas)
          .filter(([, v]) => v === 'SI')
          .map(([k]) => BR_LABELS[k]),   // string[] — labels of positive red flags only
    sq: getSistemicoAffirmativeTexts(),  // string[] — systemic screening questions answered 'SI'
    h:  state.activeHypotheses.map(id => ({
          id,
          name: HYPOTHESES[id]?.name ?? id,
          sc:   state.hypothesisScores[id]?.label ?? 'Sin evaluar',
          lr:   state.hypothesisScores[id]?.totalLR ?? null,
          tr:   state.testResults[id] ?? {}
        })),
    pn: state.planNotes                  // { variableControl, ventanaRecuperacion, anclajeHabito }
  };
}

function exportToPhysiQ() {
  const payload = buildPhysiQPayload();
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  window.open(`https://physiodevapp.github.io/physiq-report/?v=${encoded}`);
}
```

### Reception in PhysiQ-Report (`app.js` — implemented)

```js
function loadFromPhysiQAssessment() {
  const params = new URLSearchParams(location.search);
  const v = params.get('v');
  if (!v) return null;
  try {
    return JSON.parse(decodeURIComponent(escape(atob(v))));
  } catch(e) {
    console.warn('PhysiQ-Assessment payload inválido', e);
    return null;
  }
}

function applyPhysiQAssessmentContext(data) {
  if (!data) return;
  const name = document.getElementById('patient-name');
  if (name && data.p) name.value = data.p;

  const date = document.getElementById('session-date');
  if (date && data.d) date.value = data.d;

  const diag = document.getElementById('diagnosis');
  if (diag && data.r) diag.value = data.r;

  window._physiqAssessmentContext = data;
  showImportedBadge(data);
}

function showImportedBadge(data) {
  const badge = document.createElement('div');
  badge.style.cssText = `
    background:rgba(79,195,161,0.1); border:1px solid rgba(79,195,161,0.3);
    border-radius:8px; padding:10px 14px; font-size:12px;
    color:var(--accent); font-family:'DM Mono',monospace; margin-bottom:12px;
  `;
  badge.innerHTML = `✓ Valoración importada desde PhysiQ-Assessment · ${data.r || ''} · ${data.p || ''}`;
  const main = document.querySelector('main');
  if (main) main.prepend(badge);
}
```

### Clinical context injected into the prompt

`buildClinicalContext` lives in `lib/payload.js` (shared with tests). In `buildPrompt()` in `app.js`:

```js
function buildClinicalContext(data) {
  if (!data) return '';
  const hyps = (data.h || [])
    .map(h => `  · ${h.name} — ${h.sc || 'sin evaluar'}`)
    .join('\n');
  const brText = data.br?.length > 0
    ? data.br.map(s => `  ⚠️ ${s}`).join('\n')
    : '  Negativas';
  const sqText = data.sq?.length > 0
    ? '\nAlertas sistémicas positivas:\n' + data.sq.map(s => `  · ${s}`).join('\n')
    : '';
  return `## DATOS DE VALORACIÓN ESTRUCTURADA (PhysiQ-Assessment)
NOTA: estos datos proceden de una valoración clínica estructurada y son más fiables que la transcripción. Úsalos como fuente prioritaria cuando haya discrepancias.
Paciente: ${data.p || '—'} · Región: ${data.r || '—'} · Fecha: ${data.d || '—'}
Motivo de consulta: ${data.mo || '—'}
Mecanismo: ${data.me || '—'} · Cronología: ${data.cr || '—'}
NRS: ${data.nr ?? '—'}/10
Irritabilidad: ${data.ir || '—'} · Naturaleza: ${data.na || '—'}
Riesgo psicosocial: ${data.rp || '—'}
Banderas rojas:
${brText}
Cribado sistémico: ${data.si ? '⚠️ Positivo' : 'Negativo'}${sqText}

Hipótesis diagnósticas (por peso diagnóstico):
${hyps || '  (sin hipótesis registradas)'}

Notas del plan terapéutico:
  · Variable de control: ${data.pn?.variableControl || '—'}
  · Ventana de recuperación: ${data.pn?.ventanaRecuperacion || '—'}
  · Anclaje de hábito: ${data.pn?.anclajeHabito || '—'}

---`;
}
```

And in `buildPrompt(transcript, info, template)`:

```js
const clinicalCtx = buildClinicalContext(window._physiqAssessmentContext);
const prompt = `${systemPrompt}\n\n${clinicalCtx}\n\n## TRANSCRIPCIÓN DE LA SESIÓN\n${transcript}`;
```

If there is no transcript (assessment-only flow), replace the transcript section with:
```
## TRANSCRIPCIÓN DE LA SESIÓN
(No disponible — informe basado exclusivamente en los datos de la valoración estructurada)
```