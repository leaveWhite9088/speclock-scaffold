/**
 * The line work waits in, on its own (no process, no CLI).
 *
 * Checks:
 *   1. tasks run one at a time, in the order they were handed over, and say how many were ahead
 *   2. a waiting prompt cancelled by id is answered at once and never runs; the others are untouched
 *   3. the running one, one that is over, and an unknown id cannot be cancelled as waiting
 *   4. a task that fails does not stop the ones behind it; session operations share the same line
 *   5. a waiting prompt can be moved to the front; several keep the order they were promoted in; session operations keep their place
 *   6. everything is cleaned up afterwards
 */

import '../lib/isolate.mjs';
import { PromptQueue } from '../../core/pool/acp/prompt-queue.mjs';
import { check } from '../lib/scheduler.mjs';

console.log('\n=== prompt queue ===\n');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = new PromptQueue();
const order = [];
const job = (name, ms, fail = false) => async () => {
  order.push(`start:${name}`);
  await sleep(ms);
  order.push(`end:${name}`);
  if (fail) throw new Error(`${name} failed`);
  return name;
};
const gone = () => Object.assign(new Error('cancelled'), { kind: 'cancelled' });
const settle = (p) => p.then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));

const a = q.submit('a', 'first', job('a', 80), gone);
const b = q.submit('b', 'second', job('b', 10), gone);
const c = q.submit('c', 'third', job('c', 10), gone);
check('each says how many were ahead', a.ahead === 0 && b.ahead === 1 && c.ahead === 2, [a.ahead, b.ahead, c.ahead].join());
check('all are counted', q.inflight === 3);
check('the line lists the waiting, oldest first', q.waiting().map((j) => j.text).join() === 'first,second,third');

check('a waiting prompt can be cancelled', q.cancelWaiting('b') === true);
check('it no longer shows in the list', q.waiting().every((j) => j.jobId !== 'b'));
const ob = await settle(b.done);
check('and is answered at once, before the one in front is done', !ob.ok && ob.e.kind === 'cancelled' && !order.includes('end:a'), order.join());
const oc = await settle(c.done);
const oa = await settle(a.done);
check('the others ran, in order, and the cancelled one never did', oa.ok && oc.ok && order.join() === 'start:a,end:a,start:c,end:c', order.join());

check('a running or finished prompt is not waiting', q.cancelWaiting('a') === false && q.cancelWaiting('nope') === false);

// 4
order.length = 0;
const f = q.submit('f', 'fails', job('f', 5, true), gone);
const s = q.enqueue(async () => order.push('session-op'));
const g = q.submit('g', 'after', job('g', 5), gone);
const of = await settle(f.done);
await s;
const og = await settle(g.done);
check('a failing task reports its error', !of.ok && /f failed/.test(of.e.message));
check('the one behind it still runs, and a session operation waits its turn', og.ok && order.join() === 'start:f,end:f,session-op,start:g,end:g', order.join());

// 5
order.length = 0;
const p1 = q.submit('p1', 'one', job('p1', 40), gone);
const p2 = q.submit('p2', 'two', job('p2', 5), gone);
const so = q.enqueue(async () => order.push('session-op'));
const p3 = q.submit('p3', 'three', job('p3', 5), gone);
const p4 = q.submit('p4', 'four', job('p4', 5), gone);
await sleep(5); // p1 has started
check('promoting an unknown, running or finished prompt does nothing', q.promote('nope').promoted === false && q.promote('p1').promoted === false);
check('a waiting prompt goes to the front, after the one that runs', q.promote('p4').promoted === true && q.waiting().map((j) => j.jobId).join() === 'p4,p2,p3', q.waiting().map((j) => j.jobId).join());
check('a second one goes behind the first that was promoted, ahead of the rest', q.promote('p3').position === 2 && q.waiting().map((j) => j.jobId).join() === 'p4,p3,p2' && q.waiting()[0].priority === true);
await Promise.all([p1.done, p2.done, so, p3.done, p4.done].map(settle));
check('they ran in that order, and the session operation kept its place behind them', order.filter((x) => x.startsWith('start') || x === 'session-op').join() === 'start:p1,start:p4,start:p3,start:p2,session-op', order.join());

// 6: moving a task up must not change the conversation it runs in, nor the one the tasks left behind expect
{
  let cur = 'A';
  const seen = [];
  const sw = new PromptQueue({ switcher: { current: () => cur, use: async (id) => { cur = id; } } });
  const sees = (name, ms = 5) => async () => { seen.push(`${name}@${cur}`); await sleep(ms); };
  const use = (id) => sw.enqueue(async () => { cur = id; }, { session: { kind: 'use', id } });
  const r0 = sw.submit('r0', 'running', sees('R', 40), gone);
  use('X');
  const jx = sw.submit('jx', 'in X', sees('JX'), gone);
  use('Y');
  const jy = sw.submit('jy', 'in Y', sees('JY'), gone);
  await sleep(5);
  check('a task behind a switch can be moved up', sw.promote('jy').promoted === true);
  await Promise.all([r0.done, jx.done, jy.done].map(settle));
  check('it still ran in its own conversation, and the one left behind ran in its own', seen.join() === 'R@A,JY@Y,JX@X', seen.join());
  check('and the conversation was put back after it (the task that was behind it found X)', cur === 'Y' || cur === 'X', cur);

  seen.length = 0;
  cur = 'A';
  const own = sw.submit('own', 'names Z', async () => { cur = 'Z'; seen.push('OWN@Z'); await sleep(40); }, gone, { session: { kind: 'use', id: 'Z' } });
  const k = sw.submit('k', 'after it', sees('K'), gone);
  await sleep(5);
  sw.promote('k');
  await Promise.all([own.done, k.done].map(settle));
  check('a task that follows one naming its own conversation runs in that one when moved up', seen.join() === 'OWN@Z,K@Z', seen.join());

  const making = sw.submit('mk', 'makes a new one', sees('MK', 30), gone);
  sw.enqueue(async () => { cur = 'new'; }, { session: { kind: 'other' } });
  const after = sw.submit('after', 'runs in the new one', sees('AFTER'), gone);
  await sleep(5);
  const refused = sw.promote('after');
  check('a task that waits for a new conversation to be made is not moved', refused.promoted === false && /new conversation/.test(refused.reason), JSON.stringify(refused));
  await Promise.all([making.done, after.done].map(settle));
}

await sleep(20);
check('nothing is left behind', q.inflight === 0 && q.queuedJobs.size === 0 && q.items.length === 0 && !q.running, JSON.stringify([q.inflight, q.queuedJobs.size, q.items.length, q.running]));

console.log(process.exitCode ? '\n=> ✗ PROMPT QUEUE BROKEN' : '\n=> ✓ PROMPT QUEUE OK');
