// ========= GLOBAL STATE =========
let selectedFile = null, transcriptText = '', logoBase64 = null, logoMime = 'image/png';
let selectedTemplate = 'narrative';
let lastReportText = '';
let lastReportInfo = null;
let manualRegion = null;
let _activeSheet = null;
let _applyingConfig = false;
let attachedDocs = [];         // [{name, text}]
let _docSummaryForPrompt = ''; // resumen listo para inyectar en buildPrompt

// ─── SCROLL LOCK (dialogs / bottom sheets) ───────────────────
// Reference-counted: several overlays (confirm-banner, config sheet,
// processing overlay) can be stacked or opened in sequence. Each must
// release its own lock without unlocking scroll while another overlay
// is still open.
let _scrollLockCount = 0;
function lockBodyScroll() {
  _scrollLockCount++;
  document.body.style.overflow = 'hidden';
}
function unlockBodyScroll() {
  _scrollLockCount = Math.max(0, _scrollLockCount - 1);
  if (_scrollLockCount === 0) document.body.style.overflow = '';
}

// ========= SHEET MANAGEMENT =========
function openConfigSheet(type) {
  if (type === 'patient') { closeActiveSheet(); toggleSessionPanel(); return; }
  if (_activeSheet) {
    document.getElementById(_activeSheet === '_region' ? 'region-sheet' : 'sheet-' + _activeSheet)?.classList.remove('open');
  } else {
    lockBodyScroll();
  }
  _activeSheet = type;
  document.getElementById('sheet-overlay').classList.add('open');
  document.getElementById('sheet-' + type).classList.add('open');
}

function openImportSheet() { openConfigSheet('imported'); }

function closeActiveSheet() {
  if (_activeSheet === '_region') {
    document.getElementById('region-sheet')?.classList.remove('open');
  } else if (_activeSheet) {
    document.getElementById('sheet-' + _activeSheet)?.classList.remove('open');
  }
  if (_activeSheet) unlockBodyScroll();
  _activeSheet = null;
  document.getElementById('sheet-overlay').classList.remove('open');
  _updateConfigBtns();
}

function restoreConfigArea() {
  document.getElementById('step-config').style.display = 'flex';
  document.getElementById('result-section').style.display = 'none';
}

const ORCHESTRATOR_URL = 'https://physiq-orchestrator.edu-gamboa-rodriguez.workers.dev';

// ========= TURNSTILE =========
const TURNSTILE_SITEKEY = '0x4AAAAAADU3dzE5Tw_whVks';
let _turnstileToken = null, _turnstileResolve = null, _turnstileWidgetId = null;
let _emailTurnstileToken = null, _emailTurnstileWidgetId = null;
let _isProcessing = false;

function _openProcessingOverlay() {
  document.getElementById('processing-overlay').classList.add('open');
  lockBodyScroll();
}

function _closeProcessingOverlay() {
  document.getElementById('processing-overlay').classList.remove('open');
  unlockBodyScroll();
}

function _showEmailSendBtn() {
  document.getElementById('cf-turnstile-email-wrap').style.display = 'none';
  const btn = document.getElementById('email-send-btn');
  btn.style.display = '';
  btn.disabled = false;
  btn.innerHTML = 'Enviar';
}

function _showEmailTurnstile() {
  document.getElementById('cf-turnstile-email-wrap').style.display = '';
  document.getElementById('email-send-btn').style.display = 'none';
}

function _showTurnstile() {
  if (_isProcessing) return;
  if (_turnstileToken) { _showGenerateBtn(); return; }
  document.getElementById('turnstile-wrap').style.display = '';
  document.getElementById('generate-btn').style.display = 'none';
}

function _showGenerateBtn() {
  document.getElementById('turnstile-wrap').style.display = 'none';
  document.getElementById('generate-btn').style.display = '';
}

function initTurnstile() {
  _turnstileWidgetId = turnstile.render('#cf-turnstile-container', {
    sitekey: TURNSTILE_SITEKEY,
    appearance: 'always',
    callback: (token) => {
      _turnstileToken = token;
      if (_turnstileResolve) { _turnstileResolve(token); _turnstileResolve = null; }
      else if (!_isProcessing) { _showGenerateBtn(); }
    },
  });
  _emailTurnstileWidgetId = turnstile.render('#cf-turnstile-email-container', {
    sitekey: TURNSTILE_SITEKEY,
    appearance: 'always',
    callback: (token) => {
      _emailTurnstileToken = token;
      _showEmailSendBtn();
    },
  });
}

function getTurnstileToken() {
  return new Promise((resolve, reject) => {
    if (typeof turnstile === 'undefined') {
      reject(new Error('Verificación de seguridad no disponible. Comprueba tu conexión o desactiva el bloqueador de anuncios para physiq-report.'));
      return;
    }
    if (_turnstileToken) {
      const t = _turnstileToken;
      _turnstileToken = null;
      turnstile.reset(_turnstileWidgetId);
      _showTurnstile();
      resolve(t);
      return;
    }
    _turnstileResolve = resolve;
    setTimeout(() => {
      if (_turnstileResolve) {
        _turnstileResolve = null;
        reject(new Error('Tiempo de verificación agotado. Recarga la página e inténtalo de nuevo.'));
      }
    }, 300000);
  });
}

const DEFAULT_INTRO = `El presente informe sintetiza la historia clínica y funcional del paciente {PACIENTE}. Este documento carece de validez pericial o legal, y su objetivo principal es presentar, de manera cronológica y cohesiva, la evolución de su condición de salud, desde la sintomatología inicial hasta su estado actual.

Para proporcionar una visión integral y holística de su situación, la estructura de este documento se basa explícitamente en el marco conceptual de la Clasificación Internacional del Funcionamiento, de la Discapacidad y de la Salud (CIF) de la Organización Mundial de la Salud (OMS).`;

// ========= LOAD DOCX LIBRARY =========
function loadDocx(cb) {
  if (window.docx) { cb(); return; }
  const urls = [
    'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js',
    'https://unpkg.com/docx@8.5.0/build/index.umd.js',
    'https://cdnjs.cloudflare.com/ajax/libs/docx/8.5.0/docx.umd.min.js'
  ];
  let i = 0;
  function tryNext() {
    if (i >= urls.length) { alert('No se pudo cargar la librería Word.'); return; }
    const s = document.createElement('script');
    s.src = urls[i++];
    s.onload = () => { if (window.docx) cb(); else tryNext(); };
    s.onerror = tryNext;
    document.head.appendChild(s);
  }
  tryNext();
}

// ========= MARKDOWN CLEAN =========
function cleanMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^---+$/gm, '')
    .replace(/^\s*[-•]\s+/gm, '• ')
    .trim();
}

// ========= HYPERLINK PARSING =========
// Returns array of segments: [{type:'text', content:'...'} | {type:'link', text:'...', url:'...'}]
// Detects: [text](url) markdown syntax + raw emails + raw URLs (http/https/www)
function parseHyperlinks(text) {
  const segments = [];
  const regex = /(\[([^\]]+)\]\(([^)]+)\))|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})|((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?])/g;
  let lastIndex = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push({type: 'text', content: text.slice(lastIndex, m.index)});
    }
    if (m[1]) {
      let url = m[3].trim();
      if (!url.startsWith('http') && !url.startsWith('mailto:') && url.includes('@')) url = 'mailto:' + url;
      else if (!url.startsWith('http') && !url.startsWith('mailto:')) url = 'https://' + url;
      segments.push({type: 'link', text: m[2], url});
    } else if (m[4]) {
      segments.push({type: 'link', text: m[4], url: 'mailto:' + m[4]});
    } else if (m[5]) {
      let url = m[5];
      if (url.startsWith('www.')) url = 'https://' + url;
      segments.push({type: 'link', text: m[5], url});
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({type: 'text', content: text.slice(lastIndex)});
  }
  return segments;
}

// ========= MARKDOWN TABLE PARSING =========
function parseTablesInText(text) {
  const lines = text.split('\n');
  const blocks = [];
  let buffer = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('|') && i+1 < lines.length && /^\s*\|[\s\-:|]+\|\s*$/.test(lines[i+1])) {
      if (buffer.length) { blocks.push({type:'text', content: buffer.join('\n').trim()}); buffer = []; }
      const tableRows = [];
      tableRows.push(line.split('|').slice(1,-1).map(c => c.trim()));
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableRows.push(lines[i].split('|').slice(1,-1).map(c => c.trim()));
        i++;
      }
      blocks.push({type:'table', rows: tableRows});
    } else {
      buffer.push(line);
      i++;
    }
  }
  if (buffer.length) blocks.push({type:'text', content: buffer.join('\n').trim()});
  return blocks.filter(b => (b.type === 'table' && b.rows.length) || (b.type === 'text' && b.content));
}

// ========= SLIDER =========
const docSummaryMeta = [
  {tokens: 800,  words: 530,  label: 'Breve'},
  {tokens: 1600, words: 1065, label: 'Estándar'},
  {tokens: 2400, words: 1600, label: 'Extenso'},
  {tokens: 3200, words: 2130, label: 'Exhaustivo'},
  {tokens: 4000, words: 2665, label: 'Muy completo'},
  {tokens: 4800, words: 3200, label: 'Ultra completo'},
];

const sliderMeta = [
  {tokens:1000, words:400,  label:'Muy breve',       costNum:0.02},
  {tokens:1600, words:700,  label:'Breve',            costNum:0.03},
  {tokens:2200, words:950,  label:'Estándar',         costNum:0.04},
  {tokens:2800, words:1200, label:'Medio',            costNum:0.05},
  {tokens:3400, words:1450, label:'Detallado',        costNum:0.06},
  {tokens:4000, words:1700, label:'Completo',         costNum:0.07},
  {tokens:4600, words:2000, label:'Exhaustivo',       costNum:0.08},
  {tokens:5200, words:2250, label:'Muy exhaustivo',   costNum:0.09},
  {tokens:5800, words:2500, label:'Máximo',           costNum:0.10},
  {tokens:6400, words:2750, label:'Clínico completo', costNum:0.11},
  {tokens:7000, words:3000, label:'Ultra completo',   costNum:0.12},
];

// cost rate derived from sliderMeta: $0.01 per 600 output tokens
const _COST_PER_TOKEN = 0.01 / 600;

function updateSliderLabel() {
  const val = parseInt(document.getElementById('token-slider').value);
  const meta = sliderMeta.find(m => m.tokens === val) || sliderMeta[5];
  document.getElementById('slider-label').textContent =
    `~${meta.words} palabras · ${meta.label} · coste estimado ~$${meta.costNum.toFixed(2)} por informe`;
  _updateConfigBtns();
  saveConfig(true);
}

function getTokens() { return parseInt(document.getElementById('token-slider').value) || 4000; }

function selectTemplate(t) {
  selectedTemplate = t;
  document.getElementById('tpl-brief').classList.toggle('selected', t === 'brief');
  document.getElementById('tpl-narrative').classList.toggle('selected', t === 'narrative');
  _updateConfigBtns();
  saveConfig(true);
}

function toggleCard(id) {
  const body = document.getElementById('body-'+id), chev = document.getElementById('chevron-'+id);
  const open = body.classList.contains('open');
  if (!open) {
    document.querySelectorAll('.card-body.open').forEach(el => {
      el.classList.remove('open');
      const c = document.getElementById('chevron-' + el.id.replace('body-', ''));
      if (c) c.classList.remove('open');
    });
  }
  body.classList.toggle('open', !open);
  chev.classList.toggle('open', !open);
}

function _syncImportedCard() {
  _updateImportBadges();
}

function _updateImportBadges() {
  const hasROM = !!window._physiqROMContext;
  const hasAssessment = !!window._physiqAssessmentContext || !!document.getElementById('assessmentIncompleteBadge');
  const hasForce = !!window._physiqForceContext;
  const hasJump = !!window._physiqJumpContext;
  const hasBalance = !!window._physiqBalanceContext;
  const hasKinematics = !!window._physiqKinematicsContext;
  const hasQuestionnaire = !!window._physiqQuestionnaireContext;
  const hasAudio = !!document.getElementById('audioBadge');

  const hasDocs = attachedDocs.length > 0;
  const count = [hasROM, hasAssessment, hasForce, hasJump, hasBalance, hasKinematics, hasQuestionnaire, hasAudio, hasDocs].filter(Boolean).length;

  const chip = document.getElementById('importChip');
  const chipText = document.getElementById('importChipText');
  if (chip) {
    chip.classList.toggle('has-data', count > 0);
    chip.style.display = count > 0 ? 'flex' : 'none';
  }
  if (chipText) {
    chipText.textContent = `${count} fuente${count === 1 ? '' : 's'} importada${count === 1 ? '' : 's'}`;
  }
}

function _updateConfigBtns() {
  const g = id => document.getElementById(id)?.value.trim() || '';

  // Paciente: name + date + diagnosis all required
  const patName = g('patient-name'), patDate = g('session-date'), patDiag = g('diagnosis');
  const patOk   = !!(patName && patDate && patDiag);
  const subPat  = document.getElementById('sub-patient');
  if (subPat) { subPat.textContent = patOk ? patName : 'Incompleto'; subPat.classList.toggle('empty', !patOk); }

  // Clínica: name + col + unit + city required; seguimiento URL optional
  const cliOk = !!(g('clinic-name') && g('clinic-col') && g('clinic-unit') && g('clinic-city'));
  const subCli = document.getElementById('sub-clinic');
  if (subCli) { subCli.textContent = cliOk ? g('clinic-name') : 'Sin configurar'; subCli.classList.toggle('empty', !cliOk); }

  // Plantilla
  const subTpl = document.getElementById('sub-template');
  if (subTpl) subTpl.textContent = selectedTemplate === 'brief' ? 'Breve' : 'Narrativa';

  // Opciones
  const val  = parseInt(document.getElementById('token-slider')?.value) || 4000;
  const meta = sliderMeta.find(m => m.tokens === val) || sliderMeta[5];
  const subOpt = document.getElementById('sub-options');
  if (subOpt) subOpt.textContent = meta.label;
  const docTokens = parseInt(document.getElementById('doc-summary-slider')?.value) || 400;
  const subDoc = document.getElementById('sub-options-doc');
  if (subDoc) subDoc.textContent = 'Doc: ' + _docSummaryLabelFor(docTokens);
}

// ========= FILE INPUTS =========
document.getElementById('logo-file').addEventListener('change', function(e) {
  const file = e.target.files[0]; if (!file) return;
  logoMime = file.type || 'image/png';
  document.getElementById('logo-name').textContent = '✓ ' + file.name;
  const reader = new FileReader();
  reader.onload = ev => {
    logoBase64 = ev.target.result.split(',')[1];
    const p = document.getElementById('logo-preview');
    p.src = ev.target.result; p.style.display = 'block';
  };
  reader.readAsDataURL(file);
});

function _setAudioFile(file) {
  selectedFile = file;
  document.getElementById('file-name').textContent = '✓ ' + file.name;
  document.getElementById('audio-clear-btn').style.display = 'flex';
  _hideRecordingHint();
  checkReady();
}

function clearAudio() {
  selectedFile = null;
  document.getElementById('file-name').textContent = '';
  document.getElementById('audio-file').value = '';
  document.getElementById('audio-clear-btn').style.display = 'none';
  checkReady();
}

// ========= DOCUMENT ATTACHMENT =========
let _pdfJsLoaded = false, _mammothLoaded = false;

function _loadPdfJs() {
  if (_pdfJsLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
    s.onload = () => {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      _pdfJsLoaded = true;
      resolve();
    };
    s.onerror = () => reject(new Error('No se pudo cargar PDF.js'));
    document.head.appendChild(s);
  });
}

function _loadMammoth() {
  if (_mammothLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';
    s.onload = () => { _mammothLoaded = true; resolve(); };
    s.onerror = () => reject(new Error('No se pudo cargar mammoth.js'));
    document.head.appendChild(s);
  });
}

async function _extractDocText(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') {
    await _loadPdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n';
    }
    return text.trim();
  } else if (ext === 'docx') {
    await _loadMammoth();
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return result.value.trim();
  }
  throw new Error('Formato no compatible. Usa PDF o Word (.docx).');
}

function _updateDocBadgeInSheet() {
  document.getElementById('docsBadge')?.remove();
  if (!attachedDocs.length) return;
  const badge = document.createElement('div');
  badge.id = 'docsBadge';
  badge.style.cssText = 'background:rgba(56,217,169,0.07);border:1px solid rgba(56,217,169,0.22);border-radius:8px;padding:8px 14px;font-size:12px;color:var(--accent);font-family:\'DM Mono\',monospace;';
  badge.textContent = attachedDocs.length === 1
    ? `📎 ${attachedDocs[0].name}`
    : `📎 ${attachedDocs.length} documentos adjuntos`;
  const body = document.getElementById('body-imported');
  if (body) body.appendChild(badge);
}

function _renderDocChips() {
  const row = document.getElementById('doc-row');
  const btn = document.getElementById('doc-attach-btn');
  if (!row || !btn) return;

  Array.from(row.children).forEach(el => { if (el !== btn) el.remove(); });

  if (attachedDocs.length === 0) {
    btn.classList.remove('has-docs');
    btn.querySelector('.btn-text').textContent = '📎 Adjuntar documento';
    row.insertBefore(btn, row.firstChild);
  } else {
    attachedDocs.forEach((doc, idx) => {
      const chip = document.createElement('span');
      chip.className = 'doc-chip';
      chip.innerHTML = `<span class="doc-chip-name">${doc.name}</span><button class="doc-chip-remove" onclick="removeDoc(${idx})" aria-label="Eliminar">✕</button>`;
      row.insertBefore(chip, btn);
    });
    btn.classList.add('has-docs');
    btn.querySelector('.btn-text').textContent = '+ Añadir';
  }
  _updateDocBadgeInSheet();
  _syncImportedCard();
}

function removeDoc(idx) {
  attachedDocs.splice(idx, 1);
  _docSummaryForPrompt = '';
  _renderDocChips();
  checkReady();
  updateSliderLabel();
}

document.getElementById('doc-file').addEventListener('change', async function(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const errBox = document.getElementById('error-box');
  errBox.style.display = 'none';
  try {
    const text = await _extractDocText(file);
    if (!text) { errBox.textContent = '⚠️ El documento no contiene texto extraíble.'; errBox.style.display = 'block'; setTimeout(() => errBox.style.display = 'none', 4000); return; }
    attachedDocs.push({ name: file.name, text: text.slice(0, 50000) });
    _docSummaryForPrompt = '';
    _renderDocChips();
    checkReady();
    updateSliderLabel();
  } catch(err) {
    errBox.textContent = '⚠️ ' + err.message;
    errBox.style.display = 'block';
    setTimeout(() => errBox.style.display = 'none', 4000);
  }
});

function getDocSummaryTokens() {
  const sl = document.getElementById('doc-summary-slider');
  return sl ? parseInt(sl.value) : 400;
}

function _docSummaryLabelFor(tokens) {
  return (docSummaryMeta.find(m => m.tokens === tokens) || docSummaryMeta[2]).label;
}

function updateDocSummaryLabel() {
  const sl = document.getElementById('doc-summary-slider');
  if (!sl) return;
  const tokens = parseInt(sl.value);
  const meta = docSummaryMeta.find(m => m.tokens === tokens) || docSummaryMeta[2];
  const lbl = document.getElementById('doc-summary-label');
  if (lbl) lbl.textContent = `~${meta.words} palabras por doc · ${meta.label}`;
  const subDoc = document.getElementById('sub-options-doc');
  if (subDoc) subDoc.textContent = 'Doc: ' + meta.label;
  updateSliderLabel();
  saveConfig(true);
}

async function _summarizeAttachedDocs(docsText, maxTokens, token) {
  const prompt = `Eres un asistente clínico. Resume el siguiente documento médico en español, de forma estructurada y clínicamente relevante. El resumen debe ser completo —nunca truncado a mitad de una idea— y ajustarse a un máximo de ${maxTokens} tokens de respuesta. Incluye los hallazgos, diagnósticos, tratamientos y evolución más relevantes. Omite información administrativa irrelevante.

DOCUMENTO:
${docsText}`;

  const fd = new FormData();
  fd.append('prompt', prompt + '\n{{TRANSCRIPT}}');
  fd.append('maxTokens', String(maxTokens));
  fd.append('whisperHint', '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(ORCHESTRATOR_URL, {
      method: 'POST',
      headers: { 'cf-turnstile-response': token },
      body: fd,
      signal: ctrl.signal
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || res.status); }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', summary = '';
    const parseBlock = (block) => {
      let type = '', dataStr = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) type = line.slice(6).trim();
        else if (line.startsWith('data:')) dataStr = line.slice(5).trim();
      }
      if (!dataStr) return false;
      let data;
      try { data = JSON.parse(dataStr); } catch { return false; }
      if (type === 'report_chunk') { summary += data.text ?? ''; }
      else if (type === 'done') { return true; }
      else if (type === 'error') { throw new Error(data.message || 'Error desconocido'); }
      return false;
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) { if (buf.trim()) parseBlock(buf); break; }
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split('\n\n');
      buf = blocks.pop() ?? '';
      for (const block of blocks) { if (parseBlock(block)) return summary; }
    }
    return summary;
  } catch(err) {
    if (err.name === 'AbortError') throw new Error('Tiempo de espera agotado al resumir documentos.');
    throw err;
  } finally { clearTimeout(timer); }
}

document.getElementById('audio-file').addEventListener('change', function(e) {
  if (e.target.files[0]) _setAudioFile(e.target.files[0]);
});
const az = document.getElementById('audio-zone');
az.addEventListener('dragover', e => { e.preventDefault(); az.style.borderColor = 'var(--accent)'; });
az.addEventListener('dragleave', () => az.style.borderColor = '');
az.addEventListener('drop', e => {
  e.preventDefault(); az.style.borderColor = '';
  const f = e.dataTransfer.files[0];
  if (f) _setAudioFile(f);
});
let _reportSyncTimer = null;
function _scheduleReportSync() {
  clearTimeout(_reportSyncTimer);
  _reportSyncTimer = setTimeout(() => {
    const patient    = document.getElementById('patient-name')?.value.trim()  || '';
    const date       = document.getElementById('session-date')?.value.trim()  || '';
    const diagnosis  = document.getElementById('diagnosis')?.value.trim()     || '';
    _sessionCh.postMessage({ type: 'SESSION_REPORT_FIELDS', patient, date, diagnosis, manualRegion: manualRegion || null });
  }, 400);
}

document.getElementById('patient-name').addEventListener('keydown', e => { if (e.key === 'Enter') closeSessionPanel(); });
document.getElementById('patient-name').addEventListener('input', () => {
  checkReady();
  const patient = document.getElementById('patient-name').value.trim();
  const panel = document.getElementById('sessionPanel');
  panel?.classList.toggle('has-session', !!patient);
  _updateSessionPanelTitle();
  if (!patient) return;
  if (_sessionCleared) _sessionCleared = false;
  const date = document.getElementById('session-date').value.trim() || new Date().toLocaleDateString('es-ES');
  const gen = _sessionGen;
  writeSession({ patient, date }).then(session => {
    if (_sessionGen !== gen) { clearSession(); return; }
    if (session) updateSessionChip(session);
    _sessionCh.postMessage({ type: 'SESSION_PATIENT', patient });
    _scheduleReportSync();
  });
});
document.getElementById('session-date').addEventListener('input', () => {
  checkReady();
  _updateSessionPanelTitle();
  const date = document.getElementById('session-date').value.trim();
  if (date) updateSession({ date });
  _scheduleReportSync();
});
document.getElementById('diagnosis').addEventListener('input', () => {
  checkReady();
  updateSession({ diagnosis: document.getElementById('diagnosis').value.trim() });
  _scheduleReportSync();
});

function checkReady() {
  _updateConfigBtns();
  const hasName = !!document.getElementById('patient-name').value.trim();
  const ok = hasName && (selectedFile || attachedDocs.length > 0 || window._physiqAssessmentContext || window._physiqROMContext || window._physiqForceContext || window._physiqJumpContext || window._physiqBalanceContext || window._physiqKinematicsContext || window._physiqQuestionnaireContext);
  document.getElementById('generate-btn').disabled = !ok;
}

function setHstyle(btn) {
  document.querySelectorAll('.hstyle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ========= CONFIG SAVE/LOAD =========
function saveConfig(silent) {
  const cfg = {
    clinicName:  document.getElementById('clinic-name').value,
    clinicCol:   document.getElementById('clinic-col').value,
    clinicUnit:  document.getElementById('clinic-unit').value,
    clinicCity:  document.getElementById('clinic-city').value,
    intro:       document.getElementById('clinic-intro').value,
    rgpd:        document.getElementById('clinic-rgpd').value,
    font:        document.getElementById('style-font').value,
    titleSize:   document.getElementById('style-title-size').value,
    titleColor:  document.getElementById('style-title-color').value,
    titleBold:   document.getElementById('style-title-bold').value,
    titleItalic: document.getElementById('style-title-italic').value,
    bodySize:    document.getElementById('style-body-size').value,
    bodyColor:   document.getElementById('style-body-color').value,
    headerStyle: document.querySelector('.hstyle-btn.active')?.dataset.value || 'line',
    headerColor:    document.getElementById('style-header-color').value,
    seguimientoUrl: document.getElementById('clinic-seguimiento-url').value.trim(),
    reportEmail:    document.getElementById('clinic-report-email').value.trim(),
    tokens:         document.getElementById('token-slider').value,
    docSummaryTokens: document.getElementById('doc-summary-slider')?.value || '400',
    template:       selectedTemplate,
  };
  localStorage.setItem('physiq_config', JSON.stringify(cfg));
  if (logoBase64) { localStorage.setItem('physiq_logo', logoBase64); localStorage.setItem('physiq_logo_mime', logoMime); }
  if (!_applyingConfig) {
    _sessionCh.postMessage({ type: 'CONFIG_SYNC', physiq_config: cfg });
  }
  if (!silent) {
    const ok = document.getElementById('saved-ok');
    ok.style.display = 'block'; setTimeout(() => ok.style.display = 'none', 2500);
  }
}

function loadConfig() {
  const raw = localStorage.getItem('physiq_config');
  const c = raw ? JSON.parse(raw) : {};
  if (c.clinicName)  document.getElementById('clinic-name').value = c.clinicName;
  if (c.clinicCol)   document.getElementById('clinic-col').value  = c.clinicCol;
  if (c.clinicUnit)  document.getElementById('clinic-unit').value = c.clinicUnit;
  if (c.clinicCity)  document.getElementById('clinic-city').value = c.clinicCity;
  document.getElementById('clinic-intro').value = c.intro || DEFAULT_INTRO;
  if (c.rgpd)        document.getElementById('clinic-rgpd').value = c.rgpd;
  if (c.font)        document.getElementById('style-font').value  = c.font;
  if (c.titleSize)   document.getElementById('style-title-size').value  = c.titleSize;
  if (c.titleColor)  document.getElementById('style-title-color').value = c.titleColor;
  if (c.titleBold)   document.getElementById('style-title-bold').value  = c.titleBold;
  if (c.titleItalic) document.getElementById('style-title-italic').value= c.titleItalic;
  if (c.bodySize)    document.getElementById('style-body-size').value   = c.bodySize;
  if (c.bodyColor)   document.getElementById('style-body-color').value  = c.bodyColor;
  if (c.headerStyle) { const b = document.querySelector(`.hstyle-btn[data-value="${c.headerStyle}"]`); if (b) setHstyle(b); }
  if (c.headerColor)    document.getElementById('style-header-color').value    = c.headerColor;
  if (c.seguimientoUrl) document.getElementById('clinic-seguimiento-url').value = c.seguimientoUrl;
  if (c.reportEmail)    document.getElementById('clinic-report-email').value    = c.reportEmail;
  if (c.tokens) { document.getElementById('token-slider').value = c.tokens; }
  if (c.docSummaryTokens) { const sl = document.getElementById('doc-summary-slider'); if (sl) sl.value = c.docSummaryTokens; }
  if (c.template) selectTemplate(c.template);
  updateSliderLabel();
  updateDocSummaryLabel();
  const sl = localStorage.getItem('physiq_logo');
  if (sl) {
    logoBase64 = sl; logoMime = localStorage.getItem('physiq_logo_mime') || 'image/png';
    const p = document.getElementById('logo-preview');
    p.src = 'data:'+logoMime+';base64,'+sl; p.style.display = 'block';
    document.getElementById('logo-name').textContent = '✓ Logo guardado';
  }
}

// ========= CONFIG EXPORT / IMPORT =========
function exportConfig() {
  _applyingConfig = true;
  saveConfig(true); // flush current form state before reading localStorage
  _applyingConfig = false;
  const cfg = localStorage.getItem('physiq_config') || '{}';
  const logo = localStorage.getItem('physiq_logo') || null;
  const logoMimeStored = localStorage.getItem('physiq_logo_mime') || null;
  const bundle = { physiq_config: JSON.parse(cfg), physiq_logo: logo, physiq_logo_mime: logoMimeStored };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'physiq-report_config.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importConfig() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const bundle = JSON.parse(ev.target.result);
        if (bundle.physiq_config) localStorage.setItem('physiq_config', JSON.stringify(bundle.physiq_config));
        if (bundle.physiq_logo) { localStorage.setItem('physiq_logo', bundle.physiq_logo); localStorage.setItem('physiq_logo_mime', bundle.physiq_logo_mime || 'image/png'); }
        loadConfig();
        const ok = document.getElementById('saved-ok');
        ok.textContent = '✓ Configuración importada';
        ok.style.display = 'block';
        setTimeout(() => { ok.style.display = 'none'; ok.textContent = '✓ Configuración guardada'; }, 2500);
      } catch {
        const ok = document.getElementById('saved-ok');
        ok.textContent = '⚠ Archivo no válido';
        ok.style.color = 'var(--danger)';
        ok.style.display = 'block';
        setTimeout(() => { ok.style.display = 'none'; ok.textContent = '✓ Configuración guardada'; ok.style.color = ''; }, 3000);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ========= PROGRESS =========
function setStep(n, s) { document.getElementById('step-'+n).className = 'progress-step '+s; }
function showError(msg) {
  document.getElementById('error-box').textContent = '⚠️ ' + msg;
  document.getElementById('error-box').style.display = 'block';
  _closeProcessingOverlay();
  document.getElementById('generate-btn').disabled = false;
  document.getElementById('generate-btn').innerHTML = 'Generar Informe CIF-APTA';
}

// ========= WHISPER REGION PROMPTS =========
const WHISPER_PROMPTS = {
  hombro:   'Fisioterapia. Hombro. Síndrome subacromial, capsulitis adhesiva, SLAP, rotura manguito rotador, inestabilidad glenohumeral, artropatía acromioclavicular, discinesia escapular, primera costilla. Supraespinoso, infraespinoso, subescapular, redondo menor, labrum glenoideo, bursa subdeltoidea. Test de Neer, Hawkins-Kennedy, lata vacía, lata llena, aprehensión anterior, recolocación, surprise test, external rotation lag sign, drop arm, arco doloroso, aducción cruzada, O\'Brien, Speed, Yergason. SPADI, DASH, ASES. ROM glenohumeral, elevación, rotación interna, rotación externa.',
  cadera:   'Fisioterapia. Cadera. Artrosis, pinzamiento femoroacetabular, SIFA, desgarro labrum acetabular, tendinopatía glútea, síndrome piriforme, síndrome glúteo profundo, tendinopatía proximal isquiotibiales, pinzamiento isquiofemoral, dolor sacroilíaco, debilidad abductores. Trocánter mayor, acetábulo, fosa isquiática, nervio ciático, glúteo medio. FADDIR, FABER, test de Arlington, test de torsión, Trendelenburg, apoyo monopodal, sentadilla monopodal, step-down, compresión pélvica. HOOS, iHOT-12, LEFS.',
  cervical: 'Fisioterapia. Columna cervical. Radiculopatía cervical, mielopatía espondilótica, cefalea cervicogénica, disfunción articular cervical, WAD, latigazo cervical, disfunción postural cérvico-torácica, disfunción primera costilla, costo-vertebral. Nervio occipital mayor, arteria vertebral, disco intervertebral, uncovertebral. Test de Spurling, CFRT, flexión-rotación cervical, CCFT, biofeedback, ULNT1, PAIVM C0-C3, CROM. NDI, cervicalgia, cervicobraquialgia.',
  lumbar:   'Fisioterapia. Columna lumbar. Disfunción segmentaria lumbosacra, inestabilidad espinal lumbar, dolor radicular lumbar, estenosis espinal, claudicación neurogénica. Disco intervertebral, protrusión discal, hernia discal, nervio ciático, raíz nerviosa L4 L5 S1, articulación facetaria, sacroilíaca. SLR, elevación pierna recta, Lasègue, Lasègue cruzado, test de Slump, PAIVM lumbar, Kemp. ODI, Oswestry, RMDQ, Roland-Morris, lumbalgia, lumbociática.',
  rodilla:  'Fisioterapia. Rodilla. Artrosis, síndrome patelofemoral, lesión meniscal, LCA, ligamento cruzado anterior, tendinopatía rotuliana, síndrome banda iliotibial, bursitis pata de ganso. Menisco medial, menisco lateral, cartílago articular, ligamento colateral medial, ligamento colateral lateral, LCP, rótula, tendón rotuliano. Test de Lachman, cajón anterior, pivot shift, McMurray, Thessaly, Ober, Noble, lever sign. KOOS, IKDC, LEFS.',
  codo:     'Fisioterapia. Codo. Epicondilalgia lateral, codo de tenista, epicondilalgia medial, codo de golfista, neuropatía cubital, túnel cubital, síndrome túnel radial, nervio interóseo posterior, rotura distal bíceps, capsulitis codo, inestabilidad rotatoria posterolateral IRPL, ligamento colateral cubital LCC, plica radiocapitelar. Test de Cozen, Thomsen, Tinel cubital, hook test, valgo dinámico, maniobra ordeño. DASH, QuickDASH, PRTEE. Epicóndilo, epitróclea.',
  default:  'Fisioterapia musculoesquelética. Hombro: subacromial, capsulitis, SLAP, manguito rotador, Neer, Hawkins-Kennedy. Cadera: femoroacetabular, labrum, tendinopatía glútea, FADDIR, FABER. Cervical: radiculopatía, mielopatía, WAD, Spurling, ULNT. Lumbar: estenosis espinal, claudicación, SLR, Lasègue, Slump. Rodilla: LCA, menisco, patelofemoral, Lachman, McMurray. Codo: epicondilalgia, túnel cubital, IRPL, Cozen, Tinel.'
};

function getWhisperPrompt(region) {
  if (!region) return WHISPER_PROMPTS.default;
  const r = region.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (r.includes('hombro'))   return WHISPER_PROMPTS.hombro;
  if (r.includes('cadera'))   return WHISPER_PROMPTS.cadera;
  if (r.includes('cervical')) return WHISPER_PROMPTS.cervical;
  if (r.includes('lumbar'))   return WHISPER_PROMPTS.lumbar;
  if (r.includes('rodilla'))  return WHISPER_PROMPTS.rodilla;
  if (r.includes('codo'))     return WHISPER_PROMPTS.codo;
  return WHISPER_PROMPTS.default;
}

function setManualRegion(key, label, silent = false) {
  manualRegion = key || null;
  updateSession({ manualRegion: key || null });
  const triggerText = document.getElementById('region-trigger-text');
  if (triggerText) triggerText.textContent = label;
  document.querySelectorAll('.sheet-option').forEach(opt => {
    const selected = opt.dataset.region === key;
    opt.classList.toggle('selected', selected);
    const check = opt.querySelector('.sheet-option-check');
    if (check) check.textContent = selected ? '✓' : '';
  });
  closeRegionSheet();
  if (!silent) _scheduleReportSync();
}

function openRegionSheet() {
  if (_activeSheet) {
    document.getElementById(_activeSheet === '_region' ? 'region-sheet' : 'sheet-' + _activeSheet)?.classList.remove('open');
  } else {
    lockBodyScroll();
  }
  _activeSheet = '_region';
  document.getElementById('sheet-overlay').classList.add('open');
  document.getElementById('region-sheet').classList.add('open');
}

function closeRegionSheet() { closeActiveSheet(); }

function updateRegionSelector() {
  const el = document.getElementById('region-selector');
  if (el) el.style.display = window._physiqAssessmentContext ? 'none' : 'block';
}

// ========= ORCHESTRATOR (single Cloudflare Worker: Turnstile + Whisper + Claude, SSE) =========
async function callOrchestrator(file, region, info, token, onTranscript) {
  const fd = new FormData();
  if (file) fd.append('file', file);
  fd.append('whisperHint', getWhisperPrompt(region));
  fd.append('prompt', buildPrompt('{{TRANSCRIPT}}', info, selectedTemplate));
  fd.append('maxTokens', String(getTokens()));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 300000);
  try {
    const res = await fetch(ORCHESTRATOR_URL, {
      method: 'POST',
      headers: { 'cf-turnstile-response': token },
      body: fd,
      signal: ctrl.signal
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || res.status); }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', transcript = '', report = '';

    const parseBlock = (block) => {
      let type = '', dataStr = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) type = line.slice(6).trim();
        else if (line.startsWith('data:')) dataStr = line.slice(5).trim();
      }
      if (!dataStr) return false;
      let data;
      try { data = JSON.parse(dataStr); } catch { return false; }
      if (type === 'transcript') { transcript = data.text ?? ''; if (onTranscript) onTranscript(); }
      else if (type === 'report_chunk') { report += data.text ?? ''; }
      else if (type === 'done') { return true; }
      else if (type === 'error') { throw new Error(data.message || 'Error desconocido'); }
      return false;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buf.trim() && parseBlock(buf)) return { transcript, report };
        break;
      }
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split('\n\n');
      buf = blocks.pop() ?? '';
      for (const block of blocks) {
        if (parseBlock(block)) return { transcript, report };
      }
    }

    if (report) return { transcript, report };
    throw new Error('La conexión se cerró inesperadamente. Inténtalo de nuevo.');

  } catch(err) {
    if (err.name === 'AbortError') throw new Error('Tiempo de espera agotado. El informe tardó demasiado en generarse.');
    throw err;
  } finally { clearTimeout(timer); }
}

// ========= PROMPTS =========
// ========= CLINICAL CONTEXT BUILDER =========
// buildClinicalContext() / buildROMContext() / buildForceContext() / buildJumpContext() / buildBalanceContext() / buildKinematicsContext() / buildQuestionnaireContext() live in lib/payload.js

function buildPrompt(transcript, info, template) {
  const clinicalCtx       = buildClinicalContext(window._physiqAssessmentContext);
  const romCtx            = buildROMContext(window._physiqROMContext);
  const forceCtx          = buildForceContext(window._physiqForceContext);
  const jumpCtx           = buildJumpContext(window._physiqJumpContext);
  const balanceCtx        = buildBalanceContext(window._physiqBalanceContext);
  const kinematicsCtx     = buildKinematicsContext(window._physiqKinematicsContext);
  const questionnaireCtx  = buildQuestionnaireContext(window._physiqQuestionnaireContext);
  const hasHypotheses = (window._physiqAssessmentContext?.h || []).length > 0;

  const docCtx = _docSummaryForPrompt ? `DOCUMENTOS ADJUNTOS:\n${_docSummaryForPrompt}\n\n` : '';

  if (template === 'brief') {
    return `Eres un fisioterapeuta clínico experto en documentación CIF-APTA.
Genera un informe clínico breve en español a partir de la transcripción de sesión. El informe debe estar escrito en prosa clínica continua, sin listas de ítems, y no superar las 550 palabras en total.

PACIENTE: ${info.name} | Fecha: ${info.date} | Diagnóstico: ${info.diagnosis}

${clinicalCtx ? clinicalCtx + '\n\n' : ''}${romCtx ? romCtx + '\n\n' : ''}${forceCtx ? forceCtx + '\n\n' : ''}${jumpCtx ? jumpCtx + '\n\n' : ''}${balanceCtx ? balanceCtx + '\n\n' : ''}${kinematicsCtx ? kinematicsCtx + '\n\n' : ''}${questionnaireCtx ? questionnaireCtx + '\n\n' : ''}${docCtx}TRANSCRIPCIÓN:
${transcript}

INSTRUCCIONES:
1. Usa EXACTAMENTE estas tres secciones con prefijo ##:
   ## PRESENTACIÓN CLÍNICA
   ## HALLAZGOS Y CODIFICACIÓN CIF
   ## OBJETIVOS Y PLAN
2. Escribe en prosa continua dentro de cada sección, sin viñetas ni listas.
3. En ## HALLAZGOS Y CODIFICACIÓN CIF incluye los códigos CIF alfanuméricos relevantes entre paréntesis inline, integrados en la prosa. Ejemplo: "Se constata limitación del rango de flexión de hombro (b7101) con dolor asociado al movimiento activo (b28016)."
4. Omite datos que no aparezcan en la transcripción; no escribas "No evaluado".
5. Límite estricto: 550 palabras totales entre las tres secciones.${hasHypotheses ? '\n6. En ## HALLAZGOS Y CODIFICACIÓN CIF añade una frase de contraste con las hipótesis de valoración recibidas: indica si los hallazgos las refuerzan, matizan o contradicen, citando el hallazgo que lo justifica.' : ''}`;
  }

  // NARRATIVE INSTITUTIONAL TEMPLATE
  return `Eres un fisioterapeuta clínico experto en documentación según el modelo CIF de la OMS y el marco APTA. Genera un informe clínico narrativo, formal e institucional en español, siguiendo la estructura exacta indicada.

PACIENTE: ${info.name} | Fecha: ${info.date} | Diagnóstico médico: ${info.diagnosis}

${clinicalCtx ? clinicalCtx + '\n\n' : ''}${romCtx ? romCtx + '\n\n' : ''}${forceCtx ? forceCtx + '\n\n' : ''}${jumpCtx ? jumpCtx + '\n\n' : ''}${balanceCtx ? balanceCtx + '\n\n' : ''}${kinematicsCtx ? kinematicsCtx + '\n\n' : ''}${questionnaireCtx ? questionnaireCtx + '\n\n' : ''}${docCtx}TRANSCRIPCIÓN DE LA SESIÓN:
${transcript}

INSTRUCCIONES CRÍTICAS — LEE Y CUMPLE TODAS:

1. **NO GENERES NINGÚN TÍTULO NI SECCIÓN INICIAL DE IDENTIFICACIÓN**. Específicamente PROHIBIDO:
   - NO escribas "INFORME CLÍNICO DE FISIOTERAPIA" ni similar.
   - NO incluyas un bloque inicial con "Paciente:", "Fecha:", "Sesión número:", "Fisioterapeuta:" o cualquier ficha de identificación.
   - NO repitas el nombre del paciente ni la fecha al inicio.
   - El nombre del paciente, la fecha y los datos identificativos YA aparecen en la cabecera del documento. Repetirlos es un error grave.
   - Tu respuesta DEBE empezar DIRECTAMENTE con "## CONDICIÓN DE SALUD Y FACTORES CONTEXTUALES" sin ningún texto previo.

2. Usa prosa clínica continua y formal, no listas escuetas. Tono de informe profesional para enviar al paciente o equipo médico.
3. NO uses ** para negrita ni símbolos markdown, salvo en tablas markdown estándar.
4. Tablas: cuando haya datos numéricos cuantificables (ROM, fuerza, escalas), genera tablas markdown estándar con sintaxis | columna | columna |. Si no hay datos suficientes, omite la tabla y describe en prosa.
5. Si una subsección no aplica o no hay datos, omítela limpiamente (no escribas "no evaluado" en cada subsección menor).
6. Usa la terminología CIF cuando proceda (códigos b, s, d, e si emergen del contexto).${hasHypotheses ? `
7. En la sección CONCLUSIONES Y PLAN DE TRATAMIENTO incluye la subsección "### Coherencia con hipótesis de valoración". Contrasta los hallazgos de la transcripción con las hipótesis recibidas e indica si los refuerzan, matizan o si existe alguna discrepancia relevante. No propongas hipótesis nuevas en esta subsección.
8. Si en la transcripción aparecen hallazgos clínicos explícitos (tests especiales, signos, síntomas objetivos) que sugieran condiciones no cubiertas por las hipótesis recibidas, inclúyelos en "### Hipótesis adicionales a valorar", citando el hallazgo exacto que justifica cada una. Limita el alcance a la región anatómica del contexto estructurado. Omite esta subsección si no hay evidencia explícita.` : ''}

ESTRUCTURA OBLIGATORIA — empieza DIRECTAMENTE con la primera sección, sin títulos previos:

## CONDICIÓN DE SALUD Y FACTORES CONTEXTUALES
[Párrafo introductorio sobre el enfoque biopsicosocial]

### Condición de Salud (Diagnóstico Médico)
[Diagnósticos preoperatorios, postoperatorios, por imagen si aplica, en formato narrativo o lista breve]

### Factores Personales
[Edad, sexo, profesión, comorbilidades, estilo de vida previo, medicación]

### Factores Ambientales
[Domicilio, apoyo familiar, accesibilidad, ayudas técnicas]

## HISTORIA CLÍNICA Y EVOLUCIÓN

### Presentación Inicial y Antecedentes
[Origen del cuadro, evolución cronológica]

### Intervención Quirúrgica
[Si aplica: fecha, técnica, hallazgos intraoperatorios]

### Tratamientos Adyuvantes
[Si aplica: radioterapia, hormonoterapia, infiltraciones, fisioterapia previa]

## EVALUACIÓN DE FUNCIONES Y ESTRUCTURAS CORPORALES

### Funciones Neuromusculoesqueléticas y Relacionadas con el Movimiento

#### Rango de Movimiento Activo (ROM)
[Describir y, si hay datos numéricos, generar TABLA markdown con columnas: Articulación | Movimiento | Rango (Izq/Dcha) | Asimetría]

#### Fuerza Muscular
[Describir y, si hay datos numéricos, generar TABLA markdown con columnas: Miotomas | Movimiento | Fuerza (Izq/Dcha) | Asimetría]

#### Función Cardiorrespiratoria
[Pruebas ortostáticas, HRV, capacidad aeróbica si aplica]

#### Control Motor
[Análisis de patrones motores, plataformas de fuerza, si aplica]

#### Equilibrio
[Estático, dinámico, oscilación, si aplica]

#### Estabilidad Articular
[Tests de inestabilidad, propiocepción, si aplica]

### Funciones Sensoriales y Dolor
[Evaluación EVA, dolor neuropático, hiperalgesia, escalas]

## ANÁLISIS DEL FUNCIONAMIENTO: LIMITACIONES EN LA ACTIVIDAD Y RESTRICCIONES EN LA PARTICIPACIÓN

### Limitación Funcional Global
[Visión integradora del impacto biopsicosocial]

### Limitaciones en las Actividades
[Pruebas de ejecución: 6MWT, TUG, SCT, Chair Stand, etc. + escalas autorreportadas: EFEI, WOMAC]

### Restricciones en la Participación
[EQ-5D-5L, ICL, impacto laboral y social]

## CONCLUSIONES Y PLAN DE TRATAMIENTO
[Síntesis clínica integradora con problema primario, hallazgos clave y enfoque terapéutico propuesto en prosa]${hasHypotheses ? `

### Coherencia con hipótesis de valoración
[Indica si los hallazgos de la sesión refuerzan, matizan o contradicen las hipótesis recibidas, sin proponer diagnósticos nuevos]

### Hipótesis adicionales a valorar
[Solo si la transcripción contiene hallazgos explícitos que lo justifiquen: lista cada hipótesis adicional citando el hallazgo exacto. Omite si no hay evidencia explícita]` : ''}

## SEGUIMIENTO FUNCIONAL
[Espacio para registrar reevaluaciones futuras. Si no procede en esta sesión, escribir: "Pendiente de reevaluaciones programadas."]

RECORDATORIO FINAL: tu respuesta DEBE empezar literalmente con la cadena "## CONDICIÓN DE SALUD Y FACTORES CONTEXTUALES" como primer texto, sin nada antes.`;
}


// ========= TRUNCATION DETECTION =========
function detectTruncation(reportText) {
  const lastTokenBrief = 'OBJETIVOS Y PLAN';
  const lastTokenNarrative = 'SEGUIMIENTO FUNCIONAL';
  const expected = selectedTemplate === 'brief' ? lastTokenBrief : lastTokenNarrative;
  const hasLastSection = reportText.toUpperCase().includes(expected);
  const trimmed = reportText.trimEnd();
  const lastChar = trimmed[trimmed.length - 1];
  const abruptEnding = !'.!?)»"\'.'.includes(lastChar);
  return !hasLastSection || abruptEnding;
}

// ========= RENDER REPORT =========
function toggleResultBody() {
  const body = document.getElementById('result-body');
  const chev = document.getElementById('chevron-result');
  const collapsed = body.classList.toggle('collapsed');
  chev.classList.toggle('open', !collapsed);
}

function renderReport(reportText, transcript, info) {
  lastReportText = reportText;
  lastReportInfo = info;
  document.getElementById('result-chips').innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap;">
    <span class="badge">👤 ${info.name}</span>
    ${info.date?`<span class="badge">📅 ${info.date}</span>`:''}
    ${info.diagnosis?`<span class="badge">🏥 ${info.diagnosis}</span>`:''}
    <span class="badge">📐 ${selectedTemplate === 'brief' ? 'Breve' : 'Narrativo'}</span>
  </div>`;
  let html = '';

  if (detectTruncation(reportText)) {
    html += `<div style="background:rgba(255,193,7,0.1);border:1px solid #ffc107;border-radius:8px;padding:12px;margin-bottom:14px;display:flex;gap:10px;align-items:flex-start;">
      <span style="font-size:18px;flex-shrink:0;">⚠️</span>
      <div>
        <div style="font-weight:500;color:#ffc107;font-size:13px;margin-bottom:3px;">El informe parece incompleto</div>
        <div style="font-size:12px;color:var(--text-muted);line-height:1.5;">La última sección no se ha generado correctamente. Sube la longitud del informe en el selector de arriba y vuelve a generar.</div>
      </div>
    </div>`;
  }

  const sections = reportText.split(/^## /m).filter(s => s.trim());
  sections.forEach(section => {
    const lines = section.trim().split('\n');
    const title = lines[0].replace(/^#+\s*/,'').trim();
    const rawContent = lines.slice(1).join('\n').trim();

    html += `<div class="cif-section"><div class="cif-section-title">${title}</div><div class="cif-content">`;

    const blocks = rawContent.split(/^### /m);
    blocks.forEach((block, idx) => {
      if (idx === 0) {
        if (block.trim()) html += renderBlock(block);
      } else {
        const subLines = block.split('\n');
        const subTitle = subLines[0].trim();
        const subContent = subLines.slice(1).join('\n').trim();
        html += `<div style="margin-top:12px;font-family:'DM Mono',monospace;font-size:11px;color:var(--accent);text-transform:uppercase;letter-spacing:1px;">${subTitle}</div>`;

        const subBlocks = subContent.split(/^#### /m);
        subBlocks.forEach((sb, si) => {
          if (si === 0) {
            if (sb.trim()) html += renderBlock(sb);
          } else {
            const ssLines = sb.split('\n');
            const ssTitle = ssLines[0].trim();
            const ssContent = ssLines.slice(1).join('\n').trim();
            html += `<div style="margin-top:8px;font-weight:500;font-size:12px;color:var(--text);">${ssTitle}</div>`;
            if (ssContent) html += renderBlock(ssContent);
          }
        });
      }
    });

    html += `</div></div>`;
  });

  if (transcript && !transcript.startsWith('(No disponible')) {
    html += `<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px;">
      <button class="toggle-transcript" onclick="toggleTranscript()">▶ Ver transcripción original</button>
      <div class="raw-transcript" id="raw-transcript">${transcript}</div>
    </div>`;
  }
  document.getElementById('result-body').innerHTML = html;

  const cfg = JSON.parse(localStorage.getItem('physiq_config') || '{}');
  const btn = document.getElementById('btn-seguimiento');
  if (btn) btn.style.display = cfg.seguimientoUrl ? 'inline-flex' : 'none';
}

function openSeguimiento() {
  const cfg = JSON.parse(localStorage.getItem('physiq_config') || '{}');
  if (!cfg.seguimientoUrl) return;
  window.open(cfg.seguimientoUrl, '_blank', 'noopener');
}

function renderBlock(text) {
  const blocks = parseTablesInText(text);
  let out = '';
  blocks.forEach(b => {
    if (b.type === 'text') {
      out += `<div style="margin-top:6px;">${cleanMarkdown(b.content)}</div>`;
    } else {
      out += '<table>';
      b.rows.forEach((row, i) => {
        const tag = i === 0 ? 'th' : 'td';
        out += '<tr>' + row.map(c => `<${tag}>${cleanMarkdown(c)}</${tag}>`).join('') + '</tr>';
      });
      out += '</table>';
    }
  });
  return out;
}

function toggleTranscript() {
  const el = document.getElementById('raw-transcript');
  const btn = document.querySelector('.toggle-transcript');
  const open = el.style.display === 'block';
  el.style.display = open ? 'none' : 'block';
  btn.textContent = open ? '▶ Ver transcripción original' : '▼ Ocultar transcripción';
}

// ========= GENERATE =========
async function generateReport() {
  const info = {
    name:      document.getElementById('patient-name').value.trim(),
    date:      document.getElementById('session-date').value.trim() || new Date().toLocaleDateString('es-ES'),
    diagnosis: document.getElementById('diagnosis').value.trim()
  };
  document.getElementById('error-box').style.display = 'none';
  document.getElementById('result-section').style.display = 'none';
  document.getElementById('generate-btn').disabled = true;
  document.getElementById('generate-btn').innerHTML = '<div class="spinner"></div> Verificando...';
  [1,2,3].forEach(i => setStep(i,''));
  const step1El = document.getElementById('step-1');
  _isProcessing = true;
  try {
    const hasDocs = attachedDocs.length > 0;
    const hasAudio = !!selectedFile;

    // Embed doc text directly into the prompt (synchronous — no separate API call)
    if (hasDocs && !_docSummaryForPrompt) {
      const perDocLimit = Math.max(500, Math.floor(getDocSummaryTokens() * 4 / attachedDocs.length));
      _docSummaryForPrompt = attachedDocs
        .map((d, i) => `--- Documento ${i + 1}: ${d.name} ---\n${d.text.slice(0, perDocLimit)}`)
        .join('\n\n');
    }

    // Show only the steps that will actually run
    if (step1El) step1El.style.display = hasAudio ? '' : 'none';

    const token1 = await getTurnstileToken();
    _openProcessingOverlay();

    const region = window._physiqAssessmentContext?.r ?? manualRegion;

    if (hasAudio) { setStep(1,'active'); }
    else { setStep(2,'active'); }

    const result = await callOrchestrator(
      selectedFile, region, info, token1,
      hasAudio ? () => { setStep(1,'done'); setStep(2,'active'); } : null
    );

    transcriptText = result.transcript;
    setStep(2,'done'); setStep(3,'active');
    await new Promise(r => setTimeout(r, 350));
    setStep(3,'done');
    document.getElementById('result-section').style.display = 'block';
    document.getElementById('step-config').style.display = 'none';
    renderReport(result.report, transcriptText, info);

    document.getElementById('generate-btn').innerHTML = '✓ Informe generado';
  } catch(err) { console.error('[PhysiQ] generateReport error:', err); showError(err.message); }
  finally { _isProcessing = false; _closeProcessingOverlay(); _showTurnstile(); if (step1El) step1El.style.display = ''; }
}

// ========= DOWNLOAD WORD =========
function downloadWord() { loadDocx(_buildAndDownloadWord); }

async function _buildWordBlob() {
  const {Document, Packer, Paragraph, TextRun, ImageRun, Header, Footer,
         Table, TableRow, TableCell, AlignmentType, BorderStyle,
         TabStopType, PageNumber, PageBreak, WidthType, ShadingType, HeightRule, VerticalAlign,
         ExternalHyperlink} = docx;

  const c = JSON.parse(localStorage.getItem('physiq_config')||'{}');
  const font        = c.font        || 'Calibri';
  const titleSize   = parseInt(c.titleSize   || '28');
  const titleColor  = (c.titleColor  || '#2b579a').replace('#','');
  const titleBold   = c.titleBold   !== 'false';
  const titleItalic = c.titleItalic === 'true';
  const bodySize    = parseInt(c.bodySize    || '22');
  const bodyColor   = (c.bodyColor   || '#222222').replace('#','');
  const headerStyle = c.headerStyle  || 'line';
  const headerColor = (c.headerColor || '#38d9a9').replace('#','');
  const clinicName  = c.clinicName  || '';
  const clinicCol   = c.clinicCol   || '';
  const clinicUnit  = c.clinicUnit  || '';
  const clinicCity  = c.clinicCity  || '';
  const intro       = c.intro       || DEFAULT_INTRO;
  const rgpd        = c.rgpd        || '';

  const savedLogo = localStorage.getItem('physiq_logo');
  const savedMime = (localStorage.getItem('physiq_logo_mime')||'image/png').split('/')[1]||'png';

  const patientName = document.getElementById('patient-name').value.trim();
  const sessionDate = document.getElementById('session-date').value.trim() || new Date().toLocaleDateString('es-ES');
  const diagnosis = document.getElementById('diagnosis').value.trim();

  // ── HEADER: 2-col table — logo (left) | unit + patient (right) ──
  const headerLeftCell = new TableCell({
    width: {size: 3500, type: WidthType.DXA},
    borders: {
      top:    {style: BorderStyle.NONE},
      bottom: {style: BorderStyle.NONE},
      left:   {style: BorderStyle.NONE},
      right:  {style: BorderStyle.NONE},
    },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      children: savedLogo
        ? [new ImageRun({data: Uint8Array.from(atob(savedLogo), ch => ch.charCodeAt(0)), transformation:{width:110,height:38}, type:savedMime})]
        : [new TextRun({text:'', size:18, font})]
    })]
  });

  const _rightLines = [];
  if (clinicUnit) _rightLines.push(new Paragraph({
    alignment: AlignmentType.RIGHT, spacing:{after:30},
    children:[new TextRun({text: clinicUnit, bold:true, size:22, font, color:titleColor})]
  }));
  _rightLines.push(new Paragraph({
    alignment: AlignmentType.RIGHT, spacing:{after:30},
    children:[new TextRun({text: 'Paciente: ' + patientName, size:20, font, color:titleColor})]
  }));
  const _physioLine = [clinicName.trim() || null, clinicCol ? `N. col. ${clinicCol}` : null].filter(Boolean).join(' | ');
  if (_physioLine) _rightLines.push(new Paragraph({
    alignment: AlignmentType.RIGHT, spacing:{after:30},
    children:[new TextRun({text: _physioLine, size:18, font, color:'ADADAD'})]
  }));
  if (clinicCity || sessionDate) _rightLines.push(new Paragraph({
    alignment: AlignmentType.RIGHT, spacing:{after:0},
    children:[new TextRun({text: [clinicCity, sessionDate ? `a ${sessionDate}` : null].filter(Boolean).join(', '), size:18, font, color:'ADADAD'})]
  }));

  const headerRightCell = new TableCell({
    width: {size: 5886, type: WidthType.DXA},
    borders: {
      top:    {style: BorderStyle.NONE},
      bottom: {style: BorderStyle.NONE},
      left:   {style: BorderStyle.NONE},
      right:  {style: BorderStyle.NONE},
    },
    verticalAlign: VerticalAlign.CENTER,
    children: _rightLines
  });

  const headerTable = new Table({
    width: {size: 9386, type: WidthType.DXA},
    columnWidths: [3500, 5886],
    borders: {
      top:    {style: BorderStyle.NONE},
      bottom: {style: BorderStyle.NONE},
      left:   {style: BorderStyle.NONE},
      right:  {style: BorderStyle.NONE},
      insideHorizontal: {style: BorderStyle.NONE},
      insideVertical:   {style: BorderStyle.NONE},
    },
    rows: [new TableRow({children: [headerLeftCell, headerRightCell]})]
  });

  // ── FOOTER: only "Pág. X/Y" right aligned ──
  const footerParagraph = new Paragraph({
    alignment: AlignmentType.RIGHT,
    children: [
      new TextRun({text:'Pág. ', size:18, font, color:'808080'}),
      new TextRun({children:[PageNumber.CURRENT], size:18, font, color:'808080'}),
      new TextRun({text:'/', size:18, font, color:'808080'}),
      new TextRun({children:[PageNumber.TOTAL_PAGES], size:18, font, color:'808080'}),
    ],
  });

  // ── CONTENT ──
  const children = [];

  children.push(new Paragraph({
    children: [new TextRun({text:'Informe de Fisioterapia', bold:titleBold, italics:titleItalic, size: titleSize + 8, font, color:titleColor})],
    spacing: {before:0, after:140},
    border: {bottom:{style:BorderStyle.SINGLE, size:4, color:headerColor, space:1}}
  }));

  const finalIntro = intro.replace(/\{PACIENTE\}/g, patientName);
  finalIntro.split('\n').filter(l => l.trim()).forEach(line => {
    const runs = buildRunsFromLine(line.trim(), {size:bodySize, font, color:bodyColor}, {TextRun, ExternalHyperlink});
    children.push(new Paragraph({
      children: runs,
      spacing:{after:120, line:276, lineRule:'auto'},
      alignment: AlignmentType.JUSTIFIED,
    }));
  });

  // ── SECTIONS (parse ##, ###, ####, tables) ──
  const sections = lastReportText.split(/^## /m).filter(s => s.trim());
  sections.forEach(section => {
    const lines = section.trim().split('\n');
    const title = lines[0].replace(/^#+\s*/,'').trim();
    const rawContent = lines.slice(1).join('\n').trim();

    children.push(new Paragraph({
      children:[new TextRun({text:title, bold:titleBold, italics:titleItalic, size:titleSize, font, color:titleColor})],
      spacing:{before:280,after:80},
      border:{bottom:{style:BorderStyle.SINGLE,size:4,color:headerColor,space:1}}
    }));

    const blocks = rawContent.split(/^### /m);
    blocks.forEach((block, idx) => {
      if (idx === 0) {
        if (block.trim()) appendContentToWord(children, block, {font, bodySize, bodyColor, titleColor, BorderStyle, AlignmentType, Paragraph, TextRun, ExternalHyperlink, Table, TableRow, TableCell, WidthType, ShadingType});
      } else {
        const subLines = block.split('\n');
        const subTitle = subLines[0].trim();
        const subContent = subLines.slice(1).join('\n').trim();

        children.push(new Paragraph({
          children:[new TextRun({text: subTitle, bold:true, size:Math.max(titleSize-4,22), font, color:titleColor})],
          spacing:{before:180,after:60}
        }));

        const subBlocks = subContent.split(/^#### /m);
        subBlocks.forEach((sb, si) => {
          if (si === 0) {
            if (sb.trim()) appendContentToWord(children, sb, {font, bodySize, bodyColor, titleColor, BorderStyle, AlignmentType, Paragraph, TextRun, ExternalHyperlink, Table, TableRow, TableCell, WidthType, ShadingType});
          } else {
            const ssLines = sb.split('\n');
            const ssTitle = ssLines[0].trim();
            const ssContent = ssLines.slice(1).join('\n').trim();
            children.push(new Paragraph({
              children:[new TextRun({text: ssTitle, bold:true, italics:true, size:bodySize, font, color:bodyColor})],
              spacing:{before:120,after:40}
            }));
            if (ssContent) appendContentToWord(children, ssContent, {font, bodySize, bodyColor, titleColor, BorderStyle, AlignmentType, Paragraph, TextRun, ExternalHyperlink, Table, TableRow, TableCell, WidthType, ShadingType});
          }
        });
      }
    });
  });

  // ── RGPD: flows naturally after last section, no forced page break ──
  if (rgpd.trim()) {
    const rgpdSize = Math.max(bodySize - 4, 16);
    rgpd.trim().split('\n').filter(l => l.trim()).forEach((line, i) => {
      const runs = buildRunsFromLine(line.trim(), {size:rgpdSize, font, color:'ADADAD', italics:true}, {TextRun, ExternalHyperlink});
      children.push(new Paragraph({
        children: runs,
        spacing:{before: i === 0 ? 400 : 0, after:80, line:276, lineRule:'auto'},
        alignment: AlignmentType.JUSTIFIED,
      }));
    });
  }

  const doc = new Document({
    sections:[{
      properties:{page:{size:{width:11906,height:16838},margin:{top:1260,right:1260,bottom:1260,left:1260}}},
      headers:{default:new Header({children:[headerTable, new Paragraph({spacing:{after:0}, children:[new TextRun({text:'',size:8})]})]})},
      footers:{default:new Footer({children:[footerParagraph]})},
      children
    }]
  });

  const blob = await Packer.toBlob(doc);
  const filename = `PhysiQ_${patientName.replace(/\s+/g,'_')}_${sessionDate.replace(/\//g,'-')}.docx`;
  return { blob, filename, patientName };
}

async function _buildAndDownloadWord() {
  const { blob, filename } = await _buildWordBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}


// Build TextRun array (and ExternalHyperlink) from a line that may contain links
function buildRunsFromLine(line, runStyle, ctxDocx) {
  const {TextRun, ExternalHyperlink} = ctxDocx;
  const segments = parseHyperlinks(line);
  if (segments.length === 1 && segments[0].type === 'text') {
    return [new TextRun({text: line, ...runStyle})];
  }
  const out = [];
  segments.forEach(seg => {
    if (seg.type === 'text') {
      if (seg.content) out.push(new TextRun({text: seg.content, ...runStyle}));
    } else {
      out.push(new ExternalHyperlink({
        link: seg.url,
        children: [new TextRun({text: seg.text, ...runStyle, color: '0563C1', underline: {type: 'single'}})]
      }));
    }
  });
  return out;
}

function appendContentToWord(children, text, ctx) {
  const {font, bodySize, bodyColor, BorderStyle, AlignmentType, Paragraph, TextRun, ExternalHyperlink, Table, TableRow, TableCell, WidthType, ShadingType} = ctx;
  const blocks = parseTablesInText(text);
  blocks.forEach(b => {
    if (b.type === 'text') {
      const cleaned = cleanMarkdown(b.content);
      cleaned.split('\n').filter(l => l.trim()).forEach(line => {
        const runs = buildRunsFromLine(line.trim(), {size:bodySize, font, color:bodyColor}, {TextRun, ExternalHyperlink});
        children.push(new Paragraph({
          children: runs,
          spacing:{after:80, line:276, lineRule:'auto'},
          alignment: AlignmentType.JUSTIFIED,
        }));
      });
    } else if (b.type === 'table') {
      const numCols = b.rows[0].length;
      const colWidth = Math.floor(9000 / numCols);
      const tableRows = b.rows.map((row, i) => {
        return new TableRow({
          children: row.map(cell => new TableCell({
            width: {size: colWidth, type: WidthType.DXA},
            shading: i === 0 ? {fill: 'E8EEF5', type: ShadingType.CLEAR, color:'auto'} : undefined,
            margins: {top: 80, bottom: 80, left: 120, right: 120},
            borders: {
              top: {style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC'},
              bottom: {style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC'},
              left: {style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC'},
              right: {style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC'},
            },
            children: [new Paragraph({
              children: [new TextRun({text: cleanMarkdown(cell), size: Math.max(bodySize-2,18), font, bold: i === 0, color: bodyColor})]
            })]
          }))
        });
      });
      children.push(new Table({
        width: {size: 9000, type: WidthType.DXA},
        columnWidths: Array(numCols).fill(colWidth),
        rows: tableRows
      }));
      children.push(new Paragraph({spacing:{after:80}}));
    }
  });
}

// ========= COPY / RESET =========
function copyReport() {
  let text = 'INFORME CIF-APTA — PhysiQ\n'+'='.repeat(40)+'\n\n';
  document.querySelectorAll('.cif-section').forEach(s => {
    text += '## '+s.querySelector('.cif-section-title').textContent+'\n'+s.querySelector('.cif-content').textContent+'\n\n';
  });
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.result-actions .btn-secondary');
    const label = btn.querySelector('.btn-label');
    if (label) { label.textContent = ' Copiado'; setTimeout(() => label.textContent = ' Copiar', 2000); }
    else { btn.textContent = '✓ Copiado'; setTimeout(() => btn.textContent = 'Copiar', 2000); }
  });
}

function resetApp() {
  selectedFile = null; transcriptText = ''; lastReportText = '';
  attachedDocs = []; _docSummaryForPrompt = '';
  _hideRecordingHint();
  document.getElementById('file-name').textContent = '';
  document.getElementById('audio-file').value = '';
  document.getElementById('audio-clear-btn').style.display = 'none';
  _renderDocChips();
  ['patient-name','session-date','diagnosis'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('result-section').style.display = 'none';
  document.getElementById('step-config').style.display = 'flex';
  _closeProcessingOverlay();
  document.getElementById('error-box').style.display = 'none';
  document.getElementById('generate-btn').disabled = true;
  document.getElementById('generate-btn').innerHTML = 'Generar Informe CIF-APTA';
  [1,2,3].forEach(i=>setStep(i,''));
}

// ========= PHYSIQ-ASSESSMENT INTEGRATION =========
// decodePayload() lives in lib/payload.js (loaded via <script> in index.html)
function loadFromPhysiQAssessment() {
  const params = new URLSearchParams(location.search);
  const v = params.get('v');
  if (!v) return null;
  try {
    return decodePayload(v);
  } catch(e) {
    console.warn('PhysiQ-Assessment payload inválido', e);
    return null;
  }
}

function applyROMContext(romData) {
  if (!romData) return;
  document.getElementById('romBadge')?.remove();
  window._physiqROMContext = romData;

  function _abbr(label) {
    const lc = label.toLowerCase();
    const map = [
      ['rotación interna', 'RI'], ['rotación externa', 'RE'],
      ['rotación izquierda', 'Rot Izq'], ['rotación derecha', 'Rot Der'],
      ['inclinación lateral izquierda', 'Incl Izq'], ['inclinación lateral derecha', 'Incl Der'],
      ['inclinación lateral', 'Incl'], ['inclinación', 'Incl'],
      ['flexión plantar', 'FP'], ['dorsiflexión', 'Dors'],
      ['flexión', 'Flex'], ['extensión', 'Ext'],
      ['abducción horizontal', 'Abd H'], ['abducción', 'Abd'],
      ['aducción', 'Adu'], ['inversión', 'Inv'], ['eversión', 'Ev'],
      ['rotación', 'Rot'],
    ];
    const match = map.find(([k]) => lc.startsWith(k));
    return match ? match[1] : label.slice(0, 4);
  }

  let regions;
  if (romData.regions) {
    regions = Object.values(romData.regions).filter(r => r.rom && Object.keys(r.rom).length);
  } else if (romData.rom && Object.keys(romData.rom).length) {
    const lbl = romData.region ? romData.region.charAt(0).toUpperCase() + romData.region.slice(1) : 'ROM';
    regions = [{ label: lbl, rom: romData.rom }];
  } else {
    return;
  }
  if (!regions.length) return;

  if (!document.getElementById('kinem-carousel-style')) {
    const _ks = document.createElement('style');
    _ks.id = 'kinem-carousel-style';
    _ks.textContent = '.kinem-scroll{display:flex;overflow-x:auto;gap:10px;scroll-snap-type:x mandatory;margin-top:8px;padding-bottom:4px;-webkit-overflow-scrolling:touch}.kinem-scroll::-webkit-scrollbar{height:3px}.kinem-scroll::-webkit-scrollbar-thumb{background:rgba(93,173,236,0.3);border-radius:3px}.kinem-scroll::-webkit-scrollbar-track{background:transparent}.kinem-item{flex:0 0 100%;scroll-snap-align:start;min-width:0}@media(min-width:600px){.kinem-scroll.kinem-multi .kinem-item{flex:0 0 calc(50% - 5px)}}@media(min-width:900px){.kinem-scroll.kinem-multi .kinem-item{flex:0 0 calc(33.33% - 7px)}}';
    document.head.appendChild(_ks);
  }

  const countLabel = regions.length === 1
    ? `${Object.keys(regions[0].rom).length} mov.`
    : `${regions.length} regiones`;

  const sections = `<div class="kinem-scroll${regions.length > 1 ? ' kinem-multi' : ''}">` +
    regions.map(r => {
      const movs = Object.values(r.rom);
      const abbrevHtml = movs.map(m =>
        m.deficit
          ? `<span style="color:#f87171">${_abbr(m.label)}</span>`
          : `<span>${_abbr(m.label)}</span>`
      ).join('<span style="color:#8fa0bf"> · </span>');
      return `<div class="kinem-item" style="border:1px solid rgba(192,132,252,0.2);border-radius:6px;padding:6px 8px">` +
        `<div style="font-size:11px;color:#c084fc;margin-bottom:3px">${r.label}</div>` +
        `<div style="color:#8fa0bf;font-size:11px;line-height:1.6">${abbrevHtml}</div>` +
        `</div>`;
    }).join('') +
    '</div>';

  const badge = document.createElement('div');
  badge.id = 'romBadge';
  badge.style.cssText = `
    background:rgba(192,132,252,0.08); border:1px solid rgba(192,132,252,0.25);
    border-radius:8px; padding:10px 14px; font-size:12px;
    color:#c084fc; font-family:'DM Mono',monospace;
  `;
  badge.innerHTML = `✓ Movilidad importada desde PhysiQ-Motion · ${countLabel}` + sections;
  const body = document.getElementById('body-imported');
  if (body) body.prepend(badge);
  _syncImportedCard();
  checkReady();
}

function applyForceContext(forceData) {
  if (!forceData) return;
  document.getElementById('forceBadge')?.remove();

  const measurements = Array.isArray(forceData) ? forceData : [forceData];
  if (!measurements.length) return;

  window._physiqForceContext = forceData;

  const lines = measurements.map(m => {
    const label = m.label ?? (m.testType === 'peak' ? 'MVC' : m.testType?.toUpperCase() ?? 'Fuerza');
    if (m.laterality === 'comparison') {
      const l  = m.sides?.left?.peak;
      const r  = m.sides?.right?.peak;
      const ai = m.asymmetryIndex ?? (l != null && r != null ? (() => { const avg = (l + r) / 2; return avg ? Math.abs(l - r) / avg * 100 : null; })() : null);
      return [
        label,
        l  != null ? `Izq ${l.toFixed(1)} kg`  : null,
        r  != null ? `Der ${r.toFixed(1)} kg`   : null,
        ai != null ? `AI ${ai.toFixed(1)}%`     : null,
      ].filter(Boolean).join(' · ');
    }
    const peak = m.peak;
    const side = m.side === 'left' ? ' · Izq' : m.side === 'right' ? ' · Der' : '';
    return `${label}${side}${peak != null ? ' · ' + peak.toFixed(1) + ' kg' : ''}`;
  });

  const countLabel = measurements.length === 1 ? '1 medición' : `${measurements.length} mediciones`;
  const badge = document.createElement('div');
  badge.id = 'forceBadge';
  badge.style.cssText = `
    background:rgba(251,146,60,0.08); border:1px solid rgba(251,146,60,0.25);
    border-radius:8px; padding:10px 14px; font-size:12px;
    color:#fb923c; font-family:'DM Mono',monospace; line-height:1.7;
  `;
  if (!document.getElementById('kinem-carousel-style')) {
    const _ks = document.createElement('style');
    _ks.id = 'kinem-carousel-style';
    _ks.textContent = '.kinem-scroll{display:flex;overflow-x:auto;gap:10px;scroll-snap-type:x mandatory;margin-top:8px;padding-bottom:4px;-webkit-overflow-scrolling:touch}.kinem-scroll::-webkit-scrollbar{height:3px}.kinem-scroll::-webkit-scrollbar-thumb{background:rgba(93,173,236,0.3);border-radius:3px}.kinem-scroll::-webkit-scrollbar-track{background:transparent}.kinem-item{flex:0 0 100%;scroll-snap-align:start;min-width:0}@media(min-width:600px){.kinem-scroll.kinem-multi .kinem-item{flex:0 0 calc(50% - 5px)}}@media(min-width:900px){.kinem-scroll.kinem-multi .kinem-item{flex:0 0 calc(33.33% - 7px)}}';
    document.head.appendChild(_ks);
  }
  badge.innerHTML = `✓ Fuerza importada desde PhysiQ-Force · ${countLabel}` +
    `<div class="kinem-scroll${measurements.length > 1 ? ' kinem-multi' : ''}">` +
    lines.map(l => `<div class="kinem-item" style="border:1px solid rgba(251,146,60,0.2);border-radius:6px;padding:6px 8px"><span style="color:#8fa0bf;font-size:11px;line-height:1.6">${l}</span></div>`).join('') +
    '</div>';
  const body = document.getElementById('body-imported');
  if (body) body.appendChild(badge);
  _syncImportedCard();
  checkReady();
}

function applyJumpContext(jumpData) {
  if (!jumpData) return;
  document.getElementById('jumpBadge')?.remove();

  const measurements = Array.isArray(jumpData) ? jumpData : [jumpData];
  if (!measurements.length) return;

  window._physiqJumpContext = jumpData;

  const lines = measurements.map(m => {
    const label = m.label ?? m.testType ?? 'Salto';
    if (m.laterality === 'comparison' && m.sides) {
      const l = m.sides.left?.height;
      const r = m.sides.right?.height;
      const ai = (l != null && r != null && (l + r) > 0)
        ? Math.abs(l - r) / ((l + r) / 2) * 100
        : null;
      const vals = [
        l  != null ? `Izq ${l.toFixed(1)} cm`  : null,
        r  != null ? `Der ${r.toFixed(1)} cm`   : null,
        ai != null ? `AI ${ai.toFixed(1)}%`     : null,
      ].filter(Boolean).join(' · ');
      return `${label}: ${vals}`;
    }
    const parts = [];
    if (m.height     != null) parts.push(`${m.height.toFixed(1)} cm`);
    if (m.flightTime != null) parts.push(`vuelo ${m.flightTime} ms`);
    if (m.rsi        != null) parts.push(`RSI ${m.rsi.toFixed(2)}`);
    const sideLabel = m.side === 'left' ? ' (Izq)' : m.side === 'right' ? ' (Der)' : '';
    return `${label}${sideLabel}: ${parts.join(' · ') || '—'}`;
  });

  const countLabel = measurements.length === 1 ? '1 medición' : `${measurements.length} mediciones`;
  const badge = document.createElement('div');
  badge.id = 'jumpBadge';
  badge.style.cssText = `
    background:rgba(244,63,94,0.08); border:1px solid rgba(244,63,94,0.25);
    border-radius:8px; padding:10px 14px; font-size:12px;
    color:#f43f5e; font-family:'DM Mono',monospace; line-height:1.7;
  `;
  if (!document.getElementById('kinem-carousel-style')) {
    const _ks = document.createElement('style');
    _ks.id = 'kinem-carousel-style';
    _ks.textContent = '.kinem-scroll{display:flex;overflow-x:auto;gap:10px;scroll-snap-type:x mandatory;margin-top:8px;padding-bottom:4px;-webkit-overflow-scrolling:touch}.kinem-scroll::-webkit-scrollbar{height:3px}.kinem-scroll::-webkit-scrollbar-thumb{background:rgba(93,173,236,0.3);border-radius:3px}.kinem-scroll::-webkit-scrollbar-track{background:transparent}.kinem-item{flex:0 0 100%;scroll-snap-align:start;min-width:0}@media(min-width:600px){.kinem-scroll.kinem-multi .kinem-item{flex:0 0 calc(50% - 5px)}}@media(min-width:900px){.kinem-scroll.kinem-multi .kinem-item{flex:0 0 calc(33.33% - 7px)}}';
    document.head.appendChild(_ks);
  }
  badge.innerHTML = `✓ Salto importado desde PhysiQ-Jump · ${countLabel}` +
    `<div class="kinem-scroll${measurements.length > 1 ? ' kinem-multi' : ''}">` +
    lines.map(l => `<div class="kinem-item" style="border:1px solid rgba(244,63,94,0.2);border-radius:6px;padding:6px 8px"><span style="color:#8fa0bf;font-size:11px;line-height:1.6">${l}</span></div>`).join('') +
    '</div>';
  const body = document.getElementById('body-imported');
  if (body) body.appendChild(badge);
  _syncImportedCard();
  checkReady();
}

function applyBalanceContext(balanceData) {
  if (!balanceData) return;
  document.getElementById('balanceBadge')?.remove();

  const measurements = Array.isArray(balanceData) ? balanceData : [balanceData];
  if (!measurements.length) return;

  window._physiqBalanceContext = balanceData;

  const lines = measurements.map(m => {
    const label = m.label ?? m.testType ?? 'Equilibrio';
    const parts = [];
    if (m.eyes)          parts.push(m.eyes === 'open' ? 'ojos abiertos' : 'ojos cerrados');
    if (m.surface)       parts.push(m.surface === 'foam' ? 'inestable' : 'firme');
    if (m.stabilityIndex != null) parts.push(`IE ${m.stabilityIndex.toFixed(1)}%`);
    if (m.swayVelocity   != null) parts.push(`osc. ${m.swayVelocity.toFixed(1)} mm/s`);
    const sideLabel = m.side === 'left' ? ' (Izq)' : m.side === 'right' ? ' (Der)' : '';
    return `${label}${sideLabel}: ${parts.join(' · ') || '—'}`;
  });

  const countLabel = measurements.length === 1 ? '1 medición' : `${measurements.length} mediciones`;
  const badge = document.createElement('div');
  badge.id = 'balanceBadge';
  badge.style.cssText = `
    background:rgba(79,156,249,0.08); border:1px solid rgba(79,156,249,0.25);
    border-radius:8px; padding:10px 14px; font-size:12px;
    color:#4f9cf9; font-family:'DM Mono',monospace; line-height:1.7;
  `;
  if (!document.getElementById('kinem-carousel-style')) {
    const _ks = document.createElement('style');
    _ks.id = 'kinem-carousel-style';
    _ks.textContent = '.kinem-scroll{display:flex;overflow-x:auto;gap:10px;scroll-snap-type:x mandatory;margin-top:8px;padding-bottom:4px;-webkit-overflow-scrolling:touch}.kinem-scroll::-webkit-scrollbar{height:3px}.kinem-scroll::-webkit-scrollbar-thumb{background:rgba(93,173,236,0.3);border-radius:3px}.kinem-scroll::-webkit-scrollbar-track{background:transparent}.kinem-item{flex:0 0 100%;scroll-snap-align:start;min-width:0}@media(min-width:600px){.kinem-scroll.kinem-multi .kinem-item{flex:0 0 calc(50% - 5px)}}@media(min-width:900px){.kinem-scroll.kinem-multi .kinem-item{flex:0 0 calc(33.33% - 7px)}}';
    document.head.appendChild(_ks);
  }
  badge.innerHTML = `✓ Equilibrio importado desde PhysiQ-Balance · ${countLabel}` +
    `<div class="kinem-scroll${measurements.length > 1 ? ' kinem-multi' : ''}">` +
    lines.map(l => `<div class="kinem-item" style="border:1px solid rgba(79,156,249,0.2);border-radius:6px;padding:6px 8px"><span style="color:#8fa0bf;font-size:11px;line-height:1.6">${l}</span></div>`).join('') +
    '</div>';
  const body = document.getElementById('body-imported');
  if (body) body.appendChild(badge);
  _syncImportedCard();
  checkReady();
}

function applyKinematicsContext(kinematicsData) {
  if (!kinematicsData) return;
  document.getElementById('kinematicsBadge')?.remove();

  const recordings = (Array.isArray(kinematicsData) ? kinematicsData : [kinematicsData])
    .filter(r => r && r.joints && r.joints.length && r.series);
  if (!recordings.length) return;

  window._physiqKinematicsContext = kinematicsData;

  function _fmtJoint(name) {
    return name
      .replace(/^left_/, 'L ').replace(/^right_/, 'R ')
      .replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  const COLORS = {
    left_shoulder: '#4f9cf9', right_shoulder: '#fb923c',
    left_elbow: '#38d9a9',   right_elbow: '#facc15',
    left_hip: '#f472b6',     right_hip: '#34d399',
    left_knee: '#a78bfa',    right_knee: '#f87171',
  };
  const FALLBACK = ['#5dadec','#f87171','#38d9a9','#facc15','#a78bfa','#fb923c'];

  function _renderRecording(rec) {
    const { joints, series, duration } = rec;
    const jointSeries = joints.filter(j => series[j] && series[j].a && series[j].a.length);
    if (!jointSeries.length) return null;

    const durationMs  = duration || 1;
    const durationSec = (durationMs / 1000).toFixed(1);

    let globalMin = Infinity, globalMax = -Infinity;
    jointSeries.forEach(j => {
      globalMin = Math.min(globalMin, ...series[j].a);
      globalMax = Math.max(globalMax, ...series[j].a);
    });
    const pad    = Math.max((globalMax - globalMin) * 0.1, 5);
    const yMin   = globalMin - pad;
    const yRange = Math.max(globalMax - globalMin + 2 * pad, 10);

    const W = 300, H = 68, ml = 28, mr = 8, mt = 4, mb = 16;
    const cw = W - ml - mr, ch = H - mt - mb;
    const toX = t => (ml + (t / durationMs) * cw).toFixed(1);
    const toY = a => (mt + ch - ((a - yMin) / yRange) * ch).toFixed(1);

    const polylines = jointSeries.map((j, i) => {
      const color  = COLORS[j] || FALLBACK[i % FALLBACK.length];
      const points = series[j].t.map((t, k) => `${toX(t)},${toY(series[j].a[k])}`).join(' ');
      return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>`;
    }).join('');

    const tickMs = durationMs > 30000 ? 10000 : durationMs > 10000 ? 5000 : 2000;
    let timeTicks = '';
    for (let t = 0; t <= durationMs; t += tickMs) {
      const x = toX(t);
      timeTicks += `<line x1="${x}" y1="${mt + ch}" x2="${x}" y2="${mt + ch + 3}" stroke="#8fa0bf" stroke-width="0.8"/>`;
      timeTicks += `<text x="${x}" y="${H - 2}" text-anchor="middle" font-size="6" fill="#8fa0bf">${(t / 1000).toFixed(0)}s</text>`;
    }
    const yMid = Math.round((globalMin + globalMax) / 2);
    const yLabels = [globalMin, yMid, globalMax].map(a => {
      return `<text x="${ml - 2}" y="${toY(a)}" text-anchor="end" dominant-baseline="middle" font-size="6" fill="#8fa0bf">${Math.round(a)}°</text>`;
    }).join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${W} ${H}" style="display:block;margin-top:8px">
      <rect x="${ml}" y="${mt}" width="${cw}" height="${ch}" fill="rgba(255,255,255,0.03)" rx="2"/>
      <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ch}" stroke="#8fa0bf" stroke-width="0.8" opacity="0.4"/>
      <line x1="${ml}" y1="${mt + ch}" x2="${ml + cw}" y2="${mt + ch}" stroke="#8fa0bf" stroke-width="0.8" opacity="0.4"/>
      ${timeTicks}${yLabels}${polylines}
    </svg>`;

    const legend = jointSeries.map((j, i) => {
      const color = COLORS[j] || FALLBACK[i % FALLBACK.length];
      const a = series[j].a;
      const min = Math.min(...a), max = Math.max(...a);
      return `<span style="white-space:nowrap"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:3px;vertical-align:middle"></span><span style="color:#8fa0bf">${_fmtJoint(j)}: ${min}°–${max}°</span></span>`;
    }).join(' &nbsp;');

    return { durationSec, jointCount: jointSeries.length, legend, svg };
  }

  const rendered = recordings.map(_renderRecording).filter(Boolean);
  if (!rendered.length) return;

  const countLabel = rendered.length === 1
    ? `${rendered[0].durationSec}s · ${rendered[0].jointCount} articulación${rendered[0].jointCount !== 1 ? 'es' : ''}`
    : `${rendered.length} grabaciones`;

  if (!document.getElementById('kinem-carousel-style')) {
    const _ks = document.createElement('style');
    _ks.id = 'kinem-carousel-style';
    _ks.textContent = '.kinem-scroll{display:flex;overflow-x:auto;gap:10px;scroll-snap-type:x mandatory;margin-top:8px;padding-bottom:4px;-webkit-overflow-scrolling:touch}.kinem-scroll::-webkit-scrollbar{height:3px}.kinem-scroll::-webkit-scrollbar-thumb{background:rgba(93,173,236,0.3);border-radius:3px}.kinem-scroll::-webkit-scrollbar-track{background:transparent}.kinem-item{flex:0 0 100%;scroll-snap-align:start;min-width:0}@media(min-width:600px){.kinem-scroll.kinem-multi .kinem-item{flex:0 0 calc(50% - 5px)}}@media(min-width:900px){.kinem-scroll.kinem-multi .kinem-item{flex:0 0 calc(33.33% - 7px)}}';
    document.head.appendChild(_ks);
  }

  const sections = `<div class="kinem-scroll${rendered.length > 1 ? ' kinem-multi' : ''}">` +
    rendered.map((r, i) =>
      `<div class="kinem-item">${rendered.length > 1 ? `<div style="font-size:10px;color:#8fa0bf;margin-bottom:2px">Grabación ${i + 1} · ${r.durationSec}s · ${r.jointCount} art.</div>` : ''}<span style="font-size:11px;line-height:1.5">${r.legend}</span>${r.svg}</div>`
    ).join('') +
    '</div>';

  const badge = document.createElement('div');
  badge.id = 'kinematicsBadge';
  badge.style.cssText = `
    background:rgba(93,173,236,0.08); border:1px solid rgba(93,173,236,0.25);
    border-radius:8px; padding:10px 14px; font-size:12px;
    color:#5dadec; font-family:'DM Mono',monospace; line-height:1.7;
  `;
  badge.innerHTML =
    `✓ Cinemática importada desde PhysiQ-Kinematics · ${countLabel}` +
    sections;

  const body = document.getElementById('body-imported');
  if (body) body.appendChild(badge);
  _syncImportedCard();
  checkReady();
}

function applyQuestionnaireContext(questionnairesData) {
  if (!questionnairesData) return;
  const items = Array.isArray(questionnairesData) ? questionnairesData : [questionnairesData];
  if (!items.length) return;

  document.getElementById('questionnaireBadge')?.remove();
  window._physiqQuestionnaireContext = items;

  if (!document.getElementById('kinem-carousel-style')) {
    const _ks = document.createElement('style');
    _ks.id = 'kinem-carousel-style';
    _ks.textContent = '.kinem-scroll{display:flex;overflow-x:auto;gap:10px;scroll-snap-type:x mandatory;margin-top:8px;padding-bottom:4px;-webkit-overflow-scrolling:touch}.kinem-scroll::-webkit-scrollbar{height:3px}.kinem-scroll::-webkit-scrollbar-thumb{background:rgba(93,173,236,0.3);border-radius:3px}.kinem-scroll::-webkit-scrollbar-track{background:transparent}.kinem-item{flex:0 0 100%;scroll-snap-align:start;min-width:0}@media(min-width:600px){.kinem-scroll.kinem-multi .kinem-item{flex:0 0 calc(50% - 5px)}}@media(min-width:900px){.kinem-scroll.kinem-multi .kinem-item{flex:0 0 calc(33.33% - 7px)}}';
    document.head.appendChild(_ks);
  }

  const countLabel = items.length === 1 ? '1 cuestionario' : `${items.length} cuestionarios`;

  const sections = `<div class="kinem-scroll${items.length > 1 ? ' kinem-multi' : ''}">` +
    items.map(q => {
      const name = q.abbr || q.name || q.id || '?';
      const scoreStr = q.score != null ? `${q.score}` : '—';
      const labelStr = q.label || '';
      const riskDot = q.risk ? '<span style="color:#f87171"> ●</span>' : '';
      return `<div class="kinem-item" style="border:1px solid rgba(20,184,166,0.2);border-radius:6px;padding:6px 8px">` +
        `<div style="font-size:11px;color:#14b8a6;margin-bottom:2px">${name}${riskDot}</div>` +
        `<div style="color:#8fa0bf;font-size:11px;line-height:1.5">${scoreStr}${labelStr ? ` · ${labelStr}` : ''}</div>` +
        `</div>`;
    }).join('') +
    '</div>';

  const badge = document.createElement('div');
  badge.id = 'questionnaireBadge';
  badge.style.cssText = `background:rgba(20,184,166,0.08); border:1px solid rgba(20,184,166,0.25); border-radius:8px; padding:10px 14px; font-size:12px; color:#14b8a6; font-family:'DM Mono',monospace; line-height:1.7;`;
  badge.innerHTML = `✓ Cuestionarios importados desde PhysiQ-Questionnaire · ${countLabel}` + sections;

  const body = document.getElementById('body-imported');
  if (body) body.appendChild(badge);
  _syncImportedCard();
  checkReady();
}

function _showAssessmentIncompleteBadge(phase) {
  document.getElementById('assessmentBadge')?.remove();
  let badge = document.getElementById('assessmentIncompleteBadge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'assessmentIncompleteBadge';
    badge.style.cssText = `
      background:rgba(255,176,58,0.08); border:1px solid rgba(255,176,58,0.3);
      border-radius:8px; padding:10px 14px; font-size:12px;
      color:var(--text2); font-family:'DM Mono',monospace;
    `;
    const body = document.getElementById('body-imported');
    if (!body) return;
    body.appendChild(badge);
  }
  badge.innerHTML = `⏳ Valoración en curso · Fase ${phase === '4b' ? '4b' : phase} de 5`;
  _syncImportedCard();
}

function showImportedBadge(data) {
  document.getElementById('assessmentIncompleteBadge')?.remove();
  document.getElementById('assessmentBadge')?.remove();
  const badge = document.createElement('div');
  badge.id = 'assessmentBadge';
  badge.style.cssText = `
    background:rgba(79,195,161,0.1); border:1px solid rgba(79,195,161,0.3);
    border-radius:8px; padding:10px 14px; font-size:12px;
    color:var(--accent); font-family:'DM Mono',monospace;
  `;
  badge.innerHTML = `✓ Valoración importada desde PhysiQ-Assessment · ${data.r || ''} · ${data.p || ''}`;
  const body = document.getElementById('body-imported');
  if (body) body.appendChild(badge);
  _syncImportedCard();
}

function applyPhysiQAssessmentContext(data) {
  if (!data) return;
  const name = document.getElementById('patient-name');
  if (name && data.p) name.value = data.p;

  const date = document.getElementById('session-date');
  if (date && data.d) date.value = data.d;

  const diag = document.getElementById('diagnosis');
  if (diag && data.mo) diag.value = data.mo;

  window._physiqAssessmentContext = data;
  if (data.r) {
    const label = data.r.charAt(0).toUpperCase() + data.r.slice(1);
    setManualRegion(data.r, label, true);
  }
  if (data.rom) applyROMContext(data.rom);
  showImportedBadge(data);
  updateRegionSelector();
  checkReady();
  readSession().then(session => { if (session) updateSessionChip(session); });
}

// ─── INDEXEDDB AUDIO (grabación del hub) ─────────────────────
function _peekAudioFromIDB() {
  return openSessionDB().then(db => new Promise(resolve => {
    const tx  = db.transaction('audio', 'readonly');
    const get = tx.objectStore('audio').get('pending');
    get.onsuccess = () => resolve(get.result || null);
    get.onerror   = () => resolve(null);
  })).catch(() => null);
}

function _consumeAudioFromIDB() {
  return openSessionDB().then(db => new Promise(resolve => {
    const tx    = db.transaction('audio', 'readwrite');
    const store = tx.objectStore('audio');
    const get   = store.get('pending');
    get.onsuccess = () => {
      const entry = get.result;
      if (entry) store.delete('pending');
      resolve(entry || null);
    };
    get.onerror = () => resolve(null);
  })).catch(() => null);
}

function _showRecordingHint(duration) {
  const mins = Math.floor(duration / 60);
  const secs = (duration % 60).toString().padStart(2, '0');
  const label = document.getElementById('session-rec-duration');
  if (label) label.textContent = `${mins}m ${secs}s`;
  const action = document.getElementById('session-rec-action');
  if (action) action.textContent = selectedFile ? 'Reemplazar' : 'Usar';
  const hint = document.getElementById('session-rec-hint');
  if (hint) hint.style.display = 'block';
}

function _hideRecordingHint() {
  const hint = document.getElementById('session-rec-hint');
  if (hint) hint.style.display = 'none';
}

function _useSessionRecording() {
  _hideRecordingHint();
  _consumeAudioFromIDB().then(_applyImportedAudio);
}

const _recCh = new BroadcastChannel('physiq-recorder');
const _sessionCh = new BroadcastChannel('physiq-session');
let _sessionGen     = 0;
let _sessionCleared = false;
_sessionCh.onmessage = ({ data }) => {
  if (data.type === 'SESSION_PATIENT') {
    const el = document.getElementById('patient-name');
    if (!el || document.activeElement === el) return;
    el.value = data.patient || '';
    checkReady();
    readSession().then(s => { if (s) updateSessionChip(s); });
    return;
  }
  if (data.type === 'SESSION_ROM') {
    if (data.rom && Object.keys(data.rom.regions || {}).length > 0) {
      applyROMContext(data.rom);
      readSession().then(s => { if (s) updateSessionChip(s); });
    } else {
      document.getElementById('romBadge')?.remove();
      window._physiqROMContext = null;
      _syncImportedCard();
    }
    checkReady();
    return;
  }
  if (data.type === 'SESSION_ASSESSMENT') {
    applyPhysiQAssessmentContext(data.assessment);
    return;
  }
  if (data.type === 'SESSION_ASSESSMENT_PARTIAL') {
    _showAssessmentIncompleteBadge(data.phase);
    if (data.region && !window._physiqAssessmentContext) {
      const label = data.region.charAt(0).toUpperCase() + data.region.slice(1);
      setManualRegion(data.region, label, true);
    }
    readSession().then(s => { if (s) updateSessionChip(s); });
    return;
  }
  if (data.type === 'SESSION_FORCE') {
    if (data.force && (!Array.isArray(data.force) || data.force.length)) {
      applyForceContext(data.force);
      readSession().then(s => { if (s) updateSessionChip(s); });
    } else {
      window._physiqForceContext = null;
      document.getElementById('forceBadge')?.remove();
      _syncImportedCard();
    }
    checkReady();
    return;
  }
  if (data.type === 'SESSION_JUMP') {
    if (data.jumps && (!Array.isArray(data.jumps) || data.jumps.length)) {
      applyJumpContext(data.jumps);
      readSession().then(s => { if (s) updateSessionChip(s); });
    } else {
      window._physiqJumpContext = null;
      document.getElementById('jumpBadge')?.remove();
      _syncImportedCard();
    }
    checkReady();
    return;
  }
  if (data.type === 'SESSION_BALANCE') {
    if (data.balance && (!Array.isArray(data.balance) || data.balance.length)) {
      applyBalanceContext(data.balance);
      readSession().then(s => { if (s) updateSessionChip(s); });
    } else {
      window._physiqBalanceContext = null;
      document.getElementById('balanceBadge')?.remove();
      _syncImportedCard();
    }
    checkReady();
    return;
  }
  if (data.type === 'SESSION_KINEMATICS') {
    if (data.kinematics && (!Array.isArray(data.kinematics) || data.kinematics.length)) {
      applyKinematicsContext(data.kinematics);
      readSession().then(s => { if (s) updateSessionChip(s); });
    } else {
      window._physiqKinematicsContext = null;
      document.getElementById('kinematicsBadge')?.remove();
      _syncImportedCard();
    }
    checkReady();
    return;
  }
  if (data.type === 'SESSION_QUESTIONNAIRE') {
    if (data.questionnaires && (!Array.isArray(data.questionnaires) || data.questionnaires.length)) {
      applyQuestionnaireContext(data.questionnaires);
      readSession().then(s => { if (s) updateSessionChip(s); });
    } else {
      window._physiqQuestionnaireContext = null;
      document.getElementById('questionnaireBadge')?.remove();
      _syncImportedCard();
    }
    checkReady();
    return;
  }
  if (data.type === 'SESSION_CLEAR') {
    _sessionGen++;
    _sessionCleared = true;
    clearSession();
    resetApp();
    window._physiqROMContext = null;
    window._physiqAssessmentContext = null;
    window._physiqForceContext = null;
    window._physiqJumpContext = null;
    window._physiqBalanceContext = null;
    window._physiqKinematicsContext = null;
    window._physiqQuestionnaireContext = null;
    setManualRegion('', 'Genérica', true);
    updateRegionSelector();
    ['romBadge', 'assessmentBadge', 'assessmentIncompleteBadge', 'forceBadge', 'jumpBadge', 'balanceBadge', 'kinematicsBadge', 'questionnaireBadge', 'audioBadge', 'docsBadge'].forEach(id => document.getElementById(id)?.remove());
    _syncImportedCard();
    updateSessionChip(null);
    return;
  }
  if (data.type === 'SESSION_REPORT_FIELDS') {
    const nameEl = document.getElementById('patient-name');
    if (nameEl && document.activeElement !== nameEl && data.patient != null) nameEl.value = data.patient;
    const dateEl = document.getElementById('session-date');
    if (dateEl && document.activeElement !== dateEl && data.date != null) dateEl.value = data.date;
    const diagEl = document.getElementById('diagnosis');
    if (diagEl && document.activeElement !== diagEl && data.diagnosis != null) diagEl.value = data.diagnosis;
    if ('manualRegion' in data && !window._physiqAssessmentContext) {
      const label = data.manualRegion
        ? data.manualRegion.charAt(0).toUpperCase() + data.manualRegion.slice(1)
        : 'Genérica';
      setManualRegion(data.manualRegion || '', label, true);
    }
    checkReady();
    readSession().then(s => { if (s) updateSessionChip(s); });
    return;
  }
  if (data.type === 'CONFIG_SYNC') {
    _applyingConfig = true;
    if (data.physiq_config) localStorage.setItem('physiq_config', JSON.stringify(data.physiq_config));
    loadConfig();
    _applyingConfig = false;
    return;
  }
};
let _lastRecState = 'idle';
_recCh.onmessage = ({ data }) => {
  if (data.type !== 'RECORDER_STATE') return;
  if (data.state === 'recording' && _lastRecState === 'idle')
    _hideRecordingHint();
  if (data.state === 'stopped' && _lastRecState !== 'stopped' && data.hasAudio)
    _showRecordingHint(data.duration);
  if (data.state === 'idle' && _lastRecState !== 'idle')
    _hideRecordingHint();
  _lastRecState = data.state;
};

// ─── SESSION CHIP ────────────────────────────────────────────
let _sessionLabel = '';

function updateSessionChip(session) {
  const btn = document.getElementById('sessionBtn');
  if (!btn) return;
  const panel = document.getElementById('sessionPanel');
  if (!session || !session.patient) {
    _sessionLabel = '';
    btn.classList.remove('active');
    panel?.classList.remove('has-session');
    _updateSessionPanelTitle();
    return;
  }
  _sessionLabel = `${session.patient} · ${session.date || '—'}`;
  btn.classList.add('active');
  panel?.classList.add('has-session');
  _updateSessionPanelTitle();
}

function _updateSessionPanelTitle() {
  const titleEl = document.getElementById('sessionPanelTitle');
  if (!titleEl) return;
  const name = document.getElementById('patient-name')?.value.trim() || '';
  const date = document.getElementById('session-date')?.value.trim() || '';
  titleEl.textContent = name ? (date ? `${name} · ${date}` : name) : 'Sin sesión activa';
}

function showConfirmBanner(title, text, actionLabel, onConfirm) {
  const existing = document.getElementById('confirmBanner');
  if (existing) { existing.remove(); unlockBodyScroll(); }
  const overlay = document.createElement('div');
  overlay.className = 'confirm-banner';
  overlay.id = 'confirmBanner';
  overlay.innerHTML = `
    <div class="confirm-box">
      <div class="confirm-box-title">${title}</div>
      <div class="confirm-box-text">${text}</div>
      <div class="confirm-box-btns">
        <button class="confirm-btn-cancel" id="confirmCancel">Cancelar</button>
        <button class="confirm-btn-ok" id="confirmAction">${actionLabel}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  lockBodyScroll();
  window.parent.postMessage({ type: 'PHYSIQ_WIDGET_HIDE' }, '*');
  const dismiss = () => { overlay.remove(); unlockBodyScroll(); window.parent.postMessage({ type: 'PHYSIQ_WIDGET_SHOW' }, '*'); };
  document.getElementById('confirmCancel').onclick = dismiss;
  document.getElementById('confirmAction').onclick = () => { dismiss(); onConfirm(); };
}

// Closes every open sheet/dialog. Called when the hub hides this satellite
// (e.g. navigating back to hub home) so a stale open dialog isn't still
// showing when the user returns, and when the app is backgrounded standalone.
function _closeAllOverlays() {
  closeActiveSheet();
  closeSessionPanel();
  const cb = document.getElementById('confirmBanner');
  if (cb) { cb.remove(); unlockBodyScroll(); window.parent.postMessage({ type: 'PHYSIQ_WIDGET_SHOW' }, '*'); }
}

function toggleSessionPanel() {
  const overlay = document.getElementById('sessionPanelOverlay');
  if (!overlay) return;
  if (overlay.classList.contains('open')) { closeSessionPanel(); return; }
  _showSessionState('edit');
  overlay.classList.add('open');
  lockBodyScroll();
  window.parent.postMessage({ type: 'PHYSIQ_WIDGET_HIDE' }, '*');
  if (window.innerWidth < 640) {
    const panel = document.getElementById('sessionPanel');
    if (panel) {
      panel.style.transition = 'none';
      panel.style.transform = 'translateY(100%)';
      void panel.offsetHeight;
      panel.style.transition = '';
      panel.style.transform = '';
    }
  }
}

function closeSessionPanel() {
  const overlay = document.getElementById('sessionPanelOverlay');
  if (!overlay?.classList.contains('open')) return;
  overlay.classList.remove('open');
  unlockBodyScroll();
  window.parent.postMessage({ type: 'PHYSIQ_WIDGET_SHOW' }, '*');
}

function _showSessionState(state) {
  const panel = document.getElementById('sessionPanel');
  if (!panel) return;
  const editView   = document.getElementById('sessionPanelEdit');
  const deleteView = document.getElementById('sessionPanelDelete');
  if (state === 'edit') {
    if (editView)   editView.style.display   = '';
    if (deleteView) deleteView.style.display = 'none';
    setTimeout(() => document.getElementById('patient-name')?.focus(), 60);
  } else if (state === 'delete') {
    if (editView)   editView.style.display   = 'none';
    if (deleteView) deleteView.style.display = '';
    document.getElementById('sessionPanelConfirmCancel').onclick = () => _showSessionState('edit');
    document.getElementById('sessionPanelConfirmAction').onclick = () => {
      closeSessionPanel();
      _executeClearSession();
    };
  }
}

function promptClearSession() {
  const overlay = document.getElementById('sessionPanelOverlay');
  if (overlay && !overlay.classList.contains('open')) {
    overlay.classList.add('open');
    lockBodyScroll();
    window.parent.postMessage({ type: 'PHYSIQ_WIDGET_HIDE' }, '*');
    if (window.innerWidth < 640) {
      const panel = document.getElementById('sessionPanel');
      if (panel) {
        panel.style.transition = 'none';
        panel.style.transform = 'translateY(100%)';
        void panel.offsetHeight;
        panel.style.transition = '';
        panel.style.transform = '';
      }
    }
  }
  _showSessionState('delete');
}

function _executeClearSession() {
  _sessionGen++;
  _sessionCleared = true;
  resetApp();
  window._physiqROMContext = null;
  window._physiqAssessmentContext = null;
  window._physiqForceContext = null;
  window._physiqJumpContext = null;
  window._physiqBalanceContext = null;
  window._physiqKinematicsContext = null;
  window._physiqQuestionnaireContext = null;
  setManualRegion('', 'Genérica', true);
  updateRegionSelector();
  ['romBadge', 'assessmentBadge', 'assessmentIncompleteBadge', 'forceBadge', 'jumpBadge', 'balanceBadge', 'kinematicsBadge', 'questionnaireBadge', 'audioBadge', 'docsBadge'].forEach(id => document.getElementById(id)?.remove());
  _syncImportedCard();
  clearSession().then(() => {
    updateSessionChip(null);
    _sessionCh.postMessage({ type: 'SESSION_CLEAR' });
  });
}

function _applyImportedAudio(entry) {
  if (!entry) return;
  _hideRecordingHint();
  selectedFile = new File([entry.blob], entry.name, { type: entry.type });
  document.getElementById('file-name').textContent = '✓ ' + entry.name;
  document.getElementById('audio-clear-btn').style.display = 'flex';
  const mins = Math.floor(entry.duration / 60);
  const secs = (entry.duration % 60).toString().padStart(2, '0');
  const badge = document.createElement('div');
  badge.id = 'audioBadge';
  badge.style.cssText = `
    background:rgba(79,195,161,0.08); border:1px solid rgba(79,195,161,0.25);
    border-radius:8px; padding:8px 14px; font-size:12px;
    color:var(--accent); font-family:'DM Mono',monospace; margin-bottom:8px;
  `;
  badge.textContent = `🎙 Grabación de sesión · ${mins}m ${secs}s`;
  const body = document.getElementById('body-imported');
  if (body) body.appendChild(badge);
  _syncImportedCard();
  checkReady();
}

_applyingConfig = true;
loadConfig();
_applyingConfig = false;
_updateConfigBtns();
document.getElementById('sessionPanelClear').onclick = () => _showSessionState('delete');
_updateImportBadges();
document.getElementById('session-date').value = new Date().toLocaleDateString('es-ES');
applyPhysiQAssessmentContext(loadFromPhysiQAssessment());
updateRegionSelector();
_peekAudioFromIDB().then(entry => { if (entry) _showRecordingHint(entry.duration); });
readSession().then(session => {
  if (!session) return;
  if (session.assessment && !window._physiqAssessmentContext) applyPhysiQAssessmentContext(session.assessment);
  if (session.rom && !window._physiqROMContext) applyROMContext(session.rom);
  if (session.force      && (!Array.isArray(session.force)      || session.force.length)      && !document.getElementById('forceBadge'))      applyForceContext(session.force);
  if (session.jump       && (!Array.isArray(session.jump)       || session.jump.length)       && !document.getElementById('jumpBadge'))       applyJumpContext(session.jump);
  if (session.balance    && (!Array.isArray(session.balance)    || session.balance.length)    && !document.getElementById('balanceBadge'))    applyBalanceContext(session.balance);
  if (session.kinematics && (!Array.isArray(session.kinematics) || session.kinematics.length) && !document.getElementById('kinematicsBadge')) applyKinematicsContext(session.kinematics);
  if (session.questionnaires && (!Array.isArray(session.questionnaires) || session.questionnaires.length) && !document.getElementById('questionnaireBadge')) applyQuestionnaireContext(session.questionnaires);
  if (session.assessmentState && !session.assessment && !window._physiqAssessmentContext) {
    const _phaseLabels = [1, 2, 3, 4, '4b', 5];
    const maxVisited = session.assessmentState.maxVisitedIdx || 0;
    if (session.assessmentState.currentPhase !== 5 && maxVisited > 0) {
      _showAssessmentIncompleteBadge(_phaseLabels[maxVisited]);
    }
    if (session.assessmentState.region) {
      const label = session.assessmentState.region.charAt(0).toUpperCase() + session.assessmentState.region.slice(1);
      setManualRegion(session.assessmentState.region, label, true);
    }
  }
  const nameEl = document.getElementById('patient-name');
  if (session.patient && nameEl && !nameEl.value) nameEl.value = session.patient;
  if (!window._physiqAssessmentContext) {
    const dateEl = document.getElementById('session-date');
    if (session.date && dateEl) dateEl.value = session.date;
    const diagEl = document.getElementById('diagnosis');
    if (session.diagnosis && diagEl) diagEl.value = session.diagnosis;
    if (session.manualRegion && !manualRegion) {
      const label = session.manualRegion.charAt(0).toUpperCase() + session.manualRegion.slice(1);
      setManualRegion(session.manualRegion, label, true);
    }
  }
  checkReady();
  updateSessionChip(session);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Close stray open dialogs when the app is backgrounded (covers swipe-away on Android PWA)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') _closeAllOverlays();
});

// ========= SWIPE-TO-DISMISS BOTTOM SHEETS =========
function initSwipe(sheet, closeFn, handleZone = 72) {
    let startY = 0, startTime = 0, dragging = false, delta = 0, snapTimer = null, dismissTimer = null;
    const EASE = 'transform 0.3s cubic-bezier(0.32,0.72,0,1)';
    let vvHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;

    // Closing the keyboard mid-drag resizes the visual viewport, shifting the
    // sheet's on-screen position by the same amount. Compensating startY keeps
    // the drag delta accurate so the sheet follows the finger correctly.
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        const newHeight = window.visualViewport.height;
        if (dragging) startY += newHeight - vvHeight;
        vvHeight = newHeight;
      });
    }

    function onMove(e) {
      if (!dragging) return;
      // Prevent the sheet-body (or any inner scrollable) from scrolling while
      // the drag-to-dismiss gesture is active.
      e.preventDefault();
      delta = Math.max(0, e.touches[0].clientY - startY);
      sheet.style.transform = delta > 0 ? `translateY(${delta}px)` : 'translateY(0)';
    }

    function detachDocListeners() {
      document.removeEventListener('touchmove',   onMove);
      document.removeEventListener('touchend',    onRelease);
      document.removeEventListener('touchcancel', onCancel);
    }

    function onRelease() {
      if (!dragging) return;
      dragging = false;
      detachDocListeners();
      const velocity = delta / (Date.now() - startTime);
      if (delta > 80 || velocity > 0.3) {
        sheet.style.transition = EASE;
        sheet.style.transform = 'translateY(110%)';
        dismissTimer = setTimeout(() => {
          dismissTimer = null;
          sheet.style.transition = 'none';
          if (closeFn) closeFn();
          else if (sheet.classList.contains('open')) closeActiveSheet();
          sheet.style.transform = '';
          void sheet.offsetHeight;
          sheet.style.transition = '';
        }, 300);
      } else {
        sheet.style.transition = EASE;
        sheet.style.transform = 'translateY(0)';
        snapTimer = setTimeout(() => {
          sheet.style.transform = '';
          sheet.style.transition = '';
        }, 310);
      }
    }

    function onCancel() {
      if (!dragging) return;
      dragging = false;
      detachDocListeners();
      clearTimeout(dismissTimer);
      sheet.style.transform = '';
      sheet.style.transition = '';
    }

    sheet.addEventListener('touchstart', e => {
      if (window.innerWidth >= 640) return;
      if (e.touches[0].clientY - sheet.getBoundingClientRect().top > handleZone) return;
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      startY = e.touches[0].clientY;
      startTime = Date.now();
      delta = 0;
      dragging = true;
      clearTimeout(snapTimer);
      clearTimeout(dismissTimer);
      sheet.style.transition = 'none';
      // Track move/end on the document so the gesture is never lost to inner
      // scroll containers. passive:false on touchmove lets us call preventDefault.
      document.addEventListener('touchmove',   onMove,    { passive: false });
      document.addEventListener('touchend',    onRelease, { passive: true  });
      document.addEventListener('touchcancel', onCancel,  { passive: true  });
    }, { passive: true });
  }

document.querySelectorAll('.config-sheet, .region-sheet').forEach(el => initSwipe(el));

// ── Session panel swipe-to-dismiss (handle-anchored) ──────────────────────────
// .session-panel is a flex child of a transformed overlay (not position:fixed
// like the other sheets), so initSwipe's panel-level touchstart + getBoundingClientRect
// handleZone check is unreliable here. Anchor touchstart on the handle itself instead
// and track touchmove/touchend on the document.
(function () {
  const overlay = document.getElementById('sessionPanelOverlay');
  const panel   = document.getElementById('sessionPanel');
  const handle  = panel && panel.querySelector('.session-panel-handle');
  if (!overlay || !panel || !handle) return;

  let startY = 0, startTime = 0, active = false, delta = 0;
  let snapTimer = null, dismissTimer = null;
  const EASE = 'transform 0.3s cubic-bezier(0.32,0.72,0,1)';

  handle.addEventListener('touchstart', e => {
    if (window.innerWidth >= 640) return;
    clearTimeout(snapTimer);
    clearTimeout(dismissTimer);
    startY    = e.touches[0].clientY;
    startTime = Date.now();
    delta     = 0;
    active    = true;
    panel.style.transition = 'none';
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!active) return;
    delta = Math.max(0, e.touches[0].clientY - startY);
    panel.style.transform = `translateY(${delta}px)`;
  }, { passive: true });

  function release() {
    if (!active) return;
    active = false;
    const elapsed  = Math.max(1, Date.now() - startTime);
    const velocity = delta / elapsed;
    if (delta > 60 || velocity > 0.25) {
      panel.style.transition = EASE;
      panel.style.transform  = 'translateY(110%)';
      dismissTimer = setTimeout(() => {
        dismissTimer = null;
        panel.style.transition = 'none';
        closeSessionPanel();
        panel.style.transform = '';
        void panel.offsetHeight;
        panel.style.transition = '';
      }, 300);
    } else {
      panel.style.transition = EASE;
      panel.style.transform  = 'translateY(0)';
      snapTimer = setTimeout(() => {
        panel.style.transform  = '';
        panel.style.transition = '';
      }, 310);
    }
  }

  document.addEventListener('touchend',    release, { passive: true });
  document.addEventListener('touchcancel', () => {
    if (!active) return;
    active = false;
    clearTimeout(dismissTimer);
    panel.style.transform  = '';
    panel.style.transition = '';
  }, { passive: true });
}());

// ========= EMAIL =========
function sendReportByEmail() {
  if (!lastReportText) return;
  const cfg = JSON.parse(localStorage.getItem('physiq_config') || '{}');
  document.getElementById('email-to').value = cfg.reportEmail || '';
  document.getElementById('email-status').style.display = 'none';
  _showEmailTurnstile();
  openConfigSheet('email');
}

async function _doSendEmail() {
  const to = document.getElementById('email-to').value.trim();
  const status = document.getElementById('email-status');
  if (!to || !to.includes('@')) {
    status.textContent = 'Introduce un email válido';
    status.style.cssText = 'display:block;color:var(--danger);font-size:13px;margin-top:10px;';
    return;
  }

  const cfg = JSON.parse(localStorage.getItem('physiq_config') || '{}');
  cfg.reportEmail = to;
  localStorage.setItem('physiq_config', JSON.stringify(cfg));
  document.getElementById('clinic-report-email').value = to;

  const btn = document.getElementById('email-send-btn');
  const token = _emailTurnstileToken;
  _emailTurnstileToken = null;
  turnstile.reset(_emailTurnstileWidgetId);
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;"></div> Enviando...';
  status.style.display = 'none';

  try {
    const info = lastReportInfo || {};
    const parts = ['Informe CIF-APTA', info.name, info.date].filter(Boolean);
    const subject = parts.join(' — ');

    let attachments, html;
    try {
      const { blob, filename } = await new Promise((resolve, reject) => {
        loadDocx(async () => { try { resolve(await _buildWordBlob()); } catch (e) { reject(e); } });
      });
      const ab = await blob.arrayBuffer();
      const bytes = new Uint8Array(ab);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
      attachments = [{ filename, content: btoa(bin) }];
      html = _buildNotificationHtml(info);
    } catch {
      html = _buildEmailHtml(_markdownToEmailHtml(lastReportText), info);
    }

    const res = await fetch(ORCHESTRATOR_URL + '/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-turnstile-response': token },
      body: JSON.stringify({ to, subject, html, attachments }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al enviar');

    status.textContent = attachments ? '✓ Enviado con Word adjunto a ' + to : '✓ Enviado a ' + to;
    status.style.cssText = 'display:block;color:var(--accent);font-size:13px;margin-top:10px;';
    btn.innerHTML = '✓ Enviado';
    setTimeout(() => closeActiveSheet(), 2000);
  } catch (err) {
    status.textContent = '⚠️ ' + err.message;
    status.style.cssText = 'display:block;color:var(--danger);font-size:13px;margin-top:10px;';
    _showEmailTurnstile();
  }
}

function _escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _inlineFmt(text) {
  return _escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function _markdownToEmailHtml(md) {
  const lines = md.split('\n');
  let out = '', inList = false, inTable = false;

  for (const line of lines) {
    if (line.startsWith('#### ')) {
      if (inList)  { out += '</ul>'; inList = false; }
      if (inTable) { out += '</tbody></table>'; inTable = false; }
      out += `<h4 style="color:#1a3a6b;font-size:13px;margin:10px 0 3px;">${_escHtml(line.slice(5))}</h4>`;
    } else if (line.startsWith('### ')) {
      if (inList)  { out += '</ul>'; inList = false; }
      if (inTable) { out += '</tbody></table>'; inTable = false; }
      out += `<h3 style="color:#1a3a6b;font-size:15px;margin:14px 0 5px;padding-bottom:3px;border-bottom:1px solid #dde3f0;">${_escHtml(line.slice(4))}</h3>`;
    } else if (line.startsWith('## ')) {
      if (inList)  { out += '</ul>'; inList = false; }
      if (inTable) { out += '</tbody></table>'; inTable = false; }
      out += `<h2 style="color:#1a3a6b;font-size:17px;margin:18px 0 8px;background:#f0f4ff;padding:7px 12px;border-radius:4px;">${_escHtml(line.slice(3))}</h2>`;
    } else if (line.startsWith('|')) {
      if (inList) { out += '</ul>'; inList = false; }
      if (line.match(/^\|[\s\-:|]+\|$/)) continue;
      const cells = line.split('|').slice(1, -1).map(c => `<td style="border:1px solid #dde3f0;padding:5px 9px;font-size:12px;">${_inlineFmt(c.trim())}</td>`).join('');
      if (!inTable) { out += '<table style="width:100%;border-collapse:collapse;margin:8px 0;"><tbody>'; inTable = true; }
      out += `<tr>${cells}</tr>`;
    } else if (line.match(/^[-*]\s/)) {
      if (inTable) { out += '</tbody></table>'; inTable = false; }
      if (!inList) { out += '<ul style="margin:6px 0;padding-left:20px;">'; inList = true; }
      out += `<li style="margin:2px 0;font-size:13px;">${_inlineFmt(line.slice(2))}</li>`;
    } else {
      if (inList)  { out += '</ul>'; inList = false; }
      if (inTable) { out += '</tbody></table>'; inTable = false; }
      if (!line.trim()) { out += '<div style="height:6px;"></div>'; }
      else out += `<p style="margin:3px 0;font-size:13px;line-height:1.65;">${_inlineFmt(line)}</p>`;
    }
  }
  if (inList)  out += '</ul>';
  if (inTable) out += '</tbody></table>';
  return out;
}

function _buildNotificationHtml(info) {
  const patient   = _escHtml(info.name      || '');
  const date      = _escHtml(info.date      || '');
  const diagnosis = _escHtml(info.diagnosis || '');
  const chips = [
    patient   ? `<span style="background:#e8f5f0;color:#1a6b4b;padding:3px 10px;border-radius:12px;font-size:12px;">👤 ${patient}</span>`   : '',
    date      ? `<span style="background:#e8f0ff;color:#1a3a6b;padding:3px 10px;border-radius:12px;font-size:12px;">📅 ${date}</span>`      : '',
    diagnosis ? `<span style="background:#fff3e0;color:#6b3a1a;padding:3px 10px;border-radius:12px;font-size:12px;">🏥 ${diagnosis}</span>` : '',
  ].filter(Boolean).join(' ');
  const body = `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#1a1a2e;">Adjuntamos el informe CIF-APTA en formato Word (.docx). Puede abrirlo con Microsoft Word, LibreOffice o Google Docs.</p>`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:20px;background:#f0f2f5;font-family:Georgia,'Times New Roman',serif;color:#1a1a2e;">
<div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <div style="background:#0e1117;padding:18px 24px;display:flex;align-items:baseline;gap:6px;">
    <span style="font-family:Georgia,serif;font-size:22px;color:#e8edf5;">Physi</span><span style="font-family:Georgia,serif;font-size:22px;color:#4f9cf9;">Q</span>
    <span style="font-family:Georgia,serif;font-size:20px;color:#4a5568;">—</span>
    <span style="font-family:Georgia,serif;font-size:22px;color:#38d9a9;">Report</span>
    <span style="margin-left:8px;font-size:11px;color:#6b7a99;font-family:sans-serif;">Informe Clínico CIF-APTA</span>
  </div>
  ${chips ? `<div style="background:#f8f9fc;padding:12px 24px;border-bottom:1px solid #e8ecf4;display:flex;gap:8px;flex-wrap:wrap;">${chips}</div>` : ''}
  <div style="padding:20px 24px;">${body}</div>
  <div style="background:#f8f9fc;padding:10px 24px;border-top:1px solid #e8ecf4;font-size:11px;color:#999;font-family:sans-serif;text-align:center;">
    Generado con PhysiQ-Report
  </div>
</div>
</body></html>`;
}

function _buildEmailHtml(bodyHtml, info) {
  const patient   = _escHtml(info.name      || '');
  const date      = _escHtml(info.date      || '');
  const diagnosis = _escHtml(info.diagnosis || '');
  const chips = [
    patient   ? `<span style="background:#e8f5f0;color:#1a6b4b;padding:3px 10px;border-radius:12px;font-size:12px;">👤 ${patient}</span>`   : '',
    date      ? `<span style="background:#e8f0ff;color:#1a3a6b;padding:3px 10px;border-radius:12px;font-size:12px;">📅 ${date}</span>`      : '',
    diagnosis ? `<span style="background:#fff3e0;color:#6b3a1a;padding:3px 10px;border-radius:12px;font-size:12px;">🏥 ${diagnosis}</span>` : '',
  ].filter(Boolean).join(' ');

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:20px;background:#f0f2f5;font-family:Georgia,'Times New Roman',serif;color:#1a1a2e;">
<div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <div style="background:#0e1117;padding:18px 24px;display:flex;align-items:baseline;gap:6px;">
    <span style="font-family:Georgia,serif;font-size:22px;color:#e8edf5;">Physi</span><span style="font-family:Georgia,serif;font-size:22px;color:#4f9cf9;">Q</span>
    <span style="font-family:Georgia,serif;font-size:20px;color:#4a5568;">—</span>
    <span style="font-family:Georgia,serif;font-size:22px;color:#38d9a9;">Report</span>
    <span style="margin-left:8px;font-size:11px;color:#6b7a99;font-family:sans-serif;">Informe Clínico CIF-APTA</span>
  </div>
  ${chips ? `<div style="background:#f8f9fc;padding:12px 24px;border-bottom:1px solid #e8ecf4;display:flex;gap:8px;flex-wrap:wrap;">${chips}</div>` : ''}
  <div style="padding:20px 24px;">${bodyHtml}</div>
  <div style="background:#f8f9fc;padding:10px 24px;border-top:1px solid #e8ecf4;font-size:11px;color:#999;font-family:sans-serif;text-align:center;">
    Generado con PhysiQ-Report
  </div>
</div>
</body></html>`;
}

// ─── TRANSLATE BANNER ────────────────────────────────────
let _translateTimer = null;
function handleTranslateClick() {
  if (window.innerWidth > 768) return;
  const banner = document.getElementById('translateBanner');
  if (!banner) return;
  clearTimeout(_translateTimer);
  banner.classList.add('visible');
  _translateTimer = setTimeout(hideTranslateBanner, 4000);
}
function hideTranslateBanner() {
  clearTimeout(_translateTimer);
  const banner = document.getElementById('translateBanner');
  if (banner) banner.classList.remove('visible');
}
