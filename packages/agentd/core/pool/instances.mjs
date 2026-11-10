/**
 * Instances. One is a resident process of a CLI type, pinned to one directory. Every instance belongs to a project
 * (core/projects.mjs creates them, keeps the list and puts them in the pool); nothing exists outside a project, and
 * nothing is created on its own when the daemon starts.
 */

import { AcpClient } from './acp-client.mjs';
import { canCompact, contextOf } from './compaction.mjs';
import { CONVERSATIONS_DIR } from '../data-dir.mjs';
import { AGENTS } from './config.mjs';
import { pool } from './registry.mjs';
import { saved } from './store.mjs';

export function buildInstance({ id, type, cwd, project = null, shortId = id, role = null, model = null, sessionId = null, onSession = null, compactAt = null, systemPrompt = null, mcpServers = [] }) {
  const base = AGENTS[type];
  if (!base) throw new Error(`unknown type "${type}"; available: ${Object.keys(AGENTS).join(', ')}`);
  if (!cwd || typeof cwd !== 'string') throw new Error('an instance needs a directory (cwd)');
  const spec = {
    ...base,
    type,
    model,
    sessionId,
    onSession,
    compactAt,
    systemPrompt,
    // MCP servers handed to the CLI whenever a session starts or resumes (see pool/mcp.mjs). A list, or a function giving it.
    mcpServers,
    project,
    shortId,
    role,
    label: `${base.label} (${shortId})`,
    defaultCwd: cwd,
    // What the driver needs fixed for this instance (pi: its own session folder). The rest of the environment is worked out at each start.
    env: base.driver.instanceEnv?.({ id, conversationsDir: CONVERSATIONS_DIR }) ?? {},
  };
  return new AcpClient(id, spec);
}

/** One row per instance, for dashboards and the `instances` op. */
export function listInstances() {
  return [...pool.values()].map((a) => ({
    id: a.name,
    project: a.project,
    shortId: a.shortId,
    role: a.role,
    preferModel: a.preferModel,
    preferSession: a.preferSession,
    lastActive: a.lastActive,
    type: a.type,
    label: a.spec.label,
    cwd: a.spec.defaultCwd ?? null,
    alive: Boolean(a.child),
    busy: a.busy,
    /** What the running task is doing now, so a page opened mid-run can show it at once. */
    activity: a.run ? { startedAt: a.run.startedAt, tool: a.run.lastTool ?? null, toolCalls: a.run.toolCalls ?? 0, openTools: a.openTools.size, thinking: a.run.thoughtChars } : null,
    /** Prompts waiting behind the one that runs, so a page opened mid-run can tell which task is queued. */
    waiting: a.waitingJobs().length,
    /** The same prompts one by one, so each can be cancelled: [{ jobId, text, at }]. */
    waitingJobs: a.waitingJobs(),
    unstable: a.unstable,
    lastError: a.child ? null : (a.lastError ?? null),
    context: contextOf(a),
    compactAt: a.compactAt,
    canCompact: canCompact(a.type),
    compactions: saved(a.name, a.sessionId ?? a.preferSession)?.compactions ?? 0,
    sessionId: a.sessionId,
    model: a.currentModel(),
  }));
}
