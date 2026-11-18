/**
 * Reproducible HTTP gateway + agentd load benchmark (`npm run bench`).
 *
 * Environment variables:
 *   VUS           Concurrent virtual users (default: 20)
 *   DURATION_SEC  Duration per endpoint in seconds (default: 4)
 *   SEED_RECEIPTS Number of historical receipts seeded in project "bench" (default: 1200)
 *
 * Spawns an isolated daemon + gateway in a temp directory, warms up to skip cold-start jitter,
 * and measures throughput (QPS), P50/P95 latency (ms), and error rate across three endpoints:
 *   1. Write/Check gate: POST /api/projects (idempotent validation & project registry)
 *   2. Pool query:       GET  /api/agents
 *   3. Receipt search:   GET  /api/receipts?project=bench&limit=50
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VUS = Math.max(1, Number(process.env.VUS) || 20);
const DURATION_MS = Math.max(1, Number(process.env.DURATION_SEC) || 4) * 1000;
const SEED_COUNT = Math.max(100, Number(process.env.SEED_RECEIPTS) || 1200);

const dataDir = mkdtempSync(join(tmpdir(), 'speclock-bench-data-'));
const projRoot = mkdtempSync(join(tmpdir(), 'speclock-bench-proj-'));
const daemonPort = 21000 + Math.floor(Math.random() * 1000);
const gwPort = 22000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${gwPort}`;

// Seed project & 1200 realistic receipts (~450 KB JSONL) before starting
const projDir = join(dataDir, 'projects', 'bench');
mkdirSync(projDir, { recursive: true });
writeFileSync(
  join(projDir, 'project.json'),
  JSON.stringify({ id: 'bench', name: 'Bench Project', root: projRoot, instances: [] }, null, 2),
);

const lines = [];
for (let i = 0; i < SEED_COUNT; i++) {
  lines.push(
    JSON.stringify({
      ts: new Date(Date.now() - (SEED_COUNT - i) * 1000).toISOString(),
      eventId: `ev-${i}`,
      jobId: `bench~coder-${i}`,
      taskId: `task-${i}`,
      attempt: 1,
      caller: i % 3 === 0 ? 'user' : 'dispatcher',
      agent: i % 2 === 0 ? 'bench~coder' : 'bench~tester',
      sessionId: `sess-${i % 10}`,
      status: i % 25 === 0 ? 'failed' : 'done',
      durationMs: 200 + (i % 900),
      tokens: { input: 500 + i, output: 200 + (i % 100) },
      prompt: `Verify acceptance condition AC-${(i % 12) + 1} for module payment-settlement iteration ${i}`,
    }),
  );
}
writeFileSync(join(projDir, 'receipts.jsonl'), lines.join('\n') + '\n', 'utf8');

const env = {
  ...process.env,
  AGENTD_DATA_DIR: dataDir,
  AGENTD_PORT: String(daemonPort),
  AGENTD_PIPE: `\\\\.\\pipe\\speclock-bench-${process.pid}-${daemonPort}`,
  BACKEND_PORT: String(gwPort),
};

const daemon = spawn(process.execPath, [join(ROOT, 'packages', 'agentd', 'daemon', 'agentd.mjs')], {
  env,
  stdio: ['ignore', 'ignore', 'ignore'],
});
const gw = spawn(process.execPath, [join(ROOT, 'packages', 'backend', 'src', 'server.mjs')], {
  env,
  stdio: ['ignore', 'ignore', 'ignore'],
});

async function runStage(name, makeReq) {
  const latencies = [];
  let total = 0;
  let errors = 0;
  const deadline = performance.now() + DURATION_MS;

  const worker = async () => {
    while (performance.now() < deadline) {
      const t0 = performance.now();
      try {
        const ok = await makeReq();
        latencies.push(performance.now() - t0);
        total++;
        if (!ok) errors++;
      } catch {
        latencies.push(performance.now() - t0);
        total++;
        errors++;
      }
    }
  };

  const start = performance.now();
  await Promise.all(Array.from({ length: VUS }, () => worker()));
  const elapsedSec = (performance.now() - start) / 1000;
  latencies.sort((a, b) => a - b);
  const pct = (p) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] : 0);

  return {
    name,
    vus: VUS,
    total,
    qps: (total / elapsedSec).toFixed(1),
    p50: pct(0.5).toFixed(2),
    p95: pct(0.95).toFixed(2),
    errRate: total ? ((errors / total) * 100).toFixed(2) + '%' : '0.00%',
  };
}

try {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.status === 200) break;
    } catch {
      /* wait */
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  // Warm-up (avoid cold-start window)
  for (let i = 0; i < 30; i++) {
    await fetch(`${base}/api/agents`);
    await fetch(`${base}/api/receipts?project=bench&limit=50`);
  }

  console.log(`\n=== Load Benchmark (VUS=${VUS}, duration=${DURATION_MS / 1000}s/endpoint, seededReceipts=${SEED_COUNT}) ===\n`);

  const r1 = await runStage('POST /api/projects (写入校验)', async () => {
    const res = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'bench', root: projRoot }),
    });
    await res.arrayBuffer();
    // 200 or 400 (already exists) proves deterministic admission without 5xx
    return res.status === 200 || res.status === 400;
  });

  const r2 = await runStage('GET /api/agents (实例池查询)', async () => {
    const res = await fetch(`${base}/api/agents`);
    await res.arrayBuffer();
    return res.status === 200;
  });

  const r3 = await runStage('GET /api/receipts?project=bench (回执检索)', async () => {
    const res = await fetch(`${base}/api/receipts?project=bench&limit=50`);
    await res.arrayBuffer();
    return res.status === 200;
  });

  console.log('| 接口场景 | 并发 VUS | 完成请求数 | 吞吐 (QPS) | P50 (ms) | P95 (ms) | 错误率 |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of [r1, r2, r3]) {
    console.log(`| ${r.name} | ${r.vus} | ${r.total} | ${r.qps} | ${r.p50} | ${r.p95} | ${r.errRate} |`);
  }
} finally {
  gw.kill();
  daemon.kill();
  await Promise.all([new Promise((r) => gw.once('exit', r)), new Promise((r) => daemon.once('exit', r))]);
  try {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(projRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
