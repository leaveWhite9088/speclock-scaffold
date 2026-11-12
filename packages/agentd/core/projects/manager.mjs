/**
 * Projects: the configuration unit above instances.
 *
 * A project is a root directory, one dispatcher (a pi whose working directory is
 * that root) and a list of instances. Each instance is a process of one CLI type
 * pinned to a directory inside the root, with a `role` the dispatcher's LLM reads
 * when it chooses who does the work.
 *
 *   project "shop"  root D:/work/shop
 *     dsh-backend   dsh    ./server          "backend service"
 *     dsh-data      dsh    ./data-platform   "data platform"
 *     mcode-web     mcode  ./web             "front end"
 *
 * Instances belong to one project and are never shared. The pool key is
 * `<project>~<instance>`, so two projects can both have a `dsh-1`. Instances start
 * on first use and are stopped again when idle; their sessions stay on disk.
 *
 * The configuration lives in agentd's own data folder, one file per project (data/projects/<id>/project.json, next to
 * the rest of what belongs to the project). Nothing is written into the project: the rules for
 * the dispatcher and the executors are handed to each CLI as extra system instructions (rules.mjs), so the
 * project's own AGENTS.md / CLAUDE.md stay as they are.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLOBAL_DIR, PROJECT_SEP, projectDir, projectIdsOnDisk } from '../base/index.mjs';
import { forgetProject as forgetRecords } from '../records/index.mjs';
import { executorRulesFor, getTemplate } from '../prompts/index.mjs';
import { AGENTS, buildInstance, driverOf, cleanInstanceProvider, cleanMcpServers, defaultModelFor, describeMcpServers, effortOf, forgetProject as forgetSessions, listInstances, pool } from '../pool/index.mjs';

export const SEP = PROJECT_SEP;

/** data/projects/<id>/project.json */
const fileOf = (id) => join(projectDir(id), 'project.json');
const ID_RE = /^\p{L}[\p{L}\p{N}_-]{0,31}$/u;

const log = (...a) => process.stderr.write(`[projects] ${a.join(' ')}\n`);

/** @type {Array<{id: string, name: string, root: string, createdAt: string, instances: Array<{id: string, type: string, dir: string, role: string|null}>}>} */
let projects = [];

/**
 * The SpecLock server an executor is given is saved with the command that ran it when the key was made. Core can move (a copy
 * fetched later is used instead of one next to the repository), so the daemon sets a function that gives the current command
 * and it is applied each time the server list is read. By default the entry is used as saved.
 */
let specMcp = (entry) => entry;
export function setSpecMcpResolver(fn) {
  specMcp = typeof fn === 'function' ? fn : (entry) => entry;
}

const keyOf = (project, id) => `${project}${SEP}${id}`;

function save() {
  for (const p of projects) {
    const file = fileOf(p.id);
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(p, null, 2) + '\n', 'utf8');
    renameSync(tmp, file);
  }
}

function checkId(kind, id) {
  if (!ID_RE.test(String(id ?? ''))) {
    throw new Error(`${kind} name must start with a letter and use only letters, digits, "-" or "_" (max 32)`);
  }
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Resolve `dir` against `root` and refuse anything that leaves the root. */
export function resolveInside(root, dir) {
  const target = resolve(root, String(dir ?? '.') || '.');
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`directory "${dir}" is outside the project root`);
  }
  if (!isDir(target)) throw new Error(`directory does not exist: ${target}`);
  // A symlink inside the root must not lead out of it.
  const real = realpathSync(target);
  const realRoot = realpathSync(root);
  const rel2 = relative(realRoot, real);
  if (rel2.startsWith('..') || isAbsolute(rel2)) throw new Error(`directory "${dir}" resolves outside the project root`);
  return target;
}

/** Like resolveInside, but a missing directory (still inside the root) is created. */
export function ensureInside(root, dir) {
  const target = resolve(root, String(dir ?? '.') || '.');
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`directory "${dir}" is outside the project root`);
  if (!existsSync(target)) mkdirSync(target, { recursive: true });
  return resolveInside(root, dir);
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'target', '__pycache__']);

/** Existing sub-directories of the project root (two levels), as "./x/y", for the directory picker. */
export function listDirs(projectId) {
  const project = find(projectId);
  const out = [];
  const walk = (abs, rel, depth) => {
    let names = [];
    try {
      names = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of names) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const r = `${rel}/${e.name}`;
      out.push(r);
      if (depth > 1) walk(join(abs, e.name), r, depth - 1);
    }
  };
  walk(project.root, '.', 2);
  return { root: project.root, dirs: out.sort() };
}

function find(id) {
  const p = projects.find((x) => x.id === id);
  if (!p) throw new Error(`unknown project "${id}"`);
  return p;
}

function register(project, inst) {
  const key = keyOf(project.id, inst.id);
  if (pool.has(key)) return pool.get(key);
  const agent = buildInstance({
    id: key,
    type: inst.type,
    cwd: resolve(project.root, inst.dir || '.'),
    project: project.id,
    shortId: inst.id,
    role: inst.role ?? null,
    model: inst.model ?? null,
    effort: inst.effort ?? null,
    sessionId: inst.sessionId ?? null,
    compactAt: inst.compactAt ?? null,
    // A function, like the rules: an edit applies the next time a session starts or resumes.
    mcpServers: () => [...(inst.mcpServers ?? []), ...(inst.spec?.mcp ? [specMcp(inst.spec.mcp)] : [])],
    // Same for the provider: a change applies the next time the process starts.
    provider: () => inst.provider ?? null,
    // A function: the rules are read again whenever the agent starts, so an edited template applies at once.
    systemPrompt: () => executorRulesFor(inst.template, inst.spec?.role) || null,
    // The instance comes back to the session it last used, also after a daemon restart.
    onSession: (sid) => {
      inst.sessionId = sid;
      save();
    },
  });
  pool.set(key, agent);
  return agent;
}

// -- restore ----------------------------------------------------------------

(function restore() {
  for (const id of projectIdsOnDisk()) {
    try {
      if (!existsSync(fileOf(id))) continue;
      const p = JSON.parse(readFileSync(fileOf(id), 'utf8'));
      if (!p?.id || p.id !== id || !p.root) continue;
      p.instances = (p.instances ?? []).filter((i) => i?.id && AGENTS[i.type]);
      projects.push(p);
      for (const inst of p.instances) register(p, inst);
    } catch (err) {
      log(`project "${id}" unreadable, ignoring:`, err.message);
    }
  }
})();

// -- queries ----------------------------------------------------------------

export function projectRoot(id) {
  return find(id).root;
}

export function projectName(id) {
  return find(id).name;
}

export function hasProject(id) {
  return projects.some((p) => p.id === id);
}

/** Pool instances of one project. */
export function instancesOf(id) {
  return [...pool.values()].filter((a) => a.project === id);
}

export function listProjects() {
  return projects.map((p) => {
    const rows = listInstances().filter((r) => r.project === p.id);
    return {
      id: p.id,
      name: p.name,
      root: p.root,
      createdAt: p.createdAt,
      instances: rows.map((r) => ({
        ...r,
        id: r.shortId,
        key: r.id,
        dir: p.instances.find((i) => i.id === r.shortId)?.dir ?? '.',
        template: p.instances.find((i) => i.id === r.shortId)?.template ?? null,
        // Names and kinds only: an environment or a header can hold a key.
        mcp: describeMcpServers(p.instances.find((i) => i.id === r.shortId)?.mcpServers),
        // Which role it has in SpecLock Core (never the key or where it is kept).
        spec: p.instances.find((i) => i.id === r.shortId)?.spec?.role ?? null,
      })),
      alive: rows.filter((r) => r.alive).length,
      busy: rows.filter((r) => r.busy).length,
    };
  });
}

// -- changes ----------------------------------------------------------------

export function createProject({ id, name, root, instances = [] }) {
  checkId('project', id);
  if (projects.some((p) => p.id === id)) throw new Error(`project "${id}" already exists`);
  if (!root || typeof root !== 'string' || !isAbsolute(root)) throw new Error('root must be an absolute path');
  if (!isDir(root)) throw new Error(`root does not exist: ${root}`);

  const project = {
    id,
    name: String(name || id),
    root: resolve(root),
    createdAt: new Date().toISOString(),
    instances: [],
  };
  projects.push(project);
  try {
    for (const inst of instances) addInstance(id, inst, { persist: false });
    save();
  } catch (err) {
    // All or nothing: undo a half-built project.
    for (const a of instancesOf(id)) pool.delete(a.name);
    projects = projects.filter((p) => p.id !== id);
    rmSync(projectDir(id), { recursive: true, force: true });
    throw err;
  }
  return listProjects().find((p) => p.id === id);
}

/** A token count (or null for "never"). */
function cleanCompactAt(v) {
  if (v == null || v === '' || v === 0) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 10_000) throw new Error('compactAt must be a token count of at least 10000, or empty for never');
  return Math.round(n);
}

/** What an executor keeps of its place in SpecLock Core: `{ role, keyId, keyFile, mcp }` (the key is in Core's folder, not here). */
/** A reasoning level as the CLI names it ("high", "medium", …), or null for the CLI's own default. */
function cleanEffort(v) {
  const s = String(v ?? '').trim();
  return s && s !== 'default' ? s.slice(0, 40) : null;
}

function cleanSpec(v) {
  if (!v) return null;
  if (typeof v !== 'object' || typeof v.role !== 'string') throw new Error('spec must be { role, keyId, keyFile, mcp }');
  const [mcp] = cleanMcpServers([v.mcp]);
  return { role: v.role, keyId: v.keyId ?? null, keyFile: v.keyFile ?? null, mcp };
}

/** The SpecLock part an executor has now (to revoke its key when it goes or changes). */
export function specOf(projectId, id) {
  return find(projectId).instances.find((i) => i.id === id)?.spec ?? null;
}

export function addInstance(projectId, spec, { persist = true } = {}) {
  const project = find(projectId);
  // A template gives what the request leaves out.
  const tpl = spec.template ? getTemplate(spec.template) : null;
  if (spec.template && !tpl) throw new Error(`unknown template "${spec.template}"`);
  const id = spec.id;
  const type = spec.type || tpl?.type;
  const dir = spec.dir || tpl?.dir || '.';
  const role = spec.role || tpl?.role || null;
  const model = spec.model || tpl?.model || null;
  const effort = cleanEffort(spec.effort);
  const { sessionId = null, compactAt = null } = spec;
  const specRecord = cleanSpec(spec.spec);
  const mcpServers = cleanMcpServers(spec.mcpServers);
  checkId('instance', id);
  const provider = AGENTS[type] ? cleanInstanceProvider(spec.provider, type) : null;
  if (!AGENTS[type]) throw new Error(`unknown type "${type}"; available: ${Object.keys(AGENTS).join(', ')}`);
  if (project.instances.some((i) => i.id === id)) throw new Error(`instance "${id}" already exists in project "${projectId}"`);
  const abs = ensureInside(project.root, dir);

  const rel = relative(project.root, abs).replace(/\\/g, '/') || '.';
  const inst = {
    id,
    type,
    dir: rel,
    role: role ? String(role).slice(0, 500) : null,
    model: model ? String(model).slice(0, 200) : null,
    ...(effort ? { effort } : {}),
    // "new" (or nothing) means: start a fresh session on first use.
    sessionId: sessionId && sessionId !== 'new' ? String(sessionId).slice(0, 200) : null,
    compactAt: cleanCompactAt(compactAt),
    template: tpl?.id ?? null,
    ...(mcpServers.length ? { mcpServers } : {}),
    ...(provider ? { provider } : {}),
    ...(specRecord ? { spec: specRecord } : {}),
  };
  project.instances.push(inst);
  const agent = register(project, inst);
  if (persist) save();
  return { key: agent.name, id, type, dir: rel, cwd: abs, role: inst.role, model: inst.model, effort: inst.effort ?? null, sessionId: inst.sessionId, compactAt: inst.compactAt, template: inst.template, mcp: describeMcpServers(inst.mcpServers), provider: inst.provider ?? null, spec: inst.spec?.role ?? null };
}

/** Executors (in any project) made from a template: [{ project, id }]. */
export function templateUsers(templateId) {
  return projects.flatMap((p) => p.instances.filter((i) => i.template === templateId).map((i) => ({ project: p.id, id: i.id })));
}

// -- probes: what can I pick before the instance exists? -----------------------------

const PROBE_DIR = join(GLOBAL_DIR, 'probe');
const modelCache = new Map();

/** Models a CLI type offers. Needs a session, so it runs in a scratch directory, once per type. */
export async function probeModels(type, { refresh = false } = {}) {
  if (!AGENTS[type]) throw new Error(`unknown type "${type}"; available: ${Object.keys(AGENTS).join(', ')}`);
  if (modelCache.has(type) && !refresh) return modelCache.get(type);
  mkdirSync(PROBE_DIR, { recursive: true });
  const tmp = buildInstance({ id: `probe-${type}`, type, cwd: PROBE_DIR });
  try {
    const d = await tmp.describeModels();
    const opt = d.configOptions.find((o) => o.id === 'model');
    const out = {
      type,
      current: opt?.currentValue ?? null,
      default: defaultModelFor(type),
      models: (opt?.options ?? []).map((o) => ({ value: o.value, name: o.name ?? o.value })),
      // The CLI's own reasoning level, when it has one: { id, current, options: [{ value, name }] }
      effort: effortOf(d.configOptions),
    };
    modelCache.set(type, out);
    return out;
  } finally {
    await tmp.shutdown().catch(() => {});
  }
}

const effortCache = new Map();

/**
 * The reasoning levels a CLI offers for one model. Some CLIs (opencode, mcode) only show the option once a model that
 * reasons is the one in use, so the probe session is moved to that model first. Null when that model has none.
 */
export async function probeEffort(type, model, { refresh = false } = {}) {
  if (!AGENTS[type]) throw new Error(`unknown type "${type}"; available: ${Object.keys(AGENTS).join(', ')}`);
  const key = `${type}|${model ?? ''}`;
  if (effortCache.has(key) && !refresh) return effortCache.get(key);
  mkdirSync(PROBE_DIR, { recursive: true });
  const tmp = buildInstance({ id: `probe-${type}-e`, type, cwd: PROBE_DIR });
  try {
    if (model) await tmp.setConfigOption('model', model);
    const out = effortOf((await tmp.describeModels()).configOptions);
    effortCache.set(key, out);
    return out;
  } finally {
    await tmp.shutdown().catch(() => {});
  }
}

/** Sessions a CLI already has in `dir` of the project, for picking one when creating an instance. */
export async function probeSessions(projectId, type, dir = '.') {
  const project = find(projectId);
  if (!AGENTS[type]) throw new Error(`unknown type "${type}"; available: ${Object.keys(AGENTS).join(', ')}`);
  const abs = resolveInside(project.root, dir);
  const taken0 = new Set(project.instances.map((i) => i.sessionId).filter(Boolean));
  // Reading the CLI's own session folder takes milliseconds; starting the CLI takes seconds.
  const disk = driverOf(type)?.diskSessions?.(abs) ?? null;
  if (disk) return { sessions: disk.sessions.filter((x) => !taken0.has(x.sessionId)), remoteError: null };
  const tmp = buildInstance({ id: `probe-${type}-s`, type, cwd: abs });
  try {
    const r = await tmp.listSessions();
    // Sessions another instance of this project already owns are not offered twice.
    const taken = new Set(project.instances.map((i) => i.sessionId).filter(Boolean));
    return {
      sessions: r.sessions.filter((s) => s.source === 'agent' && !taken.has(s.sessionId)),
      remoteError: r.remoteError,
    };
  } finally {
    await tmp.shutdown().catch(() => {});
  }
}

/**
 * Edit an instance: role, preferred model, and (while idle) name. The CLI type and the directory are fixed.
 * A new name restarts the process under the new identity.
 */
/** The size (tokens) at which the project's dispatcher compacts its conversation; null: never. */
export function dispatcherCompactAt(projectId) {
  return find(projectId).dispatcherCompactAt ?? null;
}

/** The provider (kept on this device) the project's dispatcher starts with, `{ id, model }`; null: pi's own models. */
export function dispatcherProvider(projectId) {
  return find(projectId).dispatcherProvider ?? null;
}

/** Every project's dispatcher provider, for what must know where a provider is in use. */
export function dispatcherProviders() {
  return projects.filter((p) => p.dispatcherProvider).map((p) => ({ project: p.id, provider: p.dispatcherProvider }));
}

/** The choice checked: `{ id, model }` or null. */
export const checkDispatcherProvider = (value) => cleanInstanceProvider(value, 'pi');

export function setDispatcherProvider(projectId, value) {
  const project = find(projectId);
  const next = checkDispatcherProvider(value);
  if (next) project.dispatcherProvider = next;
  else delete project.dispatcherProvider;
  save();
  return next;
}

export function setDispatcherCompactAt(projectId, value) {
  const project = find(projectId);
  project.dispatcherCompactAt = cleanCompactAt(value);
  save();
  return project.dispatcherCompactAt;
}

export async function updateInstance(projectId, id, { role, model, effort, name, dir, compactAt, template, mcpServers, provider, spec }) {
  const project = find(projectId);
  const inst = project.instances.find((i) => i.id === id);
  if (!inst) throw new Error(`unknown instance "${id}" in project "${projectId}"`);
  let agent = pool.get(keyOf(projectId, id));
  const rename = name !== undefined && name !== id;
  if (dir !== undefined) {
    const next = relative(project.root, ensureInside(project.root, dir || '.')).split(sep).join('/') || '.';
    if (next !== inst.dir) throw new Error("an executor's directory cannot be changed after it is created; create a new executor in that directory instead");
  }
  if (rename) {
    checkId('instance', name);
    if (project.instances.some((i) => i.id === name)) throw new Error(`instance "${name}" already exists in project "${projectId}"`);
    if (agent.busy) throw new Error(`instance "${id}" is running a prompt; cancel it first`);
    await agent.shutdown();
    pool.delete(agent.name);
    inst.id = name;
    agent = register(project, inst);
    id = inst.id;
  }
  if (role !== undefined) {
    inst.role = role ? String(role).slice(0, 500) : null;
    agent.role = inst.role ?? agent.role;
  }
  if (template !== undefined) {
    // Takes effect the next time the process starts (or a new session begins).
    if (template && !getTemplate(template)) throw new Error(`unknown template "${template}"`);
    inst.template = template || null;
  }
  if (mcpServers !== undefined) {
    // For the CLIs that take them in the session request this applies to the next session or resume; pi, at its next start.
    const clean = cleanMcpServers(mcpServers);
    if (clean.length) inst.mcpServers = clean;
    else delete inst.mcpServers;
  }
  if (spec !== undefined) {
    // The key was issued (or taken away) by the caller; the server entry applies the next time a session starts, so a process that is idle stops now.
    const next = cleanSpec(spec);
    if (agent.busy) throw new Error(`instance "${id}" is running a prompt; cancel it first`);
    if (next) inst.spec = next;
    else delete inst.spec;
    if (agent.child) await agent.shutdown();
  }
  if (provider !== undefined) {
    // A process that is running keeps the endpoint it started with: stop it so the next use starts it with the new one.
    const next = cleanInstanceProvider(provider, inst.type);
    if (agent.busy) throw new Error(`instance "${id}" is running a prompt; cancel it first`);
    if (next) inst.provider = next;
    else delete inst.provider;
    if (agent.child) await agent.shutdown();
  }
  if (compactAt !== undefined) {
    inst.compactAt = cleanCompactAt(compactAt);
    agent.compactAt = inst.compactAt;
  }
  if (model !== undefined) {
    inst.model = model ? String(model).slice(0, 200) : null;
    await agent.chooseModel(inst.model);
  }
  if (effort !== undefined) {
    const next = cleanEffort(effort);
    if (next) inst.effort = next;
    else delete inst.effort;
    await agent.chooseEffort(next);
  }
  save();
  return { key: agent.name, id, role: inst.role, model: inst.model, effort: inst.effort ?? null, dir: inst.dir, compactAt: inst.compactAt, template: inst.template ?? null, provider: inst.provider ?? null, spec: inst.spec?.role ?? null };
}

function busyOf(agents) {
  return agents.filter((a) => a.busy).map((a) => a.shortId);
}

/** Stop the processes of every instance of a project. Configuration stays. */
export async function stopInstances(projectId, { force = false } = {}) {
  find(projectId);
  const agents = instancesOf(projectId);
  const busy = busyOf(agents);
  if (busy.length && !force) throw new Error(`running: ${busy.join(', ')}`);
  for (const a of agents) {
    if (a.busy) await Promise.resolve(a.cancel()).catch(() => {});
    await a.shutdown();
  }
  return { project: projectId, stopped: agents.filter((a) => !a.child).length, busy };
}

export async function removeInstance(projectId, id, { force = false } = {}) {
  const project = find(projectId);
  const agent = pool.get(keyOf(projectId, id));
  if (!agent || !project.instances.some((i) => i.id === id)) throw new Error(`unknown instance "${id}" in project "${projectId}"`);
  if (agent.busy && !force) throw new Error(`instance "${id}" is running a prompt; cancel it first`);
  if (agent.busy) await Promise.resolve(agent.cancel()).catch(() => {});
  await agent.shutdown();
  pool.delete(agent.name);
  project.instances = project.instances.filter((i) => i.id !== id);
  save();
  return { project: projectId, id, removed: true };
}

export async function removeProject(projectId, { force = false } = {}) {
  find(projectId);
  await stopInstances(projectId, { force });
  for (const a of instancesOf(projectId)) pool.delete(a.name);
  projects = projects.filter((p) => p.id !== projectId);
  // Everything about the project goes with it: its folder, and what the daemon holds in memory so that nothing writes it back.
  forgetRecords(projectId);
  forgetSessions(projectId);
  rmSync(projectDir(projectId), { recursive: true, force: true });
  return { id: projectId, removed: true };
}

/** Stop instances (project and built-in alike, so none holds a slot forever) idle for `ms`. Returns their keys. */
export async function sweepIdle(ms) {
  const now = Date.now();
  const stopped = [];
  for (const a of pool.values()) {
    if (!a.child || a.busy || now - a.lastActive < ms) continue;
    await a.shutdown();
    stopped.push(a.name);
  }
  return stopped;
}
