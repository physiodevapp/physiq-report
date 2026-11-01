// node tests/worker.mjs — pure helpers of the orchestrator's POST /verify.
// No dependencies; does not load physiq-orchestrator.js (it needs Workers globals).

import { parseVerifyBody, verifyRequestBody, VERIFY_MODELS, VERIFY_MAX_TOKENS, VERIFY_MAX_PROMPT } from '../workers/verify.js';
import { demoVerify } from '../workers/demo/handlers.js';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
function assert(description, condition) {
  if (condition) { console.log(`  ✓ ${description}`); passed++; }
  else { console.error(`  ✗ ${description}`); failed++; }
}

const schema = { type: 'object', properties: { puntos: { type: 'array' } }, required: ['puntos'] };

console.log('\n/verify — parseVerifyBody');
const ok = parseVerifyBody({ prompt: 'Revisa', schema });
assert('acepta prompt + esquema; Sonnet por defecto', !ok.error && ok.model === 'sonnet' && ok.modelId === VERIFY_MODELS.sonnet);
assert('max_tokens por defecto 2000', ok.maxTokens === 2000);
assert('max_tokens recortado al máximo', parseVerifyBody({ prompt: 'x', schema, maxTokens: 999999 }).maxTokens === VERIFY_MAX_TOKENS);
assert('max_tokens inválido → por defecto', parseVerifyBody({ prompt: 'x', schema, maxTokens: -5 }).maxTokens === 2000);
assert('haiku por alias', parseVerifyBody({ prompt: 'x', schema, model: 'haiku' }).modelId === VERIFY_MODELS.haiku);
assert('un id de modelo no se acepta', !!parseVerifyBody({ prompt: 'x', schema, model: 'claude-opus-4-1' }).error);
assert('sin prompt → error', !!parseVerifyBody({ schema }).error);
assert('prompt vacío → error', !!parseVerifyBody({ prompt: '  ', schema }).error);
assert('prompt demasiado largo → error', !!parseVerifyBody({ prompt: 'x'.repeat(VERIFY_MAX_PROMPT + 1), schema }).error);
assert('esquema que no es objeto → error', !!parseVerifyBody({ prompt: 'x', schema: { type: 'array' } }).error);
assert('esquema ausente → error', !!parseVerifyBody({ prompt: 'x' }).error);
assert('esquema enorme → error', !!parseVerifyBody({ prompt: 'x', schema: { type: 'object', description: 'x'.repeat(20000) } }).error);
assert('cuerpo nulo → error', !!parseVerifyBody(null).error);
assert('modelo heredado del prototipo → error', !!parseVerifyBody({ prompt: 'x', schema, model: 'toString' }).error);

console.log('\n/verify — verifyRequestBody');
const body = verifyRequestBody(ok);
assert('una sola herramienta con el esquema del cliente', body.tools.length === 1 && body.tools[0].input_schema === schema);
assert('tool_choice fuerza esa herramienta', body.tool_choice.type === 'tool' && body.tool_choice.name === body.tools[0].name);
assert('sin streaming', !('stream' in body));
assert('el modelo es el id, no el alias', body.model === VERIFY_MODELS.sonnet);

console.log('\n/verify — modelos y demo');
const orq = readFileSync(new URL('../workers/physiq-orchestrator.js', import.meta.url), 'utf8');
assert('VERIFY_MODELS coincide con CLAUDE_MODEL / CLAUDE_SUMMARY_MODEL del orquestador',
  orq.includes(`const CLAUDE_MODEL = '${VERIFY_MODELS.sonnet}'`) && orq.includes(`const CLAUDE_SUMMARY_MODEL = '${VERIFY_MODELS.haiku}'`));
assert("'/verify' exige ANTHROPIC_API_KEY para el modo real", /'\/verify':\s*\['ANTHROPIC_API_KEY'\]/.test(orq));
const demo = await (await demoVerify({ 'X-Test': '1' })).json();
assert('demo: sin puntos y marcado como demo', demo.demo === true && Array.isArray(demo.result.puntos) && demo.result.puntos.length === 0);
const demoSrc = readFileSync(new URL('../workers/demo/handlers.js', import.meta.url), 'utf8');
assert('handlers.js demo sigue sin tocar env ni APIs', !/env\.|api\.(openai|anthropic|resend)/.test(demoSrc));

console.log('\n/verify — ruta completa (fetch simulado, modo real en localhost)');
const worker = (await import('../workers/physiq-orchestrator.js')).default;
const env = { ANTHROPIC_API_KEY: 'k', TURNSTILE_SECRET: 's' };
const llamadas = [];
let respuestaClaude;
globalThis.fetch = async (url, init) => {
  llamadas.push({ url: String(url), init });
  if (String(url).includes('turnstile')) return new Response(JSON.stringify({ success: true }));
  return respuestaClaude();
};
const peticion = (cuerpo, token = 't') => new Request('http://localhost/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { 'cf-turnstile-response': token } : {}) },
  body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
});

respuestaClaude = () => new Response(JSON.stringify({
  content: [{ type: 'tool_use', name: 'resultado', input: { puntos: [{ cita: 'x' }] } }],
  stop_reason: 'tool_use', usage: { input_tokens: 900, output_tokens: 80 },
}));
let r = await worker.fetch(peticion({ prompt: 'Revisa', schema, model: 'haiku', maxTokens: 1500 }), env, {});
let j = await r.json();
assert('200 con el input de la herramienta como result', r.status === 200 && j.result.puntos[0].cita === 'x');
assert('modo real en la cabecera', r.headers.get('X-PhysiQ-Mode') === 'real');
assert('uso y truncado', j.usage.input === 900 && j.usage.output === 80 && j.truncated === false && j.model === 'haiku');
const enviado = JSON.parse(llamadas.find(c => c.url.includes('anthropic')).init.body);
assert('a Anthropic va el modelo de Haiku, el max_tokens pedido y la herramienta forzada',
  enviado.model === VERIFY_MODELS.haiku && enviado.max_tokens === 1500 && enviado.tool_choice.name === 'resultado');

r = await worker.fetch(peticion({ prompt: 'Revisa', schema }, null), env, {});
assert('sin token de Turnstile → 403', r.status === 403);

llamadas.length = 0;
r = await worker.fetch(peticion('no es json'), env, {});
assert('cuerpo ilegible → 400 sin llamar a Claude', r.status === 400 && !llamadas.some(c => c.url.includes('anthropic')));

respuestaClaude = () => new Response(JSON.stringify({ error: { message: 'Your credit balance is too low' } }), { status: 400 });
r = await worker.fetch(peticion({ prompt: 'Revisa', schema }), env, {});
j = await r.json();
assert('error de Anthropic → 502 con prefijo «Claude: »', r.status === 502 && j.error.message === 'Claude: Your credit balance is too low');

respuestaClaude = () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'hola' }], stop_reason: 'max_tokens', usage: {} }));
r = await worker.fetch(peticion({ prompt: 'Revisa', schema }), env, {});
assert('respuesta sin herramienta → 502', r.status === 502);

r = await worker.fetch(peticion({ prompt: 'Revisa', schema }), { ...env, DEMO_ONLY: '1' }, {});
j = await r.json();
assert('DEMO_ONLY → demo, sin llamar a Claude', r.headers.get('X-PhysiQ-Mode') === 'demo' && j.demo === true);

r = await worker.fetch(new Request('http://localhost/validate'), env, {});
j = await r.json();
assert('/validate informa del modo de verify', j.routes.verify === 'real');

// ── POST /leer-hoja (lector con foto de physiq-assessment) ──────────────────
const LH = await import('../workers/leer-hoja.js');
const { demoLeerHoja } = await import('../workers/demo/handlers.js');
// El esquema que manda physiq-assessment: todo enum, objetos cerrados
const esqHoja = { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'object', additionalProperties: false, required: ['1'],
  properties: { 1: { type: 'object', additionalProperties: false, required: ['estado', 'valor'], properties: {
    estado: { enum: ['marcado', 'dudoso', 'en_blanco', 'ilegible'] }, valor: { anyOf: [{ enum: [0, 1, 2, 3] }, { type: 'null' }] } } } } } } };
const foto = '/9j/' + 'A'.repeat(100);
const cuerpoHoja = { cuestionario: 'phq9', prompt: 'Lee la hoja', schema: esqHoja, fotos: [foto] };

console.log('\n/leer-hoja — parseLeerBody');
assert('acepta cuestionario, prompt, esquema cerrado y una foto JPEG', !LH.parseLeerBody(cuerpoHoja).error);
assert('un esquema con texto libre → error', !!LH.parseLeerBody({ ...cuerpoHoja, schema: { type: 'object', additionalProperties: false, properties: { t: { type: 'string' } } } }).error);
assert('un objeto abierto → error', !!LH.parseLeerBody({ ...cuerpoHoja, schema: { type: 'object', properties: {} } }).error);
assert('una cadena con enum sí vale', LH.esquemaCerrado({ type: 'string', enum: ['a'] }));
assert('sin foto → error', !!LH.parseLeerBody({ ...cuerpoHoja, fotos: [] }).error);
assert('demasiadas fotos → error', !!LH.parseLeerBody({ ...cuerpoHoja, fotos: Array(LH.LEER_MAX_FOTOS + 1).fill(foto) }).error);
assert('una foto que no es JPEG → error', !!LH.parseLeerBody({ ...cuerpoHoja, fotos: ['iVBORw0KGgo='] }).error);
assert('una foto enorme → error', !!LH.parseLeerBody({ ...cuerpoHoja, fotos: ['/9j/' + 'A'.repeat(LH.LEER_MAX_FOTO)] }).error);
assert('cuestionario con caracteres raros → error', !!LH.parseLeerBody({ ...cuerpoHoja, cuestionario: '../x' }).error);
assert('prompt demasiado largo → error', !!LH.parseLeerBody({ ...cuerpoHoja, prompt: 'x'.repeat(LH.LEER_MAX_PROMPT + 1) }).error);
assert('el modelo no lo elige el cliente', !('model' in LH.parseLeerBody({ ...cuerpoHoja, model: 'claude-haiku' })));

console.log('\n/leer-hoja — leerRequestBody');
const cuerpoA = LH.leerRequestBody(LH.parseLeerBody(cuerpoHoja), LH.LEER_MODELS.a);
assert('salida forzada con el esquema del cliente', cuerpoA.output_config.format.type === 'json_schema' && cuerpoA.output_config.format.schema === esqHoja);
assert('la foto como imagen JPEG y el prompt después', cuerpoA.messages[0].content[0].source.data === foto && cuerpoA.messages[0].content[1].text === 'Lee la hoja');
assert('max_tokens fijo', cuerpoA.max_tokens === LH.LEER_MAX_TOKENS);
assert('los dos modelos medidos: Sonnet y Opus', LH.LEER_MODELS.a === 'claude-sonnet-5-5' && LH.LEER_MODELS.b === 'claude-opus-5-5');

console.log('\n/leer-hoja — ruta completa (fetch simulado, modo real en localhost)');
const lecturaSimulada = v => new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ items: { 1: { estado: 'marcado', valor: v } } }) }],
  stop_reason: 'end_turn', usage: { input_tokens: 2000, output_tokens: 60 } }));
const pedirHoja = (cuerpo, token = 't') => new Request('http://localhost/leer-hoja', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'cf-turnstile-response': token } : {}) },
  body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
});
llamadas.length = 0;
respuestaClaude = () => { const n = llamadas.filter(c => c.url.includes('anthropic')).length; return lecturaSimulada(n === 1 ? 2 : 3); };
r = await worker.fetch(pedirHoja(cuerpoHoja), env, {});
j = await r.json();
const aClaude = llamadas.filter(c => c.url.includes('anthropic')).map(c => JSON.parse(c.init.body));
assert('dos llamadas, una por modelo, con la misma foto', aClaude.length === 2 && aClaude.map(b => b.model).sort().join() === [LH.LEER_MODELS.a, LH.LEER_MODELS.b].sort().join()
  && aClaude.every(b => b.messages[0].content[0].source.data === foto));
assert('200 con las dos lecturas', r.status === 200 && j.a.salida.items[1].valor !== undefined && j.b.salida.items[1].valor !== undefined && j.a.usage.input === 2000);
assert('modo real en la cabecera', r.headers.get('X-PhysiQ-Mode') === 'real');
r = await worker.fetch(pedirHoja(cuerpoHoja, null), env, {});
assert('sin token de Turnstile → 403', r.status === 403);
llamadas.length = 0;
r = await worker.fetch(pedirHoja({ ...cuerpoHoja, schema: { type: 'object', properties: { t: { type: 'string' } } } }), env, {});
assert('esquema con texto libre → 400 sin llamar a Claude', r.status === 400 && !llamadas.some(c => c.url.includes('anthropic')));
respuestaClaude = () => new Response(JSON.stringify({ error: { message: 'Overloaded' } }), { status: 529 });
r = await worker.fetch(pedirHoja(cuerpoHoja), env, {});
j = await r.json();
assert('un modelo falla → 502 con prefijo «Claude: »', r.status === 502 && j.error.message === 'Claude: Overloaded');
respuestaClaude = () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'no es json' }], stop_reason: 'end_turn', usage: {} }));
r = await worker.fetch(pedirHoja(cuerpoHoja), env, {});
j = await r.json();
assert('respuesta que no es JSON → salida null (el cliente la trata como ilegible)', r.status === 200 && j.a.salida === null);
llamadas.length = 0;
r = await worker.fetch(pedirHoja(cuerpoHoja), { ...env, DEMO_ONLY: '1' }, {});
j = await r.json();
assert('DEMO_ONLY → demo sin lectura, sin llamar a Claude', r.headers.get('X-PhysiQ-Mode') === 'demo' && j.demo === true && j.a === null
  && !llamadas.some(c => c.url.includes('anthropic')));
assert('demo de /leer-hoja no lee nada', (await (await demoLeerHoja({})).json()).a === null);
r = await worker.fetch(new Request('http://localhost/validate'), env, {});
j = await r.json();
assert('/validate informa del modo del lector', j.routes.leer === 'real');
const fuenteLH = readFileSync(new URL('../workers/leer-hoja.js', import.meta.url), 'utf8');
assert('leer-hoja.js no toca env ni registra nada', !/env\.|console\./.test(fuenteLH));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
