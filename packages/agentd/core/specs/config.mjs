/**
 * Where SpecLock Core lives and how it is reached. agentd runs ONE Core service for every project (Core keeps the
 * projects apart itself), with its data in `data/global/.speclock`, away from the user's own `~/.speclock` and from every
 * project directory. Nothing here talks to Core: it is the settings and the two files agentd keeps.
 *
 *   data/global/.speclock/   Core's own folder (database, keys/): Core's name for it, so it is called that here too
 *   data/global/specs.json   the super admin key (shown once by `speclock init`) and the port, readable by this user only
 *   data/projects/<id>/specs.json   what one project has in Core: its Core project id and its project admin key
 *
 * `agentd.config.json` may carry `{ "speclock": { "dir": "…/speclock-core", "port": 47821 } }`; the environment wins
 * (AGENTD_SPECLOCK_DIR, AGENTD_SPECLOCK_PORT).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, GLOBAL_DIR, projectPath } from '../base/index.mjs';

/** packages/agentd */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const section = CONFIG.speclock ?? {};

/** The speclock-core checkout. By default it sits next to this repository. */
export const CORE_DIR = process.env.AGENTD_SPECLOCK_DIR || section.dir || join(ROOT, '..', '..', '..', 'speclock-core');
export const CORE_PORT = Number(process.env.AGENTD_SPECLOCK_PORT || section.port || 47821);
export const CORE_URL = `http://127.0.0.1:${CORE_PORT}`;

export const HOME_DIR = join(GLOBAL_DIR, '.speclock');
const GLOBAL_FILE = join(GLOBAL_DIR, 'specs.json');

/** Python of Core's own virtual environment (made by `uv sync`). */
export const venvPython = () => join(CORE_DIR, '.venv', process.platform === 'win32' ? join('Scripts', 'python.exe') : join('bin', 'python'));

function read(file) {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) ?? {}) : {};
  } catch {
    return {};
  }
}

function write(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  // Keys are in these files: this user only (a no-op on Windows, where the data folder is the user's own anyway).
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, file);
}

/** `{ adminKey }` once Core has been set up. */
export const readGlobal = () => read(GLOBAL_FILE);
export const writeGlobal = (value) => write(GLOBAL_FILE, value);

/** `{ coreProjectId, adminKey, adminKeyId }` for a project that has been given a place in Core. */
export const readProject = (id) => read(projectPath(id, 'specs.json'));
export const writeProject = (id, value) => write(projectPath(id, 'specs.json'), value);

/** The project admin key as a file of its own (just the key): the dispatcher's MCP server is told the path, never the key. */
export const adminKeyFile = (id) => projectPath(id, 'specs-admin.key');
export function writeAdminKeyFile(id, key) {
  const file = adminKeyFile(id);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${key}\n`, { encoding: 'utf8', mode: 0o600 });
  return file;
}
export const hasAdminKeyFile = (id) => existsSync(adminKeyFile(id));
