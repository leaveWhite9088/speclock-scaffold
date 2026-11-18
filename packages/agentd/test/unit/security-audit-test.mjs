/**
 * Security & audit regression suite (SEC-01 .. SEC-08 + injection counter-examples).
 * Runs in an isolated temp data directory without requiring live LLM CLIs.
 */

import '../lib/isolate.mjs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { createProject } = await import('../../core/projects/index.mjs');
const { addPiProvider } = await import('../../core/pi/index.mjs');
const { appendReceipt, readAudits } = await import('../../daemon/receipts.mjs');
const { scopeArgs } = await import('../../daemon/guard.mjs');
const { systemOps } = await import('../../daemon/ops/system.mjs');
const { check } = await import('../lib/scheduler.mjs');

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const MONO_ROOT = dirname(dirname(ROOT));

console.log('\n=== security & audit ===\n');

// -- 1. Gateway Host / Origin CSRF & JSON encoding guard (SEC-01 + CSRF) ------
const port = 19000 + Math.floor(Math.random() * 900);
const gw = spawn(process.execPath, [join(MONO_ROOT, 'packages', 'backend', 'src', 'server.mjs')], {
  env: { ...process.env, BACKEND_PORT: String(port) },
  stdio: ['ignore', 'ignore', 'ignore'],
});

try {
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/nope`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const protectedPaths = ['/api/agents', '/api/projects', '/api/providers', '/api/receipts', '/api/audits'];
  let hostRejectedAll = true;
  for (const p of protectedPaths) {
    const code = await new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port, path: p, headers: { host: 'external.example.test' } }, (r) => {
        r.resume();
        resolve(r.statusCode);
      });
    });
    if (code !== 403) hostRejectedAll = false;
  }
  check('SEC-01 non-local Host is refused with 403 across all 5 protected endpoints', hostRejectedAll);

  const csrfRes = await fetch(`http://127.0.0.1:${port}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://external.example.test' },
    body: JSON.stringify({ id: 'csrf', root: tmpdir() }),
  });
  check('CSRF cross-site Origin write is refused with 403', csrfRes.status === 403);
  check('gateway responses enforce application/json; charset=utf-8', /application\/json;\s*charset=utf-8/i.test(csrfRes.headers.get('content-type') ?? ''));
} finally {
  gw.kill();
  await new Promise((r) => gw.once('exit', r));
}

// -- 2. Cross-project isolation & single-side receipt filtering (SEC-02) ------
const rootA = mkdtempSync(join(tmpdir(), 'sec-projA-'));
const rootB = mkdtempSync(join(tmpdir(), 'sec-projB-'));
createProject({ id: 'projA', name: 'Project A', root: rootA });
createProject({ id: 'projB', name: 'Project B', root: rootB });

appendReceipt(
  'projA~coder',
  { sessionId: 'sA', metrics: { jobId: 'jA', outcome: 'done', durationMs: 420, tokens: { input: 100, output: 50 } } },
  'implement feature A',
  'ev-1',
  { taskId: 'tA', attempt: 1, caller: 'dispatcher' },
);
appendReceipt(
  'projB~coder',
  { sessionId: 'sB', metrics: { jobId: 'jB', outcome: 'done', durationMs: 310, tokens: { input: 80, output: 40 } } },
  'internal prompt of project B',
  'ev-2',
  { taskId: 'tB', attempt: 1, caller: 'user' },
);

const sys = systemOps({ protocol: 3, startedAt: 'now', idleInstanceMs: 1000, shutdown: async () => {} });
const scopedA = sys.receipts({ limit: 50, project: 'projA' }).receipts;
check('SEC-02 receipts query with project=projA returns only projA records (0 cross-project leak)', scopedA.length === 1 && scopedA[0].agent === 'projA~coder');

let crossAgentBlocked = false;
try {
  scopeArgs('run', { caller: 'dispatcher', project: 'projA', agent: 'projB~coder', prompt: 'ping' });
} catch (err) {
  crossAgentBlocked = /outside project/.test(err.message);
}
check('SEC-02 cross-project executor access from projA dispatcher is refused', crossAgentBlocked);

// -- 3. Role privilege & parameter bypass blocks (SEC-03, SEC-04, SEC-08) -----
const deniedOps = ['provider.save', 'template.save', 'project.updateInstance', 'daemon.shutdown', 'audits'];
const allDeniedBlocked = deniedOps.every((op) => {
  try {
    scopeArgs(op, { caller: 'dispatcher', project: 'projA' });
    return false;
  } catch {
    return true;
  }
});
check('SEC-03 & SEC-08 dispatcher is blocked from provider/template/project/shutdown/audits ops', allDeniedBlocked);

let bypassBlocked = false;
try {
  scopeArgs('run', { caller: 'dispatcher', project: 'projA', agent: 'coder', prompt: 'hi', reset: true });
} catch {
  bypassBlocked = true;
}
check('SEC-04 dispatcher bypass via run(reset=true) is refused', bypassBlocked);

// -- 4. Injection counter-examples (Command, Path traversal, XSS) -------------
const piTmp = mkdtempSync(join(tmpdir(), 'sec-pi-'));
let cmdInjBlocked = false;
try {
  addPiProvider({ provider: 'bad', baseUrl: 'https://api.example.test/v1', apiKey: '!echo key', models: [{ id: 'm1' }] }, piTmp);
} catch (err) {
  cmdInjBlocked = /shell command/.test(err.message);
}
check('Injection-1: apiKey starting with "!" (command prefix) is refused', cmdInjBlocked);

let pathEscBlocked = false;
try {
  scopeArgs('new', { caller: 'user', project: 'projA', agent: 'coder', cwd: '../outside-dir' });
} catch (err) {
  pathEscBlocked = /outside/.test(err.message);
}
check('Injection-2: cwd escaping project root ("../outside-dir") is refused', pathEscBlocked);

function collectFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...collectFiles(p));
    else if (/\.(ts|tsx|js|jsx|html)$/.test(name)) out.push(p);
  }
  return out;
}
const webFiles = collectFiles(join(MONO_ROOT, 'packages', 'web', 'src'));
const rawHtmlHits = webFiles.filter((f) => /dangerouslySetInnerHTML|\.innerHTML\s*=/.test(readFileSync(f, 'utf8')));
check('Injection-3 (XSS): web frontend source contains zero raw HTML injection sinks', rawHtmlHits.length === 0);

// -- 5. Audit log completeness & rejected call traceability (SEC-07) ----------
const recA = scopedA[0];
check(
  'SEC-07 receipt preserves caller, agent, status, durationMs and token usage',
  recA.caller === 'dispatcher' && recA.agent === 'projA~coder' && recA.status === 'done' && recA.durationMs === 420 && recA.tokens?.input === 100,
);

const audits = readAudits(50);
check(
  'SEC-07 rejected unauthorized calls are recorded in audit.jsonl with actor, op and denied status',
  audits.length >= 6 &&
    audits.every((a) => a.status === 'denied' && Boolean(a.ts) && Boolean(a.actor) && Boolean(a.op)) &&
    audits.some((a) => a.op === 'provider.save' && a.actor === 'dispatcher') &&
    audits.some((a) => a.op === 'run' && a.target === 'projB~coder'),
);

console.log(process.exitCode ? '\n=> ✗ SECURITY & AUDIT BROKEN' : '\n=> ✓ SECURITY & AUDIT OK');
process.exitCode = process.exitCode ?? 0;
