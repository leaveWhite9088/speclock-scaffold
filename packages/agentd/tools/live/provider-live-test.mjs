/**
 * An executor started with a provider kept on this device really talks through it. (Calls a real endpoint and model.)
 *
 *   1. provider.save keeps a provider; provider.list never returns the key
 *   2. the dispatcher may not use any provider operation
 *   3. an executor created with `provider` answers, and its row says which provider it uses
 *   4. a CLI that keeps providers in its own configuration (mcode) is refused as an executor's provider
 *   5. a provider an executor uses cannot be removed; after the executor is gone it can
 *   6. a wrong key makes the same executor fail (so the answer in 3 did come through the provider)
 *
 * It needs a provider to try, from the environment (the test is skipped without them):
 *   PROVIDER_TEST_KEY, PROVIDER_TEST_MODEL, and PROVIDER_TEST_OPENAI and/or PROVIDER_TEST_ANTHROPIC (the endpoints)
 *
 * Usage: node tools/live/provider-live-test.mjs [type]       (default: claude, which needs the Anthropic endpoint;
 *        dsh, opencode, codex and pi need the OpenAI one)
 * Run it against a private daemon: node tools/ops/run-isolated.mjs  (the provider is stored in the daemon's data folder)
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Scheduler, check } from '../lib/scheduler.mjs';

const TYPE = process.argv[2] || 'claude';
const { PROVIDER_TEST_KEY: KEY, PROVIDER_TEST_MODEL: MODEL, PROVIDER_TEST_OPENAI: OPENAI, PROVIDER_TEST_ANTHROPIC: ANTHROPIC } = process.env;
if (!KEY || !MODEL || (!OPENAI && !ANTHROPIC)) {
  console.log('skipped: set PROVIDER_TEST_KEY, PROVIDER_TEST_MODEL and PROVIDER_TEST_OPENAI / PROVIDER_TEST_ANTHROPIC to run this');
  process.exit(0);
}
console.log(`\n=== executor with a provider: ${TYPE} ===\n`);

const s = await Scheduler.open();
const id = `t${Date.now().toString(36)}`;
const root = mkdtempSync(join(tmpdir(), 'agentd-provider-'));
const project = `p${id}`;
const call = (op, args = {}, opts) => s.c.call(op, args, { timeoutMs: 240_000, ...opts });
const fails = async (p) => p.then(() => null, (e) => e.message);

try {
  const spec = { id, name: id, apiKey: KEY, endpoints: { ...(OPENAI ? { openai: OPENAI } : {}), ...(ANTHROPIC ? { anthropic: ANTHROPIC } : {}) }, models: [MODEL] };
  await call('provider.save', spec);
  const list = await call('provider.list');
  const row = list.providers.find((p) => p.id === id);
  check('the provider is listed, with the end of its key as a hint', row?.keyHint === `…${KEY.slice(-4)}`, row?.keyHint);
  check('the list never carries the key', !JSON.stringify(list).includes(KEY));
  check('the list says which CLIs can take it', row?.support.some((x) => x.type === TYPE && x.supported), JSON.stringify(row?.support.map((x) => `${x.type}:${x.supported}`)));

  const denied = await fails(call('provider.list', { caller: 'dispatcher', project: 'whatever' }));
  check('the dispatcher may not use provider operations', /dispatcher cannot/.test(denied ?? ''), denied?.slice(0, 80));

  await call('project.create', { id: project, name: project, root });
  const added = await call('project.addInstance', { project, id: 'w', type: TYPE, dir: '.', role: 'provider test', provider: { id, model: MODEL } });
  check('the instance remembers its provider', added.provider?.id === id && added.provider?.model === MODEL, JSON.stringify(added.provider));

  const r = await call('run', { agent: added.key, prompt: 'Reply with exactly the word PONG and nothing else.' });
  check('it answers through the provider', /PONG/i.test(r.text ?? ''), String(r.text ?? '').slice(0, 80));
  const inst = (await call('instances', { project })).instances.find((i) => i.id === added.key);
  check('its row says which provider it uses', inst?.provider?.id === id, JSON.stringify(inst?.provider));

  const global = await fails(call('project.addInstance', { project, id: 'm', type: 'mcode', dir: '.', provider: { id, model: MODEL } }));
  check('mcode (providers in its own configuration) is refused', /own configuration/.test(global ?? ''), global?.slice(0, 100));

  const inUse = await fails(call('provider.remove', { id }));
  check('a provider in use cannot be removed', /still used by/.test(inUse ?? ''), inUse?.slice(0, 80));

  // the same executor with a wrong key: it must fail, which shows the answer above came through the provider
  await call('provider.save', { ...spec, apiKey: 'wrong-key-0123456789' });
  await call('project.updateInstance', { project, id: 'w', provider: { id, model: MODEL } }); // restarts it
  const bad = await call('run', { agent: added.key, prompt: 'Reply with exactly the word PONG and nothing else.', timeoutMs: 90_000 }).then((x) => ({ text: x.text, error: x.metrics?.error ?? null }), (e) => ({ text: '', error: e.message }));
  check('with a wrong key the same executor does not answer', !/PONG/i.test(bad.text ?? ''), bad.error ? String(bad.error).slice(0, 100) : `text: ${String(bad.text).slice(0, 60)}`);

  await call('project.remove', { project, force: true });
  const removed = await call('provider.remove', { id });
  check('after the executor is gone the provider can be removed', removed.removed === true);
} finally {
  await call('project.remove', { project, force: true }).catch(() => {});
  await call('provider.remove', { id }).catch(() => {});
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* left in the temp folder */
  }
  s.close();
}
console.log(process.exitCode ? '\n=> ✗ PROVIDER EXECUTOR BROKEN' : '\n=> ✓ PROVIDER EXECUTOR OK');
