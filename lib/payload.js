// Pure functions shared between app.js (browser) and tests/unit.js (Node).
// No DOM, no globals beyond what Node and browsers both provide (atob, btoa).

function decodePayload(v) {
  return JSON.parse(decodeURIComponent(escape(atob(v))));
}

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

function buildROMContext(romPayload) {
  if (!romPayload?.rom || !Object.keys(romPayload.rom).length) return '';
  const region = romPayload.region
    ? romPayload.region.charAt(0).toUpperCase() + romPayload.region.slice(1)
    : '—';
  const rows = Object.entries(romPayload.rom)
    .map(([, m]) => `  · ${m.label}: ${m.value}° (ref ${m.ref}°)${m.deficit ? ' — déficit' : ''}`)
    .join('\n');
  return `## DATOS DE MOVILIDAD ARTICULAR (PhysiQ-Motion)
NOTA: valores medidos con inclinómetro digital; úsalos como referencia objetiva para la sección de ROM del informe.
Región: ${region} · Fecha: ${romPayload.fecha || '—'}
${rows}

---`;
}

if (typeof module !== 'undefined') module.exports = { decodePayload, buildClinicalContext, buildROMContext };
