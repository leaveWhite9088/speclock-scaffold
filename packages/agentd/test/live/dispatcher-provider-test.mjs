/**
 * A project's dispatcher can start with a provider kept on this device. A small local server stands in for the provider,
 * so no real key or model is needed (the dispatcher's pi does call it).
 *
 *   1. the choice is stored and shown in the project list
 *   2. the provider is "in use" and cannot be removed
 *   3. the dispatcher's request reaches the provider's address with its key, and its model is the chosen one
 *
 * Usage: node test/live/dispatcher-provider-test.mjs      (against a private daemon: scripts/run-isolated.mjs)
 */

import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Scheduler, check } from '../lib/scheduler.mjs';

console.log('\n=== dispatcher with a provider ===\n');
const KEY = 'sk-fake-0123456789';
const seen = [];
const server = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const s = await Scheduler.open();
const id = `dp${Date.now().toString(36)}`;
const root = mkdtempSync(join(tmpdir(), 'agentd-dp-'));
const call = (op, a = {}) => s.c.call(op, a, { timeoutMs: 120_000 });
try {
  await call('provider.save', { id, name: id, apiKey: KEY, endpoints: { openai: `http://127.0.0.1:${server.address().port}/v1` }, models: ['m1'] });
  await call('project.create', { id, name: id, root });
  const set = await call('project.updateDispatcher', { project: id, provider: { id, model: 'm1' } });
  const shown = (await call('projects')).projects.find((p) => p.id === id)?.dispatcher?.provider;
  check('the choice is stored and listed', set.provider?.id === id && shown?.model === 'm1', JSON.stringify(shown));
  const used = (await call('provider.list')).providers.find((p) => p.id === id)?.usedBy;
  check('the provider is in use by the dispatcher', used?.includes(`dispatcher:${id}`), JSON.stringify(used));
  const refused = await call('provider.remove', { id }).then(() => '', (e) => e.message);
  check('so it cannot be removed', /still used by/.test(refused), refused);
  await call('dispatcher.prompt', { project: id, message: 'hello' });
  for (let i = 0; i < 40 && !seen.length; i++) await new Promise((r) => setTimeout(r, 1000));
  check('the request reaches the provider with its key', seen[0]?.url === '/v1/chat/completions' && seen[0]?.auth === `Bearer ${KEY}`, JSON.stringify(seen[0]));
  const st = await call('dispatcher.state', { project: id });
  check('and the model is the chosen one', st.model?.value === `${id}/m1`, st.model?.value);
  const bad = await call('project.updateDispatcher', { project: id, provider: { id: 'nope', model: 'x' } }).then(() => '', (e) => e.message);
  check('an unknown provider is refused', /unknown provider/.test(bad), bad);
} finally {
  await call('project.remove', { project: id, force: true }).catch(() => {});
  await call('provider.remove', { id }).catch(() => {});
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* left in the temp folder */
  }
  server.close();
  s.close();
}
console.log(process.exitCode ? '\n=> ✗ DISPATCHER PROVIDER BROKEN' : '\n=> ✓ DISPATCHER PROVIDER OK');
