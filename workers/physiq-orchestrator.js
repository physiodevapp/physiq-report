// physiq-orchestrator — Turnstile + Whisper + Claude (SSE streaming) + Resend email
// Deploy to Cloudflare Workers. Required env vars:
//
// Secrets (Dashboard → Worker → Settings → Variables → Add secret):
//   TURNSTILE_SECRET   — Cloudflare Turnstile secret key
//   OPENAI_API_KEY     — OpenAI API key (Whisper)
//   ANTHROPIC_API_KEY  — Anthropic API key (Claude)
//   RESEND_API_KEY     — Resend API key (email delivery)
//
// Variables (plain text, not secret):
//   DEMO_ONLY  — "1" forces every request into demo mode (budget kill switch)
//   DAILY_CAP  — per-actor cap of real (paid) reports per day; default 50
//
// KV Namespace binding (Dashboard → Worker → Settings → Bindings):
//   Variable name: LICENSES  →  KV namespace: physiq-licenses
//   Key format:  <license-key-string>  →  {"clinic":"Nombre","active":true}
//   While LICENSES is unbound the worker serves demo mode (fail-closed), except
//   on localhost, where it assumes a developer with .dev.vars.
//
// Optional bindings (all degrade to "no limiting" when absent):
//   RL_REPORT, RL_DEMO — Workers rate limiting bindings (see wrangler.toml)
//   RATE               — KV namespace for the per-actor daily budget cap
//
// ⚠ No longer a single file: workers/demo/ is bundled at deploy time, so pasting
// this file alone into the dashboard editor is no longer a valid fallback.
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

import { demoReport, demoEmail } from './demo/handlers.js';

const FROM_ADDRESS = 'PhysiQ Informes <informes@dataphysiq.com>';
const CLAUDE_MODEL = 'claude-sonnet-4-5';
const CLAUDE_SUMMARY_MODEL = 'claude-haiku-4-5-20251001';

// ── Helpers ────────────────────────────────────────────────────────────────

// Only for CORS. Allowing a localhost Origin is harmless: CORS is a browser
// policy, and this lets a locally-served front end talk to the deployed worker.
function isLocalDev(origin) {
  return origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1');
}

// For the licence bypass, and NOT interchangeable with the above.
//
// `Origin` is a request header the client controls: outside a browser,
// `curl -H 'Origin: http://localhost'` forges it in a second. Keying the dev
// bypass off it meant one spoofed header granted real mode with no licence.
// The worker's own hostname cannot be forged by the caller: under `wrangler dev`
// it is localhost, in production it is the workers.dev subdomain.
function isLocalWorker(url) {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

// ── Mode resolution ─────────────────────────────────────────────────────────
//
// Same contract as physiq-copilot (full rationale in the hub README → "Demo
// mode"): the decision lives in the router, before any handler, and is
// fail-closed — 'real' requires ALL of the conditions below. Anything else
// degrades to demo instead of returning 401, so a visitor without a license
// still gets to walk the whole report flow, on fixtures.
//
// Which secrets each route needs to run for real. Missing any → demo rather than
// a 502, so partial configuration degrades per route and a fork deployed with no
// secrets comes up as a working demo.
const ROUTE_SECRETS = {
  '/':      ['ANTHROPIC_API_KEY'],   // OPENAI_API_KEY only matters when audio is attached
  '/email': ['RESEND_API_KEY'],
};

async function licenseState(request, url, env) {
  const key = request.headers.get('X-License-Key') || '';
  if (isLocalWorker(url)) return { licensed: true, key };    // `wrangler dev` with .dev.vars
  if (!env.LICENSES)      return { licensed: false, key };   // KV unbound in prod → fail closed
  if (!key)               return { licensed: false, key: '' };

  const entry = await env.LICENSES.get(key, { type: 'json' });
  return { licensed: !!entry && entry.active !== false, key };
}

function modeFor(env, pathname, licensed) {
  if (env.DEMO_ONLY === '1' || env.DEMO_ONLY === 'true') return 'demo';   // budget kill switch
  if (!licensed) return 'demo';
  const needed = ROUTE_SECRETS[pathname] ?? [];
  if (needed.some(name => !env[name])) return 'demo';
  return 'real';
}

// ── Rate limiting ───────────────────────────────────────────────────────────
//
// Second layer: demo costs nothing, but a leaked license key would. Keyed by
// hashed license when there is one (the stable identity Cloudflare's guidance
// recommends) and by IP otherwise. Report generation is the most expensive call
// in the ecosystem — Whisper plus a long Claude completion — so its window is
// the tightest one. Every binding is optional: unbound means no limiting, never
// a 500.
async function rateLimited(request, env, pathname, mode, licenseKey) {
  const ip    = request.headers.get('CF-Connecting-IP') || 'unknown';
  const actor = licenseKey ? `lic:${fnv1a(licenseKey)}` : `ip:${ip}`;

  const limiter = mode === 'demo' ? env.RL_DEMO : env.RL_REPORT;
  if (limiter) {
    const { success } = await limiter.limit({ key: `${pathname}:${actor}` });
    if (!success) return true;
  }

  if (mode !== 'real' || !env.RATE) return false;
  const cap = parseInt(env.DAILY_CAP || '50', 10);
  const day = new Date().toISOString().slice(0, 10);
  const k   = `rl:${day}:${actor}`;
  const n   = parseInt(await env.RATE.get(k) || '0', 10);
  if (n >= cap) return true;
  await env.RATE.put(k, String(n + 1), { expirationTtl: 90000 });
  return false;
}

// FNV-1a — keeps the license key itself out of rate-limit keys (it is a bearer
// secret, and those keys surface in logs and analytics).
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// Reports the mode per route, because secrets are configured per provider: with
// RESEND_API_KEY missing, email is demo while report generation may be real.
//
// Deliberately never says *why* it is demo. Distinguishing "no key" from "invalid
// key" would hand a brute-forcer the oracle it needs; a client that sent a key and
// got `demo` back already knows its key is not valid. `demoOnly` is safe to expose:
// it is a global property of the worker, not a fact about any key.
function handleValidate(env, licensed, corsHeaders) {
  const routes = {
    report: modeFor(env, '/',      licensed),
    email:  modeFor(env, '/email', licensed),
  };
  const values = Object.values(routes);
  const mode = values.every(m => m === 'real') ? 'real'
             : values.every(m => m === 'demo') ? 'demo'
             : 'mixed';
  return new Response(JSON.stringify({
    ok: true, mode, routes,
    demoOnly: env.DEMO_ONLY === '1' || env.DEMO_ONLY === 'true',
  }), { headers: { ...corsHeaders, 'X-PhysiQ-Mode': mode, 'Content-Type': 'application/json' } });
}

async function verifyTurnstile(token, request, env) {
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: token,
        remoteip: request.headers.get('CF-Connecting-IP') ?? '',
      }),
    });
    const { success } = await res.json();
    return !!success;
  } catch {
    return false;
  }
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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, cf-turnstile-response, X-License-Key',
      // The client reads the mode off the response to label the report as demo.
      'Access-Control-Expose-Headers': 'X-PhysiQ-Mode',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const { licensed, key } = await licenseState(request, url, env);

    // GET /validate — lets the client know the mode BEFORE it makes its first
    // real request. Without it the mode is only learnable from a response
    // header, which is too late: the UI gates the "Generar informe" button on
    // Turnstile, and in demo that gate has to be lifted up front.
    // Costs nothing and reveals nothing per-key: see handleValidate.
    if (url.pathname === '/validate' && request.method === 'GET') {
      return handleValidate(env, licensed, corsHeaders);
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const mode = modeFor(env, url.pathname, licensed);
    corsHeaders['X-PhysiQ-Mode'] = mode;

    if (await rateLimited(request, env, url.pathname, mode, licensed ? key : '')) {
      return new Response(JSON.stringify({ error: { message: 'Has alcanzado el límite de peticiones. Inténtalo de nuevo en un minuto.' } }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' },
      });
    }

    // Turnstile guards paid work, so it only runs in real mode. In demo nothing
    // is blocked by design — a check whose failure cannot reject the request is
    // just a wasted subrequest on every visit. Scripted replay of the demo is
    // handled by RL_DEMO instead, which costs nothing to enforce.
    if (mode === 'real') {
      const token = request.headers.get('cf-turnstile-response');
      const ok    = token ? await verifyTurnstile(token, request, env) : false;
      if (!ok) {
        return new Response(JSON.stringify({ error: { message: token ? 'Verificación de seguridad fallida' : 'Verificación requerida' } }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── The fork. Nothing below this branch receives `env`, so no demo path can
    // reach Whisper, Claude or Resend even by mistake — it has no credentials to
    // authenticate with. See workers/demo/handlers.js.
    if (mode === 'demo') {
      return url.pathname === '/email'
        ? demoEmail(corsHeaders)
        : demoReport(request, corsHeaders, ctx);
    }

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
