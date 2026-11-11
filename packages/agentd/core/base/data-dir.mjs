/**
 * Where agentd keeps its data. `AGENTD_DATA_DIR` moves all of it somewhere else, which is how a second, private daemon
 * (for tests) runs next to the one a person is using without touching its files. It has no dependencies, so every part
 * can import it.
 *
 * The data is sorted by whom it belongs to:
 *
 *   data/
 *   ├─ agentd.endpoint.json     how a client finds the daemon that is running
 *   ├─ global/                  what belongs to this machine, not to a project: the providers (address and key), the list
 *   │                           of CLIs the preflight found, the CLIs it installed, the daemon's log
 *   └─ projects/<id>/           everything about one project: its configuration, conversations, tasks, receipts, journal,
 *                               long replies, handoffs, rules files and the log of every run
 *
 * So removing a project removes its folder and nothing of it is left behind, and one folder is all there is to back up,
 * move or look through for one project. What is in a project's folder is named where it is used (`projectDir(id)` is
 * only the root of it).
 */

import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** packages/agentd */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DATA_DIR = process.env.AGENTD_DATA_DIR ? resolve(process.env.AGENTD_DATA_DIR) : join(ROOT, 'data');
export const GLOBAL_DIR = join(DATA_DIR, 'global');
export const PROJECTS_DIR = join(DATA_DIR, 'projects');

/** An executor's name is `<project>~<executor>`; the project's dispatcher is `<project>~@dispatcher`. */
export const PROJECT_SEP = '~';

/** Part of a path: nothing that could step out of the folder it is put in. */
const safe = (s) => {
  const t = String(s).replace(/[^\w.@-]/g, '_');
  return t === '.' || t === '..' || t === '' ? '_' : t;
};

/** The project a name (`<project>~<executor>`) belongs to. A name without `~` is taken as a project of its own. */
export const projectIdOf = (name) => String(name).split(PROJECT_SEP)[0];

/** The executor part of a name: `shop~dsh-1` -> `dsh-1`. */
export const instanceIdOf = (name) => {
  const s = String(name);
  const i = s.indexOf(PROJECT_SEP);
  return i < 0 ? s : s.slice(i + PROJECT_SEP.length);
};

/** The folder of one project (not created here). */
export const projectDir = (project) => join(PROJECTS_DIR, safe(project));

/** The folder of the project a name belongs to, with a path inside it, created when `make` is set. */
export function projectPath(name, ...parts) {
  return join(projectDir(projectIdOf(name)), ...parts);
}

/** The projects that have a folder. */
export function projectIdsOnDisk() {
  try {
    return readdirSync(PROJECTS_DIR).filter((n) => statSync(join(PROJECTS_DIR, n)).isDirectory());
  } catch {
    return [];
  }
}

export const ensureDir = (dir) => mkdirSync(dir, { recursive: true });
