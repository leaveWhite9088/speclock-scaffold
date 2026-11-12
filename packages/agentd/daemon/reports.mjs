/**
 * Reports: what an executor answered to a task the dispatcher sent without waiting.
 *
 * The dispatcher hands a task over and its turn ends. When the executor is done, the answer is put in front of the
 * dispatcher as a message of its own ("【执行者回报】…"), which starts a new turn. Everything is kept in
 * `projects/<project>/reports.json` from the moment of the hand-over until the dispatcher has received it, so a daemon
 * that stops in between loses nothing: a finished task is delivered after the restart, a task that was still running
 * is reported as interrupted.
 *
 * Reports that end together are delivered as one message, and never while the dispatcher is in a turn (a message of the
 * person goes first). A task a person cancelled is listed in the next message but does not start a turn by itself.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectDir, projectIdsOnDisk } from '../core/base/index.mjs';
import { fitReply } from '../core/records/index.mjs';

const log = (...a) => process.stderr.write(`[reports] ${a.join(' ')}\n`);

/** The first line of a report: the page and the dispatcher's rules recognise a message by it. */
export const REPORT_TAG = '【执行者回报】';
/** Reports that end within this time of each other go in one message. */
const GATHER_MS = 1500;

const fileOf = (project) => join(projectDir(project), 'reports.json');

/** project -> entries, oldest first */
const store = new Map();

function entriesOf(project) {
  if (!store.has(project)) {
    let list = [];
    try {
      list = JSON.parse(readFileSync(fileOf(project), 'utf8'))?.pending ?? [];
    } catch {
      /* none yet */
    }
    store.set(project, list);
  }
  return store.get(project);
}

function save(project) {
  try {
    mkdirSync(projectDir(project), { recursive: true });
    const tmp = `${fileOf(project)}.tmp`;
    writeFileSync(tmp, JSON.stringify({ schema: 1, pending: entriesOf(project) }, null, 2) + '\n', 'utf8');
    renameSync(tmp, fileOf(project));
  } catch (err) {
    log('could not save the pending reports:', err.message);
  }
}

/** The dispatcher of a project, started on demand. Set by the daemon (this file does not import it: it is wired the other way round). */
let dispatcherOf = null;
export const wireReports = (fn) => {
  dispatcherOf = fn;
};

/** A task was sent without waiting: its report is owed from now on. */
export function expectReport({ project, jobId, agent, prompt, taskId = null, attempt = null, maxAttempts = null }) {
  entriesOf(project).push({
    jobId,
    agent,
    prompt: typeof prompt === 'string' ? prompt.slice(0, 400) : '',
    taskId,
    attempt,
    maxAttempts,
    startedAt: Date.now(),
    state: 'running',
  });
  save(project);
}

/** Pending reports of a project, for a page that lists the tasks still out. */
export const pendingReports = (project) => entriesOf(project).map(({ jobId, agent, state }) => ({ jobId, agent, state }));

/**
 * The task ended. `outcome`: done | failed | cancelled. Does nothing for a task nobody waits for (one sent with waiting).
 */
export function settleReport({ project, jobId, outcome, text = '', error = null, source = null, tookMs = null, sessionId = null }) {
  const e = entriesOf(project).find((x) => x.jobId === jobId);
  if (!e || e.state !== 'running') return false;
  Object.assign(e, { state: outcome, text: String(text ?? ''), error, source, tookMs, sessionId, endedAt: Date.now() });
  save(project);
  schedule(project, outcome === 'cancelled' ? 0 : GATHER_MS);
  return true;
}

/** The daemon found these tasks unfinished at its start: they are reported as interrupted. */
export function interruptReports(lostJobs) {
  const touched = new Set();
  for (const j of lostJobs) {
    const project = j.project ?? String(j.agent).split('~')[0];
    const e = entriesOf(project).find((x) => x.jobId === j.jobId);
    if (!e || e.state !== 'running') continue;
    Object.assign(e, { state: 'interrupted', error: 'the daemon stopped while this task was running; the executor may have done part of it', source: 'agentd', endedAt: Date.now() });
    touched.add(project);
  }
  for (const p of touched) save(p);
}

/** Deliver what is waiting in every project that has something (after a start). */
export function resumeReports() {
  for (const project of projectIdsOnDisk()) if (entriesOf(project).some((e) => e.state !== 'running')) schedule(project, 0);
}

const timers = new Map();
function schedule(project, ms) {
  clearTimeout(timers.get(project));
  const t = setTimeout(() => {
    timers.delete(project);
    void flush(project);
  }, ms);
  t.unref?.();
  timers.set(project, t);
}

const took = (ms) => (ms == null ? '' : ms < 60_000 ? `${Math.round(ms / 1000)} 秒` : `${Math.floor(ms / 60_000)} 分 ${Math.round((ms % 60_000) / 1000)} 秒`);

function describe(e) {
  const short = String(e.agent).split('~').slice(1).join('~') || e.agent;
  const tag = `[task ${e.taskId ?? '-'}, attempt ${e.attempt ?? 1} of ${e.maxAttempts ?? 3}, job ${e.jobId}]`;
  const head = `${short} · ${{ done: '完成', failed: '失败', cancelled: '被用户取消', interrupted: '被中断' }[e.state] ?? e.state}${e.tookMs != null ? ` · 用时 ${took(e.tookMs)}` : ''}`;
  const task = `任务：${e.prompt.replace(/\s+/g, ' ').slice(0, 120)}`;
  if (e.state === 'done') return `### ${head}\n${task}\n${fitReply(e.jobId, e.text).text || '(没有文字输出)'}\n${tag}`;
  if (e.state === 'cancelled') return `### ${head}\n${task}\n用户取消了这个任务，不用再处理。\n${tag}`;
  const from = e.source === 'cli' ? '执行者自己的 CLI 报的错（原样转述）：\n' : e.source === 'agentd' ? 'agentd 报的错（不是 CLI 的报错）：\n' : '';
  return `### ${head}\n${task}\n${from}${e.error ?? '未知原因'}\n${tag}\n告诉用户，等用户决定；不要自己重试，也不要换别的执行者重做。`;
}

/** The message the dispatcher receives for these reports. */
export function reportMessage(list) {
  return `${REPORT_TAG}以下是你之前不等结果就派出去的任务的结果，不是用户发的消息。核对结果后再向用户汇报；任务还没全部回来时，只汇报已经回来的。\n\n${list.map(describe).join('\n\n')}`;
}

async function flush(project) {
  const list = entriesOf(project).filter((e) => e.state !== 'running');
  if (!list.length || !list.some((e) => e.state !== 'cancelled')) return;
  let d;
  try {
    d = dispatcherOf(project);
  } catch (err) {
    log(`no dispatcher for ${project}: ${err.message}`);
    return;
  }
  // A turn is running (or one waits behind it): its end calls this again, so the report does not cut in.
  if (d.busy) return;
  try {
    await d.prompt(reportMessage(list));
  } catch (err) {
    log(`could not deliver the reports of ${project}: ${err.message}; trying again in a minute`);
    schedule(project, 60_000);
    return;
  }
  const sent = new Set(list.map((e) => e.jobId));
  store.set(project, entriesOf(project).filter((e) => !sent.has(e.jobId)));
  save(project);
}

/** The dispatcher's turn ended: what waited for it goes now. */
export const dispatcherSettled = (project) => {
  if (entriesOf(project).some((e) => e.state !== 'running')) schedule(project, 300);
};
