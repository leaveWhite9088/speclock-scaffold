/** Stopping a child process for good. */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

function readPosixProcesses() {
  if (existsSync('/proc')) {
    const rows = [];
    try {
      for (const entry of readdirSync('/proc')) {
        if (!/^\d+$/.test(entry)) continue;
        try {
          const stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
          const rp = stat.lastIndexOf(')');
          if (rp === -1) continue;
          const fields = stat.slice(rp + 2).trim().split(/\s+/);
          const pid = Number(entry);
          const ppid = Number(fields[1]);
          const pgid = Number(fields[2]);
          if (pid > 0 && Number.isFinite(ppid)) rows.push({ pid, ppid, pgid });
        } catch {
          /* process exited while scanning */
        }
      }
      if (rows.length > 0) return rows;
    } catch {
      /* fall back to ps */
    }
  }
  try {
    const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,pgid='], { encoding: 'utf8', timeout: 2000 });
    if (r.status === 0 && r.stdout) {
      return r.stdout
        .split('\n')
        .map((line) => line.trim().split(/\s+/).map(Number))
        .filter(([pid, ppid]) => pid > 0 && Number.isFinite(ppid))
        .map(([pid, ppid, pgid]) => ({ pid, ppid, pgid }));
    }
  } catch {
    /* ignore */
  }
  return [];
}

function killPosixTree(pid, child) {
  const self = process.pid;
  try {
    process.kill(pid, 'SIGSTOP');
  } catch {
    /* already gone */
  }
  const rows = readPosixProcesses();
  const targets = new Set([pid]);
  const groups = new Set();
  for (const row of rows) {
    if (row.pid === pid && row.pgid === pid && pid > 1 && pid !== self) groups.add(pid);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (row.pid <= 1 || row.pid === self || targets.has(row.pid)) continue;
      if (targets.has(row.ppid) || (row.pgid > 1 && groups.has(row.pgid))) {
        targets.add(row.pid);
        if (row.pid === row.pgid) groups.add(row.pgid);
        try {
          process.kill(row.pid, 'SIGSTOP');
        } catch {
          /* already gone */
        }
        changed = true;
      }
    }
  }
  for (const g of groups) {
    try {
      process.kill(-g, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  for (const p of [...targets].reverse()) {
    try {
      process.kill(p, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    /* already gone */
  }
}

/**
 * Kill a child and everything it started. `child.kill()` alone ends only the direct child on both Windows and POSIX,
 * and most of the CLIs here are an adapter that starts the real CLI, which starts its tools: a hung build or detached
 * subprocess would otherwise survive its parent.
 */
export function killTree(child) {
  const pid = child?.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      const k = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      k.on('error', () => child.kill());
      return;
    } catch {
      /* fall through */
    }
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    return;
  }
  killPosixTree(pid, child);
}
