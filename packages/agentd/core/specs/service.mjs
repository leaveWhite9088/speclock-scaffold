/**
 * The Core service as a process agentd looks after: install it (`uv sync` once), set it up once (`speclock init` in
 * data/global, whose one-time admin key is kept), start it, say whether it is up, stop it with the daemon.
 *
 * `speclock` is only ever run as `<core>/.venv python -m speclock …`; Core's code is not touched or imported.
 */

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GLOBAL_DIR } from '../base/index.mjs';
import { call } from './client.mjs';
import { CORE_DIR, CORE_PORT, HOME_DIR, readGlobal, venvPython, writeGlobal } from './config.mjs';

const log = (...a) => process.stderr.write(`[specs] ${a.join(' ')}\n`);
const ENV = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };

/** Core's address: the port its own config says (set at `init`), else the configured one. */
export function baseUrl() {
  try {
    const port = readFileSync(join(HOME_DIR, 'config.toml'), 'utf8').match(/^\s*port\s*=\s*(\d+)/m)?.[1];
    if (port) return `http://127.0.0.1:${port}`;
  } catch {
    /* not set up yet */
  }
  return `http://127.0.0.1:${CORE_PORT}`;
}

/** `{ version }` when the service answers, else null. */
export async function health() {
  try {
    const r = await call(baseUrl(), 'GET', '/health', { timeoutMs: 2000 });
    return r?.status === 'ok' ? { version: r.version ?? null } : null;
  } catch {
    return null;
  }
}

/** Is there a Core checkout, and is its environment built? `python` is where to run it. */
export function installState() {
  return { dir: CORE_DIR, found: existsSync(join(CORE_DIR, 'pyproject.toml')), python: venvPython(), built: existsSync(venvPython()) };
}

/** Build Core's environment if it is not there (a minute the first time). */
function ensureInstalled() {
  const s = installState();
  if (!s.found) throw new Error(`SpecLock Core was not found at ${CORE_DIR} (set AGENTD_SPECLOCK_DIR or "speclock.dir" in agentd.config.json)`);
  if (s.built) return s.python;
  log('building the Core environment (uv sync), this takes a minute the first time');
  const r = spawnSync('uv', ['sync', '--project', CORE_DIR], { env: ENV, encoding: 'utf8', timeout: 600_000, shell: process.platform === 'win32' });
  if (r.status !== 0 || !existsSync(s.python)) throw new Error(`could not build the Core environment: ${(r.stderr || r.error?.message || 'uv sync failed').trim().slice(-400)}`);
  return s.python;
}

/** Run `speclock <args>` in `cwd`; its output on success. */
function speclock(python, args, cwd) {
  const r = spawnSync(python, ['-m', 'speclock', ...args], { cwd, env: { ...ENV, SPECLOCK_HOME: HOME_DIR }, encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw new Error(`speclock ${args[0]} failed: ${(r.stderr || r.stdout || r.error?.message || '').trim().slice(-400)}`);
  return r.stdout;
}

/**
 * Make sure Core has been set up here and that agentd holds a super admin key. `init` prints that key once; it goes into
 * data/global/specs.json and nowhere else. If the folder exists but the key was lost, a new one is issued and the old ones revoked.
 */
export function ensureInitialised(python) {
  const have = readGlobal();
  if (have.adminKey && existsSync(join(HOME_DIR, 'config.toml'))) return have.adminKey;
  mkdirSync(GLOBAL_DIR, { recursive: true });
  const existing = existsSync(join(HOME_DIR, 'config.toml'));
  const out = speclock(python, ['init', '--port', String(CORE_PORT), '--project', 'scaffold', ...(existing ? ['--new-admin', '--revoke-old'] : [])], GLOBAL_DIR);
  const key = out.match(/human-[0-9a-f]{16,}/)?.[0];
  if (!key) throw new Error('speclock init did not print an admin key');
  writeGlobal({ ...have, adminKey: key });
  log(existing ? 'issued a new super admin key' : `set up in ${HOME_DIR}`);
  return key;
}

let child = null;
let starting = null;

/** Start the service if it is not already answering; resolves with the base URL. Many callers at once share one start. */
export function ensureRunning() {
  starting ??= (async () => {
    const python = ensureInstalled();
    ensureInitialised(python);
    if (await health()) return baseUrl();
    const out = openSync(join(GLOBAL_DIR, 'specs.log'), 'a');
    try {
      child = spawn(python, ['-m', 'speclock', 'serve'], { cwd: GLOBAL_DIR, env: { ...ENV, SPECLOCK_HOME: HOME_DIR }, stdio: ['ignore', out, out], windowsHide: true });
    } finally {
      closeSync(out);
    }
    child.on('exit', (code) => {
      log(`the service exited (${code})`);
      child = null;
    });
    for (let i = 0; i < 100; i++) {
      if (await health()) return baseUrl();
      if (!child) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`the SpecLock service did not come up (see ${join(GLOBAL_DIR, 'specs.log')})`);
  })().finally(() => {
    starting = null;
  });
  return starting;
}

/** Stop the service this daemon started (one it only found already running is left alone). */
export function stop() {
  if (child) {
    child.kill();
    child = null;
  }
}

/** Has Core been set up here before? Then the daemon brings it up at start without being asked. */
export const isSetUp = () => Boolean(readGlobal().adminKey) && existsSync(join(HOME_DIR, 'config.toml'));
