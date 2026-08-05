// workers/demo/handlers.js — servido de las rutas en modo demo.
//
// ⚠ INVARIANTE DE DISEÑO — ninguna función de este módulo recibe `env`.
//
// Es la garantía estructural de "coste cero": los secretos (OPENAI_API_KEY para
// Whisper, ANTHROPIC_API_KEY para Claude, RESEND_API_KEY para el envío) viven en
// `env`, y este módulo no tiene acceso a él. Un handler demo no puede llamar a
// una API de pago aunque alguien lo intente por error: no tendría con qué
// autenticarse. La propiedad se verifica leyendo las firmas, no auditando ifs.
//
// Mismo criterio que worker/demo/handlers.js en el repo del hub.
//   grep -n "api\.\(openai\|anthropic\|resend\)\|env\." workers/demo/  → vacío

import {
  DEMO_TRANSCRIPT,
  DEMO_REPORT_NARRATIVE,
  DEMO_REPORT_BRIEF,
  DEMO_DOC_SUMMARY,
} from './fixtures.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── POST / — generación de informe, SSE ─────────────────────────────────────
//
// Reproduce el mismo protocolo que el modo real: eventos `transcript`,
// `report_chunk` sucesivos y `done`. El cliente (app.js) recorre exactamente el
// mismo parser y el mismo render incremental; no distingue la fuente.
export function demoReport(request, corsHeaders, ctx) {
  const { readable, writable } = new TransformStream();
  const writer  = writable.getWriter();
  const encoder = new TextEncoder();

  const sendSSE = (type, data) =>
    writer.write(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));

  ctx.waitUntil((async () => {
    try {
      // La plantilla no viaja como campo propio, pero el prompt que manda el
      // cliente lleva su estructura dentro. Leerla de ahí evita añadir un campo
      // nuevo al contrato solo para el demo.
      let promptTemplate = '';
      let hasDocs = false;
      try {
        const formData = await request.formData();
        promptTemplate = String(formData.get('prompt') || '');
        hasDocs = !!formData.get('documents');
      } catch { /* cuerpo ilegible — se sirve el informe narrativo por defecto */ }

      const brief  = promptTemplate.includes('## PRESENTACIÓN CLÍNICA');
      const report = brief ? DEMO_REPORT_BRIEF : DEMO_REPORT_NARRATIVE;

      // Whisper tarda: sin esta espera el demo transcribe en cero segundos y la
      // experiencia deja de ser representativa.
      await sleep(hasDocs ? 2600 : 1800);
      sendSSE('transcript', {
        text: hasDocs
          ? `${DEMO_TRANSCRIPT}\n\n[Resumen de documentos adjuntos]\n${DEMO_DOC_SUMMARY}`
          : DEMO_TRANSCRIPT,
      });

      await sleep(700);

      // Troceado a ~35 palabras/s. El informe narrativo completo son unas 1.200
      // palabras: a la velocidad exacta de Claude serían ~35 s de stream, que es
      // realista pero pierde al visitante y se acerca a los límites de ejecución
      // del worker. Se acelera lo justo para quedarse en ~18 s manteniendo la
      // sensación de generación incremental.
      const tokens = report.split(/(\s+)/);
      for (let i = 0; i < tokens.length; i += 6) {
        sendSSE('report_chunk', { text: tokens.slice(i, i + 6).join('') });
        await sleep(45);
      }

      sendSSE('done', { success: true });
    } catch (error) {
      sendSSE('error', { message: error.message });
    } finally {
      writer.close();
    }
  })());

  return new Response(readable, {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}

// ── POST /email — envío simulado ────────────────────────────────────────────
//
// Devuelve éxito sin tocar Resend. `demo: true` es lo que permite a app.js decir
// "envío simulado" en vez de afirmar que el correo ha salido: un demo que miente
// sobre haber enviado un informe clínico sería peor que uno que no envía.
export async function demoEmail(corsHeaders) {
  await sleep(900);
  return new Response(JSON.stringify({ ok: true, demo: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
