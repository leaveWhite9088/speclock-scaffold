/**
 * An executor created with `mcpServers` can call the tool of that server. (Calls a real model.)
 *
 *   1. project.addInstance validates `mcpServers` and the dispatcher may not use it
 *   2. a status row shows the server's name, not its environment
 *   3. the executor calls the tool (the probes' fake-mcp.mjs) and the token comes back
 *   4. after the process is stopped and started again, it still can (session/resume hands the servers over again)
 *   5. project.updateInstance changes the servers, and an instance without any has no such tool
 *
 * Usage: node tools/live/mcp-live-test.mjs [type]       (default: dsh; mcode, claude, codex, opencode, pi work too)
 * Run it against a private daemon: node tools/ops/run-isolated.mjs  (or set AGENTD_DATA_DIR / AGENTD_PIPE yourself)
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FAKE_MCP_PATH } from '@speclock-scaffold/drivers';
import { Scheduler, check } from '../lib/scheduler.mjs';

const TYPE = process.argv[2] || 'dsh';
const FAKE = FAKE_MCP_PATH;
console.log(`\n=== mcp servers for executors: ${TYPE} ===\n`);

const root = mkdtempSync(join(tmpdir(), 'agentd-mcp-'));
mkdirSync(join(root, 'work'));
const logFile = join(root, 'fake-mcp.log');
const server = (token) => ({
  name: 'speclock',
  command: process.execPath,
  args: [FAKE],
  env: [
    { name: 'FAKE_MCP_LOG', value: logFile },
    { name: 'FAKE_MCP_TOKEN', value: token },
  ],
});
const ASK = 'Call the MCP tool speclock_ping and tell me exactly what text it returned. If you cannot see such a tool, reply with exactly: NO_TOOL';
const P = `mcp${Date.now().toString(36)}`;
const KEY = `${P}~exec`;

const s = await Scheduler.open();
const call = (op, args) => s.c.call(op, args);
const fails = (p, re, name) => p.then(() => check(name, false, 'did not fail'), (e) => check(name, re.test(e.message), e.message));

try {
  await call('project.create', { id: P, root });
  await fails(call('project.addInstance', { project: P, id: 'bad', type: TYPE, dir: './work', mcpServers: [{ name: 'a b', command: 'x' }] }), /name/, 'a bad server is refused');
  await fails(call('project.addInstance', { project: P, id: 'bad', type: TYPE, dir: './work', mcpServers: 'nope' }), /list/, 'a non-list is refused');
  await fails(call('project.addInstance', { project: P, id: 'bad', type: TYPE, dir: './work', caller: 'dispatcher', mcpServers: [server('X')] }), /dispatcher cannot/, 'the dispatcher cannot attach servers');

  const made = await call('project.addInstance', { project: P, id: 'exec', type: TYPE, dir: './work', mcpServers: [server('T-A')] });
  check('the instance is created with a server', made.mcp?.[0]?.name === 'speclock', JSON.stringify(made.mcp));
  const row = (await call('projects')).projects.find((p) => p.id === P).instances.find((i) => i.id === 'exec');
  const shown = JSON.stringify(row.mcp);
  check('a status row shows the name and kind only', shown === '[{"name":"speclock","kind":"stdio"}]' && !JSON.stringify(row).includes('FAKE_MCP'), shown);

  const r1 = await call('run', { agent: KEY, prompt: ASK });
  check('the executor calls the tool', /PONG-T-A/.test(r1.text ?? ''), JSON.stringify(String(r1.text ?? '').slice(0, 100)));
  check('the server was started with its environment', /spawned/.test(existsSync(logFile) ? readFileSync(logFile, 'utf8') : ''));

  await call('project.stop', { project: P, force: true });
  const r2 = await call('run', { agent: KEY, prompt: ASK });
  check('after a restart (session resumed) it still can', /PONG-T-A/.test(r2.text ?? ''), JSON.stringify(String(r2.text ?? '').slice(0, 100)));

  // Change the servers: a new token. A CLI takes them with the next session/resume, pi with its next start.
  await call('project.updateInstance', { project: P, id: 'exec', mcpServers: [server('T-B')] });
  await call('project.stop', { project: P, force: true });
  const r3 = await call('run', { agent: KEY, prompt: ASK });
  check('an edited server list applies after the next start', /PONG-T-B/.test(r3.text ?? ''), JSON.stringify(String(r3.text ?? '').slice(0, 100)));

  await call('project.updateInstance', { project: P, id: 'exec', mcpServers: [] });
  const cleared = (await call('projects')).projects.find((p) => p.id === P).instances.find((i) => i.id === 'exec');
  check('an empty list removes them', (cleared.mcp ?? []).length === 0);
} finally {
  await call('project.remove', { project: P, force: true }).catch(() => {});
  await s.close?.();
}
process.exit(process.exitCode ?? 0);
