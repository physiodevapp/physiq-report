// node tests/unit.js
// No external dependencies.

const { decodePayload, buildClinicalContext, resumenSintomas } = require('../lib/payload.js');

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
assert('NRS: sin momento inventado (ronda 27 de physiq-assessment)', /6\/10 \(intensidad registrada por el fisioterapeuta en la valoración: .*sin atribuirle otro momento/.test(ctx));

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
const HUELLA_REGLAS_INFORME = 'd4b2256d15abc49b32db822e2cb10794a4150e5ef509242b8cde030262c52008';
const huella = require('crypto').createHash('sha256').update(require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'reglas-informe.js'))).digest('hex');
assert('lib/reglas-informe.js no ha cambiado sin copiarlo a physiq-assessment (huella SHA-256)', huella === HUELLA_REGLAS_INFORME);
assert('exporta las reglas', typeof R.REGLAS_COMUNES === 'string' && typeof R.reglaDerivacion === 'function' && typeof R.reglaAudio === 'function' && typeof R.cabeceraAudio === 'function' && typeof R.PISTA_DICTADO === 'string');
// Cuestionarios de la calculadora de physiq-assessment (`cu`)
const CU = [
  { id: 'phq9', n: 'PHQ-9', v: '12/27', i: 'Síntomas depresivos moderados', a: ['Ítem 9: pensamientos de muerte o autolesión. Pregunta por el riesgo hoy'] },
  { id: 'odi', n: 'ODI', v: '38 %', i: 'Limitación funcional grave' },
  { id: 'tsk11', n: 'TSK-11', v: '30/44' },
  { id: 'gad7', n: 'GAD-7', v: '—', inc: true, a: [] },
  { id: 'dn4', n: 'DN4', v: '—', inc: true, a: ['Aviso de prueba'] },
];
const ctxCu = buildClinicalContext({ ...FULL_PAYLOAD, cu: CU });
assert('cu: bloque de cuestionarios presente', ctxCu.includes('Cuestionarios que ha rellenado el paciente'));
assert('cu: completo con puntuación, interpretación y aviso', ctxCu.includes('  · PHQ-9: 12/27 — Síntomas depresivos moderados · Aviso: Ítem 9: pensamientos de muerte'));
assert('cu: sin interpretación publicada, solo la puntuación', ctxCu.includes('  · TSK-11: 30/44\n') || ctxCu.includes('  · TSK-11: 30/44'));
assert('cu: a medias sin aviso no se envía', !ctxCu.includes('GAD-7'));
assert('cu: a medias con aviso, solo el aviso', ctxCu.includes('  · DN4: sin completar · ⚠️ Aviso de prueba'));
assert('sin cu: sin bloque de cuestionarios', !buildClinicalContext(FULL_PAYLOAD).includes('Cuestionarios que ha rellenado'));
assert('cu vacío: sin bloque', !buildClinicalContext({ ...FULL_PAYLOAD, cu: [] }).includes('Cuestionarios que ha rellenado'));

// Varios síntomas (P1–P4, z1/ss): mismo bloque que bloqueSintomasIA() de
// physiq-assessment (lib/sintomas.js). Los textos esperados son su salida
// literal para estos datos: si allí cambia, se copia aquí.
console.log('\nsíntomas P1–P4 (z1, ss)');
const SINT = { z1: { z: 'Zona lumbar, glúteo', la: 'Derecho', pr: 'Profunda', pa: 'Constante', de: 'sordo' },
  ss: [{ n: 2, z: 'Pierna por debajo de la rodilla', la: 'Derecho', nr: 3, ir: 'Baja', pa: 'Intermitente', re: 'empeora' },
       { n: 3, z: 'Rodilla', la: 'Izquierdo', nr: 4, or: true }, { n: 4, z: 'Pie', nr: null, re: 'nosabe', de: 'hormigueo' }] };
const ctxSint = buildClinicalContext({ ...FULL_PAYLOAD, ...SINT });
assert('síntomas: el bloque es el de physiq-assessment, literal', ctxSint.includes("Síntomas que refiere el paciente (mapa corporal):\n  · P1 (principal; el NRS y la irritabilidad de arriba son los suyos): Zona lumbar, glúteo · lado derecho · profunda · constante · «sordo»\n  · P2: Pierna por debajo de la rodilla · lado derecho · NRS 3/10 · irritabilidad baja · intermitente · solo cuando empeora P1\n  · P3: Rodilla (otra región, no valorada hoy) · lado izquierdo · NRS 4/10\n  · P4: Pie · NRS no registrado · relación con P1 no conocida · «hormigueo»\nDescribe cada síntoma con sus propios datos: no atribuyas a uno la intensidad, la irritabilidad ni el comportamiento de otro. Lo marcado como «otra región, no valorada hoy» no se exploró: menciónalo solo como pendiente de valorar, sin hipótesis ni plan."));
assert('síntomas: va justo después de la irritabilidad', ctxSint.includes('Irritabilidad: Moderada · Naturaleza: Mecánica\nSíntomas que refiere el paciente'));
assert('síntomas: sin P1 con datos y otra relación, sin la frase de otra región', buildClinicalContext({ ...FULL_PAYLOAD, ss: [{ n: 2, z: 'Ingle', nr: 2, re: 'independiente' }] }).includes("Síntomas que refiere el paciente (mapa corporal):\n  · P1 (principal; el NRS y la irritabilidad de arriba son los suyos): zona sin indicar\n  · P2: Ingle · NRS 2/10 · independiente de P1\nDescribe cada síntoma con sus propios datos: no atribuyas a uno la intensidad, la irritabilidad ni el comportamiento de otro."));
assert('síntomas: sin z1 ni ss (valoración anterior), sin bloque', !buildClinicalContext(FULL_PAYLOAD).includes('mapa corporal'));
assert('síntomas: ss vacío y sin z1, sin bloque', !buildClinicalContext({ ...FULL_PAYLOAD, ss: [] }).includes('mapa corporal'));
assert('síntomas: insignia con las zonas', resumenSintomas(SINT) === 'P1 Zona lumbar, glúteo · P2 Pierna por debajo de la rodilla · P3 Rodilla (otra región) · P4 Pie');
assert('síntomas: insignia sin línea con solo P1 o nada', resumenSintomas({ z1: { z: 'Cuello' }, ss: [] }) === '' && resumenSintomas(FULL_PAYLOAD) === '');
assert('síntomas: app.js pinta la línea con textContent', /linea\.textContent = `Síntomas: \$\{sint\}`/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8')));

// Hipermovilidad (hm): mismo bloque que bloqueHMIA() de physiq-assessment
// (lib/hipermovilidad.js; Fase P). Los textos esperados son su salida literal
// para estos datos, y su test (tests/unit/hipermovilidad.mjs) fija los mismos:
// si allí cambia, se copia aquí.
console.log('\nhipermovilidad (hm)');
const HM_CASOS = {
  sospecha: [{ es: "sospecha", st: "", bt: 5, co: 5, cu: 3, hag: true, vs: true },
    "Hipermovilidad (condición especial marcada por el fisioterapeuta):\n  · Estado: sospecha\n  · Beighton 5/9 (corte 5): hipermovilidad articular generalizada\n  · Cuestionario de 5 preguntas: 3 «sí»\n  · Es una sospecha: no escribas que el paciente tiene un síndrome de Ehlers-Danlos.\n  · Consideraciones para el plan: Ejercicio graduado; vigila la carga para asegurar la recuperación. El dolor empeora con la actividad y puede aparecer en las 24 h siguientes. Hipermovilidad articular generalizada: valorar derivación a reumatología o genética. No es un diagnóstico de SED hipermóvil, que exige además otros criterios. Rasgos que hacen sospechar el subtipo vascular: derivación preferente a genética. Si hay disautonomía o síntomas digestivos o urinarios importantes, derivar al especialista."],
  vascular: [{ es: "diagnosticada", st: "vascular", bt: null, co: null, cu: null, hag: null, vs: false },
    "Hipermovilidad (condición especial marcada por el fisioterapeuta):\n  · Estado: diagnosticada (subtipo vascular)\n  · Consideraciones para el plan: Ejercicio graduado; vigila la carga para asegurar la recuperación. El dolor empeora con la actividad y puede aparecer en las 24 h siguientes. Subtipo vascular: evitar deportes de colisión, ejercicio isométrico y aceleraciones bruscas; intensidad que permita conversar, control de la respiración al levantar peso y cargas ligeras. Si hay disautonomía o síntomas digestivos o urinarios importantes, derivar al especialista."],
  hipermovil: [{ es: "diagnosticada", st: "hipermovil", bt: 3, co: 6, cu: null, hag: false, vs: false },
    "Hipermovilidad (condición especial marcada por el fisioterapeuta):\n  · Estado: diagnosticada (subtipo hipermóvil (SEDh) o TEH)\n  · Beighton 3/9 (corte 6): sin hipermovilidad articular generalizada\n  · Consideraciones para el plan: Ejercicio graduado; vigila la carga para asegurar la recuperación. El dolor empeora con la actividad y puede aparecer en las 24 h siguientes. Si hay disautonomía o síntomas digestivos o urinarios importantes, derivar al especialista."],
  ns: [{ es: "diagnosticada", st: "ns", bt: null, co: null, cu: null, hag: null, vs: true },
    "Hipermovilidad (condición especial marcada por el fisioterapeuta):\n  · Estado: diagnosticada\n  · Consideraciones para el plan: Ejercicio graduado; vigila la carga para asegurar la recuperación. El dolor empeora con la actividad y puede aparecer en las 24 h siguientes. Rasgos que hacen sospechar el subtipo vascular: derivación preferente a genética. Si hay disautonomía o síntomas digestivos o urinarios importantes, derivar al especialista."],
  otro: [{ es: "diagnosticada", st: "otro", bt: 4, co: null, cu: null, hag: null, vs: false },
    "Hipermovilidad (condición especial marcada por el fisioterapeuta):\n  · Estado: diagnosticada (subtipo otro)\n  · Beighton 4/9\n  · Consideraciones para el plan: Ejercicio graduado; vigila la carga para asegurar la recuperación. El dolor empeora con la actividad y puede aparecer en las 24 h siguientes. Si hay disautonomía o síntomas digestivos o urinarios importantes, derivar al especialista."],
};
for (const [k, [hm, esperado]] of Object.entries(HM_CASOS)) {
  assert(`hm ${k}: el bloque es el de physiq-assessment, literal`, buildClinicalContext({ ...FULL_PAYLOAD, hm }).includes(esperado));
}
assert('hm: sin citas (el informe no nombra fuentes)', Object.values(HM_CASOS).every(([, t]) => !/\d{4}/.test(t.replace(/24 h/, ''))));
assert('hm: va justo después de la cirugía', /Cirug[ií]a[\s\S]*\n\nHipermovilidad \(condición especial/.test(buildClinicalContext({ ...FULL_PAYLOAD, cq: { iv: 'Artroscopia', co: [] }, hm: HM_CASOS.sospecha[0] })));
assert('sin hm (valoración anterior o sin la tarjeta), sin bloque', !buildClinicalContext(FULL_PAYLOAD).includes('Hipermovilidad (condición'));

// Disautonomía / POTS (ds): mismo bloque que bloqueDsIA() de physiq-assessment
// (lib/disautonomia.js; Fase P, docs/pots.md). Los textos esperados son su
// salida literal para estos datos, y su test (tests/unit/disautonomia.mjs,
// DS_CASOS) fija los mismos: si allí cambia, se copia aquí.
console.log('\ndisautonomía (ds)');
const DS_CASOS = {
  sospecha: [{"es":"sospecha","ti":"","pb":true,"dfc":32,"ho":false,"ot":true,"cs":2},
    "Disautonomía (condición especial marcada por el fisioterapeuta):\n  · Estado: sospecha\n  · Prueba de bipedestación activa: aumento de la FC de 32 lpm mantenido, sin hipotensión ortostática (compatible con taquicardia ortostática)\n  · Patrón de intolerancia ortostática: 2 de 2 «sí»\n  · Es una sospecha: no escribas que el paciente tiene un POTS; el diagnóstico es médico.\n  · Consideraciones para el plan: Ejercicio regular, al principio semirreclinado (remo, bicicleta reclinada, natación) y lo vertical poco a poco; al menos 4 días por semana, sesiones de al menos 30 min. La mejoría puede tardar 4–6 semanas y al principio puede encontrarse peor. Mejor ejercicio dinámico que isométrico (el isométrico provoca maniobras de Valsalva que bajan la tensión), no comer en la hora anterior y terminar con una vuelta a la calma suave. Aumento de la FC al ponerse de pie sin hipotensión ortostática: derivación preferente a su médico de atención primaria para confirmar el diagnóstico y descartar otras causas. Un desmayo durante el esfuerzo, tumbado, tras palpitaciones bruscas o con síntomas del corazón no lo explica la disautonomía: valoración médica urgente. El agua, la sal, las prendas de compresión y los fármacos los indica el médico."],
  ho: [{"es":"sospecha","ti":"","pb":true,"dfc":null,"ho":true,"ot":false,"cs":null},
    "Disautonomía (condición especial marcada por el fisioterapeuta):\n  · Estado: sospecha\n  · Prueba de bipedestación activa: caída de la tensión (hipotensión ortostática)\n  · Es una sospecha: no escribas que el paciente tiene un POTS; el diagnóstico es médico.\n  · Consideraciones para el plan: Ejercicio regular, al principio semirreclinado (remo, bicicleta reclinada, natación) y lo vertical poco a poco; al menos 4 días por semana, sesiones de al menos 30 min. La mejoría puede tardar 4–6 semanas y al principio puede encontrarse peor. Mejor ejercicio dinámico que isométrico (el isométrico provoca maniobras de Valsalva que bajan la tensión), no comer en la hora anterior y terminar con una vuelta a la calma suave. Caída de la tensión al ponerse de pie: hipotensión ortostática, no un POTS. Valoración médica, con revisión de los fármacos. Un desmayo durante el esfuerzo, tumbado, tras palpitaciones bruscas o con síntomas del corazón no lo explica la disautonomía: valoración médica urgente. El agua, la sal, las prendas de compresión y los fármacos los indica el médico."],
  pots: [{"es":"diagnosticada","ti":"pots","pb":false,"dfc":null,"ho":null,"ot":null,"cs":null},
    "Disautonomía (condición especial marcada por el fisioterapeuta):\n  · Estado: diagnosticada (POTS)\n  · Consideraciones para el plan: Ejercicio regular, al principio semirreclinado (remo, bicicleta reclinada, natación) y lo vertical poco a poco; al menos 4 días por semana, sesiones de al menos 30 min. La mejoría puede tardar 4–6 semanas y al principio puede encontrarse peor. Mejor ejercicio dinámico que isométrico (el isométrico provoca maniobras de Valsalva que bajan la tensión), no comer en la hora anterior y terminar con una vuelta a la calma suave. Un desmayo durante el esfuerzo, tumbado, tras palpitaciones bruscas o con síntomas del corazón no lo explica la disautonomía: valoración médica urgente. El agua, la sal, las prendas de compresión y los fármacos los indica el médico."],
  diagHO: [{"es":"diagnosticada","ti":"ho","pb":true,"dfc":12,"ho":false,"ot":false,"cs":null},
    "Disautonomía (condición especial marcada por el fisioterapeuta):\n  · Estado: diagnosticada (hipotensión ortostática)\n  · Prueba de bipedestación activa: no llega al corte (aumento mantenido de 12 lpm)\n  · Consideraciones para el plan: Mejor ejercicio dinámico que isométrico (el isométrico provoca maniobras de Valsalva que bajan la tensión), no comer en la hora anterior y terminar con una vuelta a la calma suave. Un desmayo durante el esfuerzo, tumbado, tras palpitaciones bruscas o con síntomas del corazón no lo explica la disautonomía: valoración médica urgente. El agua, la sal, las prendas de compresión y los fármacos los indica el médico."],
};
for (const [k, [ds, esperado]] of Object.entries(DS_CASOS)) {
  assert(`ds ${k}: el bloque es el de physiq-assessment, literal`, buildClinicalContext({ ...FULL_PAYLOAD, ds }).includes(esperado));
}
assert('ds: sin citas (el informe no nombra fuentes)', Object.values(DS_CASOS).every(([, t]) => !/(19|20)\d{2}/.test(t)));
assert('ds: con la sospecha, prohíbe escribir que tiene un POTS', DS_CASOS.sospecha[1].includes('no escribas que el paciente tiene un POTS'));
assert('ds: va justo después de la hipermovilidad', /Hipermovilidad \(condición especial[\s\S]*\n\nDisautonomía \(condición especial/.test(buildClinicalContext({ ...FULL_PAYLOAD, hm: HM_CASOS.sospecha[0], ds: DS_CASOS.pots[0] })));
assert('sin ds (valoración anterior o sin la tarjeta), sin bloque', !buildClinicalContext(FULL_PAYLOAD).includes('Disautonomía (condición'));

// Lupus (le): mismo bloque que bloqueLESIA() de physiq-assessment (lib/lupus.js;
// Fase P, docs/lupus.md). Los textos esperados son su salida literal para estos
// datos, y su test (tests/unit/lupus.mjs, LES_CASOS) fija los mismos: si allí
// cambia, se copia aquí.
console.log('\nlupus (le)');
const LES_CASOS = {
  diagnosticado: [{ es: 'diagnosticado', gc: 'm', ga: 'si', is: 'si', af: 'saf', at: true, on: true, ry: true, av: 'brote' },
    "Lupus (condición especial marcada por el fisioterapeuta):\n  · Estado: diagnosticado\n  · Datos: corticoides de más de 5 hasta 20 mg/día; ha tomado dosis altas (más de 20 mg/día más de 4 semanas); inmunosupresores o biológicos; síndrome antifosfolípido con trombosis previa; anticoagulante o antiagregante; osteonecrosis o artropatía de Jaccoud conocidas; fenómeno de Raynaud; en brote, según su médico\n  · Consideraciones para el plan: Con el lupus inactivo o leve, llegar poco a poco a 150–300 min por semana de intensidad moderada (esfuerzo 5–6 sobre 10) y fuerza al menos 2 días. Sesiones con aeróbico y fuerza, 3–5 por semana; fuerza en 1–3 series de 8–12 repeticiones con 1–3 min de descanso; aeróbico de 20–30 min hasta 50, en tramos de 4 semanas; con calentamiento y vuelta a la calma. Supervisado por un fisioterapeuta. Puede reducir algo la fatiga, y la actividad del lupus probablemente no cambia. Antes de empezar, su médico valora si hay contraindicaciones; antes de ejercicio vigoroso, puede hacer falta un ECG o una prueba de esfuerzo. Con osteonecrosis o artropatía de Jaccoud, que lo valore un especialista antes de empezar. En brote, que su reumatólogo revalore las contraindicaciones antes de seguir; en un brote articular, no cargar las articulaciones inflamadas. Fotoprotección para prevenir brotes: protector solar de amplio espectro UVA y UVB, ropa que cubra, sombrero y gafas de sol, y evitar las horas de más sol. Evitar el ejercicio al sol con un índice UV por encima de 3. Raynaud: al aire libre, guantes o ropa contra el frío; evitar tocar superficies frías y secar bien la piel durante y después del ejercicio. Por lo mismo, cuidado con el frío local en manos y pies. Fiebre o malestar general nuevos: valoración médica hoy; con corticoides puede no haber fiebre. Antifosfolípidos: la actividad física se recomienda también con anticoagulantes. No sugerir suspender el anticoagulante: retirarlo desencadena el síndrome antifosfolípido catastrófico. Riesgo de osteonecrosis: un dolor profundo en carga de cadera, rodilla, hombro o tobillo → valoración médica. Si fuma, dejarlo: el tabaco aumenta la actividad del lupus y el riesgo cardiovascular. Los corticoides, los inmunosupresores y el anticoagulante los ajusta su reumatólogo."],
  diagnosticadoMinimo: [{ es: 'diagnosticado', gc: null, ga: null, is: null, af: null, at: false, on: false, ry: false, av: null },
    "Lupus (condición especial marcada por el fisioterapeuta):\n  · Estado: diagnosticado\n  · Consideraciones para el plan: Con el lupus inactivo o leve, llegar poco a poco a 150–300 min por semana de intensidad moderada (esfuerzo 5–6 sobre 10) y fuerza al menos 2 días. Sesiones con aeróbico y fuerza, 3–5 por semana; fuerza en 1–3 series de 8–12 repeticiones con 1–3 min de descanso; aeróbico de 20–30 min hasta 50, en tramos de 4 semanas; con calentamiento y vuelta a la calma. Supervisado por un fisioterapeuta. Puede reducir algo la fatiga, y la actividad del lupus probablemente no cambia. Antes de empezar, su médico valora si hay contraindicaciones; antes de ejercicio vigoroso, puede hacer falta un ECG o una prueba de esfuerzo. Fotoprotección para prevenir brotes: protector solar de amplio espectro UVA y UVB, ropa que cubra, sombrero y gafas de sol, y evitar las horas de más sol. Evitar el ejercicio al sol con un índice UV por encima de 3. Fiebre o malestar general nuevos: valoración médica hoy; con corticoides puede no haber fiebre. Si fuma, dejarlo: el tabaco aumenta la actividad del lupus y el riesgo cardiovascular. Los corticoides, los inmunosupresores y el anticoagulante los ajusta su reumatólogo."],
  sospecha: [{ es: 'sospecha', rs: 2, fd: true },
    "Lupus (condición especial marcada por el fisioterapeuta):\n  · Estado: sospecha\n  · Rasgos que justifican una valoración médica: 2 de 5 «sí»\n  · Es una sospecha: no escribas que el paciente tiene un lupus; el diagnóstico es médico.\n  · Consideraciones para el plan: Rasgos que pueden corresponder a una enfermedad inflamatoria sistémica: derivación preferente a su médico de atención primaria. El diagnóstico es médico y necesita analítica. Si empezó tras un fármaco nuevo, comentarlo con quien lo recetó."],
  sospechaSinRasgos: [{ es: 'sospecha', rs: 0, fd: false },
    "Lupus (condición especial marcada por el fisioterapeuta):\n  · Estado: sospecha\n  · Rasgos que justifican una valoración médica: 0 de 5 «sí»\n  · Es una sospecha: no escribas que el paciente tiene un lupus; el diagnóstico es médico.\n  · Consideraciones para el plan: Sin rasgos de la lista: la sospecha queda en tu juicio clínico."],
};
for (const [k, [le, esperado]] of Object.entries(LES_CASOS)) {
  assert(`le ${k}: el bloque es el de physiq-assessment, literal`, buildClinicalContext({ ...FULL_PAYLOAD, le }).includes(esperado));
}
assert('le: sin citas (el informe no nombra fuentes)', Object.values(LES_CASOS).every(([, t]) => !/(19|20)\d{2}/.test(t)));
assert('le: con la sospecha, prohíbe escribir que tiene un lupus', LES_CASOS.sospecha[1].includes('no escribas que el paciente tiene un lupus'));
assert('le: va justo después de la disautonomía', /Disautonomía \(condición especial[\s\S]*\n\nLupus \(condición especial/.test(buildClinicalContext({ ...FULL_PAYLOAD, ds: DS_CASOS.pots[0], le: LES_CASOS.sospecha[0] })));
assert('sin le (valoración anterior o sin la tarjeta), sin bloque', !buildClinicalContext(FULL_PAYLOAD).includes('Lupus (condición'));

// Trastorno mastocitario o anafilaxia (ma): mismo bloque que bloqueMAIA() de
// physiq-assessment (lib/mastocitos.js; Fase P, docs/mastocitaria.md). Los textos
// esperados son su salida literal para estos datos, y su test
// (tests/unit/mastocitos.mjs, MA_CASOS) fija los mismos: si allí cambia, se
// copia aquí.
console.log('\ntrastorno mastocitario (ma)');
const MA_CASOS = {
  mastocitosis: [{ es: 'diagnosticado', ti: 'mastocitosis', an: 'si', ai: 'no', de: ['calor', 'roce o presión en la piel'] },
    "Trastorno mastocitario o anafilaxia (condición especial marcada por el fisioterapeuta):\n  · Datos: mastocitosis; anafilaxia previa; no lleva autoinyector; desencadenantes: calor, roce o presión en la piel\n  · No relaciones sus síntomas crónicos (dolor, cansancio) con el trastorno mastocitario: solo los episodios bruscos en varios sistemas lo son.\n  · Consideraciones para la sesión: Si en la sesión aparecen ronchas, hinchazón, falta de aire, mareo o un desmayo: para, quédate con él y llama al 112; que se ponga su autoinyector en la cara externa del muslo (si no puede, ayúdale a ponérselo si la normativa de tu país lo permite) y, si no mejora, a los 5 minutos el segundo. Tumbado (sentado si le cuesta respirar; de lado si pierde el conocimiento y respira) y sin levantarlo de golpe aunque mejore. Puede no haber ronchas. Un desmayo vasovagal mejora enseguida al tumbarlo, con el pulso lento. Si no se recupera rápido tumbado, o tiene el pulso rápido, ronchas o le cuesta respirar, trátalo como una anafilaxia. Tiene más riesgo de anafilaxia que la población general: que lleve su autoinyector siempre y lo traiga a cada sesión. En la mastocitosis, la anafilaxia suele empezar con calor brusco, palpitaciones, mareo y desmayo, a menudo sin ronchas. Tras una anafilaxia, las guías indican llevar autoinyector (salvo si fue por un fármaco fácil de evitar), y también con una mastocitosis sistémica y cualquier reacción previa: que su médico lo valore. Evita en la sesión lo que ya le ha provocado episodios; no hace falta evitar una lista de todos los descritos. Tras una anafilaxia, aunque se recupere, lo tiene que ver un médico: puede repetirse en las horas siguientes sin nueva exposición."],
  otroSinAnafilaxia: [{ es: 'diagnosticado', ti: 'otro', an: 'no', ai: 'si', de: [] },
    "Trastorno mastocitario o anafilaxia (condición especial marcada por el fisioterapeuta):\n  · Datos: otro trastorno mastocitario; lleva autoinyector\n  · No relaciones sus síntomas crónicos (dolor, cansancio) con el trastorno mastocitario: solo los episodios bruscos en varios sistemas lo son.\n  · Consideraciones para la sesión: Si en la sesión aparecen ronchas, hinchazón, falta de aire, mareo o un desmayo: para, quédate con él y llama al 112; que se ponga su autoinyector en la cara externa del muslo (si no puede, ayúdale a ponérselo si la normativa de tu país lo permite) y, si no mejora, a los 5 minutos el segundo. Tumbado (sentado si le cuesta respirar; de lado si pierde el conocimiento y respira) y sin levantarlo de golpe aunque mejore. Puede no haber ronchas. Un desmayo vasovagal mejora enseguida al tumbarlo, con el pulso lento. Si no se recupera rápido tumbado, o tiene el pulso rápido, ronchas o le cuesta respirar, trátalo como una anafilaxia. Tras una anafilaxia, aunque se recupere, lo tiene que ver un médico: puede repetirse en las horas siguientes sin nueva exposición."],
  minimo: [{ es: 'diagnosticado', ti: null, an: null, ai: null, de: [] },
    "Trastorno mastocitario o anafilaxia (condición especial marcada por el fisioterapeuta):\n  · Datos: trastorno mastocitario\n  · No relaciones sus síntomas crónicos (dolor, cansancio) con el trastorno mastocitario: solo los episodios bruscos en varios sistemas lo son.\n  · Consideraciones para la sesión: Si en la sesión aparecen ronchas, hinchazón, falta de aire, mareo o un desmayo: para, quédate con él y llama al 112; que se ponga su autoinyector en la cara externa del muslo (si no puede, ayúdale a ponérselo si la normativa de tu país lo permite) y, si no mejora, a los 5 minutos el segundo. Tumbado (sentado si le cuesta respirar; de lado si pierde el conocimiento y respira) y sin levantarlo de golpe aunque mejore. Puede no haber ronchas. Un desmayo vasovagal mejora enseguida al tumbarlo, con el pulso lento. Si no se recupera rápido tumbado, o tiene el pulso rápido, ronchas o le cuesta respirar, trátalo como una anafilaxia. Tras una anafilaxia, aunque se recupere, lo tiene que ver un médico: puede repetirse en las horas siguientes sin nueva exposición."],
};
for (const [k, [ma, esperado]] of Object.entries(MA_CASOS)) {
  assert(`ma ${k}: el bloque es el de physiq-assessment, literal`, buildClinicalContext({ ...FULL_PAYLOAD, ma }).includes(esperado));
}
assert('ma: sin citas (el informe no nombra fuentes)', Object.values(MA_CASOS).every(([, t]) => !/(19|20)\d{2}|NICE/.test(t)));
assert('ma: sin el protocolo escrito (es para el fisioterapeuta, no para el informe)', Object.values(MA_CASOS).every(([, t]) => !t.includes('protocolo escrito')));
assert('ma: va justo después del lupus', /Lupus \(condición especial[\s\S]*\n\nTrastorno mastocitario o anafilaxia \(condición especial/.test(buildClinicalContext({ ...FULL_PAYLOAD, le: LES_CASOS.sospecha[0], ma: MA_CASOS.minimo[0] })));
assert('sin ma (valoración anterior o sin la tarjeta), sin bloque', !buildClinicalContext(FULL_PAYLOAD).includes('Trastorno mastocitario o anafilaxia (condición'));

// Osteoporosis o fragilidad ósea (op): mismo bloque que bloqueOPIA() de
// physiq-assessment (lib/osteoporosis.js; Fase P, docs/osteoporosis.md). Los
// textos esperados son su salida literal para estos datos, y su test
// (tests/unit/osteoporosis.mjs, OP_CASOS) fija los mismos: si allí cambia, se
// copia aquí.
console.log('\nosteoporosis (op)');
const OP_CASOS = {
  plo: [{es: 'diagnosticada', ca: 'plo', fv: '2', fr: true, fo: false, tr: 'no', gc: 'no', dc: false, cd: 'no'},
    "Osteoporosis o fragilidad ósea (condición especial marcada por el fisioterapeuta):\n  · Estado: diagnosticada\n  · Datos: asociada al embarazo o la lactancia; 2 o más fracturas vertebrales (alguna reciente o dolorosa); sin tratamiento para el hueso; sin corticoides; sin caídas en el último año\n  · Consideraciones para el plan: Fuerza progresiva 2–3 días por semana, hasta el peso que levanta 8–12 veces, en 2 series y hasta 3, empezando suave con buena técnica y movimientos lentos y controlados; todos los grupos musculares, también la espalda, sin flexión con carga. Si el riesgo de fractura vertebral es alto, sin máquinas que obliguen a flexionar o girar el tronco. Con fractura vertebral o varias fracturas por fragilidad: impacto solo hasta caminar a paso ligero, 150 min por semana, por precaución, sin pruebas de que más sea peligroso; consulta con el fisioterapeuta al empezar. Tras una fractura vertebral dolorosa: extensores de espalda a diario, suaves, 3–5 repeticiones mantenidas 3–5 s; con dolor, empieza tumbado boca arriba. El ejercicio mejora algo la movilidad (certeza moderada); si mejora el dolor no se sabe (certeza muy baja), y los estudios se hicieron meses después de la fractura, no en la fase aguda. Espalda recta al agacharse y levantar (bisagra de cadera); modifica la flexión mantenida, repetida o al final del recorrido, sobre todo con carga; la torsión, suave y controlada, mejor girando con pasos; cuidado al pasar de tumbado a sentado o al darse la vuelta, y con peso en las manos; no levantar ni dejar cosas en el suelo, sino guardarlas a la altura de la cintura. Enseña cómo, no prohíbas. Sin manipulación forzada; la movilización suave puede ser adecuada. Un dolor de espalda brusco tras un esfuerzo pequeño puede ser una fractura vertebral nueva: valoración médica; con debilidad u hormigueo en las piernas, urgencias. Osteoporosis del embarazo o la lactancia: que se movilice pronto y sin reposo en cama; actividad en carga y de fuerza razonable, sin excesos, y sin cargar objetos pesados. Con las fracturas consolidadas, a los 3–6 meses, más carga y fuerza. Fisioterapia cuando el dolor lo permita. Al coger y cargar al bebé, la misma bisagra de cadera. Si las fracturas la limitan mucho, que tenga ayuda para cuidar del bebé. La lactancia, los fármacos y otro embarazo los decide con su médico. Tras una osteoporosis del embarazo o la lactancia pueden aparecer nuevas fracturas, más si hubo varias al principio; si hay más riesgo en otro embarazo no está claro: que lo hable con su médico. Sin caídas: equilibrio a diario, 15–20 min. Los fármacos, el calcio, la vitamina D y el corsé los indica el médico."],
  corticoides: [{es: 'diagnosticada', ca: 'corticoides', fv: '0', fr: false, fo: true, tr: 'no', gc: 'a', dc: true, cd: 'alto'},
    "Osteoporosis o fragilidad ósea (condición especial marcada por el fisioterapeuta):\n  · Estado: diagnosticada\n  · Datos: por corticoides; sin fracturas vertebrales conocidas; otras fracturas por fragilidad; sin tratamiento para el hueso; corticoides de 7,5 mg/día o más; caídas: riesgo alto\n  · Consideraciones para el plan: Fuerza progresiva 2–3 días por semana, hasta el peso que levanta 8–12 veces, en 2 series y hasta 3, empezando suave con buena técnica y movimientos lentos y controlados; todos los grupos musculares, también la espalda, sin flexión con carga. Si el riesgo de fractura vertebral es alto, sin máquinas que obliguen a flexionar o girar el tronco. Con fractura vertebral o varias fracturas por fragilidad: impacto solo hasta caminar a paso ligero, 150 min por semana, por precaución, sin pruebas de que más sea peligroso; consulta con el fisioterapeuta al empezar. Equilibrio a diario, 15–20 min. Espalda recta al agacharse y levantar (bisagra de cadera); modifica la flexión mantenida, repetida o al final del recorrido, sobre todo con carga; la torsión, suave y controlada, mejor girando con pasos; cuidado al pasar de tumbado a sentado o al darse la vuelta, y con peso en las manos; no levantar ni dejar cosas en el suelo, sino guardarlas a la altura de la cintura. Enseña cómo, no prohíbas. Sin manipulación forzada; la movilización suave puede ser adecuada. Un dolor de espalda brusco tras un esfuerzo pequeño puede ser una fractura vertebral nueva: valoración médica; con debilidad u hormigueo en las piernas, urgencias. Corticoides de 7,5 mg/día o más durante 3 meses o más sin tratamiento para el hueso: que su médico valore la protección ósea. Riesgo alto de caídas: valoración integral de caídas. Ejercicio de caídas: equilibrio exigente y ejercicio funcional (levantarse de la silla, pasos), 3 o más sesiones por semana, progresado al menos 12 semanas, unas 3 h por semana durante al menos 4 meses. El equilibrio y el ejercicio funcional reducen las caídas; caminar solo no ha demostrado reducirlas. Los fármacos, el calcio, la vitamina D y el corsé los indica el médico."],
  sospecha: [{es: 'sospecha', fs: 2, sr: 'derivar', cd: 'una'},
    "Osteoporosis o fragilidad ósea (condición especial marcada por el fisioterapeuta):\n  · Estado: sospecha\n  · Datos: una caída en el último año\n  · Factores de riesgo de fractura: 2 de 6 «sí»\n  · Es una sospecha: no escribas que el paciente tiene osteoporosis; el diagnóstico es médico.\n  · Consideraciones para el plan: Que su médico valore el riesgo de fractura (FRAX y, si procede, densitometría). Una caída, sin lesión, sin quedarse en el suelo, sin pérdida de conocimiento y sin fragilidad: valora la marcha y el equilibrio; si están alterados, programa de ejercicio de caídas y revisión de los riesgos del hogar. La velocidad de marcha por debajo de 0,8 m/s indica más riesgo. Ejercicio de caídas: equilibrio exigente y ejercicio funcional (levantarse de la silla, pasos), 3 o más sesiones por semana, progresado al menos 12 semanas, unas 3 h por semana durante al menos 4 meses. El equilibrio y el ejercicio funcional reducen las caídas; caminar solo no ha demostrado reducirlas. Un dolor de espalda brusco tras un esfuerzo pequeño puede ser una fractura vertebral nueva: valoración médica; con debilidad u hormigueo en las piernas, urgencias."],
};
for (const [k, [op, esperado]] of Object.entries(OP_CASOS)) {
  assert(`op ${k}: el bloque es el de physiq-assessment, literal`, buildClinicalContext({ ...FULL_PAYLOAD, op }).includes(esperado));
}
assert('op: sin citas (el informe no nombra fuentes)', Object.values(OP_CASOS).every(([, t]) => !/(19|20)\d{2}|NICE/.test(t)));
assert('op: con la sospecha, prohíbe escribir que tiene osteoporosis', OP_CASOS.sospecha[1].includes('no escribas que el paciente tiene osteoporosis'));
assert('op: va justo después del trastorno mastocitario', /Trastorno mastocitario o anafilaxia \(condición especial[\s\S]*\n\nOsteoporosis o fragilidad ósea \(condición especial/.test(buildClinicalContext({ ...FULL_PAYLOAD, ma: MA_CASOS.minimo[0], op: OP_CASOS.sospecha[0] })));
assert('sin op (valoración anterior o sin la tarjeta), sin bloque', !buildClinicalContext(FULL_PAYLOAD).includes('Osteoporosis o fragilidad ósea (condición'));

// Embarazo o posparto (em): mismo bloque que bloqueEMIA() de physiq-assessment
// (lib/embarazo.js; Fase P, docs/embarazo-posparto.md). Los textos esperados
// son su salida literal para estos datos, y su test (tests/unit/embarazo.mjs,
// EM_CASOS) fija los mismos: si allí cambia, se copia aquí.
console.log('\nembarazo o posparto (em)');
const EM_CASOS = {
  embarazada: [{"es":"embarazada","sg":30,"fp":"SI","sp":{"o":true,"h":false,"b":false},"rs":true},
    "Embarazo (condición especial marcada por el fisioterapeuta):\n  · Datos: 30 semanas de gestación; familiar de primer grado con disfunción del suelo pélvico; suelo pélvico: escapes de orina\n  · Consideraciones para el plan: Activa durante todo el embarazo si no hay contraindicación: al menos 150 min por semana de intensidad moderada (puede hablar, no cantar), repartidos en 3 días o más, con aeróbico y fuerza; si no llega, empezar poco a poco. Sin buceo, deportes de contacto, riesgo de caída ni bicicleta en movimiento; sin calor excesivo y bien hidratada; la intensidad alta, solo supervisada; si la maniobra de Valsalva le marea, sin aguantar la respiración. Boca arriba: si se marea, tiene náuseas o se encuentra mal, cambiar de posición; desde la semana 20 puede bajar el retorno venoso. Parar el ejercicio y consultar si aparece: sangrado vaginal, pérdida de líquido, contracciones regulares y dolorosas, dolor de vientre, dolor en el pecho, falta de aire que no cede en reposo, mareo que no cede, dolor de cabeza, debilidad que afecta al equilibrio, o dolor o hinchazón de pantorrilla. Con una contraindicación absoluta (rotura de la bolsa, parto prematuro, sangrado persistente sin explicar, placenta previa después de la semana 28, preeclampsia, cuello del útero incompetente, crecimiento fetal restringido, embarazo de trillizos o más, diabetes tipo 1, hipertensión o tiroides sin controlar, u otra enfermedad cardiovascular, respiratoria o sistémica grave), solo las actividades de la vida diaria; con una relativa, que hable con su obstetra o matrona antes de un ejercicio moderado o intenso. Dolor lumbar o de cintura pélvica: ejercicio o cinturón lumbopélvico no rígido. En el embarazo, el ejercicio de 8–12 semanas reduce el dolor lumbar y pélvico, pero en el dolor solo pélvico no mejora más que la atención habitual. La terapia manual no tiene base para ser el tratamiento principal ni para usarse sola: como mucho, para probar el alivio en pocas sesiones. Del thrust en el embarazo hay un solo ensayo piloto, con 15 mujeres en decúbito lateral y sin efectos adversos, recogido en la revisión Cochrane, y la guía de fisioterapia lo deja a criterio del clínico: no basta para decir que sea seguro. Fisioterapia de suelo pélvico: programa supervisado de al menos 3 meses. Suelo pélvico a diario, con la técnica aprendida. Con diástasis en el embarazo, la guía canadiense aconseja consejo de fisioterapia y evitar los abdominales tipo curl."],
  posparto: [{"es":"posparto","ss":6,"tp":"cesarea","oa":false,"op":false,"la":"SI","sp":null,"rs":false},
    "Posparto (condición especial marcada por el fisioterapeuta):\n  · Datos: 6 semanas desde el parto; cesárea; da el pecho\n  · Consideraciones para el plan: Volver a la actividad de forma gradual, guiada por los síntomas; no hace falta una autorización médica de rutina y la vuelta puede empezar antes de las 6 semanas. Tras la cesárea, cuando se sienta recuperada. La misma dosis que en el embarazo: 150 min por semana, con fuerza. Durante el primer año, que consulte con su médico antes del ejercicio moderado o intenso si tiene: tensión de más de 140/90, dolor en el pecho, falta de aire en reposo, mareo o pérdida de conocimiento, síntomas neurológicos, dolor o hinchazón de pantorrilla, sangrado vaginal sin regla, dolor abdominal intenso, anemia o cansancio excesivo, fiebre, o síntomas de la cesárea que empeoran con el ejercicio; casi siempre podrá seguir activa, adaptando. No son contraindicaciones: el dolor lumbar, el de cintura pélvica (sin consenso entre los encuestados; lo decidieron los autores), la incontinencia, el prolapso leve o moderado y la diástasis. Si da el pecho, mejor dar el pecho o sacarse leche antes del ejercicio, por comodidad. Volver a correr: no antes de 3 semanas y con las heridas del parto, también la cesárea, completamente curadas; el momento es individual, sin plazo fijo de 6 o 12 semanas. Antes, caminar 30 min y tareas de impacto sin síntomas. Con síntomas leves de suelo pélvico puede correr adaptando; con síntomas graves, valoración especializada primero. Si aparecen escapes, peso o presión vaginal al correr, parar y caminar. En el posparto, ejercicio individualizado con enfoque biopsicosocial y cribado del miedo-evitación; el tratamiento, antes de los 3 meses. Predicen que persista: dolor intenso, muchas pruebas de provocación positivas, dolor lumbopélvico previo, discapacidad alta, neuroticismo y miedo-evitación. La terapia manual no tiene base para ser el tratamiento principal ni para usarse sola: como mucho, para probar el alivio en pocas sesiones. Del thrust en el embarazo hay un solo ensayo piloto, con 15 mujeres en decúbito lateral y sin efectos adversos, recogido en la revisión Cochrane, y la guía de fisioterapia lo deja a criterio del clínico: no basta para decir que sea seguro. En el posparto, el thrust no está indicado con articulaciones simétricas. Suelo pélvico a diario, con la técnica aprendida. Diástasis: no hay un corte de consenso; la leve no se asocia a dolor lumbopélvico; se resuelve sola en buena parte durante el primer año; el ejercicio abdominal la reduce poco, y no hay que prohibir el curl ni el suelo pélvico."],
  riesgo: [{"es":"posparto","ss":2,"tp":"instrumental","oa":true,"op":false,"la":"NO","sp":{"o":false,"h":false,"b":false},"rs":true},
    "Posparto (condición especial marcada por el fisioterapeuta):\n  · Datos: 2 semanas desde el parto; parto vaginal instrumental; lesión del esfínter anal; no da el pecho\n  · Consideraciones para el plan: Volver a la actividad de forma gradual, guiada por los síntomas; no hace falta una autorización médica de rutina y la vuelta puede empezar antes de las 6 semanas. Tras la cesárea, cuando se sienta recuperada. La misma dosis que en el embarazo: 150 min por semana, con fuerza. Durante el primer año, que consulte con su médico antes del ejercicio moderado o intenso si tiene: tensión de más de 140/90, dolor en el pecho, falta de aire en reposo, mareo o pérdida de conocimiento, síntomas neurológicos, dolor o hinchazón de pantorrilla, sangrado vaginal sin regla, dolor abdominal intenso, anemia o cansancio excesivo, fiebre, o síntomas de la cesárea que empeoran con el ejercicio; casi siempre podrá seguir activa, adaptando. No son contraindicaciones: el dolor lumbar, el de cintura pélvica (sin consenso entre los encuestados; lo decidieron los autores), la incontinencia, el prolapso leve o moderado y la diástasis. Volver a correr: no antes de 3 semanas y con las heridas del parto, también la cesárea, completamente curadas; el momento es individual, sin plazo fijo de 6 o 12 semanas. Antes, caminar 30 min y tareas de impacto sin síntomas. Con síntomas leves de suelo pélvico puede correr adaptando; con síntomas graves, valoración especializada primero. Si aparecen escapes, peso o presión vaginal al correr, parar y caminar. En el posparto, ejercicio individualizado con enfoque biopsicosocial y cribado del miedo-evitación; el tratamiento, antes de los 3 meses. Predicen que persista: dolor intenso, muchas pruebas de provocación positivas, dolor lumbopélvico previo, discapacidad alta, neuroticismo y miedo-evitación. La terapia manual no tiene base para ser el tratamiento principal ni para usarse sola: como mucho, para probar el alivio en pocas sesiones. Del thrust en el embarazo hay un solo ensayo piloto, con 15 mujeres en decúbito lateral y sin efectos adversos, recogido en la revisión Cochrane, y la guía de fisioterapia lo deja a criterio del clínico: no basta para decir que sea seguro. En el posparto, el thrust no está indicado con articulaciones simétricas. Sin síntomas, pero con riesgo (familiar de primer grado con disfunción desde la semana 20, parto instrumental, occipitoposterior o lesión del esfínter anal): puede beneficiarse de un programa supervisado de 3 meses. Suelo pélvico a diario, con la técnica aprendida. Diástasis: no hay un corte de consenso; la leve no se asocia a dolor lumbopélvico; se resuelve sola en buena parte durante el primer año; el ejercicio abdominal la reduce poco, y no hay que prohibir el curl ni el suelo pélvico."],
};
for (const [k, [em, esperado]] of Object.entries(EM_CASOS)) {
  assert(`em ${k}: el bloque es el de physiq-assessment, literal`, buildClinicalContext({ ...FULL_PAYLOAD, em }).includes(esperado));
}
assert('em: sin citas (el informe no nombra fuentes)', Object.values(EM_CASOS).every(([, t]) => !/(19|20)\d{2}|NICE/.test(t)));
assert('em: va justo después de la osteoporosis', /Osteoporosis o fragilidad ósea \(condición especial[\s\S]*\n\nPosparto \(condición especial/.test(buildClinicalContext({ ...FULL_PAYLOAD, op: OP_CASOS.sospecha[0], em: EM_CASOS.posparto[0] })));
assert('sin em (valoración anterior o sin la tarjeta), sin bloque', !/(Embarazo|Posparto) \(condición/.test(buildClinicalContext(FULL_PAYLOAD)));

// Paciente anticoagulado o antiagregado (ac): mismo bloque que bloqueACIA() de
// physiq-assessment (lib/anticoagulado.js; Fase P, docs/anticoagulado.md). Los
// textos esperados son su salida literal para estos datos, y su test
// (tests/unit/anticoagulado.mjs, AC_CASOS) fija los mismos: si allí cambia, se
// copia aquí.
console.log('\npaciente anticoagulado o antiagregado (ac)');
const AC_CASOS = {
  anticoaguladoYAspirina: [{"es":"toma","ti":["vk","as"]},
    "Paciente anticoagulado o antiagregado (condición especial marcada por el fisioterapeuta):\n  · Toma: antivitamina K; aspirina\n  · No sugieras suspender, saltarse ni ajustar el tratamiento. No atribuyas los síntomas del paciente al fármaco si el fisioterapeuta no lo ha dicho.\n  · Consideraciones para la sesión: Golpe en la cabeza con anticoagulante o con un antiagregante que no sea la aspirina sola: a urgencias, aunque se encuentre bien; que un adulto le acompañe las primeras 24 horas y sepa que puede empeorar después de parecer recuperado. El sangrado tardío es raro, pero puede aparecer días después. Thrust: la única tabla específica de la columna torácica lo pone como contraindicación absoluta con tratamiento anticoagulante, y otra, de la terapia manual cervical, como precaución; las dos son opinión de expertos, y ninguna distingue fármacos ni da un INR. Un estudio de cohorte asoció la anticoagulación crónica a más lesión cerebral o medular tras la manipulación, sin probar la causa. Banderas de sangrado (fase 2): dolor brusco de cuello o espalda con debilidad, dolor de ingle o costado con el muslo débil o mareo, dolor brusco con bulto en la pared del abdomen, una extremidad tensa con dolor desproporcionado, y un hematoma que no se resuelve."],
  aspirinaSola: [{"es":"toma","ti":["as"]},
    "Paciente anticoagulado o antiagregado (condición especial marcada por el fisioterapeuta):\n  · Toma: aspirina\n  · No sugieras suspender, saltarse ni ajustar el tratamiento. No atribuyas los síntomas del paciente al fármaco si el fisioterapeuta no lo ha dicho.\n  · Consideraciones para la sesión: Con la aspirina sola, el golpe en la cabeza no es por sí solo motivo de derivar; los síntomas tras el golpe sí lo son. Con antiagregante solo, ninguna fuente de manipulación lo trata como contraindicación; precaución con lo que tenga riesgo de golpe. Banderas de sangrado (fase 2): dolor brusco de cuello o espalda con debilidad, dolor de ingle o costado con el muslo débil o mareo, dolor brusco con bulto en la pared del abdomen, una extremidad tensa con dolor desproporcionado, y un hematoma que no se resuelve."],
  sinRegistrar: [{"es":"toma","ti":[]},
    "Paciente anticoagulado o antiagregado (condición especial marcada por el fisioterapeuta):\n  · Toma: fármaco sin registrar\n  · No sugieras suspender, saltarse ni ajustar el tratamiento. No atribuyas los síntomas del paciente al fármaco si el fisioterapeuta no lo ha dicho.\n  · Consideraciones para la sesión: Golpe en la cabeza con anticoagulante o con un antiagregante que no sea la aspirina sola: a urgencias, aunque se encuentre bien; que un adulto le acompañe las primeras 24 horas y sepa que puede empeorar después de parecer recuperado. El sangrado tardío es raro, pero puede aparecer días después. Thrust: la única tabla específica de la columna torácica lo pone como contraindicación absoluta con tratamiento anticoagulante, y otra, de la terapia manual cervical, como precaución; las dos son opinión de expertos, y ninguna distingue fármacos ni da un INR. Un estudio de cohorte asoció la anticoagulación crónica a más lesión cerebral o medular tras la manipulación, sin probar la causa. Banderas de sangrado (fase 2): dolor brusco de cuello o espalda con debilidad, dolor de ingle o costado con el muslo débil o mareo, dolor brusco con bulto en la pared del abdomen, una extremidad tensa con dolor desproporcionado, y un hematoma que no se resuelve."],
};
for (const [k, [ac, esperado]] of Object.entries(AC_CASOS)) {
  assert(`ac ${k}: el bloque es el de physiq-assessment, literal`, buildClinicalContext({ ...FULL_PAYLOAD, ac }).includes(esperado));
}
assert('ac: sin citas (el informe no nombra fuentes)', Object.values(AC_CASOS).every(([, t]) => !/(19|20)\d{2}|NICE/.test(t)));
assert('ac: va justo después del embarazo o posparto', /Posparto \(condición especial[\s\S]*\n\nPaciente anticoagulado o antiagregado \(condición especial/.test(buildClinicalContext({ ...FULL_PAYLOAD, em: EM_CASOS.posparto[0], ac: AC_CASOS.aspirinaSola[0] })));
assert('sin ac (valoración anterior o sin la tarjeta), sin bloque', !buildClinicalContext(FULL_PAYLOAD).includes('Paciente anticoagulado o antiagregado (condición'));

// Fármacos que toma (fm): mismo bloque que bloqueFMIA() de physiq-assessment
// (lib/farmacos-paciente.js; docs/farmacos-paciente.md). Los textos esperados
// son su salida literal para estos datos, y su test
// (tests/unit/farmacos-paciente.mjs, FM_CASOS) fija los mismos: si allí cambia,
// se copia aquí.
console.log('\nfármacos que toma (fm)');
const FM_CASOS = {
  dos: [[{"id": "aine", "n": "AINE"}, {"id": "opioides", "n": "Opioides"}],
    "Fármacos que toma (familias registradas por el fisioterapeuta; sin dosis ni nombres):\n  · AINE; Opioides\n  · No sugieras cambiar, suspender ni ajustar la medicación, ni comentes interacciones entre fármacos. No atribuyas los síntomas del paciente a un fármaco si el fisioterapeuta no lo ha dicho, y no añadas recomendaciones sobre la medicación que no estén en estos datos."],
  una: [[{"id": "estatinas", "n": "Estatinas"}],
    "Fármacos que toma (familias registradas por el fisioterapeuta; sin dosis ni nombres):\n  · Estatinas\n  · No sugieras cambiar, suspender ni ajustar la medicación, ni comentes interacciones entre fármacos. No atribuyas los síntomas del paciente a un fármaco si el fisioterapeuta no lo ha dicho, y no añadas recomendaciones sobre la medicación que no estén en estos datos."],
};
for (const [k, [fm, esperado]] of Object.entries(FM_CASOS)) {
  assert(`fm ${k}: el bloque es el de physiq-assessment, literal`, buildClinicalContext({ ...FULL_PAYLOAD, fm }).includes(esperado));
}
assert('fm: sin citas (el informe no nombra fuentes)', Object.values(FM_CASOS).every(([, t]) => !/(19|20)\d{2}|NICE/.test(t)));
assert('fm: va justo después del anticoagulado', /Paciente anticoagulado o antiagregado \(condición especial[\s\S]*\n\nFármacos que toma \(familias/.test(buildClinicalContext({ ...FULL_PAYLOAD, ac: AC_CASOS.aspirinaSola[0], fm: FM_CASOS.una[0] })));
assert('sin fm (valoración anterior o sin familias), sin bloque', !buildClinicalContext(FULL_PAYLOAD).includes('Fármacos que toma (familias') && !buildClinicalContext({ ...FULL_PAYLOAD, fm: [] }).includes('Fármacos que toma (familias'));

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
