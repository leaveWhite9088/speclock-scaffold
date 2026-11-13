/**
 * What keeps the daemon's one thread free, on its own (no CLI, no model).
 *
 * Checks:
 *   1. the transcript reader returns what a full read would, for every way of asking, while only reading what is new
 *   2. the session store is written once for changes that come close together, and not at all for a figure that did not change
 *   3. a run's log file gets its pieces together, complete when the run is over, and a running run's poll carries no whole text
 *   4. a connection that fails is counted once, so the daemon never thinks nobody is connected while a client still is
 */

import '../lib/isolate.mjs';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { check } from '../lib/scheduler.mjs';

console.log('\n=== daemon load ===\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1
const { appendEntry, readTranscript } = await import('../../core/records/transcripts.mjs');
const { projectPath, projectDir } = await import('../../core/base/index.mjs');
const inst = 'demo~worker';
const sid = 's1';
const file = join(projectPath(inst, 'transcripts', 'worker'), `${sid}.jsonl`);
/** What the old reader did: every line, parsed, numbered by the lines that are not blank. */
const naive = (afterSeq = 0, limit = 200, tail = false) => {
  const max = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const all = [];
  let seq = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    seq += 1;
    try {
      all.push({ seq, ...JSON.parse(line) });
    } catch {
      /* damaged */
    }
  }
  const pool = all.filter((e) => e.seq > Math.max(Number(afterSeq) || 0, 0));
  return { total: seq, entries: tail ? pool.slice(-max) : pool.slice(0, max), hasMore: pool.length > max };
};
const same = (a, b) => JSON.stringify([a.total, a.entries, a.hasMore]) === JSON.stringify([b.total, b.entries, b.hasMore]);
const asks = [[0, 200, false], [0, 5, false], [3, 5, false], [7, 5, true], [0, 3, true], [12, 200, false], [100, 5, false], [0, 1000, false]];
const sameAll = () => asks.every(([a, l, t]) => same(readTranscript(inst, sid, { afterSeq: a, limit: l, tail: t }), naive(a, l, t)));

for (let i = 1; i <= 12; i += 1) appendEntry(inst, sid, { role: i % 2 ? 'user' : 'assistant', text: `行 ${i} 中文 ✓`, jobId: `j${i}` });
check('a transcript is read the way a full read would', sameAll(), JSON.stringify(readTranscript(inst, sid, { afterSeq: 3, limit: 5 }).entries.map((e) => e.seq)));
appendEntry(inst, sid, { role: 'tool', text: 'x'.repeat(5000) });
appendFileSync(file, '\n   \n');
appendEntry(inst, sid, { role: 'assistant', text: 'after the blanks' });
check('after more lines and blank ones, still the same', sameAll());
check('a line that is not finished is not counted until it is', (() => {
  appendFileSync(file, '{"role":"user","text":"half');
  const before = readTranscript(inst, sid).total;
  appendFileSync(file, '"}\n');
  return readTranscript(inst, sid).total === before + 1 && sameAll();
})());
appendFileSync(file, '{"damaged": \n');
appendEntry(inst, sid, { role: 'assistant', text: 'after the damage' });
check('a damaged line is skipped but keeps its number, so the numbers after it hold', (() => {
  const r = readTranscript(inst, sid, { limit: 1000 });
  const last = r.entries.at(-1);
  return last.text === 'after the damage' && last.seq === r.total && !r.entries.some((e) => e.seq === r.total - 1);
})());
const first = readTranscript(inst, sid, { limit: 1000 }).total;
check('the cursor works across polls: nothing after the last seq, then only what was added', readTranscript(inst, sid, { afterSeq: first }).entries.length === 0 && (appendEntry(inst, sid, { role: 'user', text: 'new' }), readTranscript(inst, sid, { afterSeq: first }).entries.map((e) => e.text).join() === 'new'));
check('a file that was replaced by a shorter one is read again from the start', (() => {
  writeFileSync(file, JSON.stringify({ role: 'user', text: 'only' }) + '\n');
  const r = readTranscript(inst, sid);
  return r.total === 1 && r.entries[0].text === 'only';
})());
check('an unknown session says it was not recorded', readTranscript(inst, 'nope').recorded === false);

// 2
const store = await import('../../core/pool/store.mjs');
const path = join(projectDir('demo'), 'session-labels.json');
store.noteSession(inst, 'probe', { label: 'p' });
store.flushStore();
check('the store file exists after a flush', existsSync(path), path);
rmSync(path, { force: true });
for (let i = 0; i < 200; i += 1) store.noteSession(inst, 's1', { context: { used: i, size: 1000, percent: i / 10 } });
check('200 changes in a row are not 200 writes: the file waits', !existsSync(path));
store.flushStore();
check('and one write has the last figure', JSON.parse(readFileSync(path, 'utf8'))[inst].s1.context.used === 199);
rmSync(path, { force: true });
store.noteSession(inst, 's1', { context: { used: 199, size: 1000, percent: 19.9 } });
store.flushStore();
check('a figure that did not change writes nothing', !existsSync(path));
store.noteSession(inst, 's1', { label: 'Talk' });
await sleep(700);
check('a change is written by itself a little later', existsSync(path) && JSON.parse(readFileSync(path, 'utf8'))[inst].s1.label === 'Talk');

// 3
const { appendLog, flushLogs } = await import('../../core/pool/acp/log-writer.mjs');
const log = join(projectPath(inst, 'runs'), 'job.log');
mkdirSync(dirname(log), { recursive: true });
writeFileSync(log, '');
for (let i = 0; i < 500; i += 1) appendLog(log, `piece ${i}\n`);
check('pieces are not written one by one', readFileSync(log, 'utf8') === '');
flushLogs(log);
const text = readFileSync(log, 'utf8');
check('and are all there, in order, once flushed', text.split('\n').length === 501 && text.startsWith('piece 0\n') && text.endsWith('piece 499\n'));
appendLog(log, 'late\n');
await sleep(400);
check('what is not flushed by hand is written by itself', readFileSync(log, 'utf8').endsWith('late\n'));

const { RunLog } = await import('../../core/pool/acp/runs.mjs');
const runs = new RunLog({ name: inst });
const run = runs.begin('job-1', { sessionId: 's1', model: null });
run.text = 'hello';
run.flushed = 2;
const live = runs.tail('job-1', () => ({}));
check('a poll of a running run carries what is not in the transcript yet, not the whole text', live.running === true && live.pendingText === 'llo' && !('text' in live));
appendLog(run.logFile, 'tail of the log');
runs.finish(run, () => ({ durationMs: 1 }));
check('when it is over it carries the whole text, and its log is complete', runs.tail('job-1', () => ({})).text === 'hello' && readFileSync(run.logFile, 'utf8').endsWith('tail of the log'));

// 4
const { startServer } = await import('../../daemon/server.mjs');
const PORT = 47900 + Math.floor(Math.random() * 90);
const { stats } = startServer({ ops: { ping: () => 'pong' }, scopeArgs: (_op, a) => a, pipe: 'unused', port: PORT, endpointFile: join(dirname(file), 'endpoint.json'), info: {}, onListening: () => {}, log: () => {} });
await sleep(200);
const connect = () => new Promise((resolve, reject) => {
  const s = net.connect(PORT, '127.0.0.1', () => resolve(s));
  s.on('error', () => {});
  s.once('error', reject);
});
const a = await connect();
const b = await connect();
await sleep(100);
check('two clients are counted', stats.connections === 2, String(stats.connections));
a.resetAndDestroy(); // the server sees an error and then a close
await sleep(300);
check('one that failed is subtracted once: the other is still counted', stats.connections === 1, String(stats.connections));
b.destroy();
await sleep(200);
check('and none when none is left', stats.connections === 0, String(stats.connections));
const c = await connect();
c.write('{"id":"1","op":"ping"}\n');
const answer = await new Promise((r) => c.once('data', (d) => r(String(d))));
check('a request is still answered', /"result":"pong"/.test(answer), answer);
c.destroy();

console.log(process.exitCode ? '\n=> ✗ DAEMON LOAD BROKEN' : '\n=> ✓ DAEMON LOAD OK');
process.exit(process.exitCode ?? 0);
