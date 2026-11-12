/**
 * Which part may import which, checked from the source with nothing started. A rule here is there so that nobody adds an
 * import in the wrong direction (or around a part's entry) without the test saying so.
 *
 *   groups   core/ is split by what the code does: base, records, prompts, pi, pool (with pool/acp inside it), dispatcher,
 *            projects. Each group has one entry, its index.mjs, which does nothing but re-export.
 *   entry    code outside a group imports the group through its index.mjs and through nothing else. The tests are not
 *            part of this check: they reach into a group on purpose, to test one piece alone.
 *   deps     a group only reaches the groups listed for it below, so the arrows all point one way.
 *   core     core/ imports nothing from daemon/, client/, extension/ or pi-adapter/
 *   daemon   daemon/ is imported by nothing but daemon/; the operation files do not import each other
 *   drivers  what is specific to one CLI is in packages/drivers; only the pool imports it, and it imports nothing of ours
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../lib/scheduler.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const rel = (f) => relative(ROOT, f).replace(/\\/g, '/');

function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name === 'data') continue;
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(mjs|ts)$/.test(name)) out.push(p);
  }
  return out;
}

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The scaffold packages a source imports (bare specifiers). */
function packagesOf(file) {
  const text = stripComments(readFileSync(file, 'utf8'));
  return [...text.matchAll(/\b(?:from|import)\s*\(?\s*['"](@speclock-scaffold\/[^'"]+)['"]/g)].map((m) => m[1]);
}

/** The files a source imports (relative specifiers only), as paths relative to the package. */
function importsOf(file) {
  const text = stripComments(readFileSync(file, 'utf8'));
  const specs = [...text.matchAll(/\b(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
  return specs.map((s) => rel(resolve(dirname(file), s)));
}

console.log('\n=== layers ===\n');

const files = ['core', 'daemon', 'client', 'extension', 'pi-adapter'].flatMap((d) => sources(join(ROOT, d)));
const graph = new Map(files.map((f) => [rel(f), importsOf(f)]));

// each group and the groups it may reach (pool/acp is part of pool: only the rest of the pool goes through its entry)
const DEPS = {
  'core/base': [],
  'core/records': ['core/base'],
  'core/prompts': ['core/base'],
  'core/pi': ['core/base'],
  'core/pool': ['core/base', 'core/records'],
  'core/specs': ['core/base'],
  'core/dispatcher': ['core/base', 'core/pi', 'core/prompts', 'core/pool'],
  'core/projects': ['core/base', 'core/prompts', 'core/pool', 'core/records'],
};
const GROUPS = [...Object.keys(DEPS), 'core/pool/acp'];
// the extension runs inside pi's process; it takes this one helper directly because the rest of records loads state files on import
const EXTENSION_MAY_REACH = ['core/records/reply.mjs'];

const groupOf = (f) => [...GROUPS].sort((a, b) => b.length - a.length).find((g) => f.startsWith(`${g}/`)) ?? null;
const topGroupOf = (f) => Object.keys(DEPS).find((g) => f.startsWith(`${g}/`)) ?? null;
const entryOf = (g) => `${g}/index.mjs`;

// the files the rules talk about exist, so a rename cannot silently empty a rule
const missing = GROUPS.map(entryOf).filter((f) => !graph.has(f));
check('every group has its index.mjs', missing.length === 0, missing.join(', '));
const loose = [...graph.keys()].filter((f) => /^core\/[^/]+\.mjs$/.test(f));
check('nothing sits loose at the top of core/', loose.length === 0, loose.join(', '));

const violations = (rule, test) => {
  const bad = [];
  for (const [file, imports] of graph) for (const to of imports) if (test(file, to)) bad.push(`${file} -> ${to}`);
  return check(rule, bad.length === 0, bad.join('; '));
};

violations('outside a group, only its index.mjs is imported', (from, to) => {
  const g = groupOf(to);
  if (!g || from.startsWith(`${g}/`) || to === entryOf(g)) return false;
  return !(from.startsWith('extension/') && EXTENSION_MAY_REACH.includes(to));
});

violations('a group only reaches the groups listed for it', (from, to) => {
  const a = topGroupOf(from);
  const b = topGroupOf(to);
  return a && b && a !== b && !DEPS[a].includes(b);
});

violations('core imports nothing from the daemon, the client, the extension or the adapter', (from, to) => from.startsWith('core/') && !to.startsWith('core/'));
violations('nothing imports the daemon from outside it', (from, to) => !from.startsWith('daemon/') && to.startsWith('daemon/'));
violations('the operation files do not import each other', (from, to) => from.startsWith('daemon/ops/') && to.startsWith('daemon/ops/') && from !== 'daemon/ops/index.mjs');

// an entry only re-exports, from files of its own group
const entryProblems = [];
for (const g of GROUPS) {
  const file = entryOf(g);
  if (!graph.has(file)) continue;
  const code = stripComments(readFileSync(join(ROOT, file), 'utf8')).trim();
  const statements = code.split(';').map((s) => s.trim()).filter(Boolean);
  for (const s of statements) if (!/^export\s+(\*|\{[^}]*\})\s+from\s+['"]\.\/[^'"]+['"]$/.test(s)) entryProblems.push(`${file}: ${s.slice(0, 60)}`);
  for (const to of graph.get(file)) if (!to.startsWith(`${g}/`)) entryProblems.push(`${file} -> ${to}`);
}
check('an index.mjs only re-exports files of its own group', entryProblems.length === 0, entryProblems.join('; '));

// the drivers: used by the pool (and the project code through the pool's driverOf), never the other way round
const usesDrivers = files.filter((f) => packagesOf(f).includes('@speclock-scaffold/drivers')).map(rel);
check('only the pool uses the drivers package', usesDrivers.every((f) => f.startsWith('core/pool/')), usesDrivers.filter((f) => !f.startsWith('core/pool/')).join(', '));
function driverSources() {
  const dir = join(ROOT, '..', 'drivers');
  return sources(dir)
    .filter((f) => !/[\\/]test[\\/]/.test(f))
    .map((f) => stripComments(readFileSync(f, 'utf8')))
    .join('\n');
}
check('the drivers package imports nothing of the scaffold', !/@speclock-scaffold|\.\.\/agentd/.test(driverSources()), 'a driver imports outside itself');

console.log(process.exitCode ? '\n=> ✗ LAYERS BROKEN' : '\n=> ✓ LAYERS OK');
process.exit(process.exitCode ?? 0);
