/**
 * The preflight, against folders it makes itself: versions, detection order, statuses, the manifest and the install plan.
 * Nothing is installed, no network, the real machine is not looked at.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { drivers, wantedPackages } from '@speclock-scaffold/drivers';
import { detectPackages, readPackage } from '../src/detect.mjs';
import { installPlan, runInstall, windowsCommandLine } from '../src/install.mjs';
import { buildManifest, writeManifest } from '../src/manifest.mjs';
import { behaviourOf, readProbes, runProbes } from '../src/probe.mjs';
import { describeBehaviour, summarize, worst } from '../src/report.mjs';
import { compareVersions } from '../src/version.mjs';
import { CORE, corePlan, formatCore, haveTool, inspectCore, ownDir, runCorePlan } from '../src/speclock.mjs';

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || !extra ? '' : `  (${extra})`}`);
  if (!ok) failed++;
};

console.log('\n=== preflight ===\n');

// versions
check('0.7.6 is newer than 0.6.12', compareVersions('0.7.6', '0.6.12') === 1);
check('0.1.5-rc.2 is older than 0.1.5', compareVersions('0.1.5-rc.2', '0.1.5') === -1);
check('rc.10 is newer than rc.2 (numbers, not text)', compareVersions('0.1.5-rc.10', '0.1.5-rc.2') === 1);
check('equal versions', compareVersions('1.19.1', '1.19.1') === 0);
check('something that is not a version', compareVersions('latest', '1.0.0') === null && compareVersions(null, '1.0.0') === null);

// a fake machine: a scaffold folder and a global folder
const base = mkdtempSync(join(tmpdir(), 'preflight-'));
const scaffold = join(base, 'scaffold', 'node_modules');
const global = join(base, 'global', 'node_modules');
const put = (root, name, version) => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }));
};
const wanted = wantedPackages();
const want = (name) => wanted.find((w) => w.name === name).version;
const roots = [
  { label: 'scaffold', path: scaffold },
  { label: 'global', path: global },
];

check('readPackage reads a version, and null for nothing', readPackage(global, 'nope') === null);

// everything at the verified version in the global folder, except what each case below changes
for (const w of wanted) put(global, w.name, w.version);
let d = detectPackages(wanted, roots);
check('everything installed at the verified version is ok', Object.values(d).every((p) => p.status === 'ok' && p.source === 'global'));

// older, newer, missing
put(global, '@minimax-ai/code', '0.1.0');
put(global, 'opencode-ai', '99.0.0');
mkdirSync(join(base, 'empty'), { recursive: true });
d = detectPackages(wanted, roots);
check('older than verified', d['@minimax-ai/code'].status === 'older' && d['@minimax-ai/code'].version === '0.1.0');
check('newer than verified', d['opencode-ai'].status === 'newer');
const noGlobal = detectPackages(wanted, [{ label: 'global', path: join(base, 'empty') }]);
check('a package that is nowhere is missing, with no dir', noGlobal['@deepseek-ai/dsh'].status === 'missing' && noGlobal['@deepseek-ai/dsh'].dir === null);

// the scaffold's copy at the verified version wins over a global one at another version
put(scaffold, '@minimax-ai/code', want('@minimax-ai/code'));
d = detectPackages(wanted, roots);
check('the verified version in the scaffold folder wins over another version in the global one', d['@minimax-ai/code'].status === 'ok' && d['@minimax-ai/code'].source === 'scaffold' && d['@minimax-ai/code'].others.length === 1);
// ... but an earlier copy at another version does not hide a later one at the verified version
put(scaffold, '@deepseek-ai/dsh', '0.0.1');
d = detectPackages(wanted, roots);
check('a global copy at the verified version wins over a scaffold copy at another one', d['@deepseek-ai/dsh'].status === 'ok' && d['@deepseek-ai/dsh'].source === 'global');

// per CLI
const rows = summarize(drivers, d, { CLAUDE_CONFIG_DIR: join(base, 'no-claude'), PI_CODING_AGENT_DIR: join(base, 'no-pi') });
const row = (t) => rows.find((r) => r.type === t);
check('a CLI is as bad as its worst package', row('opencode').status === 'newer' && row('mcode').status === 'ok' && worst(['ok', 'older', 'newer']) === 'older');
check('hints for what no version check sees (claude settings, pi credentials)', row('claude').hints.length === 1 && row('pi').hints.length === 1 && row('mcode').hints.length === 0);

// the manifest
const manifest = buildManifest({ node: 'N:\\node.exe', detected: noGlobal, now: new Date('2026-11-10T00:00:00Z') });
check('the manifest leaves out what was not found', Object.keys(manifest.packages).length === 0 && manifest.schema === 1 && manifest.node === 'N:/node.exe');
const manifest2 = buildManifest({ node: 'N:/node.exe', detected: d });
check('the manifest holds dir, version and source of what was found', manifest2.packages['@minimax-ai/code'].dir.endsWith('/scaffold/node_modules/@minimax-ai/code') && manifest2.packages['@minimax-ai/code'].source === 'scaffold' && !manifest2.packages['@minimax-ai/code'].dir.includes('\\'));
const file = join(base, 'global', 'clis.json');
writeManifest(file, manifest2);
check('the manifest is written as JSON (folders created)', JSON.parse(readFileSync(file, 'utf8')).packages['@minimax-ai/code'].version === want('@minimax-ai/code'));

// the install plan
const empty = detectPackages(wanted, [{ label: 'global', path: join(base, 'empty') }]);
const all = installPlan({ detected: empty, prefix: join(base, 'tools') });
check('everything missing: all seven packages, pinned', all.packages.length === 7 && all.command.args.includes('@deepseek-ai/dsh@0.1.5-rc.2') && all.command.args.includes('--prefix'));
check('the plan installs into the prefix, never globally', !all.command.args.includes('-g') && !all.command.args.includes('--global'));
const onlyPi = installPlan({ detected: empty, prefix: 'X', types: ['pi'] });
check('--type narrows it to the packages that CLI needs', onlyPi.packages.length === 1 && onlyPi.packages[0].name === '@earendil-works/pi-coding-agent');
const mixed = installPlan({ detected: d, prefix: 'X' });
check('what is installed at another version is left alone by default', mixed.packages.length === 0 && mixed.command === null);
const pinned = installPlan({ detected: d, prefix: 'X', pin: true });
check('--pin also installs the verified version of what differs', pinned.packages.some((p) => p.name === 'opencode-ai') && pinned.packages.every((p) => p.status !== 'ok'));
const ran = [];
check('running an empty plan does not call npm', runInstall(installPlan({ detected: d, prefix: 'X' }), { spawn: () => ran.push(1) }) === 0 && ran.length === 0);
const fake = runInstall(installPlan({ detected: empty, prefix: join(base, 'tools2'), types: ['pi'] }), { spawn: (cmd, a) => (ran.push([cmd, a]), { status: 0 }) });
check('running a plan calls npm once with those arguments', fake === 0 && ran.length === 1 && JSON.stringify(ran[0]).includes('@earendil-works/pi-coding-agent@1.3.0'));
check('on Windows a path with a space stays one argument', windowsCommandLine({ cmd: 'npm.cmd', args: ['install', '--prefix', 'C:/Some One/tools', '@a/b@1.0.0'] }) === 'npm.cmd install --prefix "C:/Some One/tools" @a/b@1.0.0');
check('a quote in an argument cannot end the quoting', windowsCommandLine({ cmd: 'npm', args: ['x"y z'] }) === 'npm "x\\"y z"' || windowsCommandLine({ cmd: 'npm', args: ['x"y z'] }).startsWith('npm "x'));

// the behaviour record: per CLI, per version
const pf = join(base, 'global', 'clis-probes.json');
const fakeProbe = async ({ driver }) => ({
  type: driver.type,
  at: '2026-11-10T00:00:00.000Z',
  versions: Object.fromEntries(driver.packages.map((p) => [p.name, d[p.name].version])),
  ok: driver.type !== 'dsh',
  skipped: driver.type === 'codex' ? 'not installed: x' : undefined,
  checks: [{ id: 'rules.new', ok: driver.type !== 'dsh', detail: '' }, { id: 'mcp.new', ok: true, detail: '' }],
});
const got = await runProbes({ drivers: [drivers.mcode, drivers.dsh, drivers.codex], detected: d, node: process.execPath, probe: fakeProbe, file: pf });
check('every selected CLI is probed', got.length === 3);
const rec = readProbes(pf);
check('results are kept per CLI, and a skipped CLI leaves no result', Boolean(rec.results.mcode) && Boolean(rec.results.dsh) && !rec.results.codex);
const pk = (t) => drivers[t].packages.map((p) => ({ name: p.name, version: d[p.name].version }));
check('same versions and it passed: verified', behaviourOf(rec, 'mcode', pk('mcode')).state === 'verified');
check('same versions and it failed: failed, naming the checks', (() => { const b = behaviourOf(rec, 'dsh', pk('dsh')); return b.state === 'failed' && b.failed.join() === 'rules.new'; })());
check('never probed', behaviourOf(rec, 'opencode', pk('opencode')).state === 'never' && behaviourOf(null, 'mcode', pk('mcode')).state === 'never');
check('another version since: stale, not verified', behaviourOf(rec, 'mcode', [{ name: '@minimax-ai/code', version: '9.9.9' }]).state === 'stale');
check('an unreadable record reads as empty', Object.keys(readProbes(join(base, 'nope.json')).results).length === 0);
const lines = [
  describeBehaviour({ state: 'verified', at: '2026-11-10T01:00:00Z' }),
  describeBehaviour({ state: 'failed', at: '2026-11-10T01:00:00Z', failed: ['rules.new'] }),
  describeBehaviour({ state: 'stale', at: '2026-11-09T01:00:00Z' }),
  describeBehaviour({ state: 'never' }),
];
check('the report says it in words', /verified/.test(lines[0]) && /FAILED.*rules\.new/.test(lines[1]) && /other versions/.test(lines[2]) && /never probed/.test(lines[3]));
check('summarize carries the behaviour per CLI', summarize(drivers, d, {}, rec).find((r) => r.type === 'mcode').behaviour.state === 'verified');


// SpecLock Core: where it is, whether it is the verified one, and what fetching would run
{
  const root = mkdtempSync(join(tmpdir(), 'pf-core-'));
  process.env.AGENTD_DATA_DIR = join(root, 'data');
  const tools = { status: 0, stdout: 'ok' };
  const fakeSpawn = (cmd, args) => (cmd === 'git' && args.includes('rev-parse') ? { status: 0, stdout: `${CORE.commit}\n` } : tools);
  const python = process.platform === 'win32' ? join('Scripts', 'python.exe') : join('bin', 'python');
  const fakeCore = (dir, version, { built = true } = {}) => {
    mkdirSync(join(dir, 'packages', 'config', 'src', 'speclock_config'), { recursive: true });
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "x"\n');
    writeFileSync(join(dir, 'packages', 'config', 'src', 'speclock_config', '__init__.py'), `__version__ = "${version}"\n`);
    if (built) {
      mkdirSync(join(dir, '.venv', dirname(python)), { recursive: true });
      writeFileSync(join(dir, '.venv', python), '');
    }
  };

  const named = join(root, 'named');
  fakeCore(named, CORE.version);
  const ok = inspectCore({ env: { AGENTD_SPECLOCK_DIR: named }, spawn: fakeSpawn });
  check('a Core named by AGENTD_SPECLOCK_DIR is found, at the verified commit, built', ok.status === 'ok' && ok.dir === named && ok.version === CORE.version && ok.built, JSON.stringify([ok.status, ok.dir]));
  const other = inspectCore({ env: { AGENTD_SPECLOCK_DIR: named }, spawn: (c, a) => (a.includes('rev-parse') ? { status: 0, stdout: 'abc123\n' } : tools) });
  check('another commit is reported as such, not as ok', other.status === 'other');
  const unbuilt = join(root, 'unbuilt');
  fakeCore(unbuilt, CORE.version, { built: false });
  check('one without its environment is reported as unbuilt', inspectCore({ env: { AGENTD_SPECLOCK_DIR: unbuilt }, spawn: fakeSpawn }).status === 'unbuilt');
  const noGit = inspectCore({ env: { AGENTD_SPECLOCK_DIR: named }, spawn: (c) => (c === 'git' ? { status: 1 } : tools) });
  check('without git the version still says which it is, and the missing tool is told apart', noGit.status === 'ok' && noGit.tools.git === false && noGit.tools.uv === true);
  check('a tool that cannot run counts as missing', haveTool('git', () => ({ status: 0 })) === true && haveTool('uv', () => ({ status: null, error: new Error('ENOENT') })) === false);

  // fetching: only the scaffold's own folder, by the commit, then the environment
  const plan = corePlan({ status: 'missing', dir: null, tools: { git: true, uv: true } });
  const fetch = plan.steps.find((s) => s.args.includes('fetch'));
  check('fetching goes into the scaffold’s own folder', plan.dir === ownDir() && plan.dir.endsWith(join('tools', 'speclock-core')));
  check('it fetches the verified commit from the Core repository, shallow', fetch.args.includes(CORE.commit) && fetch.args.includes(CORE.repo) && fetch.args.includes('--depth'));
  const word = (s) => s.args.find((a) => ['init', 'fetch', 'checkout', 'sync'].includes(a));
  check('it makes the folder, fetches, checks out, then builds the environment', plan.steps.map((s) => `${s.cmd} ${word(s)}`).join(', ') === 'git init, git fetch, git checkout, uv sync', plan.steps.map(word).join());
  check('a missing tool is named before anything runs', corePlan({ status: 'missing', dir: null, tools: { git: false, uv: true } }).missingTools.join() === 'git');
  const elsewhere = corePlan({ status: 'ok', dir: named, from: 'next to the repository', tools: { git: true, uv: true } });
  check('with a Core elsewhere the own copy is still fetched, only into its own folder, and the note says which is used from then on', elsewhere.steps.length === 4 && elsewhere.steps.every((s) => s.args.some((a) => String(a).startsWith(ownDir()))) && /instead of/.test(elsewhere.note) && /left as it is/.test(elsewhere.note));
  check('a Core named by AGENTD_SPECLOCK_DIR is said to win over the fetched copy', /AGENTD_SPECLOCK_DIR is set/.test(corePlan({ ...ok, from: 'AGENTD_SPECLOCK_DIR' }).note ?? ''));
  fakeCore(ownDir(), CORE.version, { built: false });
  check('the scaffold’s own copy without an environment gets only the build', corePlan({ status: 'unbuilt', dir: ownDir(), from: 'scaffold', tools: { git: true, uv: true } }).steps.map((s) => s.cmd).join() === 'uv');
  fakeCore(ownDir(), CORE.version);
  check('with its own copy built there is nothing to do', corePlan({ status: 'ok', dir: ownDir(), from: 'scaffold', tools: { git: true, uv: true } }).steps.length === 0);

  const ran = [];
  const good = runCorePlan(plan, { spawn: (c) => (ran.push(c), { status: 0 }) });
  check('the steps run in order', good.ok && ran.join() === 'git,git,git,uv');
  const stopped = [];
  const bad = runCorePlan(plan, { spawn: (c, a) => (stopped.push(c), { status: a.includes('fetch') ? 128 : 0 }) });
  check('a failing step stops the rest and says which', !bad.ok && bad.failed.args.includes('fetch') && stopped.length === 2);
  const missing = formatCore({ status: 'missing', tools: { git: true, uv: false } }).join(' ');
  check('the report says what is wrong and how to fix it', /not installed/.test(missing) && /preflight core --yes/.test(missing) && /uv \[not found\]/.test(missing));
  delete process.env.AGENTD_DATA_DIR;
}

console.log(failed ? `\n=> ✗ ${failed} FAILED` : '\n=> ✓ PREFLIGHT OK');
process.exit(failed ? 1 : 0);
