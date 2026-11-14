/**
 * What is installed on this machine, as the drivers ask for it:
 * `{ node, dir(package), version(package), bin(binary), binVersion(binary) }`.
 *
 * Where things are is the preflight's business (packages/preflight): it writes `data/global/clis.json`, and this file
 * only reads it. Without that file, npm packages are looked for next to node (where `npm i -g` puts them on Windows)
 * and standalone binaries are looked for on `PATH` and standard per-user installer folders. Worked out again on every
 * call, so a manifest written while the daemon runs applies to the next start.
 *
 *   {
 *     "schema": 1, "node": "D:/node/node.exe",
 *     "packages": { "@minimax-ai/code": { "dir": "D:/node/node_modules/@minimax-ai/code", "version": "0.7.6" } },
 *     "binaries": { "agy": { "path": "C:/Users/me/AppData/Local/agy/bin/agy.exe", "version": "1.5.9" } }
 *   }
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { GLOBAL_DIR } from '../base/index.mjs';
import { getDriver } from '@speclock-scaffold/drivers';

export const CLIS_FILE = process.env.AGENTD_CLIS_FILE || join(GLOBAL_DIR, 'clis.json');

let cached = { mtime: -1, data: null };

/** The preflight's manifest, or null. Re-read when the file changes. */
export function readManifest() {
  try {
    const mtime = statSync(CLIS_FILE).mtimeMs;
    if (mtime !== cached.mtime) {
      const data = JSON.parse(readFileSync(CLIS_FILE, 'utf8'));
      cached = { mtime, data: data && typeof data === 'object' ? data : null };
    }
    return cached.data;
  } catch {
    return null;
  }
}

/** The node that runs the CLIs: the environment, the manifest, then the one running this daemon. */
export function nodeBin() {
  return process.env.MCODE_NODE_BIN || readManifest()?.node || process.execPath;
}

const readVersion = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
};

const envBinKey = (name) => `${String(name).toUpperCase().replace(/[^A-Z0-9]/g, '_')}_BIN`;

const findBinInDirs = (name) => {
  const names = process.platform === 'win32' ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  const dirs = process.env.AGENTD_BIN_PATH !== undefined
    ? process.env.AGENTD_BIN_PATH.split(delimiter).filter(Boolean)
    : [
        ...String(process.env.PATH ?? process.env.Path ?? '').split(delimiter).filter(Boolean),
        ...(process.platform === 'win32'
          ? [process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'agy', 'bin') : join(homedir(), 'AppData', 'Local', 'agy', 'bin')]
          : [join(homedir(), '.local', 'bin')]),
      ];
  for (const d of dirs) {
    for (const n of names) {
      const file = join(d, n);
      if (existsSync(file)) return file;
    }
  }
  return null;
};

/**
 * @returns {{
 *   node: string,
 *   dir: (name: string) => string | null,
 *   version: (name: string) => string | null,
 *   bin: (name: string) => string | null,
 *   binVersion: (name: string) => string | null,
 * }}
 */
export function currentInstall() {
  const node = nodeBin();
  const manifest = readManifest();
  const fallbackRoot = process.env.AGENTD_NODE_MODULES || join(dirname(node), 'node_modules');
  const find = (name) => {
    const m = manifest?.packages?.[name];
    if (m?.dir && existsSync(join(m.dir, 'package.json'))) return m.dir;
    const dir = join(fallbackRoot, name);
    return existsSync(join(dir, 'package.json')) ? dir : null;
  };
  const findBin = (name) => {
    const override = process.env[envBinKey(name)];
    if (override && existsSync(override)) return override;
    const m = manifest?.binaries?.[name];
    if (m?.path && existsSync(m.path)) return m.path;
    return findBinInDirs(name);
  };
  return {
    node,
    dir: find,
    version: (name) => {
      const dir = find(name);
      return dir ? readVersion(dir) : null;
    },
    bin: findBin,
    binVersion: (name) => {
      const m = manifest?.binaries?.[name];
      return m?.path && existsSync(m.path) ? (m.version ?? null) : null;
    },
  };
}

/** Where pi's own cli.js is (the project dispatcher starts it directly); `missing` names what is not installed. */
export function piPaths() {
  return getDriver('pi').paths(currentInstall());
}
