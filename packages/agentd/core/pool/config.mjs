/** Constants, the CLI registry and `agentd.config.json`. Nothing here talks to a process. */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../app-config.mjs';
import { DATA_DIR, RUNTIME_DIR, STATE_DIR } from '../data-dir.mjs';
import { driverTypes, getDriver } from '@speclock-scaffold/drivers';
import { currentInstall, nodeBin } from './install.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** packages/agentd */
const ROOT = join(HERE, '..', '..');

export { DATA_DIR };

export const NODE_BIN = nodeBin();

/** Base working directory for every agent session. */
export const BASE_CWD = process.env.AGENTD_BASE_CWD || join(ROOT, '..', '..');

export const LABELS_FILE = process.env.AGENTD_LABELS_FILE || join(STATE_DIR, 'session-labels.json');

/** One log file per run, so output can be tailed externally while it streams. */
export const RUNS_DIR = process.env.AGENTD_RUNS_DIR || join(RUNTIME_DIR, 'runs');

/**
 * The CLIs, as the rest of the daemon sees them. Everything that is specific to one CLI lives in its driver
 * (packages/drivers); this only adds where each is found on this machine (pool/install.mjs) and the configured
 * start directory. `cmd`, `args` and `env` are worked out when read, from what is installed now.
 */
function specFor(driver) {
  const launch = () => driver.launch(currentInstall(), { agentdRoot: ROOT });
  return {
    type: driver.type,
    label: driver.label,
    description: driver.description,
    driver,
    launch,
    get cmd() {
      return launch().cmd;
    },
    get args() {
      return launch().args;
    },
    get env() {
      return launch().env;
    },
    envFn: driver.envFn,
    defaultCwd: process.env[`AGENTD_CWD_${driver.type.toUpperCase()}`] || null,
  };
}

export const AGENTS = Object.fromEntries(driverTypes.map((t) => [t, specFor(getDriver(t))]));

/** The driver of a CLI type, or null. */
export const driverOf = getDriver;

/** A prompt is cancelled when the agent is silent this long (tool calls in progress do not count as silence). */
export const IDLE_RUN_MS = 300_000;
/** Hard ceiling for one prompt, however active the agent is. */
export const MAX_RUN_MS = Number(process.env.AGENTD_MAX_RUN_MS) || 2 * 60 * 60_000;
/** How long a cancelled prompt gets to wrap up before it is abandoned. */
export const CANCEL_GRACE_MS = Number(process.env.AGENTD_CANCEL_GRACE_MS) || 15_000;

export const log = (...a) => process.stderr.write(`[agent-pool] ${a.join(' ')}\n`);

export const DEFAULT_AGENT = process.env.AGENTD_DEFAULT_AGENT || 'mcode';

/**
 * Optional per-agent startup configuration, from `agentd.config.json` (see core/app-config.mjs).
 *
 *   { "agents": { "mcode": { "cwd": "D:/work/project-a" },
 *                 "dsh":   { "cwd": "D:/work/project-b" } } }
 *
 * Precedence: explicit cwd on the request > AGENTD_CWD_<AGENT> env > this file >
 * the agent's built-in default > BASE_CWD.
 */
export { CONFIG };

(function applyConfig() {
  const cfg = CONFIG;
  for (const [name, spec] of Object.entries(AGENTS)) {
    spec.type = name;
    const fromEnv = process.env[`AGENTD_CWD_${name.toUpperCase()}`];
    const fromFile = cfg?.agents?.[name]?.cwd;
    spec.defaultCwd = fromEnv || fromFile || spec.defaultCwd || null;
    if (spec.defaultCwd) {
      // A configured workspace that does not exist yet would fail session/new.
      try {
        mkdirSync(spec.defaultCwd, { recursive: true });
      } catch (err) {
        log(`could not create cwd for ${name}:`, err.message);
      }
    }
  }
})();

/**
 * An executor whose process had to be killed this many times within the window is marked unstable and gets no
 * more work until a person recovers it. `limits.forcedStopLimit` / `limits.forcedStopWindowMin` in agentd.config.json.
 */
export const FORCED_STOP_LIMIT = Number(CONFIG?.limits?.forcedStopLimit) || 3;
export const FORCED_STOP_WINDOW_MS = (Number(CONFIG?.limits?.forcedStopWindowMin) || 30) * 60_000;

/** Compare directories regardless of slash style, case and trailing slash. */
export function normPath(p) {
  return String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

export function flattenOptions(opts = []) {
  return opts.flatMap((o) =>
    Array.isArray(o.options) ? flattenOptions(o.options) : [{ value: o.value, name: o.name, description: o.description }],
  );
}
