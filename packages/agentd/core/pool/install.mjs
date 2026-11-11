/**
 * What is installed on this machine, as the drivers ask for it: `{ node, dir(package), version(package) }`.
 *
 * Where things are is the preflight's business (packages/preflight): it writes `data/global/clis.json`, and this file
 * only reads it. Without that file the packages are looked for next to node, which is where `npm i -g` puts them on
 * Windows. Worked out again on every call, so a manifest written while the daemon runs applies to the next start.
 *
 *   {
 *     "schema": 1, "node": "D:/node/node.exe",
 *     "packages": { "@minimax-ai/code": { "dir": "D:/node/node_modules/@minimax-ai/code", "version": "0.7.6" } }
 *   }
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

/** @returns {{ node: string, dir: (name: string) => string | null, version: (name: string) => string | null }} */
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
  return {
    node,
    dir: find,
    version: (name) => {
      const dir = find(name);
      return dir ? readVersion(dir) : null;
    },
  };
}

/** Where pi's own cli.js is (the project dispatcher starts it directly); `missing` names what is not installed. */
export function piPaths() {
  return getDriver('pi').paths(currentInstall());
}
