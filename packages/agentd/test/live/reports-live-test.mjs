/**
 * A task the dispatcher sends without waiting, through a real daemon and a real executor (dsh). No model answer is needed:
 * what is checked is that the answer is handed to the dispatcher as a message of its own.
 *
 * Checks:
 *   1. `run` with `report` returns at once, before the executor has answered (it is only the hand-over)
 *   2. the executor's answer reaches the project's dispatcher as a user message starting with 【执行者回报】, with the
 *      reply and the task tag in it, and starts a turn of the dispatcher (agent_start)
 *   3. a task sent from a person (no `caller: 'dispatcher'`) owes no report: the dispatcher hears nothing of it
 */

import { Scheduler, check } from '../lib/scheduler.mjs';

console.log('\n=== reports (live) ===\n');

const s = await Scheduler.open();
const proj = await s.tempProject({ type: 'dsh', id: 'dsh' });
const call = (op, args = {}) => s.c.call(op, { project: proj.project, ...args }, { timeoutMs: 180_000 });
const textOf = (c) => (typeof c === 'string' ? c : (c ?? []).map((x) => x.text ?? '').join('\n'));
const reports = async () => (await call('dispatcher.messages')).messages.filter((m) => m.role === 'user' && textOf(m.content).startsWith('【执行者回报】'));

await call('subscribe', { jobId: '*' }).catch(() => {});
let turns = 0;
const off = s.c.on('dispatcher.event', (ev) => {
  if ((ev.data ?? ev).type === 'agent_start') turns += 1;
});

const t0 = Date.now();
const sent = await s.c.call('run', { agent: proj.key, prompt: 'Reply with exactly the word PONGED and nothing else.', async: true, report: true, caller: 'dispatcher' });
check('the hand-over returns at once, as a background task', sent.async === true && Boolean(sent.jobId) && Date.now() - t0 < 5000, `${Date.now() - t0}ms`);

let got = null;
for (let i = 0; i < 90 && !got; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  got = (await reports())[0];
}
const said = textOf(got?.content);
check('the answer reaches the dispatcher as a report message', Boolean(got));
check('with the reply and the task tag', /PONGED/i.test(said) && said.includes(`job ${sent.jobId}`), said.slice(0, 100).replace(/\s+/g, ' '));
check('and it started a turn of the dispatcher', turns >= 1, `${turns} turn(s)`);

for (let i = 0; i < 60 && (await call('dispatcher.state')).isStreaming; i++) await new Promise((r) => setTimeout(r, 2000));
const before = (await reports()).length;
await s.c.call('run', { agent: proj.key, prompt: 'Reply with exactly the word SOLO and nothing else.' }, { timeoutMs: 240_000 });
await new Promise((r) => setTimeout(r, 4000));
check('a task of a person owes the dispatcher nothing', (await reports()).length === before);

off();
await proj.dispose();
s.close();
console.log(process.exitCode ? '\n=> ✗ REPORTS (LIVE) BROKEN' : '\n=> ✓ REPORTS (LIVE) OK');
