// workers/leer-hoja.js — pure helpers of POST /leer-hoja (no `env`, no fetch).
//
// The photo reader of physiq-assessment's questionnaire calculator (its
// docs/lector-cuestionarios.md, step 2). The client sends the photo of a filled
// PhysiQ answer sheet plus the prompt and JSON schema it keeps next to the
// questionnaire (lib/lector-cuestionarios.js there), and the worker reads the
// same photo with two models at once — the «lectura doble» that passed the
// measurement (rounds 1–4): rows where they disagree go to the clinician as
// doubtful. The worker only relays: it never combines, scores or stores.
//
// Guards, so the route can't be used as a free general-purpose model:
//   - models fixed here (never chosen by the client), max_tokens fixed;
//   - JPEG photos only, at most LEER_MAX_FOTOS, each at most LEER_MAX_FOTO chars;
//   - the schema may not contain any free string: every string must be an enum,
//     every object closed (additionalProperties: false). The answer can only be
//     item numbers and box labels, never questionnaire text or anything else.
// Kept apart from physiq-orchestrator.js because named exports of a Worker's
// main module are read as entrypoints.

// The two models measured together (keep in sync with physiq-assessment's
// tools/leer-cuestionario.mjs, MODELOS)
export const LEER_MODELS = { a: 'claude-sonnet-5-5', b: 'claude-opus-5-5' };
export const LEER_MAX_TOKENS = 16000;        // same as the measurement
export const LEER_MAX_FOTOS = 4;
export const LEER_MAX_FOTO = 3_000_000;      // characters of base64 (~2.2 MB of JPEG)
export const LEER_MAX_PROMPT = 20000;
export const LEER_MAX_SCHEMA = 20000;

// Every string of the answer must come from an enum, and every object must be closed
export function esquemaCerrado(esq) {
  if (Array.isArray(esq)) return esq.every(esquemaCerrado);
  if (!esq || typeof esq !== 'object') return true;
  if (esq.type === 'string' && !Array.isArray(esq.enum)) return false;
  if (Array.isArray(esq.type) && esq.type.includes('string') && !Array.isArray(esq.enum)) return false;
  if (esq.type === 'object' && esq.additionalProperties !== false) return false;
  if ('patternProperties' in esq || 'additionalItems' in esq) return false;
  return Object.entries(esq).every(([k, v]) => k === 'enum' || esquemaCerrado(v));
}

export function parseLeerBody(body) {
  if (!body || typeof body !== 'object') return { error: 'Cuerpo inválido' };
  const { cuestionario, prompt, schema, fotos } = body;
  if (typeof cuestionario !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(cuestionario)) return { error: 'Cuestionario inválido' };
  if (typeof prompt !== 'string' || !prompt.trim()) return { error: 'Falta el prompt' };
  if (prompt.length > LEER_MAX_PROMPT) return { error: 'Prompt demasiado largo' };
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || schema.type !== 'object') return { error: 'Esquema inválido' };
  if (JSON.stringify(schema).length > LEER_MAX_SCHEMA) return { error: 'Esquema demasiado largo' };
  if (!esquemaCerrado(schema)) return { error: 'El esquema no puede admitir texto libre' };
  if (!Array.isArray(fotos) || !fotos.length) return { error: 'Falta la foto' };
  if (fotos.length > LEER_MAX_FOTOS) return { error: 'Demasiadas fotos' };
  if (!fotos.every(f => typeof f === 'string' && f.startsWith('/9j/') && f.length <= LEER_MAX_FOTO && /^[A-Za-z0-9+/=]+$/.test(f))) {
    return { error: 'Foto inválida (JPEG en base64, como mucho ' + Math.round(LEER_MAX_FOTO / 1e6) + ' MB)' };
  }
  return { cuestionario, prompt, schema, fotos };
}

// One Anthropic body per model: same images, prompt and forced JSON as the measurement
export function leerRequestBody({ prompt, schema, fotos }, modelId) {
  return {
    model: modelId,
    max_tokens: LEER_MAX_TOKENS,
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: [
      ...fotos.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })),
      { type: 'text', text: prompt },
    ] }],
  };
}

// Anthropic's answer → what the client gets for that model. `salida` is null when
// the text isn't JSON (the client then treats every row as illegible).
export function lecturaDeRespuesta(out) {
  const texto = out?.content?.find(b => b.type === 'text')?.text || '';
  let salida = null;
  try { salida = JSON.parse(texto); } catch { /* unreadable → null */ }
  return { salida, stop: out?.stop_reason ?? null, usage: { input: out?.usage?.input_tokens ?? null, output: out?.usage?.output_tokens ?? null } };
}
