/**
 * Does a model of the dispatchers (a provider in pi's models.json) answer? One small request straight to its address with
 * its key and its first model, the way pi will make it. The wire protocol decides how: the OpenAI ones and the Anthropic
 * one are tested; a provider that speaks something else says so instead of getting a wrong answer.
 */

import { checkEndpoint } from '../pool/index.mjs';
import { readPiProvider } from '../pi/index.mjs';

const PROTOCOL = { 'openai-completions': 'openai', 'openai-responses': 'openai', 'anthropic-messages': 'anthropic' };

/** @returns {Promise<{ provider: string, model: string|null, ok: boolean, status: number|null, detail: string, ms: number }>} */
export async function testLlm(provider, { dir, fetchImpl, timeoutMs } = {}) {
  const p = readPiProvider(provider, dir);
  const model = p.models[0] ?? null;
  const fail = (detail) => ({ provider, model, ok: false, status: null, detail, ms: 0 });
  const protocol = PROTOCOL[p.api];
  if (!protocol) return fail(`cannot test the "${p.api}" protocol from here`);
  if (!p.baseUrl) return fail('no address');
  if (!p.apiKey) return fail(p.apiKeyEnv ? `the variable ${p.apiKeyEnv} is not set` : 'no key');
  if (!model) return fail('no model');
  const r = await checkEndpoint({ protocol, endpoint: p.baseUrl, apiKey: p.apiKey, model, timeoutMs, fetchImpl });
  return { provider, model, ...r };
}
