// node tests/unit.js
// No external dependencies.

const { decodePayload, buildClinicalContext } = require('../lib/payload.js');

let passed = 0;
let failed = 0;

function assert(description, condition) {
  if (condition) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ ${description}`);
    failed++;
  }
}

function assertThrows(description, fn) {
  try {
    fn();
    console.error(`  ✗ ${description} (no lanzó excepción)`);
    failed++;
  } catch {
    console.log(`  ✓ ${description}`);
    passed++;
  }
}

// ---------------------------------------------------------------------------
// Fixture: payload canónico (misma estructura que buildPhysiQPayload() emite)
// ---------------------------------------------------------------------------
const FULL_PAYLOAD = {
  p:  'Ana García',
  r:  'Hombro derecho',
  d:  '17/05/2026',
  mo: 'Dolor al elevar el brazo',
  me: 'Insidioso',
  cr: 'Subagudo',
  rp: 'Bajo',
  nr: 6,
  ir: 'Moderada',
  na: 'Mecánica',
  si: false,
  br: [],
  sq: [],
  h:  [
    { id: 'imp_rotador', name: 'Síndrome de pinzamiento', sc: 'Alta', lr: 4.2, tr: {} },
    { id: 'tendinopatia', name: 'Tendinopatía del manguito', sc: 'Media', lr: 2.1, tr: {} }
  ],
  pn: {
    variableControl:     'Escala NRS al elevar',
    ventanaRecuperacion: '6-8 semanas',
    anclajeHabito:       'Ejercicio matutino'
  }
};

function encode(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
}

// ---------------------------------------------------------------------------
// Suite 1: decodePayload — round-trip
// ---------------------------------------------------------------------------
console.log('\ndecodePayload()');

assert('round-trip payload completo', (() => {
  const decoded = decodePayload(encode(FULL_PAYLOAD));
  return decoded.p === 'Ana García' && decoded.r === 'Hombro derecho';
})());

assert('round-trip con caracteres especiales (tildes, ñ)', (() => {
  const obj = { p: 'Ángel Muñoz', r: 'Región lumbar' };
  const decoded = decodePayload(encode(obj));
  return decoded.p === 'Ángel Muñoz' && decoded.r === 'Región lumbar';
})());

assert('nr=0 se preserva (no confundido con falsy)', (() => {
  const obj = { ...FULL_PAYLOAD, nr: 0 };
  return decodePayload(encode(obj)).nr === 0;
})());

assert('si=true se preserva', (() => {
  const obj = { ...FULL_PAYLOAD, si: true };
  return decodePayload(encode(obj)).si === true;
})());

assertThrows('base64 inválido lanza excepción', () => decodePayload('!!!no-es-base64!!!'));
assertThrows('JSON malformado lanza excepción', () => decodePayload(btoa('no-es-json')));

// ---------------------------------------------------------------------------
// Suite 2: Contrato de campos — todos los campos del emisor están presentes
// ---------------------------------------------------------------------------
console.log('\nContrato de campos (p, r, d, mo, me, cr, rp, nr, ir, na, si, br, sq, h[], pn)');

const CONTRACT_FIELDS = ['p', 'r', 'd', 'mo', 'me', 'cr', 'rp', 'nr', 'ir', 'na', 'si', 'br', 'sq', 'h', 'pn'];

const decoded = decodePayload(encode(FULL_PAYLOAD));

CONTRACT_FIELDS.forEach(field => {
  assert(`campo '${field}' presente tras decode`, field in decoded);
});

assert("h[] es array", Array.isArray(decoded.h));
assert("br[] es array", Array.isArray(decoded.br));
assert("sq[] es array", Array.isArray(decoded.sq));
assert("pn es objeto con variableControl/ventanaRecuperacion/anclajeHabito", (
  decoded.pn &&
  'variableControl' in decoded.pn &&
  'ventanaRecuperacion' in decoded.pn &&
  'anclajeHabito' in decoded.pn
));

assert("h[].id, h[].name, h[].sc, h[].lr, h[].tr presentes", decoded.h.every(h =>
  'id' in h && 'name' in h && 'sc' in h && 'lr' in h && 'tr' in h
));

// ---------------------------------------------------------------------------
// Suite 3: buildClinicalContext — salida con payload completo
// ---------------------------------------------------------------------------
console.log('\nbuildClinicalContext() — payload completo');

const ctx = buildClinicalContext(FULL_PAYLOAD);

assert('contiene cabecera estructurada', ctx.includes('## DATOS DE VALORACIÓN ESTRUCTURADA'));
assert('contiene nombre del paciente', ctx.includes('Ana García'));
assert('contiene región', ctx.includes('Hombro derecho'));
assert('contiene fecha', ctx.includes('17/05/2026'));
assert('contiene NRS', ctx.includes('6/10'));
assert('contiene hipótesis', ctx.includes('Síndrome de pinzamiento'));
assert('no envía la etiqueta de puntuación de las hipótesis (sc)', !/— (Alta|Media)\b/.test(ctx) && !ctx.includes('peso diagnóstico'));
assert('contiene variable de control, con etiqueta neutra', ctx.includes('Para dosificar la carga: Escala NRS al elevar'));
assert('contiene ventana de recuperación, con etiqueta neutra', ctx.includes('Recuperación entre sesiones: 6-8 semanas'));
assert('no nombra los campos de las notas del plan', !/Variable de control|Ventana de recuperación|Anclaje de hábito/.test(ctx));
assert('los datos del fisio prevalecen, sin «más fiables que la transcripción»', !ctx.includes('más fiables') && ctx.includes('regla de discrepancias'));
assert('cribado sistémico negativo', ctx.includes('Cribado sistémico: Negativo'));
assert('banderas rojas negativas', ctx.includes('Negativas'));
assert('termina con ---', ctx.trimEnd().endsWith('---'));

// ---------------------------------------------------------------------------
// Suite 4: buildClinicalContext — degradación con campos ausentes / nulos
// ---------------------------------------------------------------------------
console.log('\nbuildClinicalContext() — degradación graceful');

assert('data=null devuelve string vacío', buildClinicalContext(null) === '');
assert('data=undefined devuelve string vacío', buildClinicalContext(undefined) === '');

const ctxMinimo = buildClinicalContext({ p: '', r: '', d: '', nr: 0 });
assert('payload mínimo no lanza excepción', typeof ctxMinimo === 'string');
assert('nr=0 se muestra como 0/10, no como —', ctxMinimo.includes('0/10'));

const ctxConBR = buildClinicalContext({
  ...FULL_PAYLOAD,
  br: ['Déficit neurológico', 'Pérdida de peso inexplicable'],
  si: true,
  sq: ['Dolor torácico', 'Disfagia']
});
assert('banderas rojas positivas incluyen ⚠️', ctxConBR.includes('⚠️ Déficit neurológico'));
assert('cribado sistémico positivo', ctxConBR.includes('⚠️ Positivo'));
assert('alertas sistémicas positivas listadas', ctxConBR.includes('Dolor torácico'));

const ctxSinHip = buildClinicalContext({ ...FULL_PAYLOAD, h: [] });
assert('sin hipótesis muestra mensaje vacío', ctxSinHip.includes('(sin hipótesis registradas)'));

const ctxSinPn = buildClinicalContext({ ...FULL_PAYLOAD, pn: null });
assert('pn=null: sin bloque de indicaciones del plan (antes «—», que acababa como «no se especificó»)', !ctxSinPn.includes('Indicaciones del fisioterapeuta'));
const ctxPnVacio = buildClinicalContext({ ...FULL_PAYLOAD, pn: { variableControl: 'Dolor ≤ 4/10', ventanaRecuperacion: '', anclajeHabito: '  ' } });
assert('notas del plan: solo las que tienen texto', ctxPnVacio.includes('Para dosificar la carga: Dolor ≤ 4/10') && !ctxPnVacio.includes('Recuperación entre sesiones') && !ctxPnVacio.includes('Cuándo hacer'));

// ---------------------------------------------------------------------------
// Suite 5: buildClinicalContext — campos portados de physiq-assessment
// ---------------------------------------------------------------------------
console.log('\nbuildClinicalContext() — campos que el payload ya traía');

const ctxDeriv = buildClinicalContext({ ...FULL_PAYLOAD, ur: ['Sospecha de cauda equina: derivar hoy a urgencias'], dv: ['Claudicación vascular: valoración médica'] });
assert('derivación urgente (ur) presente y marcada', ctxDeriv.includes('DERIVACIÓN URGENTE') && ctxDeriv.includes('cauda equina'));
assert('derivación médica (dv) presente', ctxDeriv.includes('Derivación médica indicada') && ctxDeriv.includes('Claudicación vascular'));
assert('sin ur ni dv no hay bloque de derivación', !ctx.includes('DERIVACIÓN') && !ctx.includes('Derivación médica'));

assert('lado afectado (la)', buildClinicalContext({ ...FULL_PAYLOAD, r: 'hombro', la: 'Derecho' }).includes('Región: hombro · Lado afectado: derecho'));
assert('sin la, sin lado', !ctx.includes('Lado afectado'));

const ctxCq = buildClinicalContext({ ...FULL_PAYLOAD, cq: { iv: 'Artroplastia total de cadera', fe: '2026-09-01', se: 5, pr: 'Escrito', re: 'Sin flexión >90°', co: [] } });
assert('cirugía (cq): intervención, protocolo y restricciones', ctxCq.includes('Cirugía (paciente posquirúrgico)') && ctxCq.includes('Artroplastia total de cadera') && ctxCq.includes('Protocolo del cirujano: escrito') && ctxCq.includes('Sin flexión >90°'));
const ctxCqSin = buildClinicalContext({ ...FULL_PAYLOAD, cq: { iv: '', fe: '', se: null, pr: 'No hay', re: '', co: [] } });
assert('cirugía sin protocolo: pendiente de confirmar con el cirujano', ctxCqSin.includes('pendientes de confirmar con el cirujano'));

const ctxSv = buildClinicalContext({ ...FULL_PAYLOAD, sv: { fc: 70, fr: null, spo2: null, tas: 128, tad: 80 }, an: { talla: 178, peso: 84, imc: 26.5123 } });
assert('signos vitales y antropometría, sin clasificar, IMC con un decimal', ctxSv.includes('FC 70 lpm · TA 128/80 mmHg · talla 178 cm · peso 84 kg · IMC 26.5'));

assert('NRS no registrado (null) no es «—/10» ni 0', buildClinicalContext({ ...FULL_PAYLOAD, nr: null }).includes('NRS: no registrado'));

const hipotesis = buildClinicalContext({ ...FULL_PAYLOAD, h: [
  { id: 'x', name: 'Fractura (→ Rx)', sc: '🔴 Derivar', lr: null, tr: {}, dt: true },
  { id: 'pq1', name: 'Postoperatorio: prótesis', sc: '', lr: null, tr: {}, pq: true },
  { id: 'y', name: 'Lumbar → radicular', sc: '🟢 Peso alto (LR× 5.9)', lr: 5.9, tr: {} }
] });
assert('hipótesis tratada (dt) como antecedente', hipotesis.includes('Fractura (diagnóstico ya confirmado y tratado'));
assert('postoperatoria (pq) como condición de salud', hipotesis.includes('la cirugía es la condición de salud'));
assert('etiquetas limpias: sin «(→ Rx)», «A → B» como «orienta a»', !hipotesis.includes('(→ Rx)') && hipotesis.includes('Lumbar — orienta a: radicular'));
assert('sin LR ni pesos', !/LR×|Peso alto/.test(hipotesis));

const FP = [
  { s: 'General', q: '¿Le despierta por la noche?', a: 'No sabría decir' },
  { s: 'General', q: '¿Qué ha probado ya?', a: 'Medicación, No sabría decir' },
  { s: 'Rodilla', q: '¿Le duele al…?', a: 'Subir escaleras: Sí · Caminar: No sé · Correr: No' },
  { s: 'General', q: '¿Le sirvió?', a: 'El ibuprofeno: algo' }
];
const ctxFp = buildClinicalContext({ ...FULL_PAYLOAD, fp: FP });
assert('formulario previo (fp) presente', ctxFp.includes('Lo que refiere el paciente antes de la consulta'));
assert('fp sin «No sé» / «No sabría decir»', !/No s[eé]\b|No sabría decir/.test(ctxFp));
assert('fp: respuesta solo «No sabría decir» se quita entera', !ctxFp.includes('¿Le despierta por la noche?'));
assert('fp: múltiple y matriz quitan solo la parte «No sé»', ctxFp.includes('¿Qué ha probado ya? → Medicación') && ctxFp.includes('Subir escaleras: Sí · Correr: No'));
assert('fp: texto libre con «:» intacto', ctxFp.includes('El ibuprofeno: algo'));
const R = require('../lib/reglas-informe.js');
assert('fp sin audio: sin recordatorio de discrepancias', !ctxFp.includes(R.RECORDATORIO_DISCREPANCIAS));
assert('fp con audio: recordatorio de discrepancias', buildClinicalContext({ ...FULL_PAYLOAD, fp: FP }, { conAudio: true }).includes(R.RECORDATORIO_DISCREPANCIAS));

const ctxBreve = buildClinicalContext({ ...FULL_PAYLOAD, md: 'breve', pe: ['Cribado sistémico solo por embudo: Cardiovascular', 'Restricciones pendientes de confirmar con el cirujano'], cq: { iv: 'x', pr: 'No hay', co: [] } });
assert('modo breve: lo dice y lista lo pendiente', ctxBreve.includes('inicial breve') && ctxBreve.includes('Cribado sistémico solo por embudo'));
assert('modo breve con cirugía: el «cirujano» no se repite en lo pendiente', !ctxBreve.split('Pendiente de completar')[1].includes('cirujano'));
assert('modo breve por embudo: el cribado no es «Negativo» sin más', ctxBreve.includes('sin hallazgos en el embudo (cribado abreviado)'));
assert('modo completo: nada de breve', !ctx.includes('inicial breve'));

// ---------------------------------------------------------------------------
// Suite 6: reglas compartidas con physiq-assessment (lib/reglas-informe.js)
// ---------------------------------------------------------------------------
console.log('\nlib/reglas-informe.js — compartido con physiq-assessment');

// Idéntico byte a byte al de physiq-assessment: si cambia aquí, cópialo allí
// tal cual y actualiza esta huella en los dos tests/unit.js.
const HUELLA_REGLAS_INFORME = '39a6ab702f3a22643c3e63422cc2e3c3e76441da9c0594723df9c0cd14b5590c';
const huella = require('crypto').createHash('sha256').update(require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'reglas-informe.js'))).digest('hex');
assert('lib/reglas-informe.js no ha cambiado sin copiarlo a physiq-assessment (huella SHA-256)', huella === HUELLA_REGLAS_INFORME);
assert('exporta las reglas', typeof R.REGLAS_COMUNES === 'string' && typeof R.reglaDerivacion === 'function' && typeof R.reglaAudio === 'function' && typeof R.cabeceraAudio === 'function' && typeof R.PISTA_DICTADO === 'string');
assert('también queda en globalThis (script clásico en el navegador)', globalThis.PHYSIQ_REGLAS_INFORME === R);
assert('regla de dictado: primera persona = fisio, lo no hecho no se menciona', R.reglaAudio(true, true).includes('primera persona') && R.reglaAudio(true, true).includes('no la ha hecho'));
assert('cabecera del dictado', R.cabeceraAudio(true, false).startsWith('DICTADO DEL FISIOTERAPEUTA') && R.cabeceraAudio(false, false) === 'TRANSCRIPCIÓN DE LA SESIÓN:' && R.cabeceraAudio(false, true) === 'TRANSCRIPCIÓN:');
assert('derivación: una vez, al principio de la sección indicada', R.reglaDerivacion('## OBJETIVOS Y PLAN').includes('UNA sola vez, al principio de ## OBJETIVOS Y PLAN'));

const deploy = require('fs').readFileSync(require('path').join(__dirname, '..', '.github', 'workflows', 'deploy-to-hub.yml'), 'utf8');
assert('deploy-to-hub copia lib/reglas-informe.js', deploy.includes('lib/reglas-informe.js'));
const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
assert('index.html carga reglas-informe.js antes de payload.js y app.js', html.indexOf('lib/reglas-informe.js') > 0 && html.indexOf('lib/reglas-informe.js') < html.indexOf('lib/payload.js') && html.indexOf('lib/payload.js') < html.indexOf('src="app.js"'));

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------
console.log(`\n${passed + failed} tests: ${passed} pasados, ${failed} fallidos`);
if (failed > 0) process.exit(1);
