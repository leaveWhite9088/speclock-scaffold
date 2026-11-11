/**
 * An executor's reply as the dispatcher sees it.
 *
 * Everything the dispatcher is handed stays in its conversation for good, so one long reply (a file pasted
 * whole, a long log) would fill it. A reply over the limit is saved in full, and the dispatcher gets its start
 * and end plus the path of the file. Short replies pass through unchanged.
 */

import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectPath } from '../base/index.mjs';

/** projects/<project>/results/ : a run's id starts with its executor's name, which starts with the project. */
const resultsDirOf = (jobId) => projectPath(jobId, 'results');
export const REPLY_LIMIT = Number(process.env.AGENTD_REPLY_CHARS) || 6000;
const KEEP_FILES = 200;

/** Keep the newest files only; the folder would otherwise grow with every long reply. */
function prune(dir) {
  try {
    const files = readdirSync(dir).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }));
    files.sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(KEEP_FILES)) unlinkSync(join(dir, f));
  } catch {
    /* best effort */
  }
}

/** @returns {{ text: string, file: string | null, omitted: number }} */
export function fitReply(jobId, text, limit = REPLY_LIMIT) {
  const full = String(text ?? '');
  if (full.length <= limit) return { text: full, file: null, omitted: 0 };

  const head = full.slice(0, Math.round(limit * 0.5));
  const tail = full.slice(full.length - Math.round(limit * 0.25));
  const omitted = full.length - head.length - tail.length;

  const dir = resultsDirOf(jobId);
  let file = join(dir, `${String(jobId).replace(/[^\w.-]/g, '_')}.md`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, full, 'utf8');
    prune(dir);
  } catch {
    file = null; // still trimmed: the dispatcher's context matters more than a copy on disk
  }
  const where = file ? `The full reply is saved in ${file}. ` : '';
  return {
    text:
      `${head}\n\n[... ${omitted} characters omitted. ${where}` +
      'The start and the end are shown; read the file only if you need the middle, or ask the executor for a shorter summary.]\n\n' +
      tail,
    file,
    omitted,
  };
}
