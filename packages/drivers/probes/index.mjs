/**
 * Behaviour probes: does a CLI, at the version installed now, still do what its driver says? Real models, a few short
 * prompts per CLI, a minute or two. Run on demand by the preflight; nothing in the daemon calls this.
 *
 * Two prompts cover it, each asking for the rule's marker and a call of the probe's MCP tool at once:
 *   1. new process, new session   -> rules.new, mcp.new
 *   2. process stopped and started again, session resumed   -> rules.resume, mcp.resume
 * (the tool answers with a different token each time, so an answer after the restart proves the restarted process
 * started the server again, not that the model remembered the first answer)
 *
 * It uses only the driver: its `launch`, `rules`, `envFn`, `instanceEnv` and `spawnEnv`. If the driver hands a CLI the
 * wrong thing, a check fails; nothing here is specific to any one CLI.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcpProcess } from './acp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_MCP = join(HERE, 'fake-mcp.mjs');
/** A tiny MCP server (one tool, speclock_ping) for tests that need one. */
export const FAKE_MCP_PATH = FAKE_MCP;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const PROBE_IDS = ['start', 'rules.new', 'mcp.new', 'rules.resume', 'mcp.resume'];

/**
 * @param {{ driver: any, install: { node: string, dir: Function, version: Function }, agentdRoot: string,
 *           workRoot: string, log?: (s: string) => void, promptTimeoutMs?: number }} o
 * @returns {Promise<{ type: string, at: string, versions: Record<string,string|null>, ok: boolean, skipped?: string, checks: Array<{ id: string, ok: boolean, detail: string }> }>}
 */
export async function probeDriver({ driver, install, agentdRoot, workRoot, log = () => {}, promptTimeoutMs = 240_000 }) {
  const type = driver.type;
  const result = {
    type,
    at: new Date().toISOString(),
    versions: Object.fromEntries(driver.packages.map((p) => [p.name, install.version(p.name)])),
    ok: false,
    checks: [],
  };
  const add = (id, ok, detail = '') => {
    result.checks.push({ id, ok: Boolean(ok), detail: String(detail).slice(0, 240) });
    log(`${ok ? '✓' : '✗'} ${id}${ok || !detail ? '' : `  (${String(detail).slice(0, 120)})`}`);
  };

  const launch = driver.launch(install, { agentdRoot });
  if (launch.missing?.length) {
    result.skipped = `not installed: ${launch.missing.join(', ')}`;
    return result;
  }

  const cwd = join(workRoot, 'work');
  mkdirSync(cwd, { recursive: true });
  const marker = `ZEBRA-${type.toUpperCase()}`;
  const rule = `Rule from the project owner, it applies to every reply you write in this conversation: finish every reply with the exact word ${marker} on a line of its own, whatever the question is.`;
  const rulesFile = join(workRoot, 'rules.md');
  writeFileSync(rulesFile, rule);
  const inj = driver.rules({ text: rule, file: rulesFile, env: process.env });

  const servers = (phase, token) => [
    {
      name: 'speclock',
      command: process.execPath,
      args: [FAKE_MCP],
      env: [
        { name: 'FAKE_MCP_LOG', value: join(workRoot, `mcp-${phase}.log`) },
        { name: 'FAKE_MCP_TOKEN', value: token },
      ],
    },
  ];
  const logOf = (phase) => {
    const f = join(workRoot, `mcp-${phase}.log`);
    return existsSync(f) ? readFileSync(f, 'utf8') : '';
  };
  const start = (phase, token) =>
    AcpProcess.start({
      cmd: launch.cmd,
      args: [...launch.args, ...inj.args],
      cwd,
      env: {
        ...process.env,
        ...launch.env,
        ...(driver.instanceEnv?.({ id: `probe-${type}`, conversationsDir: join(workRoot, 'conv') }) ?? {}),
        ...(driver.envFn?.() ?? {}),
        ...(driver.spawnEnv?.({ cwd, mcpServers: servers(phase, token) }) ?? {}),
        ...inj.env,
      },
    });
  const meta = inj.meta ? { _meta: inj.meta } : {};
  const ask = (n) =>
    `Call the MCP tool speclock_ping (it may be named mcp__speclock__speclock_ping, speclock_speclock_ping or similar) and tell me exactly what text it returned. If you cannot see such a tool, reply with exactly: NO_TOOL`;

  let sessionId = null;
  let proc = null;
  try {
    // ---- 1. new process, new session ------------------------------------------------------------------------------
    proc = start('new', 'T1');
    const init = await proc.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } }, 120_000);
    add('start', !init.error, init.error ? `${init.error.message}${proc.stderr.length ? ` | ${proc.stderr.slice(-2).join(' | ')}` : ''}` : `${init.result?.agentInfo?.name ?? '?'} ${init.result?.agentInfo?.version ?? ''}`.trim());
    if (init.error) return finish();

    const sess = await proc.request('session/new', { cwd, mcpServers: servers('new', 'T1'), ...meta }, 120_000);
    sessionId = sess.result?.sessionId ?? null;
    if (!sessionId) {
      add('rules.new', false, `session/new failed: ${sess.error?.message ?? 'no session id'}`);
      add('mcp.new', false, 'no session');
      return finish();
    }
    const first = await proc.prompt(sessionId, `${inj.prefix ? `${rule}\n\n---\n\n` : ''}${ask()}`, promptTimeoutMs);
    add('rules.new', first.text.includes(marker), first.error ?? tail(first.text));
    add('mcp.new', first.text.includes('PONG-T1') && /tools\/call/.test(logOf('new')), first.error ?? tail(first.text));
    await proc.stop();
    await sleep(1200);

    // ---- 2. a new process, the session resumed --------------------------------------------------------------------
    proc = start('resume', 'T2');
    const init2 = await proc.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, 120_000);
    if (init2.error) {
      add('rules.resume', false, `initialize failed: ${init2.error.message}`);
      add('mcp.resume', false, 'no process');
      return finish();
    }
    const res = await proc.request('session/resume', { sessionId, cwd, mcpServers: servers('resume', 'T2'), ...meta }, 120_000);
    if (res.error) {
      add('rules.resume', false, `session/resume failed: ${res.error.message}`);
      add('mcp.resume', false, 'not resumed');
      return finish();
    }
    const second = await proc.prompt(res.result?.sessionId ?? sessionId, `Now do it again: ${ask()}`, promptTimeoutMs);
    add('rules.resume', second.text.includes(marker), second.error ?? tail(second.text));
    add('mcp.resume', second.text.includes('PONG-T2') && /tools\/call/.test(logOf('resume')), second.error ?? tail(second.text));
  } catch (e) {
    add('error', false, e.message);
  }
  return finish();

  async function finish() {
    await proc?.stop().catch(() => {});
    for (const id of PROBE_IDS) if (!result.checks.some((c) => c.id === id)) add(id, false, 'not reached');
    result.ok = result.checks.every((c) => c.ok);
    return result;
  }
}

const tail = (t) => JSON.stringify(String(t).replace(/\s+/g, ' ').trim().slice(-90));
