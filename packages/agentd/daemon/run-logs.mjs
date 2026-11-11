/**
 * Clears the run logs nobody will read again: the log of every run is in its project's folder
 * (data/projects/<id>/runs/), and the daemon only reads the last thirty runs of an executor, which are recent.
 *
 * Importing this file does it, once, when the daemon starts.
 */

import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { projectDir, projectIdsOnDisk } from '../core/base/index.mjs';

/** Run logs older than this are deleted. */
export const RUN_LOG_KEEP_MS = 14 * 24 * 3600 * 1000;

/** Delete run logs older than `keepMs` in one folder. @returns {number} how many */
export function pruneRunLogs(runsDir, keepMs = RUN_LOG_KEEP_MS, now = Date.now()) {
  let removed = 0;
  let names = [];
  try {
    names = readdirSync(runsDir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!name.endsWith('.log')) continue;
    const file = join(runsDir, name);
    try {
      if (now - statSync(file).mtimeMs > keepMs) {
        unlinkSync(file);
        removed++;
      }
    } catch {
      /* gone, or in use: leave it */
    }
  }
  return removed;
}

/** The same for every project. */
export function pruneAllRunLogs(keepMs = RUN_LOG_KEEP_MS, now = Date.now()) {
  return projectIdsOnDisk().reduce((sum, id) => sum + pruneRunLogs(join(projectDir(id), 'runs'), keepMs, now), 0);
}

const pruned = pruneAllRunLogs();
if (pruned) process.stderr.write(`[agentd] removed ${pruned} run logs older than 14 days\n`);
