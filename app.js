// ========= GLOBAL STATE =========
let selectedFile = null, transcriptText = '', logoBase64 = null, logoMime = 'image/png';
let selectedTemplate = 'narrative';
let lastReportText = '';
let manualRegion = null;
let _activeSheet = null;

// ========= SHEET MANAGEMENT =========
function openConfigSheet(type) {
  if (_activeSheet) {
    document.getElementById(_activeSheet === '_region' ? 'region-sheet' : 'sheet-' + _activeSheet)?.classList.remove('open');
  }
  _activeSheet = type;
  document.getElementById('sheet-overlay').classList.add('open');
  document.getElementById('sheet-' + type).classList.add('open');
  document.body.style.overflow = 'hidden';
}

function openImportSheet() { openConfigSheet('imported'); }

function closeActiveSheet() {
  if (_activeSheet === '_region') {
    document.getElementById('region-sheet')?.classList.remove('open');
  } else if (_activeSheet) {
    document.getElementById('sheet-' + _activeSheet)?.classList.remove('open');
  }
  _activeSheet = null;
  document.getElementById('sheet-overlay').classList.remove('open');
  document.body.style.overflow = '';
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
let _isProcessing = false;

function _openProcessingOverlay() {
  document.getElementById('processing-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function _closeProcessingOverlay() {
  document.getElementById('processing-overlay').classList.remove('open');
  document.body.style.overflow = '';
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
const sliderMeta = [
  {tokens:1000, words:400,  label:'Muy breve',       cost:'~$0.02'},
  {tokens:1600, words:700,  label:'Breve',            cost:'~$0.03'},
  {tokens:2200, words:950,  label:'Estándar',         cost:'~$0.04'},
  {tokens:2800, words:1200, label:'Medio',            cost:'~$0.05'},
  {tokens:3400, words:1450, label:'Detallado',        cost:'~$0.06'},
  {tokens:4000, words:1700, label:'Completo',         cost:'~$0.07'},
  {tokens:4600, words:2000, label:'Exhaustivo',       cost:'~$0.08'},
  {tokens:5200, words:2250, label:'Muy exhaustivo',   cost:'~$0.09'},
  {tokens:5800, words:2500, label:'Máximo',           cost:'~$0.10'},
  {tokens:6400, words:2750, label:'Clínico completo', cost:'~$0.11'},
  {tokens:7000, words:3000, label:'Ultra completo',   cost:'~$0.12'},
];

function updateSliderLabel() {
  const val = parseInt(document.getElementById('token-slider').value);
  const meta = sliderMeta.find(m => m.tokens === val) || sliderMeta[5];
  document.getElementById('slider-label').textContent =
    `~${meta.words} palabras · ${meta.label} · coste estimado ${meta.cost} por informe`;
  _updateConfigBtns();
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
  const hasAudio = !!document.getElementById('audioBadge');

  const set = (btnId, textId, active, label) => {
    document.getElementById(btnId)?.classList.toggle('has-data', active);
    const el = document.getElementById(textId);
    if (el) el.textContent = label;
  };

  let romLabel = 'ROM';
  if (hasROM) {
    const rd = window._physiqROMContext;
    if (rd.regions) {
      const n = Object.values(rd.regions).filter(r => r.rom && Object.keys(r.rom).length).length;
      romLabel = n ? `ROM · ${n}` : 'ROM ✓';
    } else {
      const n = Object.keys(rd.rom || {}).length;
      romLabel = n ? `ROM · ${n}` : 'ROM ✓';
    }
  }
  set('badge-rom', 'badge-rom-text', hasROM, romLabel);

  let assessLabel = 'Assessment';
  if (window._physiqAssessmentContext) assessLabel = 'Assessment ✓';
  else if (document.getElementById('assessmentIncompleteBadge')) assessLabel = 'Assessment ~';
  set('badge-assessment', 'badge-assessment-text', hasAssessment, assessLabel);

  let forceLabel = 'Force';
  if (hasForce) {
    const n = Array.isArray(window._physiqForceContext) ? window._physiqForceContext.length : 1;
    forceLabel = `Force · ${n}`;
  }
  set('badge-force', 'badge-force-text', hasForce, forceLabel);

  set('badge-audio', 'badge-audio-text', hasAudio, hasAudio ? 'Audio ✓' : 'Audio');

  const hasAny = hasROM || hasAssessment || hasForce || hasAudio;
  const row = document.querySelector('.import-badges');
  if (row) row.style.display = hasAny ? 'flex' : 'none';
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
document.getElementById('patient-name').addEventListener('input', () => {
  checkReady();
  const patient = document.getElementById('patient-name').value.trim();
  const date = document.getElementById('session-date').value.trim() || new Date().toLocaleDateString('es-ES');
  writeSession({ patient, date }).then(session => {
    if (session) updateSessionChip(session);
    if (patient) _sessionCh.postMessage({ type: 'SESSION_PATIENT', patient });
  });
});
document.getElementById('session-date').addEventListener('input', () => { checkReady(); });
document.getElementById('diagnosis').addEventListener('input', () => {
  checkReady();
  writeSession({ diagnosis: document.getElementById('diagnosis').value.trim() });
});

function checkReady() {
  _updateConfigBtns();
  const hasName = !!document.getElementById('patient-name').value.trim();
  const ok = hasName && (selectedFile || window._physiqAssessmentContext || window._physiqROMContext || window._physiqForceContext);
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
    tokens:         document.getElementById('token-slider').value,
    template:       selectedTemplate,
  };
  localStorage.setItem('physiq_config', JSON.stringify(cfg));
  if (logoBase64) { localStorage.setItem('physiq_logo', logoBase64); localStorage.setItem('physiq_logo_mime', logoMime); }
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
  if (c.tokens) { document.getElementById('token-slider').value = c.tokens; }
  if (c.template) selectTemplate(c.template);
  updateSliderLabel();
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
  saveConfig(true); // flush current form state before reading localStorage
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
      } catch { alert('Archivo no válido'); }
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
  document.getElementById('generate-btn').innerHTML = 'Generar Informe CIF-AFTA';
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

function setManualRegion(key, label) {
  manualRegion = key || null;
  writeSession({ manualRegion: key || null });
  const triggerText = document.getElementById('region-trigger-text');
  if (triggerText) triggerText.textContent = label;
  document.querySelectorAll('.sheet-option').forEach(opt => {
    const selected = opt.dataset.region === key;
    opt.classList.toggle('selected', selected);
    const check = opt.querySelector('.sheet-option-check');
    if (check) check.textContent = selected ? '✓' : '';
  });
  closeRegionSheet();
}

function openRegionSheet() {
  if (_activeSheet) {
    document.getElementById(_activeSheet === '_region' ? 'region-sheet' : 'sheet-' + _activeSheet)?.classList.remove('open');
  }
  _activeSheet = '_region';
  document.getElementById('sheet-overlay').classList.add('open');
  document.getElementById('region-sheet').classList.add('open');
  document.body.style.overflow = 'hidden';
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
// buildClinicalContext() / buildROMContext() / buildForceContext() live in lib/payload.js

function buildPrompt(transcript, info, template) {
  const clinicalCtx = buildClinicalContext(window._physiqAssessmentContext);
  const romCtx      = buildROMContext(window._physiqROMContext);
  const forceCtx    = buildForceContext(window._physiqForceContext);
  const hasHypotheses = (window._physiqAssessmentContext?.h || []).length > 0;

  if (template === 'brief') {
    return `Eres un fisioterapeuta clínico experto en documentación CIF-APTA.
Genera un informe clínico breve en español a partir de la transcripción de sesión. El informe debe estar escrito en prosa clínica continua, sin listas de ítems, y no superar las 550 palabras en total.

PACIENTE: ${info.name} | Fecha: ${info.date} | Diagnóstico: ${info.diagnosis}

${clinicalCtx ? clinicalCtx + '\n\n' : ''}${romCtx ? romCtx + '\n\n' : ''}${forceCtx ? forceCtx + '\n\n' : ''}TRANSCRIPCIÓN:
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

${clinicalCtx ? clinicalCtx + '\n\n' : ''}${romCtx ? romCtx + '\n\n' : ''}${forceCtx ? forceCtx + '\n\n' : ''}TRANSCRIPCIÓN DE LA SESIÓN:
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
  const shareBtn = document.getElementById('btn-share');
  if (shareBtn) shareBtn.style.display = navigator.share ? '' : 'none';
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
  _isProcessing = true;
  try {
    const token = await getTurnstileToken();
    _openProcessingOverlay();
    setStep(1,'active');
    const region = window._physiqAssessmentContext?.r ?? manualRegion;
    const result = await callOrchestrator(selectedFile, region, info, token, () => {
      setStep(1,'done'); setStep(2,'active');
    });
    transcriptText = result.transcript;
    setStep(2,'done'); setStep(3,'active');
    await new Promise(r => setTimeout(r, 350));
    setStep(3,'done');
    document.getElementById('result-section').style.display = 'block';
    document.getElementById('step-config').style.display = 'none';
    renderReport(result.report, transcriptText, info);
    document.getElementById('generate-btn').innerHTML = '✓ Informe generado';
  } catch(err) { console.error('[PhysiQ] generateReport error:', err); showError(err.message); }
  finally { _isProcessing = false; _closeProcessingOverlay(); _showTurnstile(); }
}

// ========= DOWNLOAD / SHARE WORD =========
function downloadWord() { loadDocx(_buildAndDownloadWord); }
function shareReport()  { loadDocx(_buildAndShareWord); }

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
    children:[new TextRun({text: 'Paciente: ' + patientName, size:20, font, color:bodyColor})]
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

async function _buildAndShareWord() {
  const { blob, filename, patientName } = await _buildWordBlob();
  const file = new File([blob], filename, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Informe de Fisioterapia — ${patientName}` });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      // share failed (e.g. MIME not supported at runtime) — fall through to download
    }
  }
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
  let text = 'INFORME CIF-AFTA — PhysiQ\n'+'='.repeat(40)+'\n\n';
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
  _hideRecordingHint();
  document.getElementById('file-name').textContent = '';
  document.getElementById('audio-file').value = '';
  document.getElementById('audio-clear-btn').style.display = 'none';
  ['patient-name','session-date','diagnosis'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('result-section').style.display = 'none';
  document.getElementById('step-config').style.display = 'flex';
  _closeProcessingOverlay();
  document.getElementById('error-box').style.display = 'none';
  document.getElementById('generate-btn').disabled = true;
  document.getElementById('generate-btn').innerHTML = 'Generar Informe CIF-AFTA';
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

  let summary;
  if (romData.regions) {
    const parts = Object.entries(romData.regions)
      .filter(([, r]) => r.rom && Object.keys(r.rom).length)
      .map(([, r]) => `${r.label} (${Object.keys(r.rom).length})`);
    summary = parts.join(' · ');
  } else {
    const region = romData.region
      ? romData.region.charAt(0).toUpperCase() + romData.region.slice(1)
      : '—';
    summary = `${region} · ${Object.keys(romData.rom || {}).length} movimientos`;
  }

  const badge = document.createElement('div');
  badge.id = 'romBadge';
  badge.style.cssText = `
    background:rgba(79,156,249,0.08); border:1px solid rgba(79,156,249,0.25);
    border-radius:8px; padding:10px 14px; font-size:12px;
    color:var(--accent); font-family:'DM Mono',monospace;
  `;
  badge.innerHTML = `✓ Movilidad importada desde PhysiQ-Motion · ${summary}`;
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
  badge.innerHTML = `✓ Fuerza importada desde PhysiQ-Force · ${countLabel}` +
    `<br><span style="color:#8fa0bf">${lines.map(l => '· ' + l).join('<br>')}</span>`;
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
    setManualRegion(data.r, label);
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
_sessionCh.onmessage = ({ data }) => {
  if (data.type === 'SESSION_PATIENT') {
    const el = document.getElementById('patient-name');
    if (!el || document.activeElement === el) return;
    el.value = data.patient || '';
    writeSession({ patient: data.patient || '' }).then(session => { if (session) updateSessionChip(session); });
    checkReady();
    return;
  }
  if (data.type === 'SESSION_ROM') {
    if (data.rom && Object.keys(data.rom.regions || {}).length > 0) {
      applyROMContext(data.rom);
    } else {
      document.getElementById('romBadge')?.remove();
      window._physiqROMContext = null;
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
      setManualRegion(data.region, label);
    }
    return;
  }
  if (data.type === 'SESSION_FORCE') {
    if (data.force && (!Array.isArray(data.force) || data.force.length)) {
      applyForceContext(data.force);
    } else {
      window._physiqForceContext = null;
      document.getElementById('forceBadge')?.remove();
      _syncImportedCard();
    }
    return;
  }
  if (data.type === 'SESSION_CLEAR') {
    resetApp();
    window._physiqROMContext = null;
    window._physiqAssessmentContext = null;
    window._physiqForceContext = null;
    setManualRegion('', 'Genérica');
    updateRegionSelector();
    ['romBadge', 'assessmentBadge', 'assessmentIncompleteBadge', 'forceBadge', 'audioBadge'].forEach(id => document.getElementById(id)?.remove());
    _syncImportedCard();
    updateSessionChip(null);
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
  if (!session) { _sessionLabel = ''; btn.classList.remove('active'); return; }
  _sessionLabel = session.patient
    ? `${session.patient} · ${session.date || '—'}`
    : `Sesión · ${session.date || '—'}`;
  btn.classList.add('active');
}

function showConfirmBanner(title, text, actionLabel, onConfirm) {
  const existing = document.getElementById('confirmBanner');
  if (existing) existing.remove();
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
  window.parent.postMessage({ type: 'PHYSIQ_WIDGET_HIDE' }, '*');
  const dismiss = () => { overlay.remove(); window.parent.postMessage({ type: 'PHYSIQ_WIDGET_SHOW' }, '*'); };
  document.getElementById('confirmCancel').onclick = dismiss;
  document.getElementById('confirmAction').onclick = () => { dismiss(); onConfirm(); };
}

function promptClearSession() {
  showConfirmBanner(
    'Nueva sesión',
    `${_sessionLabel}<br>¿Borrar? Se perderán los datos importados.`,
    'Borrar sesión',
    () => {
      resetApp();
      window._physiqROMContext = null;
      window._physiqAssessmentContext = null;
      window._physiqForceContext = null;
      setManualRegion('', 'Genérica');
      updateRegionSelector();
      ['romBadge', 'assessmentBadge', 'assessmentIncompleteBadge', 'forceBadge', 'audioBadge'].forEach(id => document.getElementById(id)?.remove());
      _syncImportedCard();
      clearSession().then(() => {
        updateSessionChip(null);
        _sessionCh.postMessage({ type: 'SESSION_CLEAR' });
      });
    }
  );
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

loadConfig();
_updateConfigBtns();
_updateImportBadges();
document.getElementById('session-date').value = new Date().toLocaleDateString('es-ES');
applyPhysiQAssessmentContext(loadFromPhysiQAssessment());
updateRegionSelector();
_peekAudioFromIDB().then(entry => { if (entry) _showRecordingHint(entry.duration); });
readSession().then(session => {
  if (!session) return;
  if (session.assessment && !window._physiqAssessmentContext) applyPhysiQAssessmentContext(session.assessment);
  if (session.rom && !window._physiqROMContext) applyROMContext(session.rom);
  if (session.force && (!Array.isArray(session.force) || session.force.length) && !document.getElementById('forceBadge')) applyForceContext(session.force);
  if (session.assessmentState && !session.assessment && !window._physiqAssessmentContext) {
    const _phaseLabels = [1, 2, 3, 4, '4b', 5];
    const maxVisited = session.assessmentState.maxVisitedIdx || 0;
    if (session.assessmentState.currentPhase !== 5 && maxVisited > 0) {
      _showAssessmentIncompleteBadge(_phaseLabels[maxVisited]);
    }
    if (session.assessmentState.region) {
      const label = session.assessmentState.region.charAt(0).toUpperCase() + session.assessmentState.region.slice(1);
      setManualRegion(session.assessmentState.region, label);
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
      setManualRegion(session.manualRegion, label);
    }
  }
  checkReady();
  updateSessionChip(session);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ========= SWIPE-TO-DISMISS BOTTOM SHEETS =========
(function () {
  function initSwipe(sheet) {
    let startY = 0, startTime = 0, dragging = false, delta = 0, snapTimer = null;
    const EASE = 'transform 0.3s cubic-bezier(0.32,0.72,0,1)';

    function isHeaderTouch(target) {
      return ['.sheet-handle', '.sheet-title', '.sheet-divider']
        .map(s => sheet.querySelector(s))
        .some(el => el && el.contains(target));
    }

    sheet.addEventListener('touchstart', e => {
      if (window.innerWidth >= 640) return;
      if (!isHeaderTouch(e.target)) return;
      startY = e.touches[0].clientY;
      startTime = Date.now();
      delta = 0;
      dragging = true;
      clearTimeout(snapTimer);
      sheet.style.transition = 'none';
    }, { passive: true });

    sheet.addEventListener('touchmove', e => {
      if (!dragging) return;
      delta = Math.max(0, e.touches[0].clientY - startY);
      sheet.style.transform = delta > 0 ? `translateY(${delta}px)` : 'translateY(0)';
    }, { passive: true });

    function onRelease() {
      if (!dragging) return;
      dragging = false;
      const velocity = delta / (Date.now() - startTime);
      if (delta > 80 || velocity > 0.3) {
        sheet.style.transition = EASE;
        sheet.style.transform = 'translateY(110%)';
        setTimeout(() => {
          sheet.style.transition = 'none';
          closeActiveSheet();
          sheet.style.transform = '';
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

    sheet.addEventListener('touchend', onRelease, { passive: true });
    sheet.addEventListener('touchcancel', () => {
      if (!dragging) return;
      dragging = false;
      sheet.style.transform = '';
      sheet.style.transition = '';
    }, { passive: true });
  }

  document.querySelectorAll('.config-sheet, .region-sheet').forEach(initSwipe);
}());

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
