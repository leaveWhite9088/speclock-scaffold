/**
 * Which tasks were in flight, kept on disk.
 *
 * A receipt is written when a task ends, so a daemon that dies mid-task would leave no trace of it. Every task
 * is therefore noted here when it is handed over and again when it ends. At startup, a task with a start and no
 * end is one the last daemon never finished: it is reported as interrupted and remembered per executor until
 * that executor gets new work. We only record it. Whether to run it again is for the dispatcher or a person to
 * decide, because the executor may have written half of its files.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectDir, projectIdOf, projectIdsOnDisk } from '../base/index.mjs';

const log = (...a) => process.stderr.write(`[journal] ${a.join(' ')}\n`);

/** projects/<project>/journal.jsonl, and next to it the executors of that project that were interrupted. */
const fileOf = (project) => join(projectDir(project), 'journal.jsonl');
const interruptedFileOf = (project) => join(projectDir(project), 'interrupted.json');

/** jobId -> project, so that the end of a task is noted where its start was. */
const projectOfJob = new Map();

function append(project, rec) {
  try {
    mkdirSync(projectDir(project), { recursive: true });
    appendFileSync(fileOf(project), JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n', 'utf8');
  } catch (err) {
    log('could not write the journal:', err.message);
  }
}

export const journalStart = ({ jobId, agent, project, prompt, taskId = null, attempt = null, retryOf = null }) => {
  const where = project ?? projectIdOf(agent);
  projectOfJob.set(jobId, where);
  append(where, { kind: 'start', jobId, agent, project: project ?? null, prompt: typeof prompt === 'string' ? prompt.slice(0, 160) : null, taskId, attempt, retryOf });
};

export const journalEnd = (jobId) => {
  const where = projectOfJob.get(jobId);
  if (!where) return;
  projectOfJob.delete(jobId);
  append(where, { kind: 'end', jobId });
};

/** Executor name -> its last interrupted task, until it gets new work. */
const interrupted = {};
for (const project of projectIdsOnDisk()) {
  try {
    Object.assign(interrupted, JSON.parse(readFileSync(interruptedFileOf(project), 'utf8')) ?? {});
  } catch {
    /* none yet */
  }
}

function saveInterrupted(project) {
  try {
    const mine = Object.fromEntries(Object.entries(interrupted).filter(([agent]) => projectIdOf(agent) === project));
    mkdirSync(projectDir(project), { recursive: true });
    writeFileSync(interruptedFileOf(project), JSON.stringify(mine, null, 2), 'utf8');
  } catch (err) {
    log('could not save interrupted tasks:', err.message);
  }
}

export const interruptedOf = (agent) => interrupted[agent] ?? null;

/** The executor got new work, so the old notice no longer applies. */
export function clearInterrupted(agent) {
  if (!interrupted[agent]) return;
  delete interrupted[agent];
  saveInterrupted(projectIdOf(agent));
}

/** The project is gone: forget what is kept about it in memory (its folder is removed by the caller). */
export function forgetProject(project) {
  for (const agent of Object.keys(interrupted)) if (projectIdOf(agent) === project) delete interrupted[agent];
  for (const [jobId, p] of projectOfJob) if (p === project) projectOfJob.delete(jobId);
}

/**
 * Startup pass: tasks that started and never ended are interrupted. Returns them, then empties the journals, so
 * each one is reported once.
 */
export function reconcileJournal() {
  const lost = [];
  for (const project of projectIdsOnDisk()) {
    const open = new Map();
    try {
      for (const line of readFileSync(fileOf(project), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let r;
        try {
          r = JSON.parse(line);
        } catch {
          continue; // a half-written last line
        }
        if (r.kind === 'start') open.set(r.jobId, r);
        else if (r.kind === 'end') open.delete(r.jobId);
      }
    } catch {
      continue;
    }
    try {
      writeFileSync(fileOf(project), '', 'utf8');
    } catch (err) {
      log('could not reset the journal:', err.message);
    }
    const mine = [...open.values()].map((r) => ({ jobId: r.jobId, agent: r.agent, project: r.project, prompt: r.prompt, startedAt: r.ts, taskId: r.taskId ?? null, attempt: r.attempt ?? null, retryOf: r.retryOf ?? null }));
    if (mine.length) {
      for (const j of mine) interrupted[j.agent] = j; // the newest one per executor
      saveInterrupted(project);
    }
    lost.push(...mine);
  }
  return lost;
}
