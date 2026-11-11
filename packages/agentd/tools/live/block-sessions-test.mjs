/**
 * The dispatcher's session handling, as the three extension tools use it: open a conversation named after a block,
 * switch back to it by name, rename it. Deleting one is still refused.
 *
 *   node tools/live/block-sessions-test.mjs [type]
 */
import { Scheduler } from '../lib/scheduler.mjs';

const TYPE = process.argv[2] || 'dsh';
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) process.exitCode = 1;
};
console.log(`\n=== block sessions: ${TYPE} ===\n`);

const s = await Scheduler.open();
const proj = await s.tempProject({ type: TYPE, id: 'w' });
// what the extension sends: the short name, inside the project, as the dispatcher
const call = (op, args = {}) => s.c.call(op, { agent: 'w', project: proj.project, caller: 'dispatcher', ...args }, { timeoutMs: 120_000 });

try {
  const a = await call('new');
  await call('rename', { sessionId: a.sessionId, label: 'login' });
  const b = await call('new');
  await call('rename', { sessionId: b.sessionId, label: 'orders' });
  check('two conversations, two ids', a.sessionId && b.sessionId && a.sessionId !== b.sessionId);

  const { sessions } = await call('sessions');
  const names = Object.fromEntries(sessions.map((x) => [x.label, x.sessionId]));
  check('both are listed under their block names', names.login === a.sessionId && names.orders === b.sessionId, JSON.stringify(Object.keys(names)));

  await call('use', { sessionId: a.sessionId });
  const st = await call('status');
  check('switching makes the named one active', st.sessionId === a.sessionId && st.sessionLabel === 'login', `${st.sessionId} ${st.sessionLabel}`);
  const row = (await s.c.call('instances', { project: proj.project })).instances.find((i) => i.id === proj.key);
  check('the instance list carries the conversation name (for the roster)', row?.sessionLabel === 'login', row?.sessionLabel);

  const r = await call('rename', { label: 'login-v2' });
  check('renaming without an id renames the active one', r.sessionId === a.sessionId && r.label === 'login-v2');

  const err = await call('deleteSession', { sessionId: b.sessionId }).then(() => '', (e) => e.message);
  check('deleting a conversation is still refused', /dispatcher cannot/.test(err), err.slice(0, 80));
  const err2 = await call('run', { prompt: 'x', reset: true }).then(() => '', (e) => e.message);
  check('resetting through run is still refused', /dispatcher cannot/.test(err2), err2.slice(0, 80));
} finally {
  await proj.dispose();
  s.close();
}
console.log(process.exitCode ? '\n=> ✗ BLOCK SESSIONS BROKEN' : '\n=> ✓ BLOCK SESSIONS OK');
