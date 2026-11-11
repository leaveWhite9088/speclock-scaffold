/**
 * The preflight, against folders it makes itself: versions, detection order, statuses, the manifest and the install plan.
 * Nothing is installed, no network, the real machine is not looked at.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drivers, wantedPackages } from '@speclock-scaffold/drivers';
import { detectPackages, readPackage } from '../src/detect.mjs';
import { installPlan, runInstall, windowsCommandLine } from '../src/install.mjs';
import { buildManifest, writeManifest } from '../src/manifest.mjs';
import { behaviourOf, readProbes, runProbes } from '../src/probe.mjs';
import { describeBehaviour, summarize, worst } from '../src/report.mjs';
import { compareVersions } from '../src/version.mjs';

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


console.log(failed ? `\n=> ✗ ${failed} FAILED` : '\n=> ✓ PREFLIGHT OK');
process.exit(failed ? 1 : 0);
