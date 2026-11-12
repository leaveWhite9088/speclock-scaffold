/**
 * Operations on the executors: the pool (listing, creating in a project), a single executor (sessions, models, start,
 * cancel, recover, tail) and what it has said (the transcript).
 */

import { AGENTS, getAgent, listInstances, pool } from '../../core/pool/index.mjs';
import { readTranscript } from '../../core/records/index.mjs';
import * as projects from '../../core/projects/index.mjs';
import { wireAgent } from '../dispatchers.mjs';
import { allocEvent, publish } from '../events.mjs';
import { viewRows } from '../guard.mjs';
import { withInterrupted } from '../startup.mjs';

/** @param {{ protocol: number, startedAt: string, idleInstanceMs: number }} ctx */
const inUse = (a) => a.inUse;

export function executorOps(ctx) {
  return {
    /** Every executor in the pool (all of them belong to a project). */
    agents: ({ project, short } = {}) => ({
      agents: viewRows([...pool.entries()].map(([name, a]) => ({
        name,
        project: a.project,
        shortId: a.shortId,
        role: a.role,
        type: a.type,
        label: a.spec.label,
        description: a.spec.description,
        cwd: a.spec.defaultCwd ?? null,
        alive: Boolean(a.child),
        spawns: a.spawnCount,
        sessionId: a.sessionId,
        busy: a.busy,
      })), project, short),
    }),

    instances: ({ project, short } = {}) => ({
      // `spec`: the role in the spec library (the dispatcher's roster shows it), kept apart from `role`, which is what the executor is for.
      instances: viewRows(withInterrupted(listInstances()).map((r) => ({ ...r, spec: r.project ? (projects.specOf(r.project, r.shortId)?.role ?? null) : null })), project, short),
      types: Object.keys(AGENTS),
    }),

    /** Add an executor to a project; its directory is relative to the project root. Without a project there is nothing to add it to. */
    'instance.create': ({ id, type, cwd, dir, role, project }) => {
      if (!project) throw new Error('a project is required: executors belong to a project (project.addInstance)');
      const r = projects.addInstance(project, { id, type, dir: dir ?? cwd ?? '.', role });
      wireAgent(pool.get(r.key));
      return { id: r.id, type: r.type, cwd: r.cwd, key: r.key, role: r.role };
    },

    /**
     * Conversation record of one session, as agentd saw it. Without sessionId it
     * reads the instance's active session. Cursor: pass the last seq as `afterSeq`.
     */

    transcript: ({ agent, sessionId, afterSeq, limit, tail }) => {
      const a = getAgent(agent);
      const sid = sessionId || a.sessionId;
      if (!sid) throw new Error(`${a.name} has no active session; pass sessionId`);
      return readTranscript(a.name, sid, { afterSeq, limit, tail });
    },

    status: ({ agent }) => getAgent(agent).status(),

    // Not in line behind the running task: listing only reads, and a person (or the dispatcher) must be able to see
    // the conversations while one is working. While it works the CLI is asked with a short deadline and the rest comes from what agentd knows.
    sessions: async ({ agent }) => getAgent(agent).listSessions(),

    /** Start the process now (manual retry after a failed start). */
    start: async ({ agent }) => {
      const a = getAgent(agent);
      await a.serialized(() => a.ensureReady());
      return a.status();
    },

    // Switching or opening a conversation has to happen between runs. While the executor is working it is put in line
    // (so the next run, which queues after it, lands in the right conversation) and the caller is not kept waiting for
    // the whole run: the dispatcher would otherwise hang on the tool call until the executor finished.
    use: async ({ agent, sessionId, cwd }) => {
      const a = getAgent(agent);
      if (!inUse(a)) return a.useSession(sessionId, cwd);
      a.useSession(sessionId, cwd).catch((err) => process.stderr.write(`[${a.name}] queued switch to ${sessionId} failed: ${err.message}
`));
      return { agent: a.name, sessionId, queued: true };
    },

    new: async ({ agent, cwd, label }) => {
      const a = getAgent(agent);
      const make = async () => {
        const sessionId = await a.newSession(cwd);
        if (label) a.renameSession(sessionId, label);
        return sessionId;
      };
      if (!inUse(a)) return { agent: a.name, sessionId: await make(), cwd: a.cwd, label: label ?? null };
      make().catch((err) => process.stderr.write(`[${a.name}] queued new conversation failed: ${err.message}
`));
      return { agent: a.name, queued: true, label: label ?? null };
    },

    deleteSession: ({ agent, sessionId }) => getAgent(agent).deleteSession(sessionId),

    rename: ({ agent, sessionId, label }) => getAgent(agent).renameSession(sessionId, label),

    models: async ({ agent, sessionId }) => getAgent(agent).describeModels(sessionId),

    setModel: async ({ agent, value, configId, sessionId }) => {
      const a = getAgent(agent);
      return a.setConfigOption(configId || 'model', value, sessionId);
    },

    /**
     * Blocking run unless `async` is set. In async mode the caller gets the jobId
     * immediately and should `subscribe` to stream progress.
     */

    tail: ({ agent, jobId }) => getAgent(agent).tail(jobId),

    wait: ({ agent, jobId }) => getAgent(agent).tail(jobId),

    /** With a `jobId`: that run only (waiting or running); without: whatever the executor is running now. */
    cancel: ({ agent, jobId }) => getAgent(agent).cancel(jobId),

    /** A person has looked at an executor marked unstable: let it take work again. */
    'agent.recover': ({ agent }) => {
      const r = getAgent(agent).recover();
      publish(allocEvent('agent.recovered', { agent }));
      return r;
    },
  };
}
