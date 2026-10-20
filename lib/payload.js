// Pure functions shared between app.js (browser) and tests/unit.js (Node).
// No DOM, no globals beyond what Node and browsers both provide (atob, btoa).

function decodePayload(v) {
  return JSON.parse(decodeURIComponent(escape(atob(v))));
}

// ── Bloque de datos de la valoración (PhysiQ-Assessment) ─────────────────────
// Portado de physiq-assessment (lib/informe-narrativo.js, contextoValoracion),
// donde se corrigió revisando informes reales:
//   · las hipótesis van sin su etiqueta de puntuación (el informe citaba
//     «LR× 2,0» y «0/4 hallazgos»);
//   · las notas del plan van con etiquetas neutras y solo si tienen texto (con
//     los nombres de los campos escribía «la variable de control»; un «—»
//     acababa como «no se especificó…»);
//   · los resultados del fisioterapeuta prevalecen, pero lo que refiere el
//     paciente sigue la regla de discrepancias (con «los datos estructurados
//     son más fiables» elegía una versión y borraba la otra);
//   · se envían las derivaciones (ur, dv), el lado, la cirugía (cq), los
//     signos vitales (sv, an), el modo breve (md, pe) y el formulario previo
//     (fp) sin «No sé», que el payload ya traía y el informe no recibía;
//   · los síntomas P1–P4 (z1, ss), la hipermovilidad (hm), la disautonomía
//     (ds), el lupus (le) y el trastorno mastocitario (ma), con el mismo
//     bloque que allí.
// opts.conAudio: con audio, bajo el formulario va el recordatorio de
// discrepancias (lib/reglas-informe.js).
function _reglasInforme() {
  return (typeof globalThis !== 'undefined' && globalThis.PHYSIQ_REGLAS_INFORME) || require('./reglas-informe.js');
}

// ── Varios síntomas (P1–P4) de la fase 3 (payload `z1`, `ss`) ─────────────────
// Copia de physiq-assessment (lib/sintomas.js: lineaP1, lineaSecundario,
// bloqueSintomasIA; docs/sintomas-multiples.md): mismo texto, para que los dos
// informes reciban el mismo bloque. Sin z1 ni ss (valoraciones anteriores o sin
// zonas), no hay bloque y nada cambia.
const _RELACION_SINTOMA = {
  juntos: 'aparece y desaparece con P1',
  empeora: 'solo cuando empeora P1',
  independiente: 'independiente de P1',
  nosabe: 'relación con P1 no conocida',
};
const _TEXTO_OTRA_REGION = 'otra región, no valorada hoy';
const _minus = s => String(s || '').toLowerCase();

function _lineaP1(z1) {
  if (!z1) return '';
  return [z1.z || 'zona sin indicar', z1.la && `lado ${_minus(z1.la)}`, _minus(z1.pr), _minus(z1.pa), z1.de && `«${z1.de}»`].filter(Boolean).join(' · ');
}

function _lineaSecundario(s) {
  const zona = s.or ? `${s.z || 'sin indicar'} (${_TEXTO_OTRA_REGION})` : (s.z || 'zona sin indicar');
  return [zona, s.la && `lado ${_minus(s.la)}`, s.nr != null ? `NRS ${s.nr}/10` : 'NRS no registrado',
    s.ir && `irritabilidad ${_minus(s.ir)}`, _minus(s.pa), s.re && _RELACION_SINTOMA[s.re], s.de && `«${s.de}»`].filter(Boolean).join(' · ');
}

function _bloqueSintomas(d) {
  if (!d.z1 && !d.ss?.length) return '';
  const lineas = [`  · P1 (principal; el NRS y la irritabilidad de arriba son los suyos): ${d.z1 ? _lineaP1(d.z1) : 'zona sin indicar'}`];
  (d.ss || []).forEach(s => lineas.push(`  · P${s.n}: ${_lineaSecundario(s)}`));
  return `Síntomas que refiere el paciente (mapa corporal):\n${lineas.join('\n')}\n`
    + 'Describe cada síntoma con sus propios datos: no atribuyas a uno la intensidad, la irritabilidad ni el comportamiento de otro.'
    + ((d.ss || []).some(s => s.or) ? ` Lo marcado como «${_TEXTO_OTRA_REGION}» no se exploró: menciónalo solo como pendiente de valorar, sin hipótesis ni plan.` : '');
}

// ── Hipermovilidad / Ehlers-Danlos (payload `hm`) ────────────────────────────
// Copia de physiq-assessment (lib/hipermovilidad.js, bloqueHMIA; Fase P,
// docs/hipermovilidad.md): mismo texto, sin las citas, que el informe no debe
// nombrar. Los textos clínicos vienen de allí (data/comun.js): un cambio allí
// se copia aquí (un test en cada repositorio fija el mismo texto literal).
// hm: { es: 'diagnosticada'|'sospecha', st: subtipo, bt: Beighton (null = sin
// hacer), co: corte, cu: «sí» del cuestionario, hag: hipermovilidad
// generalizada (true/false/null), vs: regla de sospecha del subtipo vascular }.
const _SUBTIPO_HM = { hipermovil: 'hipermóvil (SEDh) o TEH', vascular: 'vascular', otro: 'otro' };
const _TEXTOS_HM = {
  ejercicio: 'Ejercicio graduado; vigila la carga para asegurar la recuperación. El dolor empeora con la actividad y puede aparecer en las 24 h siguientes.',
  vascular: 'Subtipo vascular: evitar deportes de colisión, ejercicio isométrico y aceleraciones bruscas; intensidad que permita conversar, control de la respiración al levantar peso y cargas ligeras.',
  derivarHAG: 'Hipermovilidad articular generalizada: valorar derivación a reumatología o genética. No es un diagnóstico de SED hipermóvil, que exige además otros criterios.',
  derivarVascular: 'Rasgos que hacen sospechar el subtipo vascular: derivación preferente a genética.',
  sistemicos: 'Si hay disautonomía o síntomas digestivos o urinarios importantes, derivar al especialista.',
};

function _bloqueHM(d) {
  if (!d || !d.es) return '';
  const estado = d.es === 'diagnosticada'
    ? `diagnosticada${_SUBTIPO_HM[d.st] ? ` (subtipo ${_SUBTIPO_HM[d.st]})` : ''}`
    : 'sospecha';
  const beighton = d.bt == null ? '' : `Beighton ${d.bt}/9${d.co != null ? ` (corte ${d.co})` : ''}`;
  const t = _TEXTOS_HM;
  const plan = [
    t.ejercicio,
    d.es === 'diagnosticada' && d.st === 'vascular' ? t.vascular : '',
    d.es === 'sospecha' && d.hag ? t.derivarHAG : '',
    d.vs ? t.derivarVascular : '',
    t.sistemicos,
  ].filter(Boolean);
  return [
    'Hipermovilidad (condición especial marcada por el fisioterapeuta):',
    `  · Estado: ${estado}`,
    beighton ? `  · ${beighton}${d.hag === true ? ': hipermovilidad articular generalizada' : d.hag === false ? ': sin hipermovilidad articular generalizada' : ''}` : '',
    d.cu != null ? `  · Cuestionario de 5 preguntas: ${d.cu} «sí»` : '',
    d.es === 'sospecha' ? '  · Es una sospecha: no escribas que el paciente tiene un síndrome de Ehlers-Danlos.' : '',
    `  · Consideraciones para el plan: ${plan.join(' ')}`,
  ].filter(Boolean).join('\n');
}

// ── Disautonomía / POTS (payload `ds`) ───────────────────────────────────────
// Copia de physiq-assessment (lib/disautonomia.js, bloqueDsIA; Fase P,
// docs/pots.md): mismo texto, sin las citas, que el informe no debe nombrar.
// Los textos clínicos vienen de allí (data/comun.js): un cambio allí se copia
// aquí (un test en cada repositorio fija el mismo texto literal: DS_CASOS).
// ds: { es: 'diagnosticada'|'sospecha', ti: 'pots'|'ho'|'otra' (diagnosticada),
// pb: prueba de bipedestación hecha, dfc: aumento de la FC mantenido (lpm),
// ho: hipotensión ortostática, ot: compatible con taquicardia ortostática
// (true/false/null), cs: «sí» del patrón de sospecha (null = sin preguntar) }.
const _TIPO_DS = { pots: 'POTS', ho: 'hipotensión ortostática' };
const _TEXTOS_DS = {
  ejercicio: 'Ejercicio regular, al principio semirreclinado (remo, bicicleta reclinada, natación) y lo vertical poco a poco; al menos 4 días por semana, sesiones de al menos 30 min. La mejoría puede tardar 4–6 semanas y al principio puede encontrarse peor.',
  adaptaciones: 'Mejor ejercicio dinámico que isométrico (el isométrico provoca maniobras de Valsalva que bajan la tensión), no comer en la hora anterior y terminar con una vuelta a la calma suave.',
  derivar: 'Aumento de la FC al ponerse de pie sin hipotensión ortostática: derivación preferente a su médico de atención primaria para confirmar el diagnóstico y descartar otras causas.',
  ho: 'Caída de la tensión al ponerse de pie: hipotensión ortostática, no un POTS. Valoración médica, con revisión de los fármacos.',
  seguridad: 'Un desmayo durante el esfuerzo, tumbado, tras palpitaciones bruscas o con síntomas del corazón no lo explica la disautonomía: valoración médica urgente.',
  medico: 'El agua, la sal, las prendas de compresión y los fármacos los indica el médico.',
};

function _pruebaDs(d) {
  if (!d.pb) return '';
  if (d.ho) return 'bipedestación activa: caída de la tensión (hipotensión ortostática)';
  if (d.ot) return `bipedestación activa: aumento de la FC de ${d.dfc} lpm mantenido, sin hipotensión ortostática (compatible con taquicardia ortostática)`;
  if (d.ot === false) return `bipedestación activa: no llega al corte${d.dfc != null ? ` (aumento mantenido de ${d.dfc} lpm)` : ''}`;
  return 'bipedestación activa sin completar';
}

function _bloqueDs(d) {
  if (!d || !d.es) return '';
  const estado = d.es === 'diagnosticada'
    ? `diagnosticada${_TIPO_DS[d.ti] ? ` (${_TIPO_DS[d.ti]})` : ''}`
    : 'sospecha';
  const t = _TEXTOS_DS;
  const plan = [
    d.es === 'diagnosticada' && d.ti === 'ho' ? '' : t.ejercicio,
    t.adaptaciones,
    d.es === 'sospecha' && d.ot ? t.derivar : '',
    d.ho ? t.ho : '',
    t.seguridad,
    t.medico,
  ].filter(Boolean);
  const prueba = _pruebaDs(d);
  return [
    'Disautonomía (condición especial marcada por el fisioterapeuta):',
    `  · Estado: ${estado}`,
    prueba ? `  · Prueba de ${prueba}` : '',
    d.cs != null ? `  · Patrón de intolerancia ortostática: ${d.cs} de 2 «sí»` : '',
    d.es === 'sospecha' ? '  · Es una sospecha: no escribas que el paciente tiene un POTS; el diagnóstico es médico.' : '',
    `  · Consideraciones para el plan: ${plan.join(' ')}`,
  ].filter(Boolean).join('\n');
}

// ── Lupus eritematoso sistémico (payload `le`) ───────────────────────────────
// Copia de physiq-assessment (lib/lupus.js, bloqueLESIA; Fase P, docs/lupus.md):
// mismo texto, sin las citas, que el informe no debe nombrar. Los textos
// clínicos vienen de allí (data/comun.js): un cambio allí se copia aquí (un
// test en cada repositorio fija el mismo texto literal: LES_CASOS).
// le con «Diagnosticado»: { es: 'diagnosticado', gc: corticoides ahora
// ('no'|'b'|'m'|'a'|'ns'|null), ga: dosis altas previas, is: inmunosupresores
// ('si'|'no'|'ns'|null), af: antifosfolípidos ('no'|'apl'|'saf'|'ns'|null),
// at: anticoagulante o antiagregante, on: osteonecrosis o Jaccoud, ry: Raynaud,
// av: actividad ('estable'|'brote'|'peor'|'ns'|null) }; con «Sospecha»:
// { es: 'sospecha', rs: «sí» de los rasgos (null = sin preguntar), fd: empezó
// tras un fármaco nuevo }.
const _CORT_LES = { no: 'sin corticoides', b: 'corticoides hasta 5 mg/día', m: 'corticoides de más de 5 hasta 20 mg/día', a: 'corticoides de más de 20 mg/día', ns: 'corticoides: no lo sabe' };
const _AF_LES = { no: 'sin anticuerpos antifosfolípido', apl: 'anticuerpos antifosfolípido positivos, sin trombosis', saf: 'síndrome antifosfolípido con trombosis previa', ns: 'antifosfolípidos: no lo sabe' };
const _AV_LES = { estable: 'estable', brote: 'en brote, según su médico', peor: 'peor, sin valorar aún', ns: 'actividad: no lo sabe' };
const _TEXTOS_LES = {
  derivar: 'Rasgos que pueden corresponder a una enfermedad inflamatoria sistémica: derivación preferente a su médico de atención primaria. El diagnóstico es médico y necesita analítica.',
  farmaco: 'Si empezó tras un fármaco nuevo, comentarlo con quien lo recetó.',
  sinRasgos: 'Sin rasgos de la lista: la sospecha queda en tu juicio clínico.',
  ejercicio: 'Con el lupus inactivo o leve, llegar poco a poco a 150–300 min por semana de intensidad moderada (esfuerzo 5–6 sobre 10) y fuerza al menos 2 días. Sesiones con aeróbico y fuerza, 3–5 por semana; fuerza en 1–3 series de 8–12 repeticiones con 1–3 min de descanso; aeróbico de 20–30 min hasta 50, en tramos de 4 semanas; con calentamiento y vuelta a la calma. Supervisado por un fisioterapeuta. Puede reducir algo la fatiga, y la actividad del lupus probablemente no cambia.',
  antesEmpezar: 'Antes de empezar, su médico valora si hay contraindicaciones; antes de ejercicio vigoroso, puede hacer falta un ECG o una prueba de esfuerzo.',
  especialista: 'Con osteonecrosis o artropatía de Jaccoud, que lo valore un especialista antes de empezar.',
  brote: 'En brote, que su reumatólogo revalore las contraindicaciones antes de seguir; en un brote articular, no cargar las articulaciones inflamadas.',
  sol: 'Fotoprotección para prevenir brotes: protector solar de amplio espectro UVA y UVB, ropa que cubra, sombrero y gafas de sol, y evitar las horas de más sol. Evitar el ejercicio al sol con un índice UV por encima de 3.',
  raynaud: 'Raynaud: al aire libre, guantes o ropa contra el frío; evitar tocar superficies frías y secar bien la piel durante y después del ejercicio. Por lo mismo, cuidado con el frío local en manos y pies.',
  fiebre: 'Fiebre o malestar general nuevos: valoración médica hoy; con corticoides puede no haber fiebre.',
  antifosfolipidos: 'Antifosfolípidos: la actividad física se recomienda también con anticoagulantes. No sugerir suspender el anticoagulante: retirarlo desencadena el síndrome antifosfolípido catastrófico.',
  osteonecrosis: 'Riesgo de osteonecrosis: un dolor profundo en carga de cadera, rodilla, hombro o tobillo → valoración médica.',
  tabaco: 'Si fuma, dejarlo: el tabaco aumenta la actividad del lupus y el riesgo cardiovascular.',
  medico: 'Los corticoides, los inmunosupresores y el anticoagulante los ajusta su reumatólogo.',
};

function _datosLES(d) {
  if (d.es !== 'diagnosticado') return [];
  return [
    d.gc ? _CORT_LES[d.gc] : '',
    d.ga === 'si' ? 'ha tomado dosis altas (más de 20 mg/día más de 4 semanas)' : '',
    d.is === 'si' ? 'inmunosupresores o biológicos' : d.is === 'ns' ? 'inmunosupresores: no lo sabe' : '',
    d.af ? _AF_LES[d.af] : '',
    d.at ? 'anticoagulante o antiagregante' : '',
    d.on ? 'osteonecrosis o artropatía de Jaccoud conocidas' : '',
    d.ry ? 'fenómeno de Raynaud' : '',
    d.av ? _AV_LES[d.av] : '',
  ].filter(Boolean);
}

function _planLES(d) {
  const t = _TEXTOS_LES;
  if (d.es === 'sospecha') return [d.rs ? t.derivar : t.sinRasgos, d.fd ? t.farmaco : ''].filter(Boolean);
  return [
    t.ejercicio,
    t.antesEmpezar,
    d.on ? t.especialista : '',
    d.av === 'brote' || d.av === 'peor' ? t.brote : '',
    t.sol,
    d.ry ? t.raynaud : '',
    t.fiebre,
    d.af === 'apl' || d.af === 'saf' ? t.antifosfolipidos : '',
    d.ga === 'si' || d.gc === 'a' ? t.osteonecrosis : '',
    t.tabaco,
    t.medico,
  ].filter(Boolean);
}

function _bloqueLES(d) {
  if (!d || !d.es) return '';
  const datos = _datosLES(d);
  return [
    'Lupus (condición especial marcada por el fisioterapeuta):',
    `  · Estado: ${d.es === 'diagnosticado' ? 'diagnosticado' : 'sospecha'}`,
    datos.length ? `  · Datos: ${datos.join('; ')}` : '',
    d.es === 'sospecha' && d.rs != null ? `  · Rasgos que justifican una valoración médica: ${d.rs} de 5 «sí»` : '',
    d.es === 'sospecha' ? '  · Es una sospecha: no escribas que el paciente tiene un lupus; el diagnóstico es médico.' : '',
    `  · Consideraciones para el plan: ${_planLES(d).join(' ')}`,
  ].filter(Boolean).join('\n');
}

// ── Trastorno mastocitario o anafilaxia (payload `ma`) ───────────────────────
// Copia de physiq-assessment (lib/mastocitos.js, bloqueMAIA; Fase P,
// docs/mastocitaria.md): mismo texto, sin las citas, que el informe no debe
// nombrar (_sinCitas las quita de _TEXTOS_MA, copiados con ellas de
// data/comun.js). Un cambio allí se copia aquí (un test en cada repositorio
// fija el mismo texto literal: MA_CASOS).
// ma: { es: 'diagnosticado' (no hay «Sospecha»), ti: diagnóstico
// ('mastocitosis'|'sama'|'otro'|'soloAnafilaxia'|'ns'|null), an: anafilaxia
// previa ('si'|'no'|'ns'|null; 'si' con 'soloAnafilaxia'), ai: autoinyector
// ('si'|'no'|'sinReceta'|null), de: desencadenantes como texto ([] si no hay) }.
const _TIPO_MA = { mastocitosis: 'mastocitosis', sama: 'síndrome de activación mastocitaria', otro: 'otro trastorno mastocitario', soloAnafilaxia: 'anafilaxia previa, sin trastorno mastocitario diagnosticado', ns: 'trastorno mastocitario (no sabe cuál)' };
const _AI_MA = { si: 'lleva autoinyector', no: 'no lleva autoinyector', sinReceta: 'sin autoinyector recetado' };
const _TEXTOS_MA = {
  queHacer: 'Si en la sesión aparecen ronchas, hinchazón, falta de aire, mareo o un desmayo: para, quédate con él y llama al 112; que se ponga su autoinyector en la cara externa del muslo (si no puede, ayúdale a ponérselo si la normativa de tu país lo permite) y, si no mejora, a los 5 minutos el segundo. Tumbado (sentado si le cuesta respirar; de lado si pierde el conocimiento y respira) y sin levantarlo de golpe aunque mejore. Puede no haber ronchas (RCUK 2021, apartados 3.1, 4.4 y 5.1.1; Muraro 2022, recuadro 3; NICE NG258, 1.1.14).',
  desmayo: 'Un desmayo vasovagal mejora enseguida al tumbarlo, con el pulso lento. Si no se recupera rápido tumbado, o tiene el pulso rápido, ronchas o le cuesta respirar, trátalo como una anafilaxia (RCUK 2021, tabla 3).',
  riesgoAlto: 'Tiene más riesgo de anafilaxia que la población general (Valent 2022, tabla II): que lleve su autoinyector siempre y lo traiga a cada sesión (NICE NG258, 1.1.16).',
  mastocitosis: 'En la mastocitosis, la anafilaxia suele empezar con calor brusco, palpitaciones, mareo y desmayo, a menudo sin ronchas (Gülen 2023; González-de-Olano 2017).',
  sinAutoinyector: 'Tras una anafilaxia, las guías indican llevar autoinyector (salvo si fue por un fármaco fácil de evitar), y también con una mastocitosis sistémica y cualquier reacción previa: que su médico lo valore (RCUK 2021, 8.6; Muraro 2022, recuadro 4).',
  desencadenantes: 'Evita en la sesión lo que ya le ha provocado episodios; no hace falta evitar una lista de todos los descritos (Brockow 2021).',
  despues: 'Tras una anafilaxia, aunque se recupere, lo tiene que ver un médico: puede repetirse en las horas siguientes sin nueva exposición (NICE NG258; RCUK 2021, 8.2).',
  protocolo: 'Ten un protocolo escrito de anafilaxia y ensáyalo con regularidad (Cardona 2020, fig. 4).',
};

const _riesgoAltoMA = d => d?.ti === 'mastocitosis' || d?.ti === 'sama' || d?.an === 'si';

function _datosMA(d) {
  return [
    d.ti ? _TIPO_MA[d.ti] : 'trastorno mastocitario',
    d.an === 'si' && d.ti !== 'soloAnafilaxia' ? 'anafilaxia previa' : d.an === 'ns' ? 'anafilaxia previa: no lo sabe' : '',
    d.ai ? _AI_MA[d.ai] : '',
    d.de?.length ? `desencadenantes: ${d.de.join(', ')}` : '',
  ].filter(Boolean);
}

function _recomendacionMA(d) {
  const t = _TEXTOS_MA;
  return [
    t.queHacer,
    t.desmayo,
    _riesgoAltoMA(d) ? t.riesgoAlto : '',
    d.ti === 'mastocitosis' ? t.mastocitosis : '',
    d.ai === 'no' || d.ai === 'sinReceta' ? t.sinAutoinyector : '',
    d.de?.length ? t.desencadenantes : '',
    t.despues,
    t.protocolo,
  ].filter(Boolean);
}

// Una cita lleva un año o es una guía NICE («NICE NG258, 1.1.16»), sin año.
const _sinCitasMA = s => s.replace(/\s*\([^()]*(\d{4}|NICE (NG|CG)\d+)[^()]*\)/g, '');
function _bloqueMA(d) {
  if (!d || !d.es) return '';
  return [
    'Trastorno mastocitario o anafilaxia (condición especial marcada por el fisioterapeuta):',
    `  · Datos: ${_datosMA(d).join('; ')}`,
    '  · No relaciones sus síntomas crónicos (dolor, cansancio) con el trastorno mastocitario: solo los episodios bruscos en varios sistemas lo son.',
    `  · Consideraciones para la sesión: ${_recomendacionMA(d).filter(t => t !== _TEXTOS_MA.protocolo).map(_sinCitasMA).join(' ')}`,
  ].join('\n');
}

// ── Osteoporosis o fragilidad ósea (payload `op`) ────────────────────────────
// Copia de physiq-assessment (lib/osteoporosis.js, bloqueOPIA; Fase P,
// docs/osteoporosis.md): mismo texto, sin las citas, que el informe no debe
// nombrar (_sinCitasOP las quita de _TEXTOS_OP, copiados con ellas de
// data/comun.js). Un cambio allí se copia aquí (un test en cada repositorio
// fija el mismo texto literal: OP_CASOS).
// op con «Diagnosticada»: { es: 'diagnosticada', ca: causa ('edad'|'corticoides'|
// 'plo'|'otra'|'ns'|null), fv: fracturas vertebrales ('0'|'1'|'2'|'ns'|null),
// fr: alguna reciente o dolorosa, fo: otras fracturas por fragilidad, tr:
// tratamiento ('no'|'antirresortivo'|'otro'|'ns'|null), gc: corticoides
// ('no'|'b'|'a'|'ns'|null), dc: derivación por corticoides sin protección ósea,
// cd: caídas ('alto'|'una'|'no'|null) }. Con «Sospecha»: { es: 'sospecha', fs:
// «sí» de los 6 factores (null = sin preguntar), sr: resultado ('derivar'|
// 'joven'|'sinFactores'|'sinEdad'|null), cd }.
const _N_FACTORES_OP = 6;
const _CAUSA_OP = { edad: 'posmenopáusica o por la edad', corticoides: 'por corticoides', plo: 'asociada al embarazo o la lactancia', otra: 'otra causa', ns: 'causa: no lo sabe' };
const _FV_OP = { 0: 'sin fracturas vertebrales conocidas', 1: '1 fractura vertebral', 2: '2 o más fracturas vertebrales', ns: 'fracturas vertebrales: no lo sabe' };
const _TR_OP = { no: 'sin tratamiento para el hueso', antirresortivo: 'bifosfonato o denosumab', otro: 'otro tratamiento para el hueso', ns: 'tratamiento para el hueso: no lo sabe' };
const _GC_OP = { no: 'sin corticoides', b: 'corticoides de menos de 7,5 mg/día', a: 'corticoides de 7,5 mg/día o más', ns: 'corticoides: no lo sabe' };
const _CD_OP = { alto: 'caídas: riesgo alto', una: 'una caída en el último año', no: 'sin caídas en el último año' };
const _TEXTOS_OP = {
  fuerza: 'Fuerza progresiva 2–3 días por semana, hasta el peso que levanta 8–12 veces, en 2 series y hasta 3, empezando suave con buena técnica y movimientos lentos y controlados; todos los grupos musculares, también la espalda, sin flexión con carga (Brooke-Wavell 2022, recuadro 1; Giangregorio 2014). Si el riesgo de fractura vertebral es alto, sin máquinas que obliguen a flexionar o girar el tronco (Giangregorio 2014).',
  impactoSin: 'Impacto moderado la mayoría de los días: unos 50 impactos por sesión (pisotones, trote, saltos bajos), sin caer desde altura (Brooke-Wavell 2022, consenso).',
  impactoCon: 'Con fractura vertebral o varias fracturas por fragilidad: impacto solo hasta caminar a paso ligero, 150 min por semana, por precaución, sin pruebas de que más sea peligroso; consulta con el fisioterapeuta al empezar (Brooke-Wavell 2022, consenso; Giangregorio 2014).',
  equilibrio: 'Equilibrio a diario, 15–20 min (unas 2 h por semana; Giangregorio 2014).',
  reciente: 'Tras una fractura vertebral dolorosa: extensores de espalda a diario, suaves, 3–5 repeticiones mantenidas 3–5 s; con dolor, empieza tumbado boca arriba (Brooke-Wavell 2022, recuadro 3; Gregson 2025). El ejercicio mejora algo la movilidad (certeza moderada); si mejora el dolor no se sabe (certeza muy baja), y los estudios se hicieron meses después de la fractura, no en la fase aguda (Gibbs 2019).',
  moverse: 'Espalda recta al agacharse y levantar (bisagra de cadera); modifica la flexión mantenida, repetida o al final del recorrido, sobre todo con carga; la torsión, suave y controlada, mejor girando con pasos; cuidado al pasar de tumbado a sentado o al darse la vuelta, y con peso en las manos; no levantar ni dejar cosas en el suelo, sino guardarlas a la altura de la cintura. Enseña cómo, no prohíbas (Brooke-Wavell 2022, recuadro 3; Giangregorio 2014; Giangregorio 2015).',
  tecnica: 'Sin manipulación forzada; la movilización suave puede ser adecuada (Maitland 2005, cap. 9, p. 223; Puentedura 2015, tabla 1).',
  seguridad: 'Un dolor de espalda brusco tras un esfuerzo pequeño puede ser una fractura vertebral nueva: valoración médica; con debilidad u hormigueo en las piernas, urgencias (Gregson 2025).',
  antirresortivo: 'Con bifosfonato o denosumab: si aparece un dolor de muslo, ingle o cadera sin explicación, imagen del fémur antes de cargar (Gregson 2025).',
  corticoides: 'Corticoides de 7,5 mg/día o más durante 3 meses o más sin tratamiento para el hueso: que su médico valore la protección ósea (Gregson 2025).',
  plo: 'Osteoporosis del embarazo o la lactancia: que se movilice pronto y sin reposo en cama; actividad en carga y de fuerza razonable, sin excesos, y sin cargar objetos pesados (Kovacs y Ralston 2015). Con las fracturas consolidadas, a los 3–6 meses, más carga y fuerza (Scioscia 2023). Fisioterapia cuando el dolor lo permita (Hadji 2026; Hardcastle 2022). Al coger y cargar al bebé, la misma bisagra de cadera (extrapolado de Brooke-Wavell 2022). Si las fracturas la limitan mucho, que tenga ayuda para cuidar del bebé (Hardcastle 2022). La lactancia, los fármacos y otro embarazo los decide con su médico.',
  ploRecurrencia: 'Tras una osteoporosis del embarazo o la lactancia pueden aparecer nuevas fracturas, más si hubo varias al principio; si hay más riesgo en otro embarazo no está claro: que lo hable con su médico (Hadji 2026; Anagnostis 2024; Kovacs y Ralston 2015; Hardcastle 2022).',
  medico: 'Los fármacos, el calcio, la vitamina D y el corsé los indica el médico.',
  sospechaDerivar: 'Que su médico valore el riesgo de fractura (FRAX y, si procede, densitometría) (Gregson 2025).',
  sospechaJoven: 'Fractura por fragilidad antes de los 50: valoración médica para buscar la causa (Gregson 2025, introducción).',
  sospechaSinFactores: 'Sin factores de la lista: la sospecha queda en tu juicio clínico.',
  sospechaSinEdad: 'Anota la edad en la fase 1 para interpretar la sospecha: la regla de las guías es a partir de los 50 años.',
  caidasAlto: 'Riesgo alto de caídas: valoración integral de caídas (NICE NG249, 1.1.3; Montero-Odasso 2022).',
  caidasUna: 'Una caída, sin lesión, sin quedarse en el suelo, sin pérdida de conocimiento y sin fragilidad: valora la marcha y el equilibrio; si están alterados, programa de ejercicio de caídas y revisión de los riesgos del hogar (NICE NG249, 1.1.4–1.1.5). La velocidad de marcha por debajo de 0,8 m/s indica más riesgo (Montero-Odasso 2022).',
  caidasNo: 'Sin caídas: equilibrio a diario, 15–20 min (unas 2 h por semana; Giangregorio 2014).',
  caidasDosis: 'Ejercicio de caídas: equilibrio exigente y ejercicio funcional (levantarse de la silla, pasos), 3 o más sesiones por semana, progresado al menos 12 semanas (Montero-Odasso 2022), unas 3 h por semana durante al menos 4 meses (Brooke-Wavell 2022; Gregson 2025). El equilibrio y el ejercicio funcional reducen las caídas; caminar solo no ha demostrado reducirlas (Sherrington 2019).',
};
const _SOSPECHA_OP = { derivar: 'sospechaDerivar', joven: 'sospechaJoven', sinFactores: 'sospechaSinFactores', sinEdad: 'sospechaSinEdad' };
const _CAIDAS_OP = { alto: 'caidasAlto', una: 'caidasUna', no: 'caidasNo' };

const _fracturaVertebralOP = d => d?.fv === '1' || d?.fv === '2';

function _datosOP(d) {
  if (d.es !== 'diagnosticada') return [d.cd ? _CD_OP[d.cd] : ''].filter(Boolean);
  return [
    d.ca ? _CAUSA_OP[d.ca] : '',
    d.fv ? _FV_OP[d.fv] + (d.fr && _fracturaVertebralOP(d) ? ' (alguna reciente o dolorosa)' : '') : '',
    d.fo ? 'otras fracturas por fragilidad' : '',
    d.tr ? _TR_OP[d.tr] : '',
    d.gc ? _GC_OP[d.gc] : '',
    d.cd ? _CD_OP[d.cd] : '',
  ].filter(Boolean);
}

function _recomendacionOP(d) {
  const t = _TEXTOS_OP;
  const caidas = d.cd ? [t[_CAIDAS_OP[d.cd]], d.cd === 'alto' || d.cd === 'una' ? t.caidasDosis : ''] : [];
  if (d.es === 'sospecha') return [d.sr ? t[_SOSPECHA_OP[d.sr]] : '', ...caidas, t.seguridad].filter(Boolean);
  return [
    t.fuerza,
    _fracturaVertebralOP(d) || d.fo ? t.impactoCon : t.impactoSin,
    d.cd === 'no' ? '' : t.equilibrio,
    _fracturaVertebralOP(d) && d.fr ? t.reciente : '',
    t.moverse,
    t.tecnica,
    t.seguridad,
    d.tr === 'antirresortivo' ? t.antirresortivo : '',
    d.dc ? t.corticoides : '',
    d.ca === 'plo' ? t.plo : '',
    d.ca === 'plo' ? t.ploRecurrencia : '',
    ...caidas,
    t.medico,
  ].filter(Boolean);
}

// Una cita lleva un año o es una guía NICE («NICE NG249, 1.1.3»), sin año.
const _sinCitasOP = s => s.replace(/\s*\([^()]*(\d{4}|NICE (NG|CG)\d+)[^()]*\)/g, '');
function _bloqueOP(d) {
  if (!d || !d.es) return '';
  const datos = _datosOP(d);
  return [
    'Osteoporosis o fragilidad ósea (condición especial marcada por el fisioterapeuta):',
    `  · Estado: ${d.es === 'diagnosticada' ? 'diagnosticada' : 'sospecha'}`,
    datos.length ? `  · Datos: ${datos.join('; ')}` : '',
    d.es === 'sospecha' && d.fs != null ? `  · Factores de riesgo de fractura: ${d.fs} de ${_N_FACTORES_OP} «sí»` : '',
    d.es === 'sospecha' ? '  · Es una sospecha: no escribas que el paciente tiene osteoporosis; el diagnóstico es médico.' : '',
    `  · Consideraciones para el plan: ${_recomendacionOP(d).map(_sinCitasOP).join(' ')}`,
  ].filter(Boolean).join('\n');
}

// ── Embarazo o posparto (payload `em`) ───────────────────────────────────────
// Copia de physiq-assessment (lib/embarazo.js, bloqueEMIA; Fase P,
// docs/embarazo-posparto.md): mismo texto, sin las citas, que el informe no
// debe nombrar (_sinCitasEM las quita de _TEXTOS_EM, copiados con ellas de
// data/comun.js). Un cambio allí se copia aquí (un test en cada repositorio
// fija el mismo texto literal: EM_CASOS). Las respuestas de ánimo nunca vienen
// en el payload.
// em con «Embarazada»: { es: 'embarazada', sg: semanas de gestación (null =
// sin registrar), fp: familiar con disfunción del suelo pélvico ('SI'|'NO'|'NS'|
// null), sp, rs }. Con «Posparto»: { es: 'posparto', ss: semanas desde el parto,
// tp: tipo de parto ('vaginal'|'instrumental'|'cesarea'|'ns'|null), oa: lesión
// del esfínter anal, op: occipitoposterior, la: lactancia ('SI'|'NO'|null), sp,
// rs }. sp: síntomas de suelo pélvico { o, h, b } (orina, gases o heces, bulto)
// o null; rs: riesgo de disfunción del suelo pélvico (NICE NG210, 1.3.12).
const _TEXTOS_EM = {
  dosisEmb: 'Activa durante todo el embarazo si no hay contraindicación: al menos 150 min por semana de intensidad moderada (puede hablar, no cantar), repartidos en 3 días o más, con aeróbico y fuerza; si no llega, empezar poco a poco (Mottola 2018, recomendaciones fuertes; Bull 2020).',
  precaucionesEmb: 'Sin buceo, deportes de contacto, riesgo de caída ni bicicleta en movimiento; sin calor excesivo y bien hidratada; la intensidad alta, solo supervisada; si la maniobra de Valsalva le marea, sin aguantar la respiración (Mottola 2018, opinión de expertos).',
  supinoEmb: 'Boca arriba: si se marea, tiene náuseas o se encuentra mal, cambiar de posición (Mottola 2018, recomendación débil); desde la semana 20 puede bajar el retorno venoso (ACOG 2020).',
  pararEmb: 'Parar el ejercicio y consultar si aparece: sangrado vaginal, pérdida de líquido, contracciones regulares y dolorosas, dolor de vientre, dolor en el pecho, falta de aire que no cede en reposo, mareo que no cede, dolor de cabeza, debilidad que afecta al equilibrio, o dolor o hinchazón de pantorrilla (Mottola 2018, recuadro 2; ACOG 2020, recuadro 3).',
  contraindicaciones: 'Con una contraindicación absoluta (rotura de la bolsa, parto prematuro, sangrado persistente sin explicar, placenta previa después de la semana 28, preeclampsia, cuello del útero incompetente, crecimiento fetal restringido, embarazo de trillizos o más, diabetes tipo 1, hipertensión o tiroides sin controlar, u otra enfermedad cardiovascular, respiratoria o sistémica grave), solo las actividades de la vida diaria; con una relativa, que hable con su obstetra o matrona antes de un ejercicio moderado o intenso (Mottola 2018, tabla 2).',
  pelvicaEjercicio: 'Dolor lumbar o de cintura pélvica: ejercicio o cinturón lumbopélvico no rígido (NICE NG201, 1.4.15). En el embarazo, el ejercicio de 8–12 semanas reduce el dolor lumbar y pélvico, pero en el dolor solo pélvico no mejora más que la atención habitual (Liddle y Pennick 2015).',
  terapiaManual: 'La terapia manual no tiene base para ser el tratamiento principal ni para usarse sola (Hall 2016; Simonds 2022): como mucho, para probar el alivio en pocas sesiones (Vleeming 2008, nivel D). Del thrust en el embarazo hay un solo ensayo piloto, con 15 mujeres en decúbito lateral y sin efectos adversos, recogido en la revisión Cochrane (Liddle y Pennick 2015), y la guía de fisioterapia lo deja a criterio del clínico (Clinton 2017, grado C): no basta para decir que sea seguro.',
  sueloCon: 'Fisioterapia de suelo pélvico: programa supervisado de al menos 3 meses (NICE NG210, 1.6.14).',
  sueloHeces: 'Con escapes de heces, también valoración médica (NICE NG123, 1.3.20).',
  sueloRiesgo: 'Sin síntomas, pero con riesgo (familiar de primer grado con disfunción desde la semana 20, parto instrumental, occipitoposterior o lesión del esfínter anal): puede beneficiarse de un programa supervisado de 3 meses (NICE NG210, 1.3.12).',
  sueloDiario: 'Suelo pélvico a diario, con la técnica aprendida (Mottola 2018; NICE NG210, 1.3.11).',
  diastasisEmb: 'Con diástasis en el embarazo, la guía canadiense aconseja consejo de fisioterapia y evitar los abdominales tipo curl (Mottola 2018, opinión de expertos).',
  vueltaPp: 'Volver a la actividad de forma gradual, guiada por los síntomas (Bull 2020); no hace falta una autorización médica de rutina y la vuelta puede empezar antes de las 6 semanas (Davenport 2025). Tras la cesárea, cuando se sienta recuperada (NICE NG192, 1.7.8). La misma dosis que en el embarazo: 150 min por semana, con fuerza (Bull 2020).',
  relativasPp: 'Durante el primer año, que consulte con su médico antes del ejercicio moderado o intenso si tiene: tensión de más de 140/90, dolor en el pecho, falta de aire en reposo, mareo o pérdida de conocimiento, síntomas neurológicos, dolor o hinchazón de pantorrilla, sangrado vaginal sin regla, dolor abdominal intenso, anemia o cansancio excesivo, fiebre, o síntomas de la cesárea que empeoran con el ejercicio; casi siempre podrá seguir activa, adaptando (Davenport 2025).',
  noContraPp: 'No son contraindicaciones: el dolor lumbar, el de cintura pélvica (sin consenso entre los encuestados; lo decidieron los autores), la incontinencia, el prolapso leve o moderado y la diástasis (Davenport 2025).',
  lactanciaPp: 'Si da el pecho, mejor dar el pecho o sacarse leche antes del ejercicio, por comodidad (Davenport 2025).',
  correrPp: 'Volver a correr: no antes de 3 semanas y con las heridas del parto, también la cesárea, completamente curadas; el momento es individual, sin plazo fijo de 6 o 12 semanas. Antes, caminar 30 min y tareas de impacto sin síntomas. Con síntomas leves de suelo pélvico puede correr adaptando; con síntomas graves, valoración especializada primero. Si aparecen escapes, peso o presión vaginal al correr, parar y caminar (Christopher 2024; Deering 2024, consenso Delphi).',
  pelvicaPosparto: 'En el posparto, ejercicio individualizado con enfoque biopsicosocial y cribado del miedo-evitación (Davenport 2025); el tratamiento, antes de los 3 meses (Simonds 2022). Predicen que persista: dolor intenso, muchas pruebas de provocación positivas, dolor lumbopélvico previo, discapacidad alta, neuroticismo y miedo-evitación (Burani 2023).',
  thrustPp: 'En el posparto, el thrust no está indicado con articulaciones simétricas (Simonds 2022).',
  diastasisPp: 'Diástasis: no hay un corte de consenso; la leve no se asocia a dolor lumbopélvico (Sperstad 2016); se resuelve sola en buena parte durante el primer año (Gluppe 2021); el ejercicio abdominal la reduce poco (Beamish 2025), y no hay que prohibir el curl ni el suelo pélvico (Gluppe 2021).',
};
const _TP_EM = { vaginal: 'parto vaginal', instrumental: 'parto vaginal instrumental', cesarea: 'cesárea', ns: 'tipo de parto: no lo sabe' };
const _semEM = n => `${n} ${n === 1 ? 'semana' : 'semanas'}`;
const _spAlgunoEM = d => !!d?.sp && (d.sp.o || d.sp.h || d.sp.b);
const _spTextoEM = d => [d.sp?.o ? 'escapes de orina' : '', d.sp?.h ? 'escapes de gases o heces' : '', d.sp?.b ? 'bulto o peso vaginal' : ''].filter(Boolean).join(', ');

function _datosEM(d) {
  if (d.es === 'embarazada') {
    return [
      d.sg != null ? `${_semEM(d.sg)} de gestación` : 'semanas sin registrar',
      d.fp === 'SI' ? 'familiar de primer grado con disfunción del suelo pélvico' : '',
      _spAlgunoEM(d) ? `suelo pélvico: ${_spTextoEM(d)}` : '',
    ].filter(Boolean);
  }
  return [
    d.ss != null ? `${_semEM(d.ss)} desde el parto` : 'fecha del parto sin registrar',
    d.tp ? _TP_EM[d.tp] : '',
    d.oa ? 'lesión del esfínter anal' : '',
    d.op ? 'occipitoposterior' : '',
    d.la === 'SI' ? 'da el pecho' : d.la === 'NO' ? 'no da el pecho' : '',
    _spAlgunoEM(d) ? `suelo pélvico: ${_spTextoEM(d)}` : '',
  ].filter(Boolean);
}

function _recomendacionEM(d) {
  const t = _TEXTOS_EM;
  const suelo = _spAlgunoEM(d) ? [t.sueloCon, d.sp.h ? t.sueloHeces : ''] : [d.rs ? t.sueloRiesgo : ''];
  if (d.es === 'embarazada') {
    return [t.dosisEmb, t.precaucionesEmb, t.supinoEmb, t.pararEmb, t.contraindicaciones, t.pelvicaEjercicio, t.terapiaManual,
      ...suelo, t.sueloDiario, t.diastasisEmb].filter(Boolean);
  }
  return [t.vueltaPp, t.relativasPp, t.noContraPp, d.la === 'SI' ? t.lactanciaPp : '', t.correrPp, t.pelvicaPosparto,
    t.terapiaManual, t.thrustPp, ...suelo, t.sueloDiario, t.diastasisPp].filter(Boolean);
}

const _sinCitasEM = s => s.replace(/\s*\([^()]*(\d{4}|NICE (NG|CG)\d+)[^()]*\)/g, '');
function _bloqueEM(d) {
  if (!d || !d.es) return '';
  const datos = _datosEM(d);
  return [
    `${d.es === 'embarazada' ? 'Embarazo' : 'Posparto'} (condición especial marcada por el fisioterapeuta):`,
    datos.length ? `  · Datos: ${datos.join('; ')}` : '',
    `  · Consideraciones para el plan: ${_recomendacionEM(d).map(_sinCitasEM).join(' ')}`,
  ].filter(Boolean).join('\n');
}

// Paciente anticoagulado o antiagregado (ac): copia de bloqueACIA() de
// physiq-assessment (lib/anticoagulado.js; Fase P, docs/anticoagulado.md).
// Payload: { es: 'toma', ti: lo que toma, en el orden de la tarjeta:
// 'vk' antivitamina K | 'do' anticoagulante directo | 'hp' heparina |
// 'as' aspirina | 'oa' otro antiagregante | 'ns' no lo sabe; [] sin registrar }.
// «No lo sabe» o nada marcado cuenta como anticoagulante (el caso prudente).
// _TEXTOS_AC lleva las citas como en data/comun.js de assessment y
// _sinCitasAC las quita; AC_CASOS fija en los dos repos el mismo texto.
const _TEXTOS_AC = {
  cabeza: 'Golpe en la cabeza con anticoagulante o con un antiagregante que no sea la aspirina sola: a urgencias, aunque se encuentre bien (NICE NG232, 1.2.4); que un adulto le acompañe las primeras 24 horas y sepa que puede empeorar después de parecer recuperado (NICE NG232, 1.10.9). El sangrado tardío es raro, pero puede aparecer días después (Chenoweth 2018).',
  cabezaAspirina: 'Con la aspirina sola, el golpe en la cabeza no es por sí solo motivo de derivar (NICE NG232, 1.2.4); los síntomas tras el golpe sí lo son.',
  thrust: 'Thrust: la única tabla específica de la columna torácica lo pone como contraindicación absoluta con tratamiento anticoagulante (Puentedura 2015, tabla 1), y otra, de la terapia manual cervical, como precaución (Hutting 2018, opinión de los autores); las dos son opinión de expertos, y ninguna distingue fármacos ni da un INR. Un estudio de cohorte asoció la anticoagulación crónica a más lesión cerebral o medular tras la manipulación, sin probar la causa (Whedon 2015).',
  antiagregante: 'Con antiagregante solo, ninguna fuente de manipulación lo trata como contraindicación; precaución con lo que tenga riesgo de golpe (lo recomiendan para el lupus: Blaess 2024, rec. 3).',
  banderas: 'Banderas de sangrado (fase 2): dolor brusco de cuello o espalda con debilidad, dolor de ingle o costado con el muslo débil o mareo, dolor brusco con bulto en la pared del abdomen, una extremidad tensa con dolor desproporcionado, y un hematoma que no se resuelve.',
};
const _TI_AC = { vk: 'antivitamina K', do: 'anticoagulante directo', hp: 'heparina', as: 'aspirina', oa: 'otro antiagregante', ns: 'no sabe qué toma' };
const _tiAC = d => d?.ti || [];
const _anticoagulanteAC = d => !_tiAC(d).length || _tiAC(d).includes('ns') || _tiAC(d).some(t => ['vk', 'do', 'hp'].includes(t));
const _soloAspirinaAC = d => _tiAC(d).length === 1 && _tiAC(d)[0] === 'as';
const _dobleAC = d => _tiAC(d).includes('as') && _tiAC(d).includes('oa');

function _datosAC(d) {
  const lista = _tiAC(d).map(t => _TI_AC[t]).filter(Boolean);
  if (_dobleAC(d)) lista.push('doble antiagregación');
  return lista.length ? lista : ['fármaco sin registrar'];
}

const _sinCitasAC = s => s.replace(/\s*\([^()]*(\d{4}|NICE (NG|CG)\d+)[^()]*\)/g, '');
function _bloqueAC(d) {
  if (!d || !d.es) return '';
  const t = _TEXTOS_AC;
  return [
    'Paciente anticoagulado o antiagregado (condición especial marcada por el fisioterapeuta):',
    `  · Toma: ${_datosAC(d).join('; ')}`,
    '  · No sugieras suspender, saltarse ni ajustar el tratamiento. No atribuyas los síntomas del paciente al fármaco si el fisioterapeuta no lo ha dicho.',
    `  · Consideraciones para la sesión: ${[_soloAspirinaAC(d) ? t.cabezaAspirina : t.cabeza, _anticoagulanteAC(d) ? t.thrust : t.antiagregante, t.banderas].map(_sinCitasAC).join(' ')}`,
  ].join('\n');
}

// Fármacos que toma (fm): copia de bloqueFMIA() de physiq-assessment
// (lib/farmacos-paciente.js; paso 3 de la farmacología, docs/farmacos-paciente.md).
// Payload: [{ id, n }]: familias de la guía de fármacos marcadas en la tarjeta
// «Fármacos que toma», con su nombre corto (n), para no tener aquí una tabla de
// ids que habría que actualizar con cada familia nueva. Sin dosis ni nombres de
// fármaco, sin citas. FM_CASOS fija en los dos repos el mismo texto.
function _bloqueFM(fm) {
  const nombres = (Array.isArray(fm) ? fm : []).map(x => x?.n).filter(Boolean);
  if (!nombres.length) return '';
  return [
    'Fármacos que toma (familias registradas por el fisioterapeuta; sin dosis ni nombres):',
    `  · ${nombres.join('; ')}`,
    '  · No sugieras cambiar, suspender ni ajustar la medicación, ni comentes interacciones entre fármacos. No atribuyas los síntomas del paciente a un fármaco si el fisioterapeuta no lo ha dicho, y no añadas recomendaciones sobre la medicación que no estén en estos datos.',
  ].join('\n');
}

// Línea corta para la insignia de la valoración importada
function resumenSintomas(d) {
  const partes = [];
  if (d?.z1?.z) partes.push(`P1 ${d.z1.z}`);
  (d?.ss || []).forEach(s => partes.push(`P${s.n} ${s.z || 'zona sin indicar'}${s.or ? ' (otra región)' : ''}`));
  return partes.length > 1 || d?.ss?.length ? partes.join(' · ') : '';
}

// «(→ Rx)», «①/②» fuera; «A → B» → «A — orienta a: B»
function _limpiarEtiqueta(texto) {
  const partes = String(texto ?? '').replace(/\s*\(→[^)]*\)/g, '').replace(/\s*\([①-⑳]\)/g, '').split(/\s*→\s*/);
  return partes.length > 1 ? `${partes[0]} — orienta a: ${partes.slice(1).join('; ')}` : partes[0];
}

function _bloqueCirugia(cq) {
  const fecha = cq.fe ? `${cq.fe}${cq.se != null ? ` (${cq.se} semanas)` : ''}` : cq.se != null ? `hace unas ${cq.se} semanas` : '';
  const conProt = cq.pr === 'Escrito' || cq.pr === 'Verbal';
  return [
    'Cirugía (paciente posquirúrgico):',
    `  · Intervención: ${cq.iv || 'sin detallar'}`,
    fecha ? `  · Fecha: ${fecha}` : '',
    `  · Protocolo del cirujano: ${conProt ? cq.pr.toLowerCase() : 'no hay o no se ha indicado; restricciones pendientes de confirmar con el cirujano'}`,
    cq.re ? `  · Restricciones: ${cq.re}` : '',
    cq.co?.length ? `  · Complicaciones: ${cq.co.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

function _signosVitalesTexto(sv, an) {
  const partes = [];
  if (sv?.fc != null)   partes.push(`FC ${sv.fc} lpm`);
  if (sv?.fr != null)   partes.push(`FR ${sv.fr} rpm`);
  if (sv?.spo2 != null) partes.push(`SpO₂ ${sv.spo2}%`);
  if (sv?.tas != null || sv?.tad != null) partes.push(`TA ${sv?.tas ?? '—'}/${sv?.tad ?? '—'} mmHg`);
  if (an?.talla != null) partes.push(`talla ${an.talla} cm`);
  if (an?.peso != null)  partes.push(`peso ${an.peso} kg`);
  if (an?.imc != null)   partes.push(`IMC ${Number(an.imc).toFixed(1)}`);
  return partes.join(' · ');
}

// Formulario previo (payload `fp`: { s, q, a }) sin las respuestas «No sé» /
// «No sabría decir», ni sueltas ni dentro de una matriz («Caminar: No sé · …»):
// el informe las convertía en negaciones («niega…», «desconoce si…»).
const _RE_NO_SE = /^(?:no s[eé]|no sabr[ií]a decir)$/i;
// Una línea por cuestionario del campo `cu`: «PHQ-9: 12/27 — Síntomas depresivos moderados»
function _lineaCuestionario(c) {
  return `${c.n}: ${c.v}${c.i ? ` — ${c.i}` : ''}${c.a?.length ? ` · Aviso: ${c.a.join(' · ')}` : ''}`;
}

function _formularioSinNoSe(fp) {
  return (fp || []).map(x => {
    const partes = String(x.a ?? '').split(' · ').map(p => {
      const fila = /^(.*):\s*(.+)$/.exec(p);           // fila de matriz: «Caminar: No sé»
      if (fila) return _RE_NO_SE.test(fila[2].trim()) ? '' : p;
      return p.split(', ').filter(v => !_RE_NO_SE.test(v.trim())).join(', ');   // única o múltiple
    }).filter(p => p.trim());
    return partes.length ? { q: x.q, a: partes.join(' · ') } : null;
  }).filter(Boolean);
}

function buildClinicalContext(data, opts = {}) {
  if (!data) return '';
  const conAudio = !!opts.conAudio;
  const hyps = (data.h || [])
    .map(h => `  · ${_limpiarEtiqueta(h.name)}${h.pq
      ? ' (la cirugía es la condición de salud, no una hipótesis por confirmar)'
      : h.dt ? ' (diagnóstico ya confirmado y tratado por el médico: es un antecedente)' : ''}`)
    .join('\n');
  const brText = data.br?.length > 0
    ? data.br.map(s => `  ⚠️ ${s}`).join('\n')
    : '  Negativas';
  const sqText = data.sq?.length > 0
    ? '\nAlertas sistémicas positivas:\n' + data.sq.map(s => `  · ${s}`).join('\n')
    : '';

  const extra = [];
  if (data.cq) extra.push(_bloqueCirugia(data.cq));
  if (data.hm?.es) extra.push(_bloqueHM(data.hm));
  if (data.ds?.es) extra.push(_bloqueDs(data.ds));
  if (data.le?.es) extra.push(_bloqueLES(data.le));
  if (data.ma?.es) extra.push(_bloqueMA(data.ma));
  if (data.op?.es) extra.push(_bloqueOP(data.op));
  if (data.em?.es) extra.push(_bloqueEM(data.em));
  if (data.ac?.es) extra.push(_bloqueAC(data.ac));
  const fm = _bloqueFM(data.fm);
  if (fm) extra.push(fm);
  if (data.ur?.length) extra.push(`DERIVACIÓN URGENTE indicada en el cribado (debe constar en el informe):\n${data.ur.map(s => `  · ${s}`).join('\n')}`);
  if (data.dv?.length) extra.push(`Derivación médica indicada en la exploración (debe constar en el informe):\n${data.dv.map(s => `  · ${s}`).join('\n')}`);
  // Cuestionarios puntuados en la calculadora de physiq-assessment (`cu`): solo
  // los completos, con la puntuación y la interpretación que da la app, y las
  // alertas de seguridad aunque el cuestionario esté a medias. Mismo bloque que
  // contextoValoracion() de physiq-assessment.
  const cu = (data.cu || []).filter(c => !c.inc || c.a?.length);
  if (cu.length) extra.push(`Cuestionarios que ha rellenado el paciente (puntuación e interpretación calculadas por la app; cítalos con su nombre, su puntuación y su interpretación tal cual, sin recalcularlos ni darles otro significado, junto a los factores personales o psicosociales si son de ánimo, miedo, autoeficacia o riesgo de cronicidad, y junto al dolor si son de dolor neuropático; si avisan de algo, el aviso también debe constar):\n${cu.map(c => `  · ${c.inc ? `${c.n}: sin completar · ⚠️ ${c.a.join(' · ')}` : _lineaCuestionario(c)}`).join('\n')}`);
  const sv = _signosVitalesTexto(data.sv, data.an);
  if (sv) extra.push(`Signos vitales y antropometría: ${sv}`);
  const fp = _formularioSinNoSe(data.fp);
  if (fp.length) extra.push(`Lo que refiere el paciente antes de la consulta (pregunta → respuesta):\n${fp.map(x => `  · ${x.q} → ${x.a}`).join('\n')}${conAudio ? `\n  ${_reglasInforme().RECORDATORIO_DISCREPANCIAS}` : ''}`);
  const notas = [['Para dosificar la carga', data.pn?.variableControl], ['Recuperación entre sesiones', data.pn?.ventanaRecuperacion], ['Cuándo hacer los ejercicios', data.pn?.anclajeHabito]]
    .filter(([, v]) => (v || '').trim());
  if (notas.length) extra.push(`Indicaciones del fisioterapeuta para el plan:\n${notas.map(([k, v]) => `  · ${k}: ${v.trim()}`).join('\n')}`);
  if (data.md === 'breve') {
    // Con cirugía, «pendiente de confirmar con el cirujano» ya tiene su sitio
    // (regla del paciente operado): en la lista salía otra vez.
    const pe = (data.pe || []).filter(s => !(data.cq && /cirujano/i.test(s)));
    extra.push('Tipo de valoración: inicial breve (consulta corta). Las hipótesis sin tests de confirmación son hipótesis de trabajo, no diagnósticos.'
      + ' Dilo UNA vez en el informe, en una frase, junto con lo que queda pendiente de completar en la próxima sesión (la lista de abajo, en lenguaje clínico); lo pendiente se dice solo en esa frase, sin repetirlo en otras secciones («no se realizaron tests…»); no presentes como completo lo que está pendiente (p. ej., si el cribado sistémico fue abreviado, no escribas que el cribado sistémico fue negativo sin más).'
      + (pe.length ? `\nPendiente de completar:\n${pe.map(s => `  · ${s}`).join('\n')}` : ''));
  }
  // El cribado solo por embudo no es un «Negativo» sin más
  const embudo = data.md === 'breve' && (data.pe || []).some(s => /embudo/i.test(s));

  return `## DATOS DE VALORACIÓN ESTRUCTURADA (PhysiQ-Assessment)
NOTA: estos datos proceden de una valoración clínica estructurada. Los resultados y clasificaciones del fisioterapeuta son la fuente prioritaria; para lo que refiere el paciente, sigue la regla de discrepancias de las instrucciones.
Paciente: ${data.p || '—'} · Región: ${data.r || '—'}${data.la ? ` · Lado afectado: ${String(data.la).toLowerCase()}` : ''} · Fecha: ${data.d || '—'}
Motivo de consulta: ${data.mo || '—'}
Mecanismo: ${data.me || '—'} · Cronología: ${data.cr || '—'}
NRS: ${data.nr != null ? `${data.nr}/10 (intensidad registrada por el fisioterapeuta en la valoración: debe constar en el informe como «EVN de N/10» o «EVN de N/10 en la valoración», sin atribuirle otro momento —reposo, actividad, peor momento, última semana—; si se da otra cifra para otro momento, recoge las dos, cada una con el suyo)` : 'no registrado'}
Irritabilidad: ${data.ir || '—'} · Naturaleza: ${data.na || '—'}
${_bloqueSintomas(data) ? `${_bloqueSintomas(data)}\n` : ''}Riesgo psicosocial: ${data.rp || '—'}
Banderas rojas:
${brText}
Cribado sistémico: ${data.si ? '⚠️ Positivo' : embudo ? 'sin hallazgos en el embudo (cribado abreviado)' : 'Negativo'}${sqText}

Hipótesis de trabajo del fisioterapeuta (de mayor a menor apoyo):
${hyps || '  (sin hipótesis registradas)'}${extra.length ? '\n\n' + extra.join('\n\n') : ''}

---`;
}

function buildROMContext(romPayload) {
  if (!romPayload) return '';
  const fecha = romPayload.fecha || '—';

  // Multi-region schema: { regions: { [id]: { label, rom } } }
  if (romPayload.regions) {
    const sections = Object.entries(romPayload.regions)
      .filter(([, r]) => r.rom && Object.keys(r.rom).length)
      .map(([, r]) => {
        const rows = Object.entries(r.rom)
          .map(([, m]) => `  · ${m.label}: ${m.value}° (ref ${m.ref}°)${m.deficit ? ' — déficit' : ''}`)
          .join('\n');
        return `${r.label}:\n${rows}`;
      });
    if (!sections.length) return '';
    return `## DATOS DE MOVILIDAD ARTICULAR (PhysiQ-Motion)
NOTA: valores medidos con inclinómetro digital; úsalos como referencia objetiva para la sección de ROM del informe.
Fecha: ${fecha}
${sections.join('\n\n')}

---`;
  }

  // Single-region schema (legacy): { region, rom }
  if (!romPayload.rom || !Object.keys(romPayload.rom).length) return '';
  const region = romPayload.region
    ? romPayload.region.charAt(0).toUpperCase() + romPayload.region.slice(1)
    : '—';
  const rows = Object.entries(romPayload.rom)
    .map(([, m]) => `  · ${m.label}: ${m.value}° (ref ${m.ref}°)${m.deficit ? ' — déficit' : ''}`)
    .join('\n');
  return `## DATOS DE MOVILIDAD ARTICULAR (PhysiQ-Motion)
NOTA: valores medidos con inclinómetro digital; úsalos como referencia objetiva para la sección de ROM del informe.
Región: ${region} · Fecha: ${fecha}
${rows}

---`;
}

function buildForceContext(forceData) {
  if (!forceData) return '';
  const measurements = Array.isArray(forceData) ? forceData : [forceData];
  if (!measurements.length) return '';

  const lines = measurements.map(m => {
    const label = m.label ?? (m.testType === 'peak' ? 'MVC' : m.testType?.toUpperCase() ?? 'Fuerza');
    if (m.laterality === 'comparison') {
      const l  = m.sides?.left?.peak;
      const r  = m.sides?.right?.peak;
      const ai = m.asymmetryIndex ?? (l != null && r != null ? (() => { const avg = (l + r) / 2; return avg ? Math.abs(l - r) / avg * 100 : null; })() : null);
      const vals = [
        l  != null ? `Izq ${l.toFixed(1)} kg`  : null,
        r  != null ? `Der ${r.toFixed(1)} kg`   : null,
        ai != null ? `AI ${ai.toFixed(1)}%`     : null,
      ].filter(Boolean).join(' · ');

      const detail = [];
      if (m.testType === 'rfd') {
        const lRfd = m.sides?.left?.rfd2080;
        const rRfd = m.sides?.right?.rfd2080;
        if (lRfd != null || rRfd != null) {
          const rfdParts = [
            lRfd != null ? `Izq ${lRfd.toFixed(0)} kg/s` : null,
            rRfd != null ? `Der ${rRfd.toFixed(0)} kg/s` : null,
          ].filter(Boolean);
          const rfdAI = (lRfd != null && rRfd != null && (lRfd + rRfd) > 0)
            ? Math.abs(lRfd - rRfd) / ((lRfd + rRfd) / 2) * 100 : null;
          if (rfdAI != null) rfdParts.push(`AI-RFD ${rfdAI.toFixed(1)}%`);
          detail.push(`RFD 20-80%: ${rfdParts.join(' · ')}`);
        }
        const lIfe = m.sides?.left?.ife;
        const rIfe = m.sides?.right?.ife;
        if (lIfe != null || rIfe != null) {
          const ifeParts = [
            lIfe != null ? `Izq ${lIfe.toFixed(1)}%` : null,
            rIfe != null ? `Der ${rIfe.toFixed(1)}%` : null,
          ].filter(Boolean);
          detail.push(`IFE: ${ifeParts.join(' · ')}`);
        }
      }

      const line1 = `  · ${label}: ${vals}`;
      return detail.length ? `${line1}\n    ${detail.join(' · ')}` : line1;
    }
    const peak      = m.peak;
    const sideLabel = m.side === 'left' ? ' (Izq)' : m.side === 'right' ? ' (Der)' : '';
    const rfdVal    = m.rfd2080 ?? m.rfd;
    const rfdPart   = rfdVal != null ? ` · RFD 20-80% ${rfdVal.toFixed(0)} kg/s` : '';
    const ifePart   = m.ife   != null ? ` · IFE ${m.ife.toFixed(1)}%`             : '';
    return `  · ${label}${sideLabel}: ${peak != null ? peak.toFixed(1) + ' kg' : '—'}${rfdPart}${ifePart}`;
  }).join('\n');

  return `## DATOS DE FUERZA (PhysiQ-Force)
NOTA: mediciones con dinamómetro digital Tindeq Progressor; úsalos como referencia objetiva para la sección de fuerza del informe.
${lines}

---`;
}

function buildJumpContext(jumpData) {
  if (!jumpData) return '';
  const jumps = Array.isArray(jumpData) ? jumpData : [jumpData];
  if (!jumps.length) return '';

  // Group by type + leg (physiq-jump schema: {id, type, leg, flightTime, height, fps})
  const groups = {};
  for (const j of jumps) {
    const type = j.type ?? j.label ?? j.testType ?? 'Salto';
    const leg  = j.leg ?? j.side;
    const legLabel = leg === 'left' ? ' (Izq)' : leg === 'right' ? ' (Der)' : '';
    const key  = `${type}${legLabel}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(j);
  }

  const lines = Object.entries(groups).map(([label, group]) => {
    const heights = group.map(j => j.height).filter(h => h != null);
    const avg = heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : null;
    const max = heights.length ? Math.max(...heights) : null;
    const parts = [];
    if (group.length > 1) parts.push(`n=${group.length}`);
    if (max != null) parts.push(group.length > 1 ? `máx ${max.toFixed(1)} cm` : `${max.toFixed(1)} cm`);
    if (avg != null && group.length > 1) parts.push(`media ${avg.toFixed(1)} cm`);
    // flightTime is in seconds → convert to ms
    const fts = group.map(j => j.flightTime).filter(ft => ft != null);
    if (fts.length) {
      const avgFt = fts.reduce((a, b) => a + b, 0) / fts.length;
      parts.push(`vuelo ${Math.round(avgFt * 1000)} ms`);
    }
    return `  · ${label}: ${parts.join(' · ') || '—'}`;
  });

  return `## DATOS DE SALTO (PhysiQ-Jump)
NOTA: mediciones de rendimiento de salto por análisis de vídeo; úsalos como referencia objetiva para la sección de capacidad funcional del informe.
${lines.join('\n')}

---`;
}

function buildBalanceContext(balanceData) {
  if (!balanceData) return '';
  // Balance emits a dict { testId: { testId, label, sublabel, eyes, stance, duration, score, metrics } }
  const measurements = Array.isArray(balanceData)
    ? balanceData
    : Object.values(balanceData);
  if (!measurements.length) return '';

  const lines = measurements.map(m => {
    const label = m.sublabel ? `${m.label} · ${m.sublabel}` : (m.label ?? m.testType ?? 'Equilibrio');
    const parts = [];
    if (m.eyes)   parts.push(m.eyes === 'open' ? 'ojos abiertos' : 'ojos cerrados');
    if (m.stance) parts.push(m.stance === 'tandem' ? 'tándem' : 'bilateral');
    if (m.duration        != null) parts.push(`${m.duration} s`);
    if (m.score           != null) parts.push(`puntuación ${m.score}/100`);
    if (m.metrics?.hRMS         != null) parts.push(`H-RMS ${m.metrics.hRMS.toFixed(1)} mG`);
    if (m.metrics?.stabilityRate != null) parts.push(`tasa ${m.metrics.stabilityRate.toFixed(1)} mG/s`);

    const detail = [];
    const apRMS = m.metrics?.ap?.rms;
    const mlRMS = m.metrics?.ml?.rms;
    if (apRMS != null && mlRMS != null) {
      const ratio = mlRMS > 0 ? apRMS / mlRMS : null;
      const dir = ratio == null ? '' : ratio > 1.6 ? ' (dominante AP)' : ratio < 0.625 ? ' (dominante ML)' : ' (mixto)';
      detail.push(`AP ${apRMS.toFixed(1)} mG · ML ${mlRMS.toFixed(1)} mG${dir}`);
    }
    if (m.metrics?.cop?.pathLength   != null) detail.push(`trayectoria COP ${m.metrics.cop.pathLength.toFixed(1)} cm`);
    if (m.metrics?.cop?.meanVelocity != null) detail.push(`vel. COP ${m.metrics.cop.meanVelocity.toFixed(2)} cm/s`);
    if (m.metrics?.cop?.ellipseArea  != null) detail.push(`elipse 95% ${m.metrics.cop.ellipseArea.toFixed(2)} cm²`);
    if (m.metrics?.cop?.jerkRMS      != null) detail.push(`jerk COP ${m.metrics.cop.jerkRMS.toFixed(2)} cm/s³`);

    const line1 = `  · ${label}: ${parts.join(' · ') || '—'}`;
    return detail.length ? `${line1}\n    ${detail.join(' · ')}` : line1;
  }).join('\n');

  return `## DATOS DE EQUILIBRIO (PhysiQ-Balance)
NOTA: mediciones de control postural y equilibrio; úsalos como referencia objetiva para la sección de estabilidad del informe. Los valores COP son una aproximación por péndulo invertido, no force-plate.
${lines}

---`;
}

function buildKinematicsContext(kinematicsData) {
  if (!kinematicsData) return '';
  const recordings = (Array.isArray(kinematicsData) ? kinematicsData : [kinematicsData])
    .filter(r => r && r.joints && r.joints.length && r.series);
  if (!recordings.length) return '';

  function _fmtJoint(name) {
    return name
      .replace(/^left_/, 'L ')
      .replace(/^right_/, 'R ')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  const blocks = recordings.map((rec, i) => {
    const { joints, series, duration } = rec;
    const durationSec = ((duration || 0) / 1000).toFixed(1);
    const lines = joints
      .filter(j => series[j] && series[j].a && series[j].a.length)
      .map(j => {
        const angles = series[j].a;
        const min  = Math.min(...angles);
        const max  = Math.max(...angles);
        const mean = Math.round(angles.reduce((s, a) => s + a, 0) / angles.length);
        return `  · ${_fmtJoint(j)}: media ${mean}° · rango ${min}°–${max}° (amplitud ${max - min}°)`;
      }).join('\n');
    if (!lines) return '';
    const label = recordings.length > 1 ? `Grabación ${i + 1} (${durationSec}s)` : `Duración ${durationSec}s`;
    return `${label}:\n${lines}`;
  }).filter(Boolean);

  if (!blocks.length) return '';

  const noteDuration = recordings.length > 1
    ? `${recordings.length} grabaciones`
    : `${((recordings[0].duration || 0) / 1000).toFixed(1)}s`;

  return `## DATOS DE CINEMÁTICA ARTICULAR (PhysiQ-Kinematics)
NOTA: ángulos articulares medidos por visión artificial durante ${noteDuration}; úsalos como referencia objetiva para la sección de movilidad dinámica del informe.
${blocks.join('\n\n')}

---`;
}

function buildQuestionnaireContext(questionnairesData) {
  if (!questionnairesData) return '';
  const items = Array.isArray(questionnairesData) ? questionnairesData : [questionnairesData];
  if (!items.length) return '';

  const lines = items.map(q => {
    const name = q.name || q.abbr || q.id || '?';
    const parts = [];
    if (q.score  != null) parts.push(`puntuación ${q.score}`);
    if (q.label)          parts.push(q.label);
    if (q.risk)           parts.push('⚠️ riesgo');
    return `  · ${name}: ${parts.join(' · ') || '—'}`;
  }).join('\n');

  return `## DATOS DE CUESTIONARIOS VALIDADOS (PhysiQ-Questionnaire)
NOTA: resultados de cuestionarios clínicos validados; úsalos como referencia objetiva para la sección de evaluación funcional del informe.
${lines}

---`;
}

if (typeof module !== 'undefined') module.exports = { decodePayload, buildClinicalContext, resumenSintomas, buildROMContext, buildForceContext, buildJumpContext, buildBalanceContext, buildKinematicsContext, buildQuestionnaireContext };
