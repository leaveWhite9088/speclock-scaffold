/**
 * Reports: the answers of tasks the dispatcher sent without waiting. A stand-in dispatcher, no pi, no CLI.
 *
 * Checks:
 *   1. a finished task is delivered to the dispatcher as one message starting with the report tag, with the reply and the
 *      task tag, and it is forgotten once delivered
 *   2. tasks that end together arrive in one message
 *   3. while the dispatcher is in a turn nothing is delivered; when the turn settles the report goes
 *   4. a failure says where the error comes from and that the user decides; a cancelled task alone starts no turn, but is
 *      listed in the next message
 *   5. a daemon that stopped: a finished-but-undelivered report is delivered after the restart, a task that was still
 *      running is reported as interrupted
 */

import '../lib/isolate.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { check } = await import('../lib/scheduler.mjs');
const { projectDir } = await import('../../core/base/index.mjs');
const R = await import('../../daemon/reports.mjs');

console.log('\n=== reports ===\n');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sent = [];
const dispatcher = { busy: false, prompt: async (text) => void sent.push(text) };
R.wireReports(() => dispatcher);
const task = (project, n, extra = {}) => ({ project, jobId: `${project}~web-${n}`, agent: `${project}~web`, prompt: `task ${n}`, taskId: `t-${n}`, attempt: 1, maxAttempts: 3, ...extra });
const pendingOnDisk = (project) => JSON.parse(readFileSync(join(projectDir(project), 'reports.json'), 'utf8')).pending;

// 1
R.expectReport(task('demo', 1));
check('a task that is out is owed a report', R.pendingReports('demo').length === 1 && R.pendingReports('demo')[0].state === 'running');
R.settleReport({ project: 'demo', jobId: 'demo~web-1', outcome: 'done', text: 'all built', tookMs: 96_000 });
await sleep(2000);
check('the answer reaches the dispatcher once, as a report', sent.length === 1 && sent[0].startsWith(R.REPORT_TAG) && sent[0].includes('all built') && sent[0].includes('job demo~web-1') && sent[0].includes('1 分 36 秒'));
check('and is forgotten after that', pendingOnDisk('demo').length === 0);

// the heading says which module the task was about, however the dispatcher wrote it (a tester's "工作项 **#3（模块「X」）**" too)
sent.length = 0;
R.expectReport(task('demo', 9, { prompt: '【按规格安排】请对已实现的工作项 **#3（模块「写一页」）** 做独立端到端验收。' }));
await sleep(100);
R.settleReport({ project: 'demo', jobId: 'demo~web-9', outcome: 'done', text: 'tested', tookMs: 5000 });
await sleep(2000);
check('a report is headed with the module the task was for (named in the task when Core cannot be asked)', sent.length === 1 && /### web · 完成 · 「写一页」 · 用时/.test(sent[0]), sent[0]);

// 2
sent.length = 0;
R.expectReport(task('demo', 2));
R.expectReport(task('demo', 3));
R.settleReport({ project: 'demo', jobId: 'demo~web-2', outcome: 'done', text: 'first' });
await sleep(400);
R.settleReport({ project: 'demo', jobId: 'demo~web-3', outcome: 'done', text: 'second' });
await sleep(2000);
check('tasks that end together arrive in one message', sent.length === 1 && sent[0].includes('first') && sent[0].includes('second'));

// 3
sent.length = 0;
dispatcher.busy = true;
R.expectReport(task('demo', 4));
R.settleReport({ project: 'demo', jobId: 'demo~web-4', outcome: 'done', text: 'late' });
await sleep(2000);
check('nothing is delivered while the dispatcher is in a turn', sent.length === 0 && pendingOnDisk('demo').length === 1);
dispatcher.busy = false;
R.dispatcherSettled('demo');
await sleep(800);
check('it goes when the turn has settled', sent.length === 1 && sent[0].includes('late'));

// 4
sent.length = 0;
R.expectReport(task('demo', 5));
R.settleReport({ project: 'demo', jobId: 'demo~web-5', outcome: 'cancelled' });
await sleep(500);
check('a cancelled task alone starts no turn', sent.length === 0);
R.expectReport(task('demo', 6));
R.settleReport({ project: 'demo', jobId: 'demo~web-6', outcome: 'failed', error: 'boom', source: 'cli' });
await sleep(2000);
check('a failure carries its source and leaves the decision to the user', sent.length === 1 && sent[0].includes("CLI 报的错") && sent[0].includes('boom') && sent[0].includes('不要自己重试'));
check('the cancelled one is listed with it', sent[0].includes('用户取消'));
check('settling a task nobody waits for does nothing', R.settleReport({ project: 'demo', jobId: 'nobody', outcome: 'done' }) === false);

// 5
sent.length = 0;
R.expectReport(task('demo', 7));
R.expectReport(task('demo', 8));
R.settleReport({ project: 'demo', jobId: 'demo~web-7', outcome: 'done', text: 'finished before the stop' });
// the daemon stops here (nothing delivered yet) and a new one starts: it reads the same file
dispatcher.busy = true;
await sleep(2000);
const R2 = await import('../../daemon/reports.mjs?restart');
const got = [];
R2.wireReports(() => ({ busy: false, prompt: async (t) => void got.push(t) }));
R2.interruptReports([{ jobId: 'demo~web-8', agent: 'demo~web', project: 'demo' }]);
R2.resumeReports();
await sleep(300);
check('after a restart, what finished is delivered and what was running is reported as interrupted', got.length === 1 && got[0].includes('finished before the stop') && got[0].includes('被中断') && got[0].includes('may have done part of it'));

console.log(process.exitCode ? '\n=> ✗ REPORTS BROKEN' : '\n=> ✓ REPORTS OK');
process.exit(process.exitCode ?? 0);
