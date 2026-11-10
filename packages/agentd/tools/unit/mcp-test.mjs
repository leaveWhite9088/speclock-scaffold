/**
 * MCP servers handed to executors: validation, the pi form, what a status row shows, and that sessions pass them on
 * (new and resume). No process, no model.
 */

import { cleanMcpServers, describeMcpServers, mcpServersOf } from '../../core/pool/mcp.mjs';
import { piMcpServers } from '@speclock-scaffold/drivers';
import { Sessions } from '../../core/pool/acp/sessions.mjs';

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || !extra ? '' : `  (${extra})`}`);
  if (!ok) failed++;
};
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

const stdio = { name: 'speclock', command: 'speclock', args: ['mcp', '--key-file', 'executor-agent--be.key'], env: [{ name: 'SPECLOCK_HOME', value: 'D:/x/.speclock' }] };

check('nothing configured is an empty list', cleanMcpServers(undefined).length === 0 && cleanMcpServers([]).length === 0 && cleanMcpServers(null).length === 0);
check('a stdio server is kept in ACP shape', JSON.stringify(cleanMcpServers([stdio])) === JSON.stringify([stdio]));
check('env may be given as an object', cleanMcpServers([{ name: 'a', command: 'x', env: { K: 'v' } }])[0].env[0].name === 'K');
check('an http server is recognised by its url', cleanMcpServers([{ name: 'h', url: 'https://example.com/mcp' }])[0].type === 'http');
check('a bad name is refused', throws(() => cleanMcpServers([{ name: 'a b', command: 'x' }])));
check('a missing command is refused', throws(() => cleanMcpServers([{ name: 'a' }])));
check('a duplicate name is refused', throws(() => cleanMcpServers([stdio, stdio])));
check('args must be strings', throws(() => cleanMcpServers([{ name: 'a', command: 'x', args: [1] }])));
check('env values must be strings', throws(() => cleanMcpServers([{ name: 'a', command: 'x', env: [{ name: 'K', value: 1 }] }])));
check('not a list is refused', throws(() => cleanMcpServers({ name: 'a' })));

check('a function giving the list is read each time', (() => {
  let list = [];
  const spec = { mcpServers: () => list };
  const before = mcpServersOf(spec).length;
  list = [stdio];
  return before === 0 && mcpServersOf(spec).length === 1;
})());

const pi = piMcpServers(cleanMcpServers([stdio, { name: 'h', url: 'https://e.com/mcp', headers: [{ name: 'A', value: 'b' }] }]));
check('pi form: stdio becomes command/args/env', pi.speclock.command === 'speclock' && pi.speclock.args[2] === 'executor-agent--be.key' && pi.speclock.env.SPECLOCK_HOME === 'D:/x/.speclock');
check('pi form: http becomes url/headers', pi.h.url === 'https://e.com/mcp' && pi.h.headers.A === 'b');

const shown = JSON.stringify(describeMcpServers([stdio]));
check('a status row shows names and kinds only', shown === '[{"name":"speclock","kind":"stdio"}]' && !shown.includes('SPECLOCK_HOME') && !shown.includes('.key'));

// Sessions put the servers in session/new and in session/resume.
const calls = [];
const agent = { name: 't', type: 'dsh', custom: true, spec: { mcpServers: () => [stdio], defaultCwd: 'C:/w', type: 'dsh' }, child: {}, busy: false };
const request = async (method, params) => {
  calls.push({ method, params });
  if (method === 'session/new') return { sessionId: 'S1' };
  if (method === 'session/resume') return { sessionId: params.sessionId };
  return {};
};
const s = new Sessions({ agent, request, init: async () => {}, enqueue: (fn) => fn(), rulesMeta: () => ({}) });
await s.ensureReady('C:/w').catch(() => {});
const made = calls.find((c) => c.method === 'session/new');
check('session/new carries the servers', made && made.params.mcpServers.length === 1 && made.params.mcpServers[0].name === 'speclock', JSON.stringify(calls.map((c) => c.method)));
s.live.clear();
await s.attachRaw('S9', 'C:/w').catch(() => {});
const resumed = calls.find((c) => c.method === 'session/resume');
check('session/resume carries the servers', resumed && resumed.params.mcpServers?.length === 1, JSON.stringify(calls.map((c) => c.method)));

console.log(failed ? `\n=> ✗ ${failed} FAILED` : '\n=> ✓ MCP OK');
process.exit(failed ? 1 : 0);
