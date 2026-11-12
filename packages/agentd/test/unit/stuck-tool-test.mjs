/**
 * A tool call that never ends (a dev server run in the foreground) is cancelled after a while. Fake ACP agent, no real CLI.
 *
 * Checks:
 *   1. a tool call that ends within the limit is left alone, whatever the idle limit
 *   2. a tool call that stays open with the agent saying nothing is cancelled once the stuck limit has passed, and the
 *      agent is told to cancel
 *   3. the error names the command and says it is most likely one that never ends, and that a process may be left
 *   4. while it is stuck, the executor's row says how long it has been quiet
 */

import '../lib/isolate.mjs';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.AGENTD_STUCK_TOOL_MS = '1500'; // read when the pool loads
process.env.AGENTD_CANCEL_GRACE_MS = '500';
const { buildInstance } = await import('../../core/pool/index.mjs');
const { check } = await import('../lib/scheduler.mjs');

console.log('\n=== stuck tool ===\n');

const dir = mkdtempSync(join(tmpdir(), 'agentd-stuck-'));
const cancelled = join(dir, 'cancelled');
const script = join(dir, 'fake.mjs');
writeFileSync(
  script,
  `
import { writeFileSync } from 'node:fs';
const send = (o) => console.log(JSON.stringify({ jsonrpc: '2.0', ...o }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let openId = null;
process.stdin.on('data', async (d) => {
  for (const line of String(d).split(String.fromCharCode(10)).filter(Boolean)) {
    const m = JSON.parse(line);
    if (m.method === 'initialize') send({ id: m.id, result: { agentInfo: { name: 'fake' }, agentCapabilities: {} } });
    else if (m.method === 'session/new') send({ id: m.id, result: { sessionId: 'S1' } });
    else if (m.method === 'session/cancel') {
      writeFileSync(${JSON.stringify(cancelled)}, 'yes');
      if (openId != null) send({ id: openId, result: { stopReason: 'cancelled' } });
    } else if (m.method === 'session/prompt') {
      const text = m.params.prompt[0].text;
      const update = (u) => send({ method: 'session/update', params: { sessionId: 'S1', update: u } });
      if (text === 'short') {
        update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'build', status: 'in_progress' });
        await wait(800);
        update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' });
        update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'built' } }); // a turn ends with a message, or it is asked to go on
        send({ id: m.id, result: { stopReason: 'end_turn' } });
      } else {
        update({ sessionUpdate: 'tool_call', toolCallId: 't2', title: 'bash', status: 'in_progress', rawInput: { command: 'npm run dev' } });
        openId = m.id;
      }
    }
  }
});
`,
);

const a = buildInstance({ id: 'stuck-test', type: 'dsh', cwd: dir });
a.spec.launch = () => ({ cmd: process.execPath, args: [script], env: {}, missing: [] });
const run = (text, idleMs) => a.startPrompt(text, { timeoutMs: idleMs }).done.then((r) => r, (e) => e);

const short = await run('short', 60_000);
check('a tool call that ends within the limit is left alone', !(short instanceof Error), short.message);

const t0 = Date.now();
const pending = run('stuck', 4000); // the idle limit sets how often the run is looked at
await new Promise((r) => setTimeout(r, 900));
const quiet = a.quietMs;
check('while a tool call is open the executor says how long it has been quiet', quiet > 0 && quiet < 1500, `${quiet} ms`);
const stuck = await pending;
check('a tool call that stays open is cancelled', stuck instanceof Error && /no sign of life/.test(stuck.message), stuck.message);
check('the agent was told to cancel', existsSync(cancelled));
check('it was cancelled soon after the stuck limit, not at the idle limit', Date.now() - t0 < 5000, `${Date.now() - t0} ms`);
check('the error names the command and what to look for', /npm run dev/.test(stuck.message) && /never ends/.test(stuck.message) && /may still be running/.test(stuck.message), stuck.message);

await a.shutdown();
console.log(process.exitCode ? '\n=> ✗ STUCK TOOL BROKEN' : '\n=> ✓ STUCK TOOL OK');
process.exit(process.exitCode ?? 0);
