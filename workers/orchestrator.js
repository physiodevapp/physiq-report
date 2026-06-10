// physiq-orchestrator — single worker: Turnstile + Whisper + Claude
// Deploy to Cloudflare Workers. Required env vars:
//   TURNSTILE_SECRET   — Cloudflare Turnstile secret key
//   OPENAI_API_KEY     — OpenAI API key (Whisper)
//   ANTHROPIC_API_KEY  — Anthropic API key (Claude)
//
// Expected request: multipart/form-data POST with:
//   file (optional)   — audio blob
//   whisperHint       — transcription hint string
//   prompt            — full Claude prompt with {{TRANSCRIPT}} placeholder
//   maxTokens         — Claude max_tokens (number as string)
//
// Response: { transcript: string, report: string }

export default {
  async fetch(request, env) {

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

    // Turnstile validation
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

    try {
      const formData = await request.formData();
      const audioFile  = formData.get('file');
      const whisperHint = formData.get('whisperHint') || '';
      const promptTemplate = formData.get('prompt') || '';
      const maxTokens = parseInt(formData.get('maxTokens') || '4000');

      // Step 1: Whisper (optional — skipped if no audio)
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

      // Step 2: Claude
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
        }),
      });
      if (!claudeRes.ok) {
        const e = await claudeRes.json();
        throw new Error('Claude: ' + (e.error?.message || claudeRes.status));
      }
      const report = (await claudeRes.json()).content[0].text;

      return new Response(JSON.stringify({ transcript, report }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: { message: error.message } }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }
};
