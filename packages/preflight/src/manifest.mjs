/**
 * The manifest: what the daemon reads (agentd's core/pool/install.mjs). This is the only thing the two sides share.
 *
 *   { "schema": 1, "generatedAt": "...", "node": "D:/node/node.exe",
 *     "packages": { "<npm name>": { "dir": "...", "version": "...", "source": "scaffold|global" } } }
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const SCHEMA = 1;

const slash = (p) => String(p).replace(/\\/g, '/');

/** Only what was found goes in; a package that is missing is left out, so the daemon falls back to its own search. */
export function buildManifest({ node, detected, now = new Date() }) {
  const packages = {};
  for (const d of Object.values(detected)) {
    if (d.dir) packages[d.name] = { dir: slash(d.dir), version: d.version, source: d.source };
  }
  return { schema: SCHEMA, generatedAt: now.toISOString(), node: slash(node), packages };
}

export function writeManifest(file, manifest) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
  return file;
}
