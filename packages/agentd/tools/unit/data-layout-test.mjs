/**
 * The data directory is sorted into folders, and an older flat one is moved into them. Files only, in a temp folder.
 *
 * Checks:
 *   1. every file and folder of the old layout ends up in its folder with its content
 *   2. nothing is overwritten: when the new place is taken the old one stays and is reported
 *   3. a second run changes nothing
 *   4. the old log keeps a name of its own (the new log may already exist)
 *   5. old run logs are deleted, recent ones and other files are not
 *   6. the folders core/data-dir.mjs names are the ones the files are moved into
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTD_DATA_DIR = mkdtempSync(join(tmpdir(), 'agentd-layout-empty-'));
const { migrateDataLayout, pruneRunLogs, MOVES } = await import('../../daemon/data-layout.mjs');
const dirs = await import('../../core/data-dir.mjs');
const { check } = await import('../lib/scheduler.mjs');

console.log('\n=== data layout ===\n');

const put = (root, rel, text) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const fresh = () => {
  const root = mkdtempSync(join(tmpdir(), 'agentd-layout-'));
  for (const [name, , ] of MOVES) {
    if (['transcripts', 'dispatcher-sessions', 'pi-sessions', 'handoffs', 'rules', 'results', 'runs'].includes(name)) put(root, `${name}/inner/file.txt`, `${name} content`);
    else put(root, name, `${name} content`);
  }
  return root;
};

// 1
const root = fresh();
const r = migrateDataLayout(root);
check('everything in MOVES is moved', r.moved.length === MOVES.length && r.kept.length === 0, r.moved.join());
check('files land in state/', readFileSync(join(root, 'state', 'projects.json'), 'utf8') === 'projects.json content' && existsSync(join(root, 'state', 'receipts.jsonl')) && existsSync(join(root, 'state', 'journal.jsonl.interrupted.json')));
check('folders keep their contents, in conversations/', readFileSync(join(root, 'conversations', 'transcripts', 'inner', 'file.txt'), 'utf8') === 'transcripts content' && existsSync(join(root, 'conversations', 'pi-sessions', 'inner', 'file.txt')));
check('outputs/ and runtime/', existsSync(join(root, 'outputs', 'rules', 'inner', 'file.txt')) && existsSync(join(root, 'outputs', 'handoffs')) && existsSync(join(root, 'runtime', 'runs', 'inner', 'file.txt')));
check('nothing is left at the top', !MOVES.some(([n]) => existsSync(join(root, n))));

// 3
const again = migrateDataLayout(root);
check('a second run moves nothing', again.moved.length === 0 && again.kept.length === 0);

// 2
const taken = fresh();
put(taken, 'state/tasks.json', 'the new one');
const t = migrateDataLayout(taken);
check('a taken place is not overwritten', readFileSync(join(taken, 'state', 'tasks.json'), 'utf8') === 'the new one' && readFileSync(join(taken, 'tasks.json'), 'utf8') === 'tasks.json content');
check('and is reported', t.kept.join() === 'tasks.json' && t.moved.length === MOVES.length - 1);

// 4
const withLog = fresh();
put(withLog, 'runtime/agentd.log', 'new log');
migrateDataLayout(withLog);
check('the old log keeps a name of its own', readFileSync(join(withLog, 'runtime', 'agentd.log'), 'utf8') === 'new log' && readFileSync(join(withLog, 'runtime', 'agentd.before-sorting.log'), 'utf8') === 'agentd.log content');

// 5
const runs = join(mkdtempSync(join(tmpdir(), 'agentd-runs-')), 'runs');
put(runs, '../runs/old.log', 'x');
put(runs, '../runs/new.log', 'x');
put(runs, '../runs/old.txt', 'x');
const old = new Date(Date.now() - 20 * 24 * 3600 * 1000);
utimesSync(join(runs, 'old.log'), old, old);
utimesSync(join(runs, 'old.txt'), old, old);
check('one old log is removed', pruneRunLogs(runs) === 1 && !existsSync(join(runs, 'old.log')));
check('a recent log and a file that is not a log stay', existsSync(join(runs, 'new.log')) && existsSync(join(runs, 'old.txt')));
check('a missing folder is nothing to do', pruneRunLogs(join(runs, 'nope')) === 0);

// 6
const folderOf = { state: dirs.STATE_DIR, conversations: dirs.CONVERSATIONS_DIR, outputs: dirs.OUTPUTS_DIR, runtime: dirs.RUNTIME_DIR };
check('the folder names match core/data-dir.mjs', MOVES.every(([, f]) => folderOf[f] === join(dirs.DATA_DIR, f)));

console.log(process.exitCode ? '\n=> ✗ DATA LAYOUT BROKEN' : '\n=> ✓ DATA LAYOUT OK');
process.exit(process.exitCode ?? 0);
