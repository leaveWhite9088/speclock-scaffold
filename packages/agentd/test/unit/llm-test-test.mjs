/**
 * Testing a dispatcher model (a provider of pi's models.json), against a small server of its own: no daemon, no real LLM.
 *
 *   1. the key is worked out ($NAME from the environment, a literal as it is) and never listed
 *   2. a good key answers, a wrong key is refused with the endpoint's words, with the key not repeated
 *   3. a provider with nothing to test with says what is missing
 */

import '../lib/isolate.mjs';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addPiProvider } from '../../core/pi/models.mjs';
import { readPiProvider } from '../../core/pi/index.mjs';
import { testLlm } from '../../core/dispatcher/index.mjs';
import { check } from '../lib/scheduler.mjs';

console.log('\n=== dispatcher model test ===\n');

const KEY = 'sk-llm-test-0123456789';
const seen = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ url: req.url, auth: req.headers.authorization, key: req.headers['x-api-key'], body: JSON.parse(body || '{}') });
    const ok = req.headers.authorization === `Bearer ${KEY}` || req.headers['x-api-key'] === KEY;
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok ? { id: 'x' } : { error: { message: `invalid key ${req.headers.authorization ?? ''}` } }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const dir = mkdtempSync(join(tmpdir(), 'llm-test-'));

addPiProvider({ provider: 'lit', baseUrl: `${base}/v1`, apiKey: KEY, models: [{ id: 'm1' }, { id: 'm2' }] }, dir);
addPiProvider({ provider: 'envy', baseUrl: `${base}/v1`, apiKey: '$LLM_TEST_KEY', models: [{ id: 'm1' }] }, dir);
addPiProvider({ provider: 'bad', baseUrl: `${base}/v1`, apiKey: 'wrong-key-0123456789', models: [{ id: 'm1' }] }, dir);
addPiProvider({ provider: 'ant', baseUrl: `${base}/anthropic`, api: 'anthropic-messages', apiKey: KEY, models: [{ id: 'c1' }] }, dir);
addPiProvider({ provider: 'goog', baseUrl: `${base}/g`, api: 'google-generative-ai', apiKey: KEY, models: [{ id: 'g1' }] }, dir);
addPiProvider({ provider: 'unset', baseUrl: `${base}/v1`, apiKey: '$LLM_TEST_UNSET', models: [{ id: 'm1' }] }, dir);

// 1
process.env.LLM_TEST_KEY = KEY;
check('a literal key is used as it is', readPiProvider('lit', dir).apiKey === KEY);
check('a $NAME key is read from the environment', readPiProvider('envy', dir).apiKey === KEY && readPiProvider('envy', dir).apiKeyEnv === 'LLM_TEST_KEY');
check('a reference to a variable that is not set has no key', readPiProvider('unset', dir).apiKey === null);

// 2
const good = await testLlm('lit', { dir });
check('a good key answers, with the first model', good.ok && good.status === 200 && good.model === 'm1' && seen[0].body.model === 'm1' && seen[0].url === '/v1/chat/completions', JSON.stringify(good));
check('the key from the environment works the same', (await testLlm('envy', { dir })).ok);
const anth = await testLlm('ant', { dir });
check('an Anthropic-protocol provider is tested on its own path', anth.ok && seen.at(-1).url === '/anthropic/v1/messages' && seen.at(-1).key === KEY, seen.at(-1).url);
const bad = await testLlm('bad', { dir });
check('a wrong key is refused with the endpoint\'s words', !bad.ok && bad.status === 401 && /invalid key/.test(bad.detail), bad.detail);
check('and the key is not repeated', !bad.detail.includes('wrong-key-0123456789'));

// 3
const goog = await testLlm('goog', { dir });
check('a protocol that cannot be tested says so, and sends nothing', !goog.ok && /cannot test/.test(goog.detail) && !seen.some((s) => s.url.startsWith('/g')), goog.detail);
const unset = await testLlm('unset', { dir });
check('a variable that is not set is named', !unset.ok && /LLM_TEST_UNSET/.test(unset.detail), unset.detail);
const gone = await testLlm('nope', { dir }).then(() => '', (e) => e.message);
check('an unknown provider is refused', /not in models.json/.test(gone), gone);

server.close();
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  /* left in the temp folder */
}
console.log(process.exitCode ? '\n=> ✗ LLM TEST BROKEN' : '\n=> ✓ LLM TEST OK');
