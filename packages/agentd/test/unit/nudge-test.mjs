/**
 * A turn that stops halfway is asked to go on. Fake ACP agent, no real CLI.
 *
 * Cheap models sometimes end a turn on a thought or a tool result with nothing after it (the task is not done and there is
 * no report), or write their tool call out as text, which runs nothing.
 *
 * Checks:
 *   1. a turn that ended on a tool result is asked to go on, and the answer that follows is the run's answer
 *   2. a tool call written as text is asked for again, with its own wording
 *   3. a turn that never answers is asked twice at most, and then the run says it is unfinished
 *   4. a turn that ends with a message is left alone; so is a command (a compaction says nothing)
 */

import '../lib/isolate.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { buildInstance } = await import('../../core/pool/index.mjs');
const { check } = await import('../lib/scheduler.mjs');

console.log('\n=== nudge: a turn that stops halfway ===\n');

const dir = mkdtempSync(join(tmpdir(), 'agentd-nudge-'));
const script = join(dir, 'fake.mjs');
writeFileSync(
  script,
  `
const send = (o) => console.log(JSON.stringify({ jsonrpc: '2.0', ...o }));
let current = '';
process.stdin.on('data', (d) => {
  for (const line of String(d).split(String.fromCharCode(10)).filter(Boolean)) {
    const m = JSON.parse(line);
    if (m.method === 'initialize') send({ id: m.id, result: { agentInfo: { name: 'fake' }, agentCapabilities: {} } });
    else if (m.method === 'session/new') send({ id: m.id, result: { sessionId: 'S1' } });
    else if (m.method === 'session/prompt') {
      const text = m.params.prompt[0].text;
      const update = (u) => send({ method: 'session/update', params: { sessionId: 'S1', update: u } });
      const say = (t) => update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } });
      const tool = () => { update({ sessionUpdate: 'tool_call', toolCallId: 't' + Math.random(), title: 'bash', status: 'in_progress' }); update({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed' }); };
      const isNudge = text.includes('系统提示');
      if (!isNudge) current = text;
      if (current.startsWith('halfway')) { if (isNudge) say('finished it'); else tool(); }
      else if (current.startsWith('astext')) { if (isNudge) { tool(); say('done for real'); } else say('<｜DSML｜ invoke name="bash">'); }
      else if (current.startsWith('never')) { tool(); }
      else if (current.startsWith('/')) { tool(); }
      else say('all good');
      send({ id: m.id, result: { stopReason: 'end_turn' } });
    }
  }
});
`,
);

const a = buildInstance({ id: 'nudge-test', type: 'dsh', cwd: dir });
a.spec.launch = () => ({ cmd: process.execPath, args: [script], env: {}, missing: [] });
const run = (text) => a.startPrompt(text, { timeoutMs: 30_000 }).done.then((r) => r, (e) => e);

const halfway = await run('halfway');
check('a turn that ended on a tool result is asked to go on, and the answer that follows is the run’s', !(halfway instanceof Error) && /finished it/.test(halfway.text), halfway.text ?? halfway.message);
check('it says it was asked, and that it went on', halfway.metrics.attention.some((x) => x.code === 'auto_continued'), JSON.stringify(halfway.metrics.attention));

const astext = await run('astext');
check('a tool call written as text is asked for again', !(astext instanceof Error) && /done for real/.test(astext.text), astext.text ?? astext.message);

const never = await run('never');
check('a turn that never answers is asked twice and then called unfinished', !(never instanceof Error) && never.metrics.attention.some((x) => x.code === 'ended_without_result' && /2 time/.test(x.text)), JSON.stringify(never.metrics?.attention));

const fine = await run('fine');
check('a turn that ends with a message is left alone', !(fine instanceof Error) && fine.text === 'all good' && !fine.metrics.attention.some((x) => /auto_continued|ended_without/.test(x.code)));

const cmd = await run('/compact');
check('a command is not asked to go on', !(cmd instanceof Error) && !cmd.metrics.attention.some((x) => /auto_continued|ended_without/.test(x.code)), JSON.stringify(cmd.metrics?.attention));

await a.shutdown();
console.log(process.exitCode ? '\n=> ✗ NUDGE BROKEN' : '\n=> ✓ NUDGE OK');
process.exit(process.exitCode ?? 0);
