// workers/verify.js — pure helpers of POST /verify (no `env`, no fetch).
//
// /verify is a thin "structured Claude call": the prompt and the JSON schema of
// the answer come from the client (physiq-assessment keeps them next to its
// report prompt, so iterating them needs no worker deploy). The answer is
// forced through a single tool whose input_schema is that schema, so it always
// comes back as JSON. The model is chosen by alias only and max_tokens is
// clamped, so one request can never cost more than one Sonnet call of
// VERIFY_MAX_TOKENS. Kept apart from physiq-orchestrator.js because named
// exports of a Worker's main module are read as entrypoints.

export const VERIFY_MODELS = {
  sonnet: 'claude-sonnet-4-5',
  haiku:  'claude-haiku-4-5-20251001',
};
export const VERIFY_MAX_TOKENS = 4000;
export const VERIFY_MAX_PROMPT = 200000;   // characters
export const VERIFY_MAX_SCHEMA = 10000;    // characters of JSON

export function parseVerifyBody(body) {
  if (!body || typeof body !== 'object') return { error: 'Cuerpo inválido' };
  const { prompt, schema, maxTokens, model = 'sonnet' } = body;
  if (typeof prompt !== 'string' || !prompt.trim()) return { error: 'Falta el prompt' };
  if (prompt.length > VERIFY_MAX_PROMPT) return { error: 'Prompt demasiado largo' };
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || schema.type !== 'object') {
    return { error: 'Esquema inválido' };
  }
  if (JSON.stringify(schema).length > VERIFY_MAX_SCHEMA) return { error: 'Esquema demasiado largo' };
  if (!Object.hasOwn(VERIFY_MODELS, model)) return { error: 'Modelo no permitido' };
  const n = parseInt(maxTokens, 10);
  const tokens = Math.min(Number.isFinite(n) && n > 0 ? n : 2000, VERIFY_MAX_TOKENS);
  return { prompt, schema, model, modelId: VERIFY_MODELS[model], maxTokens: tokens };
}

export function verifyRequestBody({ prompt, schema, modelId, maxTokens }) {
  return {
    model: modelId,
    max_tokens: maxTokens,
    tools: [{ name: 'resultado', description: 'Devuelve el resultado de la revisión.', input_schema: schema }],
    tool_choice: { type: 'tool', name: 'resultado' },
    messages: [{ role: 'user', content: prompt }],
  };
}

