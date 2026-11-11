/**
 * The data directory is sorted by whom the data belongs to: data/global/ for the machine, data/projects/<id>/ for a
 * project. In a temp folder, no process.
 *
 * Checks:
 *   1. the paths: a project's folder, what an executor's name says about its project, nothing that steps out of the folder
 *   2. what the records and the pool write for an executor lands in its project's folder, not at the top
 *   3. what belongs to the machine (providers, the CLI manifest) is in global/
 *   4. a project's folder is the project: it is found at the next start, and removing the project removes all of it
 *   5. old run logs are deleted in every project, recent ones and other files are not
 */

import '../lib/isolate.mjs';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

const base = await import('../../core/base/index.mjs');
const records = await import('../../core/records/index.mjs');
const manager = await import('../../core/projects/index.mjs');
const { appendReceipt, readReceipts } = await import('../../daemon/receipts.mjs');
const { pruneRunLogs, pruneAllRunLogs } = await import('../../daemon/run-logs.mjs');
const { fitReply } = await import('../../core/records/reply.mjs');
const { check } = await import('../lib/scheduler.mjs');

console.log('\n=== data layout ===\n');
const { DATA_DIR, GLOBAL_DIR, PROJECTS_DIR, projectDir, projectIdOf, instanceIdOf, projectPath } = base;

// 1
check('global/ and projects/ are inside the data directory', GLOBAL_DIR === join(DATA_DIR, 'global') && PROJECTS_DIR === join(DATA_DIR, 'projects'));
check('a project has a folder of its own', projectDir('shop') === join(PROJECTS_DIR, 'shop'));
check('an executor name says its project and its own id', projectIdOf('shop~dsh-1') === 'shop' && instanceIdOf('shop~dsh-1') === 'dsh-1' && projectIdOf('shop~@dispatcher') === 'shop' && instanceIdOf('shop~@dispatcher') === '@dispatcher');
check('nothing steps out of the folder: a name is one folder of projects/', projectDir('..') === join(PROJECTS_DIR, '_') && relative(PROJECTS_DIR, projectDir('a/../../b')).split(sep).length === 1);

// 2
const root = mkdtempSync(join(tmpdir(), 'agentd-layout-root-'));
const info = manager.createProject({ id: 'shop', name: 'Shop', root });
check('the project is written as its own file', existsSync(join(projectDir('shop'), 'project.json')) && info.id === 'shop');
const agent = 'shop~dsh-1';
records.appendEntry(agent, 'S1', { role: 'user', text: 'hi' });
check('a transcript is in transcripts/<executor>/', existsSync(join(projectPath(agent, 'transcripts', 'dsh-1'), 'S1.jsonl')));
const plan = records.planRun({ agent, prompt: 'do it' });
records.recordRun(plan, `${agent}-j1`);
check('the tasks are in tasks.json of the project', existsSync(join(projectDir('shop'), 'tasks.json')));
records.journalStart({ jobId: `${agent}-j1`, agent, project: 'shop', prompt: 'do it' });
check('the journal is in the project', existsSync(join(projectDir('shop'), 'journal.jsonl')));
appendReceipt(agent, { sessionId: 'S1', metrics: { jobId: `${agent}-j1`, outcome: 'done' } }, 'do it');
check('the receipts are in the project, and are read back', existsSync(join(projectDir('shop'), 'receipts.jsonl')) && readReceipts(10, 'shop').length === 1 && readReceipts(10).length === 1);
fitReply(`${agent}-j2`, 'x'.repeat(100), 10);
check('a long reply is saved in results/ of the project', readdirSync(join(projectDir('shop'), 'results')).length === 1);
check('and nothing was written at the top of the data directory except the folders', readdirSync(DATA_DIR).every((n) => ['global', 'projects'].includes(n)), readdirSync(DATA_DIR).join());

// 3
const { PROVIDERS_FILE } = await import('../../core/pool/providers.mjs');
const { CLIS_FILE } = await import('../../core/pool/install.mjs');
check('their files are named in global/', PROVIDERS_FILE === join(GLOBAL_DIR, 'providers.json') && CLIS_FILE === join(GLOBAL_DIR, 'clis.json'));

// 4
check('a project folder is listed', base.projectIdsOnDisk().join() === 'shop');
await manager.removeProject('shop', { force: true });
check('removing the project removes its whole folder', !existsSync(projectDir('shop')) && base.projectIdsOnDisk().length === 0);
records.endRun(`${agent}-j1`, 'done'); // an end that arrives late finds nothing to write
check('and nothing writes it back', !existsSync(projectDir('shop')));

// 5
const runsA = join(projectDir('a'), 'runs');
const runsB = join(projectDir('b'), 'runs');
for (const d of [runsA, runsB]) mkdirSync(d, { recursive: true });
const old = new Date(Date.now() - 20 * 24 * 3600 * 1000);
for (const d of [runsA, runsB]) {
  writeFileSync(join(d, 'old.log'), 'x');
  writeFileSync(join(d, 'new.log'), 'x');
  writeFileSync(join(d, 'old.txt'), 'x');
  utimesSync(join(d, 'old.log'), old, old);
  utimesSync(join(d, 'old.txt'), old, old);
}
check('one folder: the old log is removed', pruneRunLogs(runsA) === 1 && !existsSync(join(runsA, 'old.log')));
check('a recent log and a file that is not a log stay', existsSync(join(runsA, 'new.log')) && existsSync(join(runsA, 'old.txt')));
check('every project is cleared', pruneAllRunLogs() === 1 && !existsSync(join(runsB, 'old.log')) && existsSync(join(runsB, 'new.log')));
check('a missing folder is nothing to do', pruneRunLogs(join(runsA, 'nope')) === 0);

console.log(process.exitCode ? '\n=> ✗ DATA LAYOUT BROKEN' : '\n=> ✓ DATA LAYOUT OK');
process.exit(process.exitCode ?? 0);
