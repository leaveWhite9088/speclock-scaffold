/**
 * The data directory used to be one flat folder. This moves what an older daemon left there into the folders it is sorted
 * into now (see core/data-dir.mjs), and clears the run logs nobody will read again.
 *
 * Importing this file does the move, so `agentd.mjs` imports it before anything else: modules that read their files when
 * they load must find them in the new place. Nothing is overwritten: when both places hold a file, the old one stays
 * where it is and the daemon says so. A move that fails (a file is still held open by a daemon that is running) stops the
 * start with the reason, because a daemon that started on empty files would carry on as if it had lost everything.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../core/data-dir.mjs';

/** [name in the old flat folder, folder it belongs in now, name it gets there (default: the same)] */
export const MOVES = [
  ['projects.json', 'state'],
  ['instances.json', 'state'],
  ['tasks.json', 'state'],
  ['session-labels.json', 'state'],
  ['journal.jsonl', 'state'],
  ['journal.jsonl.interrupted.json', 'state'],
  ['receipts.jsonl', 'state'],
  ['transcripts', 'conversations'],
  ['dispatcher-sessions', 'conversations'],
  ['pi-sessions', 'conversations'],
  ['handoffs', 'outputs'],
  ['rules', 'outputs'],
  ['results', 'outputs'],
  ['runs', 'runtime'],
  // The client opens the new log before the daemon starts, so the old one cannot take its name.
  ['agentd.log', 'runtime', 'agentd.before-sorting.log'],
];

/** Run logs older than this are deleted; the last thirty runs are what the daemon still reads, and those are recent. */
export const RUN_LOG_KEEP_MS = 14 * 24 * 3600 * 1000;

/** @returns {{ moved: string[], kept: string[] }} what was moved, and what was left because the new place was taken */
export function migrateDataLayout(root = DATA_DIR) {
  const moved = [];
  const kept = [];
  for (const [name, folder, newName = name] of MOVES) {
    const from = join(root, name);
    if (!existsSync(from)) continue;
    const to = join(root, folder, newName);
    if (existsSync(to)) {
      kept.push(name);
      continue;
    }
    mkdirSync(join(root, folder), { recursive: true });
    try {
      renameSync(from, to);
    } catch (err) {
      throw new Error(`cannot move ${from} to ${to} (${err.code ?? err.message}); is an older daemon still running? Stop it and start again`);
    }
    moved.push(name);
  }
  // An empty folder an older version made for probing a CLI; the same folder now lives under runtime/.
  try {
    rmdirSync(join(root, 'probe'));
  } catch {
    /* not there, or not empty */
  }
  return { moved, kept };
}

/** Delete run logs older than `keepMs`. @returns {number} how many */
export function pruneRunLogs(runsDir = join(DATA_DIR, 'runtime', 'runs'), keepMs = RUN_LOG_KEEP_MS, now = Date.now()) {
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

const { moved, kept } = migrateDataLayout();
if (moved.length) process.stderr.write(`[agentd] data directory sorted into folders: moved ${moved.join(', ')}\n`);
if (kept.length) process.stderr.write(`[agentd] data directory: ${kept.join(', ')} exist both in the old place and the new one; the new one is used, the old one was left\n`);
const pruned = pruneRunLogs();
if (pruned) process.stderr.write(`[agentd] removed ${pruned} run logs older than 14 days\n`);
