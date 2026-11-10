/**
 * Installing the verified versions. Optional, and never on its own: `plan` only says what would run, `run` runs it, and
 * the CLI calls `run` only when the person passed --yes. It installs into the scaffold's own folder, never globally,
 * so nothing a person installed themselves is replaced.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

/**
 * What to install: the packages that are missing, and with `pin` also those found at another version. Optionally only
 * those some of `types` need.
 */
export function installPlan({ detected, prefix, types = null, pin = false }) {
  const wanted = Object.values(detected).filter((d) => {
    if (types && !d.types.some((t) => types.includes(t))) return false;
    return d.status === 'missing' || (pin && d.status !== 'ok');
  });
  const specs = wanted.map((d) => `${d.name}@${d.wanted}`);
  return {
    prefix,
    packages: wanted.map((d) => ({ name: d.name, version: d.wanted, status: d.status })),
    command: specs.length ? { cmd: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['install', '--prefix', prefix, '--no-audit', '--no-fund', ...specs] } : null,
  };
}

/**
 * One command line for cmd.exe: `npm.cmd` can only be started through a shell on Windows, and a shell splits on spaces,
 * so a prefix like "C:/Users/Some One/tools" would turn into two arguments (npm then took the second half for a GitHub
 * repository). Every argument is quoted.
 */
export function windowsCommandLine({ cmd, args }) {
  const q = (a) => (/^[A-Za-z0-9_@./:\\=+-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '\\"')}"`);
  return [cmd, ...args].map(q).join(' ');
}

/** Run the plan. Returns the exit status of npm (0 when there was nothing to do). */
export function runInstall(plan, { spawn = spawnSync, platform = process.platform } = {}) {
  if (!plan.command) return 0;
  mkdirSync(plan.prefix, { recursive: true });
  const r =
    platform === 'win32'
      ? spawn(windowsCommandLine(plan.command), [], { stdio: 'inherit', shell: true, windowsHide: true })
      : spawn(plan.command.cmd, plan.command.args, { stdio: 'inherit', windowsHide: true });
  return r.status ?? 1;
}
