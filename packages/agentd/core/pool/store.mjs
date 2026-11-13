/**
 * Per-session sidecar data (labels, cwd, model choice, context, compaction counts). Agents have no rename API.
 * One file per project: projects/<project>/session-labels.json, holding the executors of that project.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectDir, projectIdOf } from '../base/index.mjs';
import { log } from './config.mjs';

const fileOf = (project) => join(projectDir(project), 'session-labels.json');

/** project -> { executor name -> { sessionId -> {label?, cwd?, updatedAt?, note?, ...} } }, read when first needed */
const stores = new Map();

function storeOf(project) {
  let store = stores.get(project);
  if (store) return store;
  store = {};
  try {
    if (existsSync(fileOf(project))) store = JSON.parse(readFileSync(fileOf(project), 'utf8')) ?? {};
  } catch (err) {
    log(`labels file of project "${project}" unreadable, starting empty:`, err.message);
    store = {};
  }
  stores.set(project, store);
  return store;
}

/** Projects whose store changed and is not written yet, and the timer that will write them. */
const dirty = new Set();
let timer = null;
/** How long changes are gathered before the file is written: a figure that changes with every message must not rewrite the file each time. */
const SAVE_DELAY_MS = 500;

function writeProject(project) {
  try {
    mkdirSync(projectDir(project), { recursive: true });
    writeFileSync(fileOf(project), JSON.stringify(storeOf(project), null, 2));
  } catch (err) {
    log('failed to save labels:', err.message);
  }
}

/** Write what changed now (at once, for a caller that is about to exit or to read the file). */
export function flushStore() {
  clearTimeout(timer);
  timer = null;
  for (const project of [...dirty]) {
    dirty.delete(project);
    writeProject(project);
  }
}
process.on('exit', flushStore);

/**
 * Write the store of the project an executor belongs to (given its name), or of every project read so far. Not at once: the
 * file holds every conversation of every executor of the project and is written whole, on the daemon's one thread, so changes
 * that come close together go out as one write.
 */
export function saveStore(name = null) {
  for (const project of name ? [projectIdOf(name)] : [...stores.keys()]) dirty.add(project);
  if (timer || !dirty.size) return;
  timer = setTimeout(flushStore, SAVE_DELAY_MS);
  timer.unref?.();
}

/** The project is gone: forget what was read of it (its folder is removed by the caller). */
export function forgetProject(project) {
  dirty.delete(project);
  stores.delete(project);
}

export function entry(agent, sessionId) {
  const store = storeOf(projectIdOf(agent));
  store[agent] ??= {};
  store[agent][sessionId] ??= {};
  return store[agent][sessionId];
}

const same = (a, b) => a === b || (a && b && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));

export function noteSession(agent, sessionId, patch) {
  if (!sessionId) return;
  const e = entry(agent, sessionId);
  // nothing to write when it says what the record already says (a usage figure repeats between messages)
  if (Object.entries(patch).every(([k, v]) => same(e[k], v))) return;
  Object.assign(e, patch);
  saveStore(agent);
}

/** Fill in sessions that finished a run before context figures were kept, from their receipts. */
export function seedContexts(receipts) {
  const changed = new Set();
  for (const r of [...receipts].reverse()) {
    const c = r?.context;
    if (!r?.agent || !r?.sessionId || c?.percent == null) continue;
    const e = entry(r.agent, r.sessionId);
    if (!e.context) {
      e.context = { used: c.used ?? null, size: c.size ?? null, percent: c.percent };
      changed.add(r.agent);
    }
  }
  for (const agent of changed) saveStore(agent);
}

/** Read-only views, so callers never hold the mutable map. */
export const saved = (agent, sessionId) => storeOf(projectIdOf(agent))[agent]?.[sessionId];
export const savedAll = (agent) => storeOf(projectIdOf(agent))[agent] ?? {};
