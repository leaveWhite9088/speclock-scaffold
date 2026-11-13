/**
 * Transcript store: our own record of every conversation that passes through agentd.
 *
 * The agents keep their own history on disk, but the protocol gives us no way to
 * read it back: `dsh` has no `loadSession`, and `mcode` replays history only
 * through resume. So agentd writes what it sees, one JSONL file per session:
 *
 *   data/projects/<project>/transcripts/<executor>/<sessionId>.jsonl
 *
 * Each line is one entry: { seq, ts, role, ... }. `seq` is the 1-based line number,
 * which makes `afterSeq` a stable cursor for incremental reads.
 *
 * Roles: user, assistant, tool, error.
 * Limit: sessions that were used outside agentd have no record before the first
 * run that went through agentd.
 */

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { instanceIdOf, projectPath } from '../base/index.mjs';

const safe = (s) => String(s).replace(/[^A-Za-z0-9._~-]/g, '_');
/** projects/<project>/transcripts/<executor>/ */
const dirFor = (instance) => projectPath(instance, 'transcripts', safe(instanceIdOf(instance)));
const fileFor = (instance, sessionId) => join(dirFor(instance), `${safe(sessionId)}.jsonl`);

/**
 * The session a run was recorded in, found by its job id (the run's prompt is written to the transcript once the
 * session is known). Looks at the instance's most recently written sessions only. Null when nothing was recorded.
 */
export function findJobSession(instance, jobId) {
  try {
    const dir = dirFor(instance);
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(0, 8);
    for (const { f } of files) {
      if (readFileSync(join(dir, f), 'utf8').includes(`"jobId":"${jobId}"`)) return f.slice(0, -'.jsonl'.length);
    }
  } catch {
    /* no transcripts for this instance */
  }
  return null;
}

/** Append one entry. Best-effort: a failed write never breaks a run. */
export function appendEntry(instance, sessionId, entry) {
  if (!instance || !sessionId) return false;
  try {
    const file = fileFor(instance, sessionId);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Where each line of a transcript starts, kept per file so that a read does not go through the whole file again. A poll that
 * asks for "after seq N" used to read, split and parse every line of a file that only ever grows (hours of tool output), on the
 * daemon's one thread, every second or two. Now only the bytes that were added since the last read are scanned (to find the
 * line starts), and only the lines asked for are read and parsed.
 */
const indexes = new Map();
const NEWLINE = 0x0a;

/** `{ size, starts: number[] }`: the byte offset where each non-blank line starts, for the lines that are complete (end in a newline). */
function indexOf(file, size) {
  let ix = indexes.get(file);
  if (!ix || size < ix.size) ix = { size: 0, scanned: 0, starts: [], lineStart: 0, blank: true };
  if (size > ix.scanned) {
    const fd = openSync(file, 'r');
    try {
      const CHUNK = 1 << 20;
      const buf = Buffer.allocUnsafe(Math.min(CHUNK, size - ix.scanned));
      let pos = ix.scanned;
      while (pos < size) {
        const n = readSync(fd, buf, 0, Math.min(buf.length, size - pos), pos);
        if (n <= 0) break;
        for (let i = 0; i < n; i += 1) {
          const b = buf[i];
          if (b === NEWLINE) {
            if (!ix.blank) ix.starts.push(ix.lineStart);
            ix.lineStart = pos + i + 1;
            ix.blank = true;
          } else if (ix.blank && b !== 0x20 && b !== 0x0d && b !== 0x09) {
            ix.blank = false;
          }
        }
        pos += n;
      }
      ix.scanned = pos;
    } finally {
      closeSync(fd);
    }
  }
  ix.size = size;
  indexes.set(file, ix);
  return ix;
}

/** Read bytes [from, to) of a file as text. */
function readRange(file, from, to) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(Math.max(0, to - from));
    let got = 0;
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, from + got);
      if (n <= 0) break;
      got += n;
    }
    return buf.toString('utf8', 0, got);
  } finally {
    closeSync(fd);
  }
}

/**
 * Read entries of one session.
 *   afterSeq  return entries with seq greater than this (default 0)
 *   limit     maximum entries returned (default 200, maximum 1000)
 *   tail      return the last `limit` entries instead of the first ones
 */
export function readTranscript(instance, sessionId, { afterSeq = 0, limit = 200, tail = false } = {}) {
  const max = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const file = fileFor(instance, sessionId);
  if (!existsSync(file)) {
    return { agent: instance, sessionId, recorded: false, total: 0, entries: [], hasMore: false };
  }

  const ix = indexOf(file, statSync(file).size);
  const total = ix.starts.length;
  const after = Math.min(Math.max(Number(afterSeq) || 0, 0), total);
  // the lines after `after`, and of those the ones to return: the first `max`, or the last `max`
  const first = tail ? Math.max(after, total - max) : after;
  const last = Math.min(total, first + max);
  const entries = [];
  if (last > first) {
    const from = ix.starts[first];
    const to = last < total ? ix.starts[last] : ix.lineStart;
    const lines = readRange(file, from, to).split('\n').filter((l) => l.trim());
    lines.forEach((line, i) => {
      try {
        entries.push({ seq: first + i + 1, ...JSON.parse(line) });
      } catch {
        /* skip a damaged line but keep the numbering stable */
      }
    });
  }
  return { agent: instance, sessionId, recorded: true, total, entries, hasMore: total - after > max };
}
