/**
 * SpecLock Core, seen from agentd. This is the only place that knows Core's API; the rest of agentd asks for what it
 * needs in its own words:
 *
 *   - `roleOf(value)`             check the role a person picked for an executor (or none)
 *   - `issueExecutorKey(…)`       give an executor its place in Core: a key bound to the project, and the MCP server entry
 *                                 that carries it (the key itself stays in a file inside Core's folder, never in the entry)
 *   - `revokeKey(id)`             take that key away again
 *   - `projectAdmin(projectId)`   the project admin key the dispatcher's tools act with (never shown to a model)
 *   - `status()`                  for the screen: is it installed, running, which version
 *
 * One Core serves every project (it keeps them apart by the project each key is bound to). The super admin key is used
 * here for the two things only it may do, making a project and making keys, and is never handed to any agent.
 */

import { CoreError, call } from './client.mjs';
import { HOME_DIR, coreDir, adminKeyFile, hasAdminKeyFile, readGlobal, readProject, venvPython, writeAdminKeyFile, writeProject } from './config.mjs';
import { baseUrl, ensureRunning, health, installState, isSetUp, stop } from './service.mjs';


/** What the person picks (in agentd's words) and the role Core knows it by. */
export const ROLES = {
  requirements: 'requirements-agent',
  executor: 'executor-agent',
  tester: 'tester-agent',
  scanner: 'scanner-agent',
};

/** A role the person picked: one of ROLES' names, or null for "not connected". Anything else is refused. */
export function roleOf(value) {
  if (value == null || value === '' || value === 'none') return null;
  if (!Object.hasOwn(ROLES, value)) throw new Error(`unknown SpecLock role "${value}"; use one of: ${Object.keys(ROLES).join(', ')}, or none`);
  return value;
}

/** Core's `mcp_config` is a `.mcp.json` entry; the executors take the same server in ACP's shape. */
function acpServer(config) {
  const [[name, s]] = Object.entries(config?.mcpServers ?? {});
  return { name, command: s.command, args: s.args ?? [], env: Object.entries(s.env ?? {}).map(([k, v]) => ({ name: k, value: String(v) })) };
}

async function asAdmin() {
  const base = await ensureRunning();
  return { base, key: readGlobal().adminKey };
}

/**
 * The project's place in Core: made on first use, with its project admin key. `name` is what the project is called here.
 * @returns {Promise<{ base: string, coreProjectId: number, adminKey: string }>}
 */
const building = new Map();
export function ensureProject(projectId, name) {
  // Two executors made at once must not each make the project.
  if (!building.has(projectId)) building.set(projectId, makeProject(projectId, name).finally(() => building.delete(projectId)));
  return building.get(projectId);
}

async function makeProject(projectId, name) {
  const { base, key } = await asAdmin();
  const have = readProject(projectId);
  if (have.coreProjectId && have.adminKey) return { base, ...have };
  let coreProjectId = have.coreProjectId;
  if (!coreProjectId) {
    // A name Core already has (another project here, or one made by hand) is made unique by the project's id.
    const existing = await call(base, 'GET', '/projects', { key });
    const taken = new Set(existing.map((p) => p.name));
    const wanted = taken.has(name) ? `${name} (${projectId})` : name;
    coreProjectId = (await call(base, 'POST', '/projects', { key, body: { name: wanted } })).id;
    writeProject(projectId, { ...have, coreProjectId });
  }
  const made = await call(base, 'POST', '/keys', { key, body: { role: 'project-admin', label: `dispatcher-${projectId}`, project_id: coreProjectId } });
  const next = { ...readProject(projectId), coreProjectId, adminKey: made.key, adminKeyId: made.id };
  writeProject(projectId, next);
  writeAdminKeyFile(projectId, made.key);
  return { base, ...next };
}

/**
 * The Core MCP server for a project's dispatcher, acting with the project admin key (it may approve change requests and see
 * the project's work, nothing outside the project). The key is in a file of agentd's; the entry holds its path. Null until the
 * project has a place in Core. Synchronous: it is read each time the dispatcher starts.
 */
export function dispatcherServer(projectId) {
  const p = readProject(projectId);
  if (!p.coreProjectId || !p.adminKey) return null;
  if (!hasAdminKeyFile(projectId)) writeAdminKeyFile(projectId, p.adminKey); // a project made before the key had a file
  return { name: 'speclock', command: venvPython(), args: ['-m', 'speclock', 'mcp', '--key-file', adminKeyFile(projectId)], env: [{ name: 'SPECLOCK_HOME', value: HOME_DIR }] };
}

/** A project admin key for the dispatcher's tools. */
export async function projectAdmin(projectId, name) {
  const p = await ensureProject(projectId, name);
  return { base: p.base, key: p.adminKey, coreProjectId: p.coreProjectId };
}

/**
 * Give an executor a key for `role`, bound to the project. Names are `<project>-<executor>` because Core keeps all key
 * files in one folder. The result is what to keep with the executor: `{ role, keyId, keyFile, mcp }`.
 */
export async function issueExecutorKey({ project, projectName, executor, role }) {
  const picked = roleOf(role);
  if (!picked) return null;
  const { base, key } = await asAdmin();
  const p = await ensureProject(project, projectName ?? project);
  const made = await call(base, 'POST', '/keys', { key, body: { role: ROLES[picked], label: `${project}-${executor}`, project_id: p.coreProjectId } });
  return { role: picked, keyId: made.id, keyFile: made.key_file, mcp: acpServer(made.mcp_config) };
}

/** Take a key away (an executor goes, or changes role). A key Core no longer has is not an error. */
export async function revokeKey(keyId) {
  if (!keyId) return;
  const { base, key } = await asAdmin();
  try {
    await call(base, 'DELETE', `/keys/${keyId}`, { key });
  } catch (err) {
    if (!(err instanceof CoreError) || err.status !== 404) throw err;
  }
}

/** For the screen. Never starts anything. */
/** The project's id inside Core (what Core's own page takes as `?project=`), or null while it has none there yet. Never the key. */
export const coreProjectId = (projectId) => readProject(projectId).coreProjectId ?? null;

export async function status() {
  const s = installState();
  const up = await health();
  return { found: s.found, built: s.built, python: s.python, setUp: isSetUp(), running: Boolean(up), version: up?.version ?? null, url: baseUrl(), dir: coreDir(), home: HOME_DIR };
}
