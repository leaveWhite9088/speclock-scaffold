/**
 * Running the drivers' behaviour probes and keeping what they found, per CLI and per version, in
 * `data/global/clis-probes.json`. That file is for the report only: the daemon never reads it, and nothing here runs
 * unless someone asked (`preflight probe`).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeDriver } from '@speclock-scaffold/drivers';
import { dataDir } from './detect.mjs';

export const probesPath = () => process.env.AGENTD_PROBES_FILE || join(dataDir(), 'global', 'clis-probes.json');

/** packages/agentd: the pi adapter lives there, and the pi driver starts it. */
export const agentdRoot = () => process.env.AGENTD_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'agentd');

/** What the detection found, in the shape the drivers ask for. */
export const installFrom = (detected, node, binaries = {}) => ({
  node,
  dir: (name) => detected[name]?.dir ?? null,
  version: (name) => detected[name]?.version ?? null,
  bin: (name) => binaries[name]?.dir ?? null,
  binVersion: (name) => binaries[name]?.version ?? null,
});

export function readProbes(file = probesPath()) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && data.results ? data : { schema: 1, results: {} };
  } catch {
    return { schema: 1, results: {} };
  }
}

export function saveProbes(record, file = probesPath()) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
  return file;
}

/**
 * Probe the given drivers at the same time (each is a process and a few prompts, mostly waiting), keep each result,
 * and return them. A CLI that is not installed is skipped, not failed.
 */
export async function runProbes({ drivers, detected, binaries = {}, node, log = () => {}, probe = probeDriver, file = probesPath() }) {
  const install = installFrom(detected, node, binaries);
  const results = await Promise.all(
    drivers.map((driver) =>
      probe({
        driver,
        install,
        agentdRoot: agentdRoot(),
        workRoot: mkdtempSync(join(tmpdir(), `preflight-probe-${driver.type}-`)),
        log: (line) => log(`[${driver.type}] ${line}`),
      }),
    ),
  );
  const record = readProbes(file);
  for (const r of results) if (!r.skipped) record.results[r.type] = r;
  record.schema = 1;
  saveProbes(record, file);
  return results;
}

/**
 * What the last probe of a CLI says about the versions installed now.
 *   never      no result recorded
 *   verified   passed, at exactly these versions
 *   failed     ran at exactly these versions and something did not hold
 *   stale      the last result is for other versions
 */
export function behaviourOf(record, type, packages) {
  const r = record?.results?.[type];
  if (!r) return { state: 'never' };
  const now = Object.fromEntries(packages.map((p) => [p.name, p.version]));
  const same = Object.keys(now).length === Object.keys(r.versions ?? {}).length && Object.entries(now).every(([n, v]) => r.versions?.[n] === v);
  if (!same) return { state: 'stale', at: r.at, was: r.versions };
  return r.ok ? { state: 'verified', at: r.at } : { state: 'failed', at: r.at, failed: r.checks.filter((c) => !c.ok).map((c) => c.id) };
}
