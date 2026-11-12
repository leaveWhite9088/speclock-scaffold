/**
 * SpecLock Core, the spec library: where it is, whether it is the version the scaffold was verified with, and (only when
 * asked) fetching it. Like the CLIs, it is installed into the scaffold's own folder (data/global/tools/speclock-core), never
 * anywhere else, and nothing happens without --yes.
 *
 * Where agentd looks (core/specs/config.mjs does the same, in this order): AGENTD_SPECLOCK_DIR, then the copy installed
 * here, then a `speclock-core` folder next to this repository (a person developing Core has one). The first that exists wins.
 *
 * Fetching needs `git` and `uv` on the PATH; neither is installed for the person. Core is public, so no login is needed.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownPrefix } from './detect.mjs';

/** What the scaffold was verified with. Core has no release tags yet, so a commit is what is fetched. */
export const CORE = {
  repo: 'https://github.com/leaveWhite9088/speclock-core.git',
  commit: '87cc6e8a3e67150947f13f6c2f3fed76feaa7ef3',
  version: '0.3.0',
  verified: '2026-11-12',
};

/** packages/preflight -> the repository root. */
const repoRoot = () => join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const ownDir = () => join(ownPrefix(), 'speclock-core');
export const siblingDir = () => join(repoRoot(), '..', 'speclock-core');

const isCore = (dir) => existsSync(join(dir, 'pyproject.toml')) && existsSync(join(dir, 'packages', 'config'));
const venvPython = (dir) => join(dir, '.venv', process.platform === 'win32' ? join('Scripts', 'python.exe') : join('bin', 'python'));

/** The folders in the order they are tried, and which of them are a Core checkout. */
export function candidates(env = process.env) {
  const list = [];
  if (env.AGENTD_SPECLOCK_DIR) list.push({ label: 'AGENTD_SPECLOCK_DIR', dir: env.AGENTD_SPECLOCK_DIR });
  list.push({ label: 'scaffold', dir: ownDir() }, { label: 'next to the repository', dir: siblingDir() });
  return list.map((c) => ({ ...c, found: isCore(c.dir) }));
}

function versionOf(dir) {
  try {
    return /__version__\s*=\s*["']([^"']+)["']/.exec(readFileSync(join(dir, 'packages', 'config', 'src', 'speclock_config', '__init__.py'), 'utf8'))?.[1] ?? null;
  } catch {
    return null;
  }
}

function commitOf(dir, spawn = spawnSync) {
  const r = spawn('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? String(r.stdout).trim() : null;
}

/** Is `name` runnable? (`git`, `uv`) */
export function haveTool(name, spawn = spawnSync) {
  const r = spawn(name, ['--version'], { encoding: 'utf8', windowsHide: true });
  return r.status === 0;
}

/**
 * What there is: the Core that would be used, whether it is the verified version, whether its environment is built, and
 * which tools a fetch needs. `status`: missing | unbuilt | ok | other (found, at a version we did not verify).
 */
export function inspectCore({ env = process.env, spawn = spawnSync } = {}) {
  const list = candidates(env);
  const used = list.find((c) => c.found) ?? null;
  const base = { wanted: CORE, candidates: list, tools: { git: haveTool('git', spawn), uv: haveTool('uv', spawn), npm: haveTool('npm', spawn) } };
  if (!used) return { ...base, status: 'missing', dir: null };
  const version = versionOf(used.dir);
  const commit = commitOf(used.dir, spawn);
  const built = existsSync(venvPython(used.dir));
  const verified = commit ? commit === CORE.commit : version === CORE.version;
  return { ...base, status: !built ? 'unbuilt' : verified ? 'ok' : 'other', dir: used.dir, from: used.label, version, commit, built };
}

/**
 * What would run. Only the copy in the scaffold's own folder is fetched or built: a Core somewhere else (a checkout someone
 * works in) is never touched. Fetching a commit by its hash is `init` + `fetch --depth 1` + `checkout`, which GitHub allows,
 * and avoids downloading the whole history.
 */
export function corePlan(info) {
  const dir = ownDir();
  const steps = [];
  const build = { cmd: 'uv', args: ['sync', '--project', dir], note: 'build its Python environment (about a minute)' };
  // Core serves its web page itself, but only once it has been built (apps/web/dist); that needs node's npm
  const web = join(dir, 'apps', 'web');
  const webSteps = [
    { cmd: 'npm', args: ['install', '--no-audit', '--no-fund'], cwd: web, note: 'install the web page’s packages (needs the network)' },
    { cmd: 'npm', args: ['run', 'build'], cwd: web, note: 'build the web page Core serves' },
  ];
  if (!isCore(dir)) {
    steps.push(
      { cmd: 'git', args: ['init', '--quiet', dir], note: `create ${dir}` },
      { cmd: 'git', args: ['-C', dir, 'fetch', '--quiet', '--depth', '1', CORE.repo, CORE.commit], note: `fetch the verified commit ${CORE.commit.slice(0, 7)} (${CORE.version})` },
      { cmd: 'git', args: ['-C', dir, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], note: 'check it out' },
      build,
      ...webSteps,
    );
  } else {
    if (!existsSync(venvPython(dir))) steps.push(build);
    if (!existsSync(join(web, 'dist', 'index.html'))) steps.push(...webSteps);
  }
  const need = [...new Set(steps.map((s) => s.cmd))].filter((t) => !info.tools[t]);
  // The scaffold's own copy comes before one next to the repository, so fetching it changes which Core is used.
  let note = null;
  if (steps.length && info.dir && info.from === 'AGENTD_SPECLOCK_DIR') note = `AGENTD_SPECLOCK_DIR is set to ${info.dir}, which is used before this copy: unset it to use the fetched one`;
  else if (steps.length && info.dir && info.from !== 'scaffold') note = `after this the scaffold uses this copy instead of ${info.dir}; that folder is left as it is`;
  return { dir, steps, missingTools: need, note };
}

/** Run the steps in order; stops at the first that fails. Returns `{ ok, failed? }`. */
export function runCorePlan(plan, { spawn = spawnSync, log = () => {} } = {}) {
  if (!plan.steps.length) return { ok: true };
  mkdirSync(dirname(plan.dir), { recursive: true });
  for (const s of plan.steps) {
    log(`  ${s.cmd} ${s.args.join(' ')}`);
    // npm is a .cmd on Windows, which only runs through a shell
    const r = spawn(s.cmd, s.args, { stdio: 'inherit', windowsHide: true, cwd: s.cwd, shell: s.cmd === 'npm' && process.platform === 'win32' });
    if (r.status !== 0) return { ok: false, failed: s };
  }
  return { ok: true };
}

const NOTE = {
  missing: 'not installed',
  unbuilt: 'found, but its Python environment is not built',
  ok: 'at the verified version',
  other: 'found at a version the scaffold was not verified with',
};
const MARK = { missing: '✗', unbuilt: '!', ok: '✓', other: '~' };

/** The lines of the report. */
export function formatCore(info) {
  const lines = [`${MARK[info.status]} speclock-core  ${NOTE[info.status]}`];
  if (info.dir) lines.push(`    found at ${info.dir} (${info.from})${info.version ? `, version ${info.version}` : ''}${info.commit ? `, commit ${info.commit.slice(0, 7)}` : ''}`);
  lines.push(`    verified ${CORE.version}, commit ${CORE.commit.slice(0, 7)}, on ${CORE.verified}`);
  if (info.status === 'missing') lines.push(`    fetch it: preflight core --yes   (needs git${info.tools.git ? '' : ' [not found]'} and uv${info.tools.uv ? '' : ' [not found]'}; goes into ${ownDir()})`);
  if (info.status === 'unbuilt') lines.push(info.from === 'scaffold' ? '    the daemon builds it when first needed (uv sync); to do it now: preflight core --yes' : '    the daemon builds it when first needed (uv sync); this folder is not ours, so preflight leaves it alone');
  if (info.dir && info.from !== 'scaffold') lines.push('    to use a copy of the scaffold’s own instead: preflight core --yes');
  return lines;
}
