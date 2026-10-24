/**
 * Where agentd keeps its data (projects, receipts, transcripts, journal, rules files…). `AGENTD_DATA_DIR` moves all of it
 * somewhere else, which is how a second, private daemon (for tests) runs next to the one a person is using without
 * touching its files. It has no dependencies, so every part can import it.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** packages/agentd */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const DATA_DIR = process.env.AGENTD_DATA_DIR ? resolve(process.env.AGENTD_DATA_DIR) : join(ROOT, 'data');

/**
 * The data directory is sorted by what the files are for, so it is clear what may be deleted and what must be backed up:
 *   state/          what the system remembers (projects, executors, tasks, journal, receipts, session names): back it up
 *   conversations/  the words: executor transcripts, the dispatcher's and pi's own session files: back it up
 *   outputs/        documents agentd wrote for people and agents: handoff copies, long replies, the rules files handed to the CLIs
 *   runtime/        the daemon's log and the log of every run: safe to delete
 * `agentd.endpoint.json` stays at the top: it is how a client finds the daemon that is running.
 */
export const STATE_DIR = join(DATA_DIR, 'state');
export const CONVERSATIONS_DIR = join(DATA_DIR, 'conversations');
export const OUTPUTS_DIR = join(DATA_DIR, 'outputs');
export const RUNTIME_DIR = join(DATA_DIR, 'runtime');
