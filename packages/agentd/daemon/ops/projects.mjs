/**
 * Operations on projects, the executors configured in them, and the executor templates.
 */

import { join } from 'node:path';
import { MAX_PROCESSES, aliveCount, pool } from '../../core/pool/index.mjs';
import { projectPath } from '../../core/base/index.mjs';
import { savedContext } from '../../core/dispatcher/index.mjs';
import * as projects from '../../core/projects/index.mjs';
import * as specs from '../../core/specs/index.mjs';
import { getTemplate, listTemplates, removeTemplate, saveTemplate } from '../../core/prompts/index.mjs';
import { dispatchers, wireAgent } from '../dispatchers.mjs';
import { withInterrupted } from '../startup.mjs';

/** Refuse while something of the project runs (unless forced), then stop its dispatcher. */
async function stopProjectProcesses(project, force) {
  const d = dispatchers.get(project);
  const busy = [
    ...projects.instancesOf(project).filter((a) => a.busy).map((a) => a.shortId),
    ...(d?.busy ? ['(dispatcher)'] : []),
  ];
  if (busy.length && !force) throw new Error(`still running: ${busy.join(', ')}`);
  if (d?.busy) await d.abort().catch(() => {});
  await d?.shutdown();
}

/** The dispatcher gets SpecLock Core once its project has a place there; a running one that started without it starts again (when it is not working). */
async function refreshDispatcher(project) {
  const d = dispatchers.get(project);
  if (d?.child && !d.busy && !d.startedWithMcp && specs.dispatcherServer(project)) await d.restart();
}

/** @param {{ protocol: number, startedAt: string, idleInstanceMs: number }} ctx */
export function projectOps(ctx) {
  return {
    'project.dirs': ({ project }) => projects.listDirs(project),

    projects: () => ({
      projects: projects.listProjects().map((p) => ({
        ...p,
        instances: withInterrupted(p.instances, (i) => i.key),
        dispatcher: { provider: projects.dispatcherProvider(p.id), alive: Boolean(dispatchers.get(p.id)?.child), busy: Boolean(dispatchers.get(p.id)?.busy), compactAt: projects.dispatcherCompactAt(p.id), compactions: dispatchers.get(p.id)?.compactions() ?? 0, queued: (dispatchers.get(p.id)?.queue ?? []).map((m) => m.slice(0, 300)), context: (dispatchers.get(p.id)?.child ? dispatchers.get(p.id)?.context : null) ?? savedContext(projectPath(p.id, 'dispatcher-sessions')) },
      })),
      limits: { maxProcesses: MAX_PROCESSES, alive: aliveCount(), idleMinutes: ctx.idleInstanceMs / 60_000 },
    }),

    /** The size at which the project's dispatcher compacts its conversation (null: never). */
    'project.updateDispatcher': async ({ project, compactAt, provider }) => {
      const d = dispatchers.get(project);
      const out = { project };
      if (compactAt !== undefined) {
        out.compactAt = projects.setDispatcherCompactAt(project, compactAt);
        if (d) d.compactAt = out.compactAt;
      }
      if (provider !== undefined) {
        const next = projects.checkDispatcherProvider(provider); // a bad choice is refused whatever the dispatcher is doing
        if (d?.busy) throw new Error('the dispatcher is working on a prompt; abort it first');
        out.provider = projects.setDispatcherProvider(project, next);
        // a running pi keeps the models it started with: start it again so the next turn uses the new provider
        if (d?.child) await d.restart();
      }
      return out;
    },

    'project.create': (args) => {
      const p = projects.createProject(args);
      for (const a of projects.instancesOf(p.id)) wireAgent(a);
      return p;
    },

    /** `spec`: the role in SpecLock Core (requirements, executor, tester, scanner), or none. It gets a key bound to the project. */
    'project.addInstance': async ({ project, id, type, dir, role, model, effort, sessionId, compactAt, template, mcpServers, provider, spec }) => {
      // The request decides ('none' for no role); when it says nothing, the template's suggestion applies.
      const picked = specs.roleOf(spec !== undefined ? spec : template ? getTemplate(template)?.spec : null); // a bad role is refused before anything is made
      let r = projects.addInstance(project, { id, type, dir, role, model, effort, sessionId, compactAt, template, mcpServers, provider });
      if (picked) {
        let issued = null;
        try {
          issued = await specs.issueExecutorKey({ project, projectName: projects.projectName(project), executor: id, role: picked });
          r = await projects.updateInstance(project, id, { spec: issued });
          await refreshDispatcher(project);
        } catch (err) {
          if (issued) await specs.revokeKey(issued.keyId).catch(() => {});
          await projects.removeInstance(project, id, { force: true }).catch(() => {}); // all or nothing
          throw err;
        }
      }
      wireAgent(pool.get(r.key));
      return r;
    },

    /** Models a CLI type offers (cached per type). */
    /** The reasoning levels of one model of a CLI (which levels there are depends on the model). */
    'project.effort': ({ type, model, refresh, provider }) => projects.probeEffort(type, model, { refresh: refresh === true, provider: provider ?? null }),

    'project.models': ({ type, refresh }) => projects.probeModels(type, { refresh: refresh === true }),

    /** Existing sessions of a CLI type in a project directory, to pick from when creating an instance. */
    'project.sessions': ({ project, type, dir }) => projects.probeSessions(project, type, dir),

    /** Edit an instance: role and preferred model. A running instance with a session switches model now. */
    'project.updateInstance': async ({ project, id, role, model, effort, name, dir, compactAt, template, mcpServers, provider, spec }) => {
      // The SpecLock role first: a new one means a new key, the old one is taken away (Core names key files by label, so the old goes before the new comes).
      let nextSpec;
      if (spec !== undefined) {
        const picked = specs.roleOf(spec);
        const now = projects.specOf(project, id);
        if ((now?.role ?? null) !== picked) {
          if (projects.instancesOf(project).find((a) => a.shortId === id)?.busy) throw new Error(`instance "${id}" is running a prompt; cancel it first`);
          if (now) await specs.revokeKey(now.keyId);
          try {
            nextSpec = picked ? await specs.issueExecutorKey({ project, projectName: projects.projectName(project), executor: id, role: picked }) : null;
          } catch (err) {
            await projects.updateInstance(project, id, { spec: null }); // the old key is gone: do not keep a role that has none
            throw err;
          }
        }
      }
      const r = await projects.updateInstance(project, id, { role, model, effort, name, dir, compactAt, template, mcpServers, provider, spec: nextSpec });
      if (nextSpec) await refreshDispatcher(project);
      const agent = pool.get(r.key);
      wireAgent(agent);
      if (model && agent.child && agent.sessionId && !agent.busy) {
        await agent.setConfigOption('model', model, agent.sessionId).catch(() => {});
      }
      return r;
    },

    'template.list': () => ({ templates: listTemplates().map((t) => ({ ...t, usedBy: projects.templateUsers(t.id) })) }),

    'template.save': (args) => {
      const t = saveTemplate(args);
      return { ...t, usedBy: projects.templateUsers(t.id) };
    },

    'template.remove': ({ id }) => {
      const users = projects.templateUsers(id);
      return { ...removeTemplate(id), usedBy: users };
    },

    'project.removeInstance': async ({ project, id, force }) => {
      const had = projects.specOf(project, id);
      const r = await projects.removeInstance(project, id, { force });
      if (had) await specs.revokeKey(had.keyId).catch((err) => process.stderr.write(`[specs] could not revoke the key of ${project}/${id}: ${err.message}\n`));
      return r;
    },

    /** Close a project: stop its processes. Configuration and sessions stay. */
    'project.stop': async ({ project, force }) => {
      await stopProjectProcesses(project, force);
      return projects.stopInstances(project, { force: true });
    },

    'project.remove': async ({ project, force }) => {
      await stopProjectProcesses(project, force);
      dispatchers.delete(project);
      const keys = projects.instancesOf(project).map((a) => projects.specOf(project, a.shortId)?.keyId).filter(Boolean);
      const r = await projects.removeProject(project, { force: true });
      // The project's executors lose their keys; the project itself stays in Core (a published spec cannot be deleted without a person's approval).
      for (const k of keys) await specs.revokeKey(k).catch((err) => process.stderr.write(`[specs] could not revoke a key of ${project}: ${err.message}\n`));
      return r;
    },
  };
}
