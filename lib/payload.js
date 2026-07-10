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

if (typeof module !== 'undefined') module.exports = { decodePayload, buildClinicalContext, buildROMContext, buildForceContext, buildJumpContext, buildBalanceContext, buildKinematicsContext, buildQuestionnaireContext };
