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
      return `  · ${label}: ${vals}`;
    }
    const peak      = m.peak;
    const sideLabel = m.side === 'left' ? ' (Izq)' : m.side === 'right' ? ' (Der)' : '';
    const rfdPart   = m.rfd  != null ? ` · RFD ${m.rfd.toFixed(0)} kg/s`  : '';
    return `  · ${label}${sideLabel}: ${peak != null ? peak.toFixed(1) + ' kg' : '—'}${rfdPart}`;
  }).join('\n');

  return `## DATOS DE FUERZA (PhysiQ-Force)
NOTA: mediciones con dinamómetro digital Tindeq Progressor; úsalos como referencia objetiva para la sección de fuerza del informe.
${lines}

---`;
}

function buildJumpContext(jumpData) {
  if (!jumpData) return '';
  const measurements = Array.isArray(jumpData) ? jumpData : [jumpData];
  if (!measurements.length) return '';

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
      return `  · ${label}: ${vals}`;
    }
    const parts = [];
    if (m.height      != null) parts.push(`${m.height.toFixed(1)} cm`);
    if (m.flightTime  != null) parts.push(`vuelo ${m.flightTime} ms`);
    if (m.contactTime != null) parts.push(`contacto ${m.contactTime} ms`);
    if (m.rsi         != null) parts.push(`RSI ${m.rsi.toFixed(2)}`);
    const sideLabel = m.side === 'left' ? ' (Izq)' : m.side === 'right' ? ' (Der)' : '';
    return `  · ${label}${sideLabel}: ${parts.join(' · ') || '—'}`;
  }).join('\n');

  return `## DATOS DE SALTO (PhysiQ-Jump)
NOTA: mediciones de rendimiento de salto; úsalos como referencia objetiva para la sección de capacidad funcional del informe.
${lines}

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
    // legacy flat fields
    if (m.stabilityIndex != null) parts.push(`IE ${m.stabilityIndex.toFixed(1)}%`);
    if (m.swayVelocity   != null) parts.push(`vel. oscilación ${m.swayVelocity.toFixed(1)} mm/s`);
    return `  · ${label}: ${parts.join(' · ') || '—'}`;
  }).join('\n');

  return `## DATOS DE EQUILIBRIO (PhysiQ-Balance)
NOTA: mediciones de control postural y equilibrio; úsalos como referencia objetiva para la sección de estabilidad del informe.
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

if (typeof module !== 'undefined') module.exports = { decodePayload, buildClinicalContext, buildROMContext, buildForceContext, buildJumpContext, buildBalanceContext, buildKinematicsContext };
