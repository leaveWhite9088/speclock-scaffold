/**
 * The drivers: everything that is specific to one CLI, one file each.
 *
 * What a driver is (the contract; `test/drivers-test.mjs` checks every driver against it):
 *
 *   type, label, description
 *   packages      [{ name, version }]  the npm packages it needs, at the versions its behaviours were checked on
 *   verified      { on, note }          when, and what was checked
 *   capabilities  { compact, rules, mcp, mcpStart, sessionsOnDisk? }  what the rest of the scaffold may rely on
 *   launch(install, ctx)  -> { cmd, args, env, missing }  how to start it; never throws, names what is not installed
 *   rules({ text, file, env }) -> { args, env, meta, prefix }  how it is handed the rules
 *   envFn?()                   environment worked out at every start
 *   provider?                  { protocol: 'anthropic'|'openai', scope: 'process'|'global', apply({ provider, endpoint, model, dir, env }) }
 *                              how to start it with another endpoint and key (see probes/provider.mjs)
 *   instanceEnv?({ id, sessionsDir }), spawnEnv?({ cwd, mcpServers }), paths?(install), diskSessions?(cwd)
 *
 * `install` is what the scaffold found on this machine: { node, dir(packageName), version(packageName) }. A driver
 * knows nothing about where things are installed, only what it needs; the preflight finds, checks and installs.
 *
 * Nothing in here imports the daemon, so the preflight reads the same files. When a CLI changes, its driver (and the
 * versions in it) is what changes; the rest of the scaffold asks `capabilities` instead of asking which CLI it is.
 */

import claude from './claude.mjs';
import codex from './codex.mjs';
import dsh from './dsh.mjs';
import mcode from './mcode.mjs';
import opencode from './opencode.mjs';
import pi from './pi.mjs';

export const drivers = { mcode, dsh, opencode, claude, codex, pi };
export const driverTypes = Object.keys(drivers);
export const getDriver = (type) => drivers[type] ?? null;

/** Every npm package the drivers need, once each, with the CLIs that need it. */
export function wantedPackages() {
  const byName = new Map();
  for (const d of Object.values(drivers)) {
    for (const p of d.packages) {
      const row = byName.get(p.name) ?? { name: p.name, version: p.version, types: [] };
      if (row.version !== p.version) throw new Error(`drivers disagree on ${p.name}: ${row.version} and ${p.version}`);
      row.types.push(d.type);
      byName.set(p.name, row);
    }
  }
  return [...byName.values()];
}

export { piMcpServers } from './pi.mjs';
export { FAKE_MCP_PATH, PROBE_IDS, probeDriver } from './probes/index.mjs';
export { applyProvider, checkEndpoint, discoverModels, scrub, testProvider } from './probes/provider.mjs';
export { dshFolderName, dshSessions } from './dsh-sessions.mjs';
