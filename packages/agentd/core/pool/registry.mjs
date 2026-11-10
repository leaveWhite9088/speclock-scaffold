/** The pool of agent instances, plus the limits and locks that apply across them. */

import { CONFIG } from './config.mjs';

export const pool = new Map();

/** Upper bound on live agent processes, so many projects cannot exhaust memory. */
export const MAX_PROCESSES = Number(process.env.AGENTD_MAX_PROCESSES) || CONFIG?.limits?.maxProcesses || 12;

/** Model a type uses when an instance names none (agentd.config.json defaultModels). */
export function defaultModelFor(type) {
  return CONFIG?.defaultModels?.[type] ?? null;
}

export const START_ATTEMPTS = 3;
const startChains = new Map();

/** Run `fn` after the previous start of the same CLI type has finished. */
export function withStartLock(key, fn) {
  const prev = startChains.get(key) ?? Promise.resolve();
  const next = prev.then(fn);
  startChains.set(key, next.catch(() => {}));
  return next;
}

export function aliveCount(filter = () => true) {
  let n = 0;
  for (const a of pool.values()) if (a.child && filter(a)) n += 1;
  return n;
}

/** An executor by its pool key (`<project>~<id>`). There is no default one: nothing exists outside a project. */
export function getAgent(name) {
  if (!name) throw new Error('an executor is required (<project>~<id>); there is no default one');
  const agent = pool.get(name);
  if (!agent) throw new Error(`unknown agent "${name}"; available: ${[...pool.keys()].join(', ') || '(no executors yet: create a project and an executor first)'}`);
  return agent;
}
