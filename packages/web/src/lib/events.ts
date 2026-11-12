/** Live events from the backend (SSE), fanned out to whoever listens. */

export type LiveName = 'dispatcher.event' | 'job.started' | 'job.done' | 'agent.exit' | 'agent.forced-stop' | 'agent.recovered' | 'job.interrupted' | 'job.running' | 'progress' | 'handoff.changed' | 'agent.compacted';
export interface LiveEvent {
  name: LiveName;
  /** dispatcher.event: the project it belongs to */
  project?: string;
  /** job.*: the executor key */
  agent?: string;
  /** progress: what the run is doing */
  elapsedMs?: number;
  tool?: string | null;
  toolCalls?: number;
  openTools?: number;
  thinkingChars?: number;
  /** job.started: it waits behind other prompts of the same executor */
  queued?: boolean;
  ahead?: number;
  /** job.*: the run, and how it ended */
  jobId?: string;
  result?: { text?: string; metrics?: { outcome?: string; durationMs?: number } };
  error?: string;
  metrics?: { outcome?: string; durationMs?: number };
  /** job.*: which attempt at its task this run is */
  attempt?: number;
  maxAttempts?: number;
  data?: {
    type?: string;
    kind?: string;
    delta?: string;
    toolName?: string;
    toolCallId?: string;
    args?: unknown;
    isError?: boolean;
    result?: { content?: unknown; details?: { attempt?: number; maxAttempts?: number } };
    code?: number;
    /** pi's own message events: the message itself (role, content, timestamp), or `truncated` when it was too big to carry */
    message?: { role?: string; content?: unknown; timestamp?: number };
    truncated?: boolean;
  };
}

type Handler = (e: LiveEvent) => void;
const handlers = new Set<Handler>();

export function onLive(h: Handler): () => void {
  handlers.add(h);
  return () => handlers.delete(h);
}
export const emitLive = (e: LiveEvent) => handlers.forEach((h) => h(e));
