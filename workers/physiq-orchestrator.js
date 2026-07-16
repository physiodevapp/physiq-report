// physiq-orchestrator — single worker: Turnstile + Whisper + Claude (SSE streaming) + Resend email
// Deploy to Cloudflare Workers. Required env vars:
//
// Secrets (Dashboard → Worker → Settings → Variables → Add secret):
//   TURNSTILE_SECRET   — Cloudflare Turnstile secret key
//   OPENAI_API_KEY     — OpenAI API key (Whisper)
//   ANTHROPIC_API_KEY  — Anthropic API key (Claude)
//   RESEND_API_KEY     — Resend API key (email delivery)
//
// KV Namespace binding (Dashboard → Worker → Settings → Bindings):
//   Variable name: LICENSES  →  KV namespace: physiq-licenses
//   Key format:  <license-key-string>  →  {"clinic":"Nombre","active":true}
//   While LICENSES is unbound the worker runs without license checks (dev passthrough).
//
// Routes:
//   POST /        — multipart/form-data → SSE stream (transcript + report)
//   POST /email   — application/json { to, subject, html } → JSON { ok: true }
//
// SSE events (/ route):
//   event: transcript   data: { text: string }
//   event: report_chunk data: { text: string }
//   event: done         data: { success: true }
//   event: error        data: { message: string }
//
// FormData fields (/ route):
//   file             — audio blob (optional)
//   whisperHint      — hint string for Whisper (optional)
//   prompt           — prompt template with {{TRANSCRIPT}} and optionally {{DOC_SUMMARY}} placeholders
//   maxTokens        — max output tokens for the report (default 5000)
//   documents        — JSON array of {name, text} objects (optional, triggers doc summarization)
//   docSummaryTokens — max output tokens for the doc summary call (default 5000)

const FROM_ADDRESS = 'PhysiQ Informes <informes@dataphysiq.com>';
const CLAUDE_MODEL = 'claude-sonnet-4-5';
const CLAUDE_SUMMARY_MODEL = 'claude-haiku-4-5-20251001';

// ── Helpers ────────────────────────────────────────────────────────────────

function isLocalDev(origin) {
  return origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1');
}

async function checkLicense(request, env, origin) {
  if (isLocalDev(origin)) return null;   // dev bypass
  if (!env.LICENSES) return null;        // KV not bound yet — passthrough

  const key = request.headers.get('X-License-Key') || '';
  if (!key) return new Response(JSON.stringify({ error: { message: 'Licencia requerida' } }), {
    status: 401, headers: { 'Content-Type': 'application/json' },
  });

  const entry = await env.LICENSES.get(key, { type: 'json' });
  if (!entry || entry.active === false) return new Response(JSON.stringify({ error: { message: 'Licencia no válida' } }), {
    status: 401, headers: { 'Content-Type': 'application/json' },
  });

  return null;
}

// ── Whisper transcription ──────────────────────────────────────────────────

async function transcribeAudio(audioFile, whisperHint, env) {
  const whisperForm = new FormData();
  whisperForm.append('file', audioFile);
  whisperForm.append('model', 'whisper-1');
  whisperForm.append('language', 'es');
  if (whisperHint) whisperForm.append('prompt', whisperHint);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
    body: whisperForm,
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error('Whisper: ' + (e.error?.message || res.status));
  }
  return (await res.json()).text;
}

// ── Document summarization (non-streaming Claude call) ─────────────────────

async function summarizeDocs(documents, docSummaryTokens, env) {
  const docsText = documents
    .map((d, i) => `=== Documento ${i + 1}: ${d.name} ===\n${d.text}`)
    .join('\n\n');

  const prompt = `Eres un asistente clínico experto. Resume los siguientes documentos médicos en español de forma estructurada y clínicamente relevante. El resumen debe ser completo —nunca cortado a mitad de una idea— y ajustarse a un máximo de ${docSummaryTokens} tokens de respuesta. Para cada documento incluye los hallazgos, diagnósticos, tratamientos y evolución más relevantes. Omite información administrativa irrelevante. Si hay varios documentos, sintetiza también los puntos de conexión clínica entre ellos.

${docsText}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_SUMMARY_MODEL,
      max_tokens: docSummaryTokens,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    }),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error('Claude (docs): ' + (e.error?.message || res.status));
  }
  const result = await res.json();
  return result.content?.[0]?.text || '';
}

// ── Main handler ───────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';

    const corsHeaders = {
      'Access-Control-Allow-Origin': isLocalDev(origin) ? origin : 'https://physiodevapp.github.io',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, cf-turnstile-response, X-License-Key',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // License check
    const licenseErr = await checkLicense(request, env, origin);
    if (licenseErr) {
      return new Response(licenseErr.body, {
        status: licenseErr.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Turnstile validation — all routes require it
    const turnstileToken = request.headers.get('cf-turnstile-response');
    if (!turnstileToken) {
      return new Response(JSON.stringify({ error: { message: 'Verificación requerida' } }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: turnstileToken,
        remoteip: request.headers.get('CF-Connecting-IP') ?? '',
      }),
    });
    const { success } = await verifyRes.json();
    if (!success) {
      return new Response(JSON.stringify({ error: { message: 'Verificación de seguridad fallida' } }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const url = new URL(request.url);
    if (url.pathname === '/email') {
      return handleEmail(request, env, corsHeaders);
    }

    // ── SSE report generation ──────────────────────────────────────────────

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const sendSSE = (type, data) => {
      writer.write(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
    };

    ctx.waitUntil((async () => {
      try {
        const formData = await request.formData();
        const audioFile        = formData.get('file');
        const whisperHint      = formData.get('whisperHint') || '';
        const promptTemplate   = formData.get('prompt') || '';
        const maxTokens        = parseInt(formData.get('maxTokens') || '5000');
        const docSummaryTokens = parseInt(formData.get('docSummaryTokens') || '5000');
        let documents = [];
        try { documents = JSON.parse(formData.get('documents') || '[]'); } catch { /* no docs */ }

        // Step 1: Whisper + doc summarization in parallel (when both present)
        const [transcript, docSummary] = await Promise.all([
          audioFile
            ? transcribeAudio(audioFile, whisperHint, env)
            : Promise.resolve('(No disponible — informe basado exclusivamente en los datos de la valoración estructurada)'),
          documents.length
            ? summarizeDocs(documents, docSummaryTokens, env)
            : Promise.resolve(''),
        ]);

        sendSSE('transcript', { text: transcript });

        // Step 2: Claude (streaming report)
        const docBlock = docSummary ? `DOCUMENTOS ADJUNTOS (resumen clínico):\n${docSummary}\n\n` : '';
        const prompt = promptTemplate
          .replace('{{DOC_SUMMARY}}', docBlock)
          .replace('{{TRANSCRIPT}}', transcript);

        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: CLAUDE_MODEL,
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: prompt }],
            stream: true,
          }),
        });
        if (!claudeRes.ok) {
          const e = await claudeRes.json();
          throw new Error('Claude: ' + (e.error?.message || claudeRes.status));
        }

        const reader = claudeRes.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === '[DONE]') continue;
            try {
              const parsed = JSON.parse(raw);
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                sendSSE('report_chunk', { text: parsed.delta.text });
              }
            } catch { /* partial line — ignore */ }
          }
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
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  }
};

// ── Email handler ──────────────────────────────────────────────────────────

async function handleEmail(request, env, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { to, subject, html, attachments } = body;
  if (!to || !subject || !html) {
    return new Response(JSON.stringify({ error: 'Faltan campos: to, subject, html' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const emailPayload = { from: FROM_ADDRESS, to: [to], subject, html };
  if (Array.isArray(attachments) && attachments.length) emailPayload.attachments = attachments;

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(emailPayload),
  });

  if (!resendRes.ok) {
    const e = await resendRes.json().catch(() => ({}));
    return new Response(JSON.stringify({ error: e.message || `Resend ${resendRes.status}` }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
