/** Constants, the CLI registry and `agentd.config.json`. Nothing here talks to a process. */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../base/index.mjs';
import { driverTypes, getDriver } from '@speclock-scaffold/drivers';
import { currentInstall, nodeBin } from './install.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** packages/agentd */
const ROOT = join(HERE, '..', '..');

export const NODE_BIN = nodeBin();

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
  };
}

export const AGENTS = Object.fromEntries(driverTypes.map((t) => [t, specFor(getDriver(t))]));

/** The driver of a CLI type, or null. */
export const driverOf = getDriver;

/** A prompt is cancelled when the agent is silent this long (tool calls in progress do not count as silence). */
export const IDLE_RUN_MS = 300_000;
/**
 * A tool call that has been open this long with the agent saying nothing else is taken as stuck (typically a dev server or a
 * watcher run in the foreground: it never ends, and the CLI waits for it for ever). The run is cancelled. Not counted as
 * silence before that, so a long build is left alone. `limits.stuckToolMin` in agentd.config.json, or AGENTD_STUCK_TOOL_MS.
 */
export const STUCK_TOOL_MS = Number(process.env.AGENTD_STUCK_TOOL_MS) || (Number(CONFIG?.limits?.stuckToolMin) > 0 ? Number(CONFIG.limits.stuckToolMin) * 60_000 : 600_000);
/** Hard ceiling for one prompt, however active the agent is. */
export const MAX_RUN_MS = Number(process.env.AGENTD_MAX_RUN_MS) || 2 * 60 * 60_000;
/** How long a cancelled prompt gets to wrap up before it is abandoned. */
export const CANCEL_GRACE_MS = Number(process.env.AGENTD_CANCEL_GRACE_MS) || 15_000;

export const log = (...a) => process.stderr.write(`[agent-pool] ${a.join(' ')}\n`);

/** `agentd.config.json` (see core/base/app-config.mjs). */
export { CONFIG };

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
