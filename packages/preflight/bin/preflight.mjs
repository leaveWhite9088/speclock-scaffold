#!/usr/bin/env node
/**
 * Preflight: what is installed, is it what the drivers were verified on, and (only if asked) install it.
 *
 *   preflight [check]            report; changes nothing                                  (default)
 *   preflight write              report, then write the manifest the daemon reads (data/global/clis.json)
 *   preflight probe              run the behaviour probes (rules, MCP, resume) against what is installed. Uses real models:
 *                                a few short prompts per CLI, one to two minutes, all CLIs at once. Never run by anything else.
 *   preflight install [--yes]    without --yes: show what would be installed; with it: install the verified versions
 *                                of what is missing into the scaffold's own folder (data/global/tools), then write the manifest
 *   preflight core [--yes]       SpecLock Core (the spec library): without --yes: show what would be fetched; with it: fetch the
 *                                verified commit into data/global/tools/speclock-core and build its environment (needs git and uv)
 *
 *   --pin         install also the packages found at another version (the scaffold's copy then takes precedence)
 *   --type a,b     only for these CLIs
 *   --json         machine-readable output
 *   --strict       exit 1 when a CLI is missing
 *   --help
 */

import { existsSync } from 'node:fs';
import { drivers, wantedBinaries, wantedPackages } from '@speclock-scaffold/drivers';
import {
  CORE,
  buildManifest,
  corePlan,
  defaultBinDirs,
  defaultRoots,
  detectBinaries,
  detectPackages,
  formatCore,
  formatReport,
  inspectCore,
  installPlan,
  manifestPath,
  ownPrefix,
  readProbes,
  runCorePlan,
  runInstall,
  runProbes,
  summarize,
  writeManifest,
} from '../src/index.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : null;
};
const command = args.find((a) => !a.startsWith('--') && a !== value('type')) ?? 'check';

if (flag('help') || flag('h') || !['check', 'write', 'install', 'probe', 'core'].includes(command)) {
  console.log(readHelp());
  process.exit(flag('help') || flag('h') ? 0 : 2);
}

if (command === 'core') {
  let info = inspectCore();
  console.log(formatCore(info).join('\n') + '\n');
  const plan = corePlan(info);
  if (!plan.steps.length) {
    console.log('nothing to fetch or build');
    process.exit(0);
  }
  if (plan.note) console.log(`note: ${plan.note}\n`);
  console.log('would run:');
  for (const s of plan.steps) console.log(`  ${s.cmd} ${s.args.join(' ')}    # ${s.note}`);
  if (plan.missingTools.length) {
    console.error(`\n${plan.missingTools.join(' and ')} not found on the PATH: install ${plan.missingTools.length > 1 ? 'them' : 'it'} first (preflight does not install them)`);
    process.exit(1);
  }
  if (!flag('yes')) {
    console.log(`\nthis changes nothing without --yes: it downloads ${CORE.repo} (public, no login) into ${plan.dir}.`);
    process.exit(0);
  }
  const done = runCorePlan(plan, { log: (l) => console.log(l) });
  if (!done.ok) {
    console.error(`\nfailed at: ${done.failed.cmd} ${done.failed.args.join(' ')}`);
    process.exit(1);
  }
  info = inspectCore();
  console.log('\n' + formatCore(info).join('\n'));
  process.exit(info.status === 'ok' ? 0 : 1);
}

const types = value('type') ? value('type').split(',').map((s) => s.trim()).filter(Boolean) : null;
for (const t of types ?? []) {
  if (!drivers[t]) {
    console.error(`unknown CLI "${t}"; known: ${Object.keys(drivers).join(', ')}`);
    process.exit(2);
  }
}

const node = process.env.MCODE_NODE_BIN || process.execPath;

function look() {
  const roots = defaultRoots(node);
  const detected = detectPackages(wantedPackages(), roots);
  const binaries = detectBinaries(wantedBinaries(), defaultBinDirs());
  return { roots: roots.map((r) => ({ ...r, exists: existsSync(r.path) })), detected, binaries };
}

let { roots, detected, binaries } = look();

if (command === 'install') {
  const plan = installPlan({ detected, prefix: ownPrefix(), types, pin: flag('pin') });
  const missingBins = Object.values(binaries).filter((b) => b.status === 'missing' && (!types || b.types.some((t) => types.includes(t))));
  if (missingBins.length) {
    console.log(`note: ${missingBins.map((b) => b.name).join(', ')} is a standalone binary (not an npm package): install it with its own installer.`);
  }
  if (!plan.packages.length) {
    console.log('nothing to install' + (flag('pin') ? '' : ' (packages found at another version are left alone; --pin installs the verified one too)'));
  } else {
    console.log(`would install into ${plan.prefix}/node_modules:`);
    for (const p of plan.packages) console.log(`  ${p.name}@${p.version}  (${p.status})`);
    console.log(`  command: ${plan.command.cmd} ${plan.command.args.join(' ')}`);
    if (!flag('yes')) {
      console.log('\nthis changes nothing without --yes: it downloads from the npm registry and runs the packages\' install scripts.');
      process.exit(0);
    }
    const code = runInstall(plan);
    if (code !== 0) {
      console.error(`\nnpm exited with ${code}; nothing was recorded`);
      process.exit(code);
    }
    ({ roots, detected, binaries } = look());
  }
}

if (command === 'probe') {
  const chosen = Object.values(drivers).filter((d) => !types || types.includes(d.type));
  console.log(`probing ${chosen.map((d) => d.type).join(', ')} (real models, a few short prompts each; this takes a minute or two)
`);
  const results = await runProbes({ drivers: chosen, detected, binaries, node, log: (l) => console.log(l) });
  console.log('');
  for (const r of results) {
    console.log(r.skipped ? `- ${r.type.padEnd(9)} skipped, ${r.skipped}` : `${r.ok ? '✓' : '✗'} ${r.type.padEnd(9)} ${r.checks.map((c) => `${c.ok ? '✓' : '✗'}${c.id}`).join('  ')}`);
  }
  console.log('');
  if (results.some((r) => !r.skipped && !r.ok)) process.exitCode = 1;
}

const rows = summarize(drivers, detected, process.env, readProbes(), binaries);
const core = inspectCore();

if (command === 'write' || command === 'install') {
  const file = writeManifest(manifestPath(), buildManifest({ node, detected, binaries }));
  if (!flag('json')) console.log(`\nmanifest written: ${file}`);
}

if (flag('json')) {
  console.log(JSON.stringify({ node, roots, rows, core }, null, 2));
} else {
  console.log((command === 'check' ? '' : '\n') + formatReport({ node, roots, rows }));
  console.log('\n' + formatCore(core).join('\n'));
  if (rows.some((r) => r.status === 'missing') && command === 'check') {
    console.log('\nmissing CLIs can be installed at their verified versions: preflight install --yes   (only into data/global/tools, not globally)');
  }
}

process.exit(flag('strict') && rows.some((r) => r.status === 'missing') ? 1 : process.exitCode ?? 0);

function readHelp() {
  return [
    'preflight [check|write|probe|install|core] [--yes] [--pin] [--type a,b] [--json] [--strict]',
    '  check    report only (default)',
    '  write    report, and write the manifest the daemon reads',
    '  probe    run the behaviour probes (real models; opt-in)',
    '  install  show what would be installed; with --yes install the verified versions of what is missing into data/global/tools',
    '  core     SpecLock Core (the spec library): show what would be fetched; with --yes fetch the verified commit into data/global/tools/speclock-core',
  ].join('\n');
}
