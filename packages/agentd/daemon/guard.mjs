/**
 * Who may ask for what. Requests from a project's dispatcher carry `project` and `caller: "dispatcher"`; this file
 * decides which ops they may use and resolves the names they give inside their own project.
 */

import * as projects from '../core/projects/index.mjs';

/**
 * Requests from a project's dispatcher carry `project`. Everything it names is
 * resolved inside that project, and a name that already points elsewhere is refused.
 */
export const AGENT_ARG_OPS = new Set([
  'status', 'sessions', 'use', 'new', 'rename', 'models', 'setModel', 'run', 'tail', 'wait', 'cancel', 'transcript',
]);

/**
 * What a project's dispatcher may not do. It may start, name and switch the conversations of its executors (`new`,
 * `rename`, `use`: one conversation per block of work), but deleting one, resetting one through `run` and changing
 * an executor's directory stay with a person. Replacing a conversation because its context drifted is the confirmed
 * handoff, which runs inside agentd and never goes through these ops.
 */
export const DISPATCHER_DENIED = new Set(['deleteSession', 'agent.recover', 'project.updateDispatcher', 'project.updateInstance', 'project.addInstance', 'project.create', 'provider.list', 'provider.save', 'provider.remove', 'provider.test', 'provider.discover', 'template.save', 'template.remove', 'daemon.shutdown', 'handoff.generate', 'handoff.apply', 'handoff.cancel']);
function checkCaller(op, args) {
  if (args?.caller !== 'dispatcher') return;
  const sessionArgs = op === 'run' && (args.reset || args.sessionId || args.cwd);
  if (DISPATCHER_DENIED.has(op) || sessionArgs) {
    throw new Error(`the dispatcher cannot do "${op}": deleting or resetting sessions and changing an executor's directory are done by a person. Send the task with agent_run, or ask the user.`);
  }
}

export function scopeArgs(op, args) {
  checkCaller(op, args);
  const project = args?.project;
  if (!project || !AGENT_ARG_OPS.has(op)) return args;
  if (!projects.hasProject(project)) throw new Error(`unknown project "${project}"`);
  const agent = args.agent;
  if (!agent) throw new Error('agent is required inside a project');
  if (String(agent).includes(projects.SEP)) throw new Error(`agent "${agent}" is outside project "${project}"`);
  const scoped = { ...args, agent: `${project}${projects.SEP}${agent}` };
  // A directory the dispatcher names must stay inside the project root.
  if (args.cwd) scoped.cwd = projects.resolveInside(projects.projectRoot(project), args.cwd);
  return scoped;
}

/** Rows of one project, with short names when the caller is that project's dispatcher. */
export function viewRows(rows, project, short) {
  const mine = rows.filter((r) => (project ? r.project === project : true));
  if (!short) return mine;
  return mine.map((r) => ({ ...r, key: r.id ?? r.name, ...(r.id ? { id: r.shortId } : { name: r.shortId }) }));
}
