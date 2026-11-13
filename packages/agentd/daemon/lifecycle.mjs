/**
 * How the daemon lives and ends. Project instances and dispatchers that were not used for a while are stopped (their
 * sessions stay on disk and come back on the next use); the daemon itself exits when nobody is connected and nothing
 * runs; a signal shuts everything down cleanly.
 */

import { rmSync } from 'node:fs';

/** How long the processes get to stop before the daemon exits anyway. */
const SHUTDOWN_MS = 10_000;

/**
 * @param {{
 *   endpointFile: string, pool: Map<string, any>, dispatchers: Map<string, any>,
 *   sweepIdle: (ms: number) => Promise<string[]>,       // stops idle project instances, says which
 *   stats: { connections: number, lastActivity: number },
 *   idleMs: number, idleInstanceMs: number,
 *   log: (...a: any[]) => void,
 * }} o
 * @returns {{ shutdown: (code: number) => Promise<void> }}
 */
export function startLifecycle({ endpointFile, pool, dispatchers, sweepIdle, stats, idleMs, idleInstanceMs, log }) {
  const anyDispatcherBusy = () => [...dispatchers.values()].some((d) => d.busy);

  let ending = null;
  /**
   * Stop everything and exit. Asked again (a second signal, the idle check coming round while this runs) it does not start
   * over, and a process that will not stop cannot keep the daemon from ending: after SHUTDOWN_MS it exits anyway.
   */
  function shutdown(code) {
    if (ending) return ending;
    try {
      rmSync(endpointFile, { force: true });
    } catch {
      /* ignore */
    }
    const force = setTimeout(() => {
      log(`some processes did not stop within ${SHUTDOWN_MS / 1000}s; exiting anyway`);
      process.exit(code);
    }, SHUTDOWN_MS);
    ending = Promise.all([...[...pool.values()].map((a) => a.shutdown().catch(() => {})), ...[...dispatchers.values()].map((d) => d.shutdown().catch(() => {}))]).then(() => {
      clearTimeout(force);
      process.exit(code);
    });
    return ending;
  }

  // Idle recycling. One sweep at a time: stopping a process can take longer than the interval, and two sweeps would stop the same one twice.
  let sweeping = false;
  setInterval(async () => {
    if (sweeping || ending) return;
    sweeping = true;
    try {
      const stopped = await sweepIdle(idleInstanceMs);
      for (const [key, d] of dispatchers) {
        if (d.child && !d.busy && Date.now() - d.lastActive > idleInstanceMs) {
          await d.shutdown();
          stopped.push(`dispatcher:${key}`);
        }
      }
      if (stopped.length) log(`idle, stopped: ${stopped.join(', ')}`);
    } catch (err) {
      log('idle sweep failed:', err.message);
    } finally {
      sweeping = false;
    }
  }, 60_000).unref();

  // Idle shutdown: no clients, nothing running.
  setInterval(() => {
    const busy = [...pool.values()].some((a) => a.busy) || anyDispatcherBusy();
    if (!ending && stats.connections === 0 && !busy && Date.now() - stats.lastActivity > idleMs) {
      log('idle; shutting down');
      shutdown(0);
    }
  }, 30_000).unref();

  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(0));
  process.on('uncaughtException', (e) => {
    log('uncaught:', e?.stack ?? String(e));
  });

  return { shutdown };
}
