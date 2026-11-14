/**
 * The manifest: what the daemon reads (agentd's core/pool/install.mjs). This is the only thing the two sides share.
 *
 *   { "schema": 1, "generatedAt": "...", "node": "D:/node/node.exe",
 *     "packages": { "<npm name>": { "dir": "...", "version": "...", "source": "scaffold|global" } },
 *     "binaries": { "<bin name>": { "path": "...", "version": "...", "source": "PATH|local|..." } } }
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const SCHEMA = 1;

const slash = (p) => String(p).replace(/\\/g, '/');

/** Only what was found goes in; anything missing is left out, so the daemon falls back to its own search. */
export function buildManifest({ node, detected, binaries = {}, now = new Date() }) {
  const packages = {};
  for (const d of Object.values(detected)) {
    if (d.dir) packages[d.name] = { dir: slash(d.dir), version: d.version, source: d.source };
  }
  const bins = {};
  for (const b of Object.values(binaries)) {
    if (b.dir) bins[b.name] = { path: slash(b.dir), version: b.version, source: b.source };
  }
  return { schema: SCHEMA, generatedAt: now.toISOString(), node: slash(node), packages, binaries: bins };
}

export function writeManifest(file, manifest) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
  return file;
}
