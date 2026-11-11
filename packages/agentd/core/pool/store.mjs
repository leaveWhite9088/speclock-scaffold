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

/** Write the store of the project an executor belongs to (given its name), or of every project read so far. */
export function saveStore(name = null) {
  for (const project of name ? [projectIdOf(name)] : [...stores.keys()]) {
    try {
      mkdirSync(projectDir(project), { recursive: true });
      writeFileSync(fileOf(project), JSON.stringify(storeOf(project), null, 2));
    } catch (err) {
      log('failed to save labels:', err.message);
    }
  }
}

/** The project is gone: forget what was read of it (its folder is removed by the caller). */
export function forgetProject(project) {
  stores.delete(project);
}

export function entry(agent, sessionId) {
  const store = storeOf(projectIdOf(agent));
  store[agent] ??= {};
  store[agent][sessionId] ??= {};
  return store[agent][sessionId];
}

export function noteSession(agent, sessionId, patch) {
  if (!sessionId) return;
  Object.assign(entry(agent, sessionId), patch);
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
