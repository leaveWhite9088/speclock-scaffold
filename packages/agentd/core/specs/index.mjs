/** SpecLock Core as agentd uses it: the service, and what an executor needs from it (a role, a key). Entry of core/specs; the rest is internal. */

export { CoreError } from './client.mjs';
export { ROLES, dispatcherServer, ensureProject, issueExecutorKey, projectAdmin, revokeKey, roleOf, status } from './provision.mjs';
export { ensureRunning, isSetUp, stop } from './service.mjs';
