/**
 * Operations on the daemon itself: who it is, what happened (events, receipts), how healthy the agents are, and
 * who listens to a job.
 */

import { AGENTS, getAgent, pool } from '../../core/pool/index.mjs';
import { dispatchers } from '../dispatchers.mjs';
import { EPOCH, RING_MAX, eventsSince, subscribe, unsubscribe } from '../events.mjs';
import { readAudits, readReceipts } from '../receipts.mjs';

/** @param {{ protocol: number, startedAt: string, idleInstanceMs: number, shutdown: (code: number) => Promise<void> }} ctx */
export function systemOps(ctx) {
  return {
    hello: () => ({
      protocol: ctx.protocol,
      epoch: EPOCH,
      pid: process.pid,
      startedAt: ctx.startedAt,
      agents: [...pool.keys()],
      types: Object.keys(AGENTS),
    }),

    /** Replay durable events after a known id (Last-Event-ID semantics). */
    'events.since': ({ afterId, limit } = {}) => eventsSince(afterId, Math.min(Number(limit) || 500, RING_MAX)),

    /** Recent receipts, newest last (scoped to `project` when given). */
    receipts: ({ limit, project } = {}) => ({ receipts: readReceipts(Math.min(Number(limit) || 50, 500), project ?? null) }),

    /** Recent security and rejection audit records, newest last. */
    audits: ({ limit, project } = {}) => ({ audits: readAudits(Math.min(Number(limit) || 50, 500), project ?? null) }),

    /**
     * Observability metrics & 3-part alert evaluation (counter by agent/status, queue depth, P95 duration, 5m alert rule).
     * Error ratio is derived by consumers/dashboards from status="failed" over total invocations (single source of truth).
     */
    metrics: ({ windowSec } = {}) => {
      const winMs = (Math.max(10, Number(windowSec) || 300)) * 1000;
      const cutoff = Date.now() - winMs;
      const allReceipts = readReceipts(500);
      const allAudits = readAudits(500);

      const invCounts = new Map();
      const durations = [];
      let recentRuns = 0;
      let recentFailed = 0;

      for (const r of allReceipts) {
        const agent = r.agent || 'unknown';
        const status = r.status || 'done';
        const key = `${agent}|${status}`;
        invCounts.set(key, (invCounts.get(key) ?? 0) + 1);
        if (Number.isFinite(r.durationMs) && r.durationMs >= 0) durations.push(r.durationMs);
        const ts = Date.parse(r.ts || '');
        if (ts >= cutoff) {
          recentRuns++;
          if (status === 'failed') recentFailed++;
        }
      }
      durations.sort((a, b) => a - b);
      const p95Ms = durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] : 0;

      const queues = [...pool.values()].map((a) => ({ agent: a.name, inflight: a.inflight ?? 0, waiting: a.waitingJobs?.().length ?? 0 }));
      const recentDenied = allAudits.filter((a) => a.status === 'denied' && Date.parse(a.ts || '') >= cutoff).length;
      const recentErrRate = recentRuns > 0 ? recentFailed / recentRuns : 0;

      // 3-part alert rule: metric + sustained window condition + action
      const alertFiring = recentDenied >= 3 || (recentRuns >= 5 && recentErrRate > 0.05);
      const alert = {
        rule: '5 分钟窗口内越权拒绝 >= 3 次 或 任务错误率 > 5%（样本 >= 5） -> 标记 FIRING 并写入告警通知记录（附 /api/metrics 与 /api/audits 排查入口）',
        state: alertFiring ? 'FIRING' : 'OK',
        windowSec: winMs / 1000,
        recentDenied,
        recentRuns,
        recentFailed,
        action: alertFiring ? 'notify-maintainer: inspect /api/audits and /api/receipts' : 'none',
      };

      const promLines = [
        '# HELP agent_invocations_total Total executor invocations partitioned by agent and status.',
        '# TYPE agent_invocations_total counter',
        ...[...invCounts.entries()].map(([k, v]) => {
          const [ag, st] = k.split('|');
          return `agent_invocations_total{agent="${ag}",status="${st}"} ${v}`;
        }),
        '# HELP agent_invocation_p95_ms 95th percentile invocation duration in milliseconds.',
        '# TYPE agent_invocation_p95_ms gauge',
        `agent_invocation_p95_ms ${p95Ms}`,
        '# HELP agent_queue_depth Current waiting + inflight tasks per executor.',
        '# TYPE agent_queue_depth gauge',
        ...queues.map((q) => `agent_queue_depth{agent="${q.agent}"} ${q.inflight}`),
        '# HELP security_audit_denied_recent Rejected unauthorized calls within the alert window.',
        '# TYPE security_audit_denied_recent gauge',
        `security_audit_denied_recent ${recentDenied}`,
        '# HELP system_alert_firing 1 when the 3-part alert rule is firing, else 0.',
        '# TYPE system_alert_firing gauge',
        `system_alert_firing ${alertFiring ? 1 : 0}`,
      ];

      return {
        invocations: Object.fromEntries(invCounts),
        p95DurationMs: p95Ms,
        queues,
        alert,
        prometheus: promLines.join('\n') + '\n',
      };
    },

    /** Agent health view: liveness + last run's inferred attention. */
    health: async () => {
      const agents = [];
      for (const name of [...pool.keys()]) {
        agents.push(await getAgent(name).serialized(() => getAgent(name).status()));
      }
      return { agents };
    },

    subscribe: ({ jobId }, sock) => {
      if (jobId) subscribe(sock, jobId);
      return { subscribed: jobId ?? null };
    },

    unsubscribe: ({ jobId }, sock) => {
      if (jobId) unsubscribe(sock, jobId);
      return { subscribed: null };
    },

    /**
     * End the daemon, cleanly: the same shutdown as when it is idle or gets a signal. Refused while anything is working
     * or waiting, so it never takes a person's task down. The next request starts a fresh daemon (new code, new state).
     */
    'daemon.shutdown': () => {
      const busy = [
        ...[...pool.values()].filter((a) => a.busy || a.inflight > 0).map((a) => a.name),
        ...[...dispatchers].filter(([, d]) => d.busy || d.queue.length).map(([key]) => `${key} dispatcher`),
      ];
      if (busy.length) throw new Error(`not stopping: still working on ${busy.join(', ')}`);
      // After the answer has gone out.
      setTimeout(() => void ctx.shutdown(0), 200);
      return { stopping: true, pid: process.pid };
    },
  };
}
