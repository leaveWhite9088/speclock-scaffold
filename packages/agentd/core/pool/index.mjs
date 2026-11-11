/**
 * The executor pool: one resident ACP process per executor instance, the session registry (labels, model choice, live set),
 * run bookkeeping, metrics, compaction, MCP servers and providers. This file is the entry of core/pool: whatever is not
 * listed here is internal to the pool.
 */

export { checkEndpoint } from './endpoint.mjs';
export { canCompact, compactIfNeeded } from './compaction.mjs';
export { AGENTS, CONFIG, IDLE_RUN_MS, driverOf, flattenOptions } from './config.mjs';
export { nodeBin, piPaths } from './install.mjs';
export { buildInstance, listInstances } from './instances.mjs';
export { cleanMcpServers, describeMcpServers } from './mcp.mjs';
export { formatMetrics } from './metrics.mjs';
export { cleanInstanceProvider, getProvider, listProviders, providerClis, providerSupport, removeProvider, saveProvider, testProviderAll } from './providers.mjs';
export { MAX_PROCESSES, aliveCount, defaultModelFor, getAgent, pool } from './registry.mjs';
export { forgetProject, saved, seedContexts } from './store.mjs';
export { injectionFor } from './system-prompt.mjs';
