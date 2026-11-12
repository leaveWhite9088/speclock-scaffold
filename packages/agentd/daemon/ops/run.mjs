/**
 * The `run` operation: give an executor a prompt. It makes the task plan (which attempt this is), starts the prompt,
 * writes the journal, announces the start and the end, and files the receipt.
 */

import { getAgent } from '../../core/pool/index.mjs';
import { clearInterrupted, journalEnd, journalStart } from '../../core/records/index.mjs';
import { endRun, planRun, recordRun } from '../../core/records/index.mjs';
import { noteRunOutcome } from '../dispatchers.mjs';
import { allocEvent, publish, subscribe } from '../events.mjs';
import { appendReceipt } from '../receipts.mjs';
import { expectReport, settleReport } from '../reports.mjs';

/** @param {{ protocol: number, startedAt: string, idleInstanceMs: number }} ctx */
export function runOps(ctx) {
  return {
    run: async (
      { agent, prompt, cwd, timeoutMs, reset, sessionId, model, async: isAsync, subscribe: wantSub, retryOf, caller, report },
      sock,
    ) => {
      const a = getAgent(agent);
      // A task for a module goes to that module's conversation. When the executor is idle the dispatcher has already switched it,
      // so a different name means it forgot; refused here, with what to do. (While it works a switch may be waiting in line: trusted.)
      const forModule = caller === 'dispatcher' ? /(?:待办|工作项)\s*\**\s*#\d+\s*[（(]\s*模块「([^」]+)」/.exec(String(prompt ?? ''))?.[1]?.trim() : null;
      if (forModule && !a.inUse && (a.currentSessionLabel() ?? '').trim() !== forModule) {
        throw new Error(
          `${a.name} is in the conversation "${a.currentSessionLabel() ?? '(no name)'}", but this task is for the module "${forModule}". ` +
            `One conversation is for one module: switch with agent_session_use "${forModule}" (or open it with agent_session_new, named "${forModule}"), then send the task again.`,
        );
      }
      // Which task is this an attempt at? Refused here when the task has used up its attempts.
      const plan = planRun({ agent: a.name, prompt, retryOf, counted: caller === 'dispatcher' });
      const task = { taskId: plan.taskId, attempt: plan.attempt, retryOf: plan.retryOf, maxAttempts: plan.maxAttempts };
      if (model) await a.setConfigOption('model', model, sessionId);
      const started = a.startPrompt(prompt, { timeoutMs, cwd, reset, sessionId, meta: { taskId: task.taskId, attempt: task.attempt, retryOf: task.retryOf } });
      recordRun(plan, started.jobId);

      // Subscribe before the run can finish. A fast agent could otherwise complete
      // between the caller receiving the jobId and its separate subscribe call,
      // and the `done` event would be broadcast to nobody.
      if (wantSub && sock) subscribe(sock, started.jobId);

      // Sent without waiting: the answer goes to the dispatcher as a message of its own when it comes (reports.mjs).
      const reporting = Boolean(report) && caller === 'dispatcher' && Boolean(a.project);
      if (reporting) expectReport({ project: a.project, jobId: started.jobId, agent: a.name, prompt, ...task });

      task.queued = started.ahead > 0;
      task.ahead = started.ahead;
      journalStart({ jobId: started.jobId, agent: a.name, project: a.project, prompt, ...task });
      clearInterrupted(a.name);
      publish(
        allocEvent('job.started', {
          jobId: started.jobId,
          ...task,
          agent: a.name,
          sessionId: a.sessionId,
          prompt: typeof prompt === 'string' ? prompt.slice(0, 160) : null,
        }),
      );

      const finish = (result, error) => {
        journalEnd(started.jobId);
        endRun(started.jobId, error ? (error.metrics?.outcome ?? 'failed') : (result?.metrics?.outcome ?? 'done'));
        const ev = allocEvent('job.done', {
          jobId: started.jobId,
          ...task,
          agent: a.name,
          ...(error
            ? { error: error.message, metrics: error.metrics ?? { error: error.message, attention: [], health: 'error' } }
            : { result }),
        });
        // The receipt embeds the event id, so history and stream can be joined.
        ev.receipt = appendReceipt(
          a.name,
          error ? { metrics: ev.metrics, sessionId: error.sessionId ?? null } : result,
          prompt,
          ev.id,
          task,
        );
        publish(ev);
        const failed = (!!error || !!result?.metrics?.error) && error?.metrics?.outcome !== 'cancelled';
        noteRunOutcome(a, failed, error?.message ?? result?.metrics?.error ?? '');
        if (reporting) {
          const m = error ? error.metrics : result?.metrics;
          const cancelled = m?.outcome === 'cancelled' || result?.stopReason === 'cancelled';
          const message = error?.message ?? result?.metrics?.error ?? null;
          settleReport({
            project: a.project,
            jobId: started.jobId,
            outcome: cancelled ? 'cancelled' : message ? 'failed' : 'done',
            // A run the CLI ended without saying why may be unfinished: the dispatcher is told so, not left to take the reply for a conclusion.
            text: m?.attention?.some((x) => x.code === 'no_stop_reason' || x.code === 'ended_without_result')
              ? `（注意：执行者这次运行没有正常收尾（CLI 没说为什么结束，或停在了一半、没给出结果），可能没做完。下面只是它中途说过的话，不是正式结论；是否完成请以文件和规格库里的实际结果为准，必要时让它接着做。）
${result?.text ?? ''}`
              : (result?.text ?? ''),
            error: message,
            source: m?.failureSource ?? null,
            tookMs: m?.durationMs ?? m?.totalMs ?? null,
            sessionId: result?.sessionId ?? error?.sessionId ?? null,
          });
        }
        return ev;
      };

      if (isAsync) {
        started.done.then((r) => finish(r)).catch((e) => finish(null, e));
        return { jobId: started.jobId, async: true, ...task };
      }

      try {
        const r = await started.done;
        const ev = finish(r);
        return { ...r, jobId: started.jobId, ...task, receipt: ev.receipt };
      } catch (e) {
        finish(null, e);
        throw e;
      }
    },
  };
}
