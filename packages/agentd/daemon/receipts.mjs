/** Append-only log of finished runs (projects/<project>/receipts.jsonl), so receipts survive restarts and idle gaps. */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GLOBAL_DIR, projectDir, projectIdOf, projectIdsOnDisk } from '../core/base/index.mjs';

const fileOf = (project) => join(projectDir(project), 'receipts.jsonl');
const auditFile = () => join(GLOBAL_DIR, 'audit.jsonl');
const log = (...a) => process.stderr.write(`[agentd] ${a.join(' ')}\n`);

export function appendReceipt(agent, result, prompt, eventId = null, task = {}) {
  const m = result?.metrics ?? {};
  const receipt = {
    ts: new Date().toISOString(),
    eventId,
    jobId: m.jobId ?? null,
    taskId: task.taskId ?? null,
    attempt: task.attempt ?? null,
    retryOf: task.retryOf ?? null,
    caller: task.caller ?? 'user',
    agent,
    sessionId: result?.sessionId ?? null,
    status: m.outcome ?? (m.error ? 'failed' : m.stopReason === 'cancelled' ? 'cancelled' : 'done'),
    forced: Boolean(m.forced),
    failureSource: m.failureSource ?? null,
    stopReason: m.stopReason ?? null,
    durationMs: m.durationMs ?? null,
    health: m.health ?? 'ok',
    attention: m.attention ?? [],
    model: m.modelName ?? m.model ?? null,
    tokens: m.tokens ?? null,
    context: m.context ?? null,
    chars: m.chars ?? 0,
    prompt: typeof prompt === 'string' ? prompt.slice(0, 160) : null,
  };
  try {
    const project = projectIdOf(agent);
    mkdirSync(projectDir(project), { recursive: true });
    appendFileSync(fileOf(project), JSON.stringify(receipt) + '\n', 'utf8');
  } catch (err) {
    log('could not write receipt:', err.message);
  }
  return receipt;
}

/** The last `limit` receipts of one project, or of all projects together (the newest by time). */
export function readReceipts(limit = 50, project = null) {
  const tail = (p) => {
    try {
      return readFileSync(fileOf(p), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(-limit)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  };
  if (project) return tail(project);
  return projectIdsOnDisk()
    .flatMap(tail)
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
    .slice(-limit);
}

/** Append a single-line JSON security/operation audit record (e.g., rejected unauthorized calls). */
export function appendAudit({ actor = 'unknown', project = null, op = '', target = null, status = 'denied', detail = '' } = {}) {
  const rec = {
    ts: new Date().toISOString(),
    actor: String(actor).slice(0, 64),
    project: project ? String(project).slice(0, 64) : null,
    op: String(op).slice(0, 64),
    target: target ? String(target).slice(0, 128) : null,
    status: String(status).slice(0, 32),
    detail: String(detail).slice(0, 200),
  };
  try {
    mkdirSync(GLOBAL_DIR, { recursive: true });
    appendFileSync(auditFile(), JSON.stringify(rec) + '\n', 'utf8');
  } catch (err) {
    log('could not write audit:', err.message);
  }
  return rec;
}

/** Read the last `limit` audit records, optionally filtered by project. */
export function readAudits(limit = 50, project = null) {
  try {
    const rows = readFileSync(auditFile(), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const filtered = project ? rows.filter((r) => r.project === project) : rows;
    return filtered.slice(-limit);
  } catch {
    return [];
  }
}
