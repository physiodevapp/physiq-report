// ========= GLOBAL STATE =========
let selectedFile = null, transcriptText = '', logoBase64 = null, logoMime = 'image/png';
let selectedTemplate = 'narrative';
let lastReportText = '';
let manualRegion = null;

// ========= TURNSTILE =========
const TURNSTILE_SITEKEY = '0x4AAAAAADU3dzE5Tw_whVks';
let _turnstileToken = null, _turnstileResolve = null, _turnstileWidgetId = null;

function _showTurnstile() {
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
      _showGenerateBtn();
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
    _turnstileResolve = (token) => {
      _turnstileToken = null;
      turnstile.reset(_turnstileWidgetId);
      _showTurnstile();
      resolve(token);
    };
    setTimeout(() => {
      if (_turnstileResolve) {
        _turnstileResolve = null;
        reject(new Error('Tiempo de verificación agotado. Recarga la página e inténtalo de nuevo.'));
      }
    }, 30000);
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
}

function getTokens() { return parseInt(document.getElementById('token-slider').value) || 4000; }

function selectTemplate(t) {
  selectedTemplate = t;
  document.getElementById('tpl-brief').classList.toggle('selected', t === 'brief');
  document.getElementById('tpl-narrative').classList.toggle('selected', t === 'narrative');
  saveConfig(true);
}

function toggleCard(id) {
  const body = document.getElementById('body-'+id), chev = document.getElementById('chevron-'+id);
  const open = body.classList.contains('open');
  body.classList.toggle('open', !open); chev.classList.toggle('open', !open);
}

function _syncImportedCard() {
  const card = document.getElementById('imported-card');
  if (!card) return;
  const ids = ['romBadge', 'assessmentBadge', 'assessmentIncompleteBadge'];
  const hasAny = ids.some(id => document.getElementById(id));
  const wasHidden = card.style.display === 'none';
  card.style.display = hasAny ? '' : 'none';
  if (hasAny && wasHidden) {
    document.getElementById('body-imported')?.classList.add('open');
    document.getElementById('chevron-imported')?.classList.add('open');
  }
  const summary = document.getElementById('imported-card-summary');
  if (!summary) return;
  const parts = [];
  if (document.getElementById('romBadge')) parts.push('Movilidad');
  if (document.getElementById('assessmentBadge')) parts.push('Valoración');
  if (document.getElementById('assessmentIncompleteBadge')) parts.push('Valoración en curso');
  summary.textContent = parts.join(' · ');
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

document.getElementById('audio-file').addEventListener('change', function(e) {
  selectedFile = e.target.files[0];
  if (selectedFile) { _hideRecordingHint(); document.getElementById('file-name').textContent = '✓ ' + selectedFile.name; checkReady(); }
});
const az = document.getElementById('audio-zone');
az.addEventListener('dragover', e => { e.preventDefault(); az.style.borderColor = 'var(--accent)'; });
az.addEventListener('dragleave', () => az.style.borderColor = '');
az.addEventListener('drop', e => {
  e.preventDefault(); az.style.borderColor = '';
  const f = e.dataTransfer.files[0];
  if (f) { selectedFile = f; document.getElementById('file-name').textContent = '✓ ' + f.name; checkReady(); }
});
document.getElementById('patient-name').addEventListener('input', () => {
  checkReady();
  const patient = document.getElementById('patient-name').value.trim();
  writeSession({ patient }).then(() => {
    if (patient) _sessionCh.postMessage({ type: 'SESSION_PATIENT', patient });
  });
});

function checkReady() {
  const hasName = !!document.getElementById('patient-name').value.trim();
  const ok = hasName && (selectedFile || window._physiqAssessmentContext || window._physiqROMContext);
  document.getElementById('generate-btn').disabled = !ok;
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
    headerStyle: document.querySelector('input[name="hstyle"]:checked').value,
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
  if (c.headerStyle) document.querySelector(`input[name="hstyle"][value="${c.headerStyle}"]`).checked = true;
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

// ========= PROGRESS =========
function setStep(n, s) { document.getElementById('step-'+n).className = 'progress-step '+s; }
function showError(msg) {
  document.getElementById('error-box').textContent = '⚠️ ' + msg;
  document.getElementById('error-box').style.display = 'block';
  document.getElementById('progress-wrap').style.display = 'none';
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
  document.getElementById('sheet-overlay').classList.add('open');
  document.getElementById('region-sheet').classList.add('open');
}

function closeRegionSheet() {
  document.getElementById('sheet-overlay').classList.remove('open');
  document.getElementById('region-sheet').classList.remove('open');
}

function updateRegionSelector() {
  const el = document.getElementById('region-selector');
  if (el) el.style.display = window._physiqAssessmentContext ? 'none' : 'block';
}

// ========= TRANSCRIBE (via Cloudflare Worker) =========
async function transcribeAudio(file, region) {
  const token = await getTurnstileToken();
  const fd = new FormData();
  fd.append('file', file);
  fd.append('prompt', getWhisperPrompt(region));
  const res = await fetch('https://physiq-whisper.edu-gamboa-rodriguez.workers.dev', {
    method: 'POST',
    headers: { 'cf-turnstile-response': token },
    body: fd
  });
  if (!res.ok) { const e = await res.json(); throw new Error('Whisper: '+(e.error?.message||res.status)); }
  return (await res.json()).text;
}

// ========= PROMPTS =========
// ========= CLINICAL CONTEXT BUILDER =========
// buildClinicalContext() lives in lib/payload.js (loaded via <script> in index.html)

function buildPrompt(transcript, info, template) {
  const clinicalCtx = buildClinicalContext(window._physiqAssessmentContext);
  const romCtx      = buildROMContext(window._physiqROMContext);
  const hasHypotheses = (window._physiqAssessmentContext?.h || []).length > 0;

  if (template === 'brief') {
    return `Eres un fisioterapeuta clínico experto en documentación CIF-APTA.
Genera un informe clínico breve en español a partir de la transcripción de sesión. El informe debe estar escrito en prosa clínica continua, sin listas de ítems, y no superar las 550 palabras en total.

PACIENTE: ${info.name} | Fecha: ${info.date} | Diagnóstico: ${info.diagnosis}

${clinicalCtx ? clinicalCtx + '\n\n' : ''}${romCtx ? romCtx + '\n\n' : ''}TRANSCRIPCIÓN:
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

${clinicalCtx ? clinicalCtx + '\n\n' : ''}${romCtx ? romCtx + '\n\n' : ''}TRANSCRIPCIÓN DE LA SESIÓN:
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

// ========= ANALYZE (via Cloudflare Worker) =========
async function analyzeWithClaude(transcript, info) {
  const token = await getTurnstileToken();
  const prompt = buildPrompt(transcript, info, selectedTemplate);
  const res = await fetch('https://physiq-claude.edu-gamboa-rodriguez.workers.dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-turnstile-response': token },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: getTokens(),
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) { const e = await res.json(); throw new Error('Claude: '+(e.error?.message||res.status)); }
  return (await res.json()).content[0].text;
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
function renderReport(reportText, transcript, info) {
  lastReportText = reportText;
  let html = `<div style="margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap;">
    <span class="badge">👤 ${info.name}</span>
    ${info.date?`<span class="badge">📅 ${info.date}</span>`:''}
${info.diagnosis?`<span class="badge">🏥 ${info.diagnosis}</span>`:''}
    <span class="badge">📐 ${selectedTemplate === 'brief' ? 'Breve' : 'Narrativo'}</span>
  </div>`;

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
  document.getElementById('generate-btn').innerHTML = '<div class="spinner"></div> Procesando...';
  document.getElementById('progress-wrap').style.display = 'block';
  [1,2,3].forEach(i => setStep(i,''));
  try {
    if (selectedFile) {
      setStep(1,'active');
      transcriptText = await transcribeAudio(selectedFile, window._physiqAssessmentContext?.r ?? manualRegion);
      setStep(1,'done');
    } else {
      transcriptText = '(No disponible — informe basado exclusivamente en los datos de la valoración estructurada)';
      setStep(1,'done');
    }
    setStep(2,'active');
    const report = await analyzeWithClaude(transcriptText, info);
    setStep(2,'done'); setStep(3,'active');
    await new Promise(r => setTimeout(r, 350));
    setStep(3,'done');
    document.getElementById('progress-wrap').style.display = 'none';
    document.getElementById('result-section').style.display = 'block';
    renderReport(report, transcriptText, info);
    document.getElementById('generate-btn').innerHTML = '✓ Informe generado';
  } catch(err) { showError(err.message); }
}

// ========= DOWNLOAD WORD =========
function downloadWord() { loadDocx(_buildAndDownloadWord); }

async function _buildAndDownloadWord() {
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

  const headerRightCell = new TableCell({
    width: {size: 5886, type: WidthType.DXA},
    borders: {
      top:    {style: BorderStyle.NONE},
      bottom: {style: BorderStyle.NONE},
      left:   {style: BorderStyle.NONE},
      right:  {style: BorderStyle.NONE},
    },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: {after: 40},
        children: [new TextRun({text: clinicUnit || '', bold:true, size:22, font, color: titleColor})]
      }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({text: 'Paciente: ' + patientName, size:20, font, color: bodyColor})]
      })
    ]
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

  children.push(new Paragraph({spacing:{after:200}}));

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

  // ── RGPD on new page, justified, dynamically pushed toward bottom ──
  if (rgpd.trim()) {
    children.push(new Paragraph({children:[new PageBreak()]}));

    const rgpdText = rgpd.trim();
    const charsPerLine = 100;
    const estimatedRgpdLines = rgpdText.split('\n').reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed) return acc;
      return acc + Math.max(1, Math.ceil(trimmed.length / charsPerLine));
    }, 0);

    const linesPerPage = 59;
    const spacersNeeded = Math.max(0, linesPerPage - estimatedRgpdLines - 1);

    for (let i = 0; i < spacersNeeded; i++) {
      children.push(new Paragraph({children:[new TextRun({text:'', size:bodySize, font})], spacing:{after:0}}));
    }

    rgpdText.split('\n').filter(l=>l.trim()).forEach(line => {
      const rgpdSize = Math.max(bodySize-4,16);
      const runs = buildRunsFromLine(line.trim(), {size:rgpdSize, font, color:'ADADAD', italics:true}, {TextRun, ExternalHyperlink});
      children.push(new Paragraph({
        children: runs,
        spacing:{after:80, line:276, lineRule:'auto'},
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
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `PhysiQ_${patientName.replace(/\s+/g,'_')}_${sessionDate.replace(/\//g,'-')}.docx`;
  a.click();
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
    btn.textContent = '✓ Copiado'; setTimeout(()=>btn.textContent='Copiar',2000);
  });
}

function resetApp() {
  selectedFile = null; transcriptText = ''; lastReportText = '';
  _hideRecordingHint();
  document.getElementById('file-name').textContent = '';
  document.getElementById('audio-file').value = '';
  ['patient-name','session-date','diagnosis'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('result-section').style.display = 'none';
  document.getElementById('progress-wrap').style.display = 'none';
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
  if (data.rom) applyROMContext(data.rom);
  showImportedBadge(data);
  updateRegionSelector();
  checkReady();
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
    writeSession({ patient: data.patient || '' });
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
      ['romBadge', 'assessmentBadge', 'assessmentIncompleteBadge', 'audioBadge'].forEach(id => document.getElementById(id)?.remove());
      _syncImportedCard();
      clearSession().then(() => updateSessionChip(null));
    }
  );
}

function _applyImportedAudio(entry) {
  if (!entry) return;
  _hideRecordingHint();
  selectedFile = new File([entry.blob], entry.name, { type: entry.type });
  document.getElementById('file-name').textContent = '✓ ' + entry.name;
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
  const main = document.querySelector('main');
  if (main) main.prepend(badge);
  checkReady();
}

loadConfig();
applyPhysiQAssessmentContext(loadFromPhysiQAssessment());
updateRegionSelector();
_peekAudioFromIDB().then(entry => { if (entry) _showRecordingHint(entry.duration); });
readSession().then(session => {
  if (!session) return;
  if (session.assessment && !window._physiqAssessmentContext) applyPhysiQAssessmentContext(session.assessment);
  if (session.rom && !window._physiqROMContext) applyROMContext(session.rom);
  if (session.assessmentState && !session.assessment && !window._physiqAssessmentContext) {
    const _phaseLabels = [1, 2, 3, 4, '4b', 5];
    const maxVisited = session.assessmentState.maxVisitedIdx || 0;
    if (session.assessmentState.currentPhase !== 5 && maxVisited > 0) {
      _showAssessmentIncompleteBadge(_phaseLabels[maxVisited]);
    }
  }
  const nameEl = document.getElementById('patient-name');
  if (session.patient && nameEl && !nameEl.value) nameEl.value = session.patient;
  const dateEl = document.getElementById('session-date');
  if (session.date && dateEl && !dateEl.value) dateEl.value = session.date;
  checkReady();
  updateSessionChip(session);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ─── TRANSLATE BANNER ────────────────────────────────────
let _translateTimer = null;
function handleTranslateClick() {
  if (window.innerWidth > 768) return;
  const banner = document.getElementById('translateBanner');
  if (!banner) return;
  const bannerH = banner.getBoundingClientRect().height;
  banner.classList.add('visible');
  const main = document.querySelector('main');
  if (main && bannerH > 0) {
    const currentPt = parseFloat(getComputedStyle(main).paddingTop);
    main.style.paddingTop = (currentPt + bannerH) + 'px';
  }
  clearTimeout(_translateTimer);
  _translateTimer = setTimeout(hideTranslateBanner, 4000);
}
function hideTranslateBanner() {
  clearTimeout(_translateTimer);
  const banner = document.getElementById('translateBanner');
  if (banner) banner.classList.remove('visible');
  const main = document.querySelector('main');
  if (main) main.style.paddingTop = '';
}
