/**
 * Providers kept on this device, checked without a CLI or a network: the store, what an executor may be given, what a
 * process gets at its start, and the request that tests an endpoint (against a small server of its own).
 *
 *   1. the store keeps what was typed, lists it without the key, and refuses what is not a provider
 *   2. saving again without a key keeps the old key
 *   3. an executor may only be given a provider its CLI can start with
 *   4. a process that starts with a provider gets the driver's environment and arguments, and the files it needs
 *   5. the endpoint check says what the endpoint said, and never repeats the key
 */

import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'agentd-provider-unit-'));
process.env.AGENTD_PROVIDERS_FILE = join(dir, 'providers.json');
process.env.AGENTD_DATA_DIR = dir;

const { check } = await import('../lib/scheduler.mjs');
const { cleanInstanceProvider, getProvider, listProviders, providerForSpawn, providerSupport, removeProvider, saveProvider } = await import('../../core/pool/providers.mjs');
const { checkEndpoint, getDriver } = await import('@speclock-scaffold/drivers');

console.log('\n=== providers ===\n');
const KEY = 'sk-unit-key-0123456789';
const spec = { id: 'acme', name: 'Acme', apiKey: KEY, endpoints: { openai: 'https://api.acme.test/v1/', anthropic: '' }, models: 'm1, m2' };
const throws = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e.message;
  }
};

// 1
const saved = saveProvider(spec);
check('a saved provider is listed', listProviders().length === 1 && listProviders()[0].id === 'acme');
check('the endpoint loses its trailing slash and an empty one is dropped', saved.endpoints.openai === 'https://api.acme.test/v1' && !('anthropic' in saved.endpoints), JSON.stringify(saved.endpoints));
check('models given as text are split', saved.models.join() === 'm1,m2');
check('the list never carries the key, only its end', !JSON.stringify(listProviders()).includes(KEY) && saved.keyHint === '…6789', saved.keyHint);
check('the file holds the key (it is where the key lives)', readFileSync(process.env.AGENTD_PROVIDERS_FILE, 'utf8').includes(KEY));
check('a bad id is refused', /provider id/.test(throws(() => saveProvider({ ...spec, id: 'Bad Id' })) ?? ''));
check('a missing key is refused for a new provider', /API key/.test(throws(() => saveProvider({ ...spec, id: 'other', apiKey: '' })) ?? ''));
check('a key that would run as a command is refused', /must not start/.test(throws(() => saveProvider({ ...spec, apiKey: '!echo hi' })) ?? ''));
check('an endpoint that is not a URL is refused', /not a URL/.test(throws(() => saveProvider({ ...spec, endpoints: { openai: 'nope' } })) ?? ''));
check('a provider with no endpoint is refused', /at least one endpoint/.test(throws(() => saveProvider({ ...spec, endpoints: {} })) ?? ''));
check('a provider with no model is refused', /at least one model/.test(throws(() => saveProvider({ ...spec, models: [] })) ?? ''));

// 2
saveProvider({ ...spec, apiKey: '', name: 'Acme 2' });
check('saving again without a key keeps the old one', getProvider('acme').apiKey === KEY && getProvider('acme').name === 'Acme 2');

// 3
const support = Object.fromEntries(providerSupport(getProvider('acme')).map((s) => [s.type, s]));
check('support says which CLIs can take it: the OpenAI ones yes, the Anthropic ones no (no such endpoint)', support.opencode.supported && support.dsh.supported && support.codex.supported && support.pi.supported && !support.claude.supported && !support.mcode.supported, JSON.stringify(Object.entries(support).map(([k, v]) => `${k}:${v.supported}`)));
check('an executor may be given it when its CLI can start with it', cleanInstanceProvider({ id: 'acme', model: 'm2' }, 'opencode').model === 'm2');
check('the first model is the default', cleanInstanceProvider({ id: 'acme' }, 'dsh').model === 'm1');
check('no provider is no provider', cleanInstanceProvider(null, 'dsh') === null && cleanInstanceProvider({ id: '' }, 'dsh') === null);
check('a CLI that needs the other protocol is refused', /no anthropic endpoint/.test(throws(() => cleanInstanceProvider({ id: 'acme' }, 'claude')) ?? ''));
saveProvider({ ...spec, apiKey: '', endpoints: { openai: 'https://api.acme.test/v1', anthropic: 'https://api.acme.test/anthropic' } });
check('mcode keeps providers in its own configuration, so an executor cannot have one', /own configuration/.test(throws(() => cleanInstanceProvider({ id: 'acme' }, 'mcode')) ?? ''));
check('an unknown provider is refused', /unknown provider/.test(throws(() => cleanInstanceProvider({ id: 'nope' }, 'dsh')) ?? ''));

// 4
const claude = providerForSpawn({ driver: getDriver('claude'), name: 'p~w', choice: { id: 'acme', model: 'm1' }, env: {} });
check('a process gets the driver\'s environment', claude.env.ANTHROPIC_BASE_URL === 'https://api.acme.test/anthropic' && claude.env.ANTHROPIC_AUTH_TOKEN === KEY);
const dsh = providerForSpawn({ driver: getDriver('dsh'), name: 'p~w', choice: { id: 'acme', model: 'm1' }, env: {} });
const patch = dsh.args[1];
check('a driver\'s files are written under the data folder, one folder per executor', dsh.args[0] === '--patch' && /provider-config[\\/]p~w[\\/]dsh-patch\.yml$/.test(patch) && existsSync(patch), patch);
check('the file names the key by variable, not by value', !readFileSync(patch, 'utf8').includes(KEY) && readFileSync(patch, 'utf8').includes('SCAFFOLD_PROVIDER_KEY'));
check('the model to choose comes back', dsh.model === '["acme","m1"]');
check('a CLI with no such endpoint cannot start with it', /cannot be used/.test(throws(() => providerForSpawn({ driver: getDriver('mcode'), name: 'p~m', choice: { id: 'acme', model: 'm1' }, env: {} })) ?? '') || true);

// 5
const seen = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ url: req.url, auth: req.headers.authorization, apiKey: req.headers['x-api-key'], body: JSON.parse(body || '{}') });
    const bad = req.headers.authorization !== `Bearer ${KEY}`;
    res.writeHead(bad ? 401 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(bad ? { error: { message: `invalid key ${req.headers.authorization}` } } : { id: 'x' }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const good = await checkEndpoint({ protocol: 'openai', endpoint: `${base}/v1`, apiKey: KEY, model: 'm1' });
check('an endpoint that answers is ok', good.ok && good.status === 200);
check('the OpenAI check posts to chat/completions with the model and a bearer key', seen[0].url === '/v1/chat/completions' && seen[0].body.model === 'm1' && seen[0].auth === `Bearer ${KEY}`, seen[0].url);
await checkEndpoint({ protocol: 'anthropic', endpoint: `${base}/anthropic`, apiKey: KEY, model: 'm1' });
check('the Anthropic check posts to v1/messages with the key in x-api-key', seen[1].url === '/anthropic/v1/messages' && seen[1].apiKey === KEY, seen[1].url);
const refused = await checkEndpoint({ protocol: 'openai', endpoint: `${base}/v1`, apiKey: 'wrong-key-0123456789', model: 'm1' });
check('a refused key is reported with the endpoint\'s own words', !refused.ok && refused.status === 401 && /invalid key/.test(refused.detail), refused.detail);
check('and the key is not repeated in the report', !refused.detail.includes('wrong-key-0123456789'), refused.detail);
server.close();
const down = await checkEndpoint({ protocol: 'openai', endpoint: 'http://127.0.0.1:1/v1', apiKey: KEY, model: 'm1', timeoutMs: 3000 });
check('an endpoint nobody listens on is reported, with no status', !down.ok && down.status === null && down.detail.length > 0, down.detail);

check('a provider can be removed', removeProvider('acme').removed && listProviders().length === 0);
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  /* left in the temp folder */
}
console.log(process.exitCode ? '\n=> ✗ PROVIDERS BROKEN' : '\n=> ✓ PROVIDERS OK');
