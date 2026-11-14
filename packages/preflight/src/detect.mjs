/**
 * Finding what is installed. Pure where it can be: `detectPackages` and `detectBinaries` take the places to look as
 * arguments, so a test can point them at folders it made; only `defaultRoots` and `defaultBinDirs` ask the machine.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
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

/** Environment variable that names a standalone binary explicitly (`agy` -> `AGY_BIN`). */
export const binaryEnvKey = (name) => `${String(name).toUpperCase().replace(/[^A-Z0-9]/g, '_')}_BIN`;

/** Where standalone executables are looked for: `PATH` first, then standard per-user installer folders. */
export function defaultBinDirs(env = process.env, platform = process.platform) {
  if (env.AGENTD_BIN_PATH) {
    return env.AGENTD_BIN_PATH.split(delimiter).filter(Boolean).map((path) => ({ label: 'bin', path }));
  }
  const seen = new Set();
  const keyOf = (p) => (platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  const dirs = [];
  const add = (label, path) => {
    if (!path) return;
    const k = keyOf(path);
    if (seen.has(k)) return;
    seen.add(k);
    dirs.push({ label, path });
  };
  for (const p of String(env.PATH ?? env.Path ?? '').split(delimiter)) if (p.trim()) add('PATH', p.trim());
  if (platform === 'win32') {
    add('local', env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'agy', 'bin') : join(homedir(), 'AppData', 'Local', 'agy', 'bin'));
  } else {
    add('local', join(homedir(), '.local', 'bin'));
  }
  return dirs;
}

/** The executable file for `name` inside `dir`, or null. */
export function findBinary(dir, name, platform = process.platform) {
  const names = platform === 'win32' ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  for (const n of names) {
    const file = join(dir, n);
    if (existsSync(file)) return file;
  }
  return null;
}

/** Ask a standalone executable its `--version`, returning the first semver token or null. */
export function readBinaryVersion(file, spawn = spawnSync) {
  try {
    const r = spawn(file, ['--version'], { encoding: 'utf8', timeout: 10_000, windowsHide: true, shell: /\.cmd$/i.test(file) });
    const text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    const m = text.match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Same status shape as `detectPackages`, for standalone executables (`dir` holds the executable's full path).
 * Pure when `dirs` and `readVersion` are passed.
 */
export function detectBinaries(wanted, dirs, { env = process.env, readVersion = readBinaryVersion, platform = process.platform } = {}) {
  const out = {};
  const keyOf = (p) => (platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  for (const w of wanted) {
    const seen = new Set();
    const found = [];
    const push = (file, source) => {
      const k = keyOf(file);
      if (seen.has(k)) return;
      seen.add(k);
      found.push({ dir: file, version: readVersion(file), source });
    };
    const envKey = binaryEnvKey(w.name);
    if (env[envKey] && existsSync(env[envKey])) push(env[envKey], envKey);
    for (const d of dirs) {
      const file = findBinary(d.path, w.name, platform);
      if (file) push(file, d.label);
    }
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
