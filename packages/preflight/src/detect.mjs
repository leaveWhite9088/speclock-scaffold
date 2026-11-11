/**
 * Finding what is installed. Pure where it can be: `detectPackages` takes the places to look as an argument, so a test
 * can point it at folders it made; only `defaultRoots` asks the machine (`npm root -g`).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions } from './version.mjs';

/** packages/agentd/data, or where AGENTD_DATA_DIR says: the same place the daemon uses. */
export function dataDir() {
  if (process.env.AGENTD_DATA_DIR) return resolve(process.env.AGENTD_DATA_DIR);
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'agentd', 'data');
}

/** Where the manifest goes, and where the daemon reads it (data/global/clis.json). */
export const manifestPath = () => process.env.AGENTD_CLIS_FILE || join(dataDir(), 'global', 'clis.json');

/** The scaffold's own install folder: `npm install --prefix` puts packages in <this>/node_modules. */
export const ownPrefix = () => join(dataDir(), 'global', 'tools');

/** npm's global folder for this node, or null. */
export function globalRoot(node = process.execPath) {
  if (process.env.AGENTD_NODE_MODULES) return process.env.AGENTD_NODE_MODULES;
  try {
    // On Windows npm is npm.cmd, which only a shell can start; one command string, so no argument is passed through the shell.
    const r = process.platform === 'win32'
      ? spawnSync('npm.cmd root -g', [], { encoding: 'utf8', timeout: 20_000, shell: true, windowsHide: true })
      : spawnSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
    const out = String(r.stdout ?? '').trim().split(/\r?\n/).pop();
    if (r.status === 0 && out && existsSync(out)) return out;
  } catch {
    /* fall through */
  }
  // Windows puts global packages next to node.exe.
  const beside = join(dirname(node), 'node_modules');
  return existsSync(beside) ? beside : null;
}

/** Where to look, in order of preference: the scaffold's own folder first (a pinned install), then the global one. */
export function defaultRoots(node = process.execPath) {
  const roots = [{ label: 'scaffold', path: join(ownPrefix(), 'node_modules') }];
  const g = globalRoot(node);
  if (g) roots.push({ label: 'global', path: g });
  return roots;
}

/** `{ dir, version }` of an npm package inside a node_modules folder, or null. */
export function readPackage(root, name) {
  const dir = join(root, name);
  try {
    const json = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return { dir, version: typeof json.version === 'string' ? json.version : null };
  } catch {
    return null;
  }
}

/**
 * For each wanted package ({ name, version }): where it is, which version, and how that compares with the one the
 * drivers were verified on. A copy at the wanted version wins over an earlier one at another version.
 *
 *   status  ok        installed at the verified version
 *           newer     installed, newer than verified: not checked by us
 *           older     installed, older than verified
 *           unknown   installed, but its version cannot be read or compared
 *           missing   not found anywhere
 */
export function detectPackages(wanted, roots) {
  const out = {};
  for (const w of wanted) {
    const found = roots.map((r) => ({ ...readPackage(r.path, w.name), source: r.label })).filter((f) => f.dir);
    const exact = found.find((f) => f.version === w.version);
    const pick = exact ?? found[0] ?? null;
    let status = 'missing';
    if (pick) {
      const c = compareVersions(pick.version, w.version);
      status = c === 0 ? 'ok' : c === 1 ? 'newer' : c === -1 ? 'older' : 'unknown';
    }
    out[w.name] = {
      name: w.name,
      wanted: w.version,
      types: w.types,
      status,
      dir: pick?.dir ?? null,
      version: pick?.version ?? null,
      source: pick?.source ?? null,
      others: found.filter((f) => f !== pick).map((f) => ({ dir: f.dir, version: f.version, source: f.source })),
    };
  }
  return out;
}
