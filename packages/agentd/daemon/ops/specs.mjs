/**
 * Operations on the SpecLock Core service as agentd sees it: is it there. What an executor does with it (its role and key)
 * is part of the project operations, because a role is something an executor is created or edited with.
 */

import * as specs from '../../core/specs/index.mjs';

/** @param {{ protocol: number, startedAt: string, idleInstanceMs: number }} ctx */
export function specOps(ctx) {
  return {
    /** Installed, set up, running, version: never starts anything. With `project`, also that project's id inside Core. */
    'specs.status': async ({ project } = {}) => ({ ...(await specs.status()), coreProjectId: project ? specs.coreProjectId(project) : null }),
  };
}
