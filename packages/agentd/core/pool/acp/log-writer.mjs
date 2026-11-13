/**
 * Appends to a run's log file without a write for every streamed piece. A reply arrives as many small pieces, and a synchronous
 * append for each one (open, write, close) holds the daemon's one thread, which on Windows is slow enough to be felt when several
 * executors stream at once. The pieces are gathered and written together a little later, and at once when the daemon exits.
 */

import { appendFileSync } from 'node:fs';

const FLUSH_MS = 250;
/** file -> text not written yet */
const pending = new Map();
let timer = null;

/** Write everything that waits (all files, or one). */
export function flushLogs(file = null) {
  if (file) {
    const text = pending.get(file);
    if (text == null) return;
    pending.delete(file);
    write(file, text);
  } else {
    clearTimeout(timer);
    timer = null;
    for (const [f, text] of [...pending]) {
      pending.delete(f);
      write(f, text);
    }
  }
}

function write(file, text) {
  try {
    appendFileSync(file, text, 'utf8');
  } catch {
    /* logging is best-effort */
  }
}

/** Add `text` to the end of `file`; it is written within a fraction of a second. */
export function appendLog(file, text) {
  pending.set(file, (pending.get(file) ?? '') + text);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushLogs();
  }, FLUSH_MS);
  timer.unref?.();
}

process.on('exit', () => flushLogs());
