// physiq-orchestrator — single worker: Turnstile + Whisper + Claude (SSE streaming) + Resend email
// Deploy to Cloudflare Workers. Required env vars:
//   TURNSTILE_SECRET   — Cloudflare Turnstile secret key
//   OPENAI_API_KEY     — OpenAI API key (Whisper)
//   ANTHROPIC_API_KEY  — Anthropic API key (Claude)
//   RESEND_API_KEY     — Resend API key (email delivery)
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

const FROM_ADDRESS = 'PhysiQ Informes <informes@dataphysiq.com>';

export default {
  async fetch(request, env, ctx) {

    const corsHeaders = {
      'Access-Control-Allow-Origin': 'https://physiodevapp.github.io',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, cf-turnstile-response',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // /email route — protected by RESEND_API_KEY server-side, no Turnstile needed
    const url = new URL(request.url);
    if (url.pathname === '/email') {
      return handleEmail(request, env, corsHeaders);
    }

    // Turnstile validation — only for the SSE report generation route
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
        const audioFile     = formData.get('file');
        const whisperHint   = formData.get('whisperHint') || '';
        const promptTemplate = formData.get('prompt') || '';
        const maxTokens     = parseInt(formData.get('maxTokens') || '4000');

        // Step 1: Whisper (skipped if no audio)
        let transcript;
        if (audioFile) {
          const whisperForm = new FormData();
          whisperForm.append('file', audioFile);
          whisperForm.append('model', 'whisper-1');
          whisperForm.append('language', 'es');
          if (whisperHint) whisperForm.append('prompt', whisperHint);

          const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
            body: whisperForm,
          });
          if (!whisperRes.ok) {
            const e = await whisperRes.json();
            throw new Error('Whisper: ' + (e.error?.message || whisperRes.status));
          }
          transcript = (await whisperRes.json()).text;
        } else {
          transcript = '(No disponible — informe basado exclusivamente en los datos de la valoración estructurada)';
        }

        sendSSE('transcript', { text: transcript });

        // Step 2: Claude (streaming)
        const prompt = promptTemplate.replace('{{TRANSCRIPT}}', transcript);
        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
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

  const { to, subject, html } = body;
  if (!to || !subject || !html) {
    return new Response(JSON.stringify({ error: 'Faltan campos: to, subject, html' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, html }),
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
