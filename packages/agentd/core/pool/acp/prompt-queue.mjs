/**
 * The line an agent's work waits in. One thing runs at a time, in the order it was handed over, except that a waiting
 * prompt can be moved to the front (`promote`). A prompt that has not started yet can be cancelled by its job id, and its
 * caller is answered at once. Session operations go through the same line, so they never overlap a running prompt; they
 * keep their place and are never promoted.
 *
 * Which conversation a task runs in depends on what ran before it (the dispatcher switches the executor, then sends the
 * task), so a task cannot just be moved ahead: its place in line is also its place in a conversation. A switch (or a task that
 * names its own conversation) is therefore marked with `session`, and `promote` carries that along (see there).
 */

export class PromptQueue {
  /**
   * `touch` is called whenever work is queued or finishes (the pool uses it to recycle idle processes). `switcher` is how the
   * line itself changes the conversation: `{ current(): id | null, use(id): Promise }`, needed to move a task up.
   */
  constructor({ touch = () => {}, switcher = null } = {}) {
    this.touch = touch;
    this.switcher = switcher;
    /** Something is running now. */
    this.running = false;
    /** What waits its turn, next first: `{ jobId | null, label, at, priority, run, resolve, reject }`. */
    this.items = [];
    /** Prompts handed over and not finished yet (running or waiting their turn). */
    this.inflight = 0;
    /** Prompts waiting their turn: jobId -> { text, at }. */
    this.queuedJobs = new Map();
  }

  _pump() {
    if (this.running) return;
    const item = this.items.shift();
    if (!item) return;
    this.running = true;
    if (item.jobId) this.queuedJobs.delete(item.jobId);
    Promise.resolve()
      .then(item.run)
      .then(item.resolve, item.reject)
      .finally(() => {
        this.running = false;
        this.touch();
        this._pump();
      });
  }

  _add(item) {
    this.touch();
    const done = new Promise((resolve, reject) => {
      item.resolve = resolve;
      item.reject = reject;
    });
    this.items.push(item);
    // a tick later: until then the first of a burst still counts as waiting (it can be cancelled or promoted)
    Promise.resolve().then(() => this._pump());
    return done;
  }

  /**
   * Run `task` after everything ahead of it, whether that succeeded or not. `session` says what it does to the conversation:
   * `{ kind: 'use', id }` switches to that one (and may be done again), `{ kind: 'other' }` changes it in a way that cannot be
   * repeated (a new conversation), nothing: it does not change it.
   */
  enqueue(task, { session = null } = {}) {
    return this._add({ jobId: null, session, run: task });
  }

  /**
   * Put a prompt in line. `task` runs when its turn comes (unless it was cancelled meanwhile, then `cancelled()` is the
   * error). Returns `{ done, ahead }`: `done` settles when the task does, or at once when the prompt is cancelled while it
   * waits; `ahead` is how many were in line before it.
   */
  submit(jobId, label, task, cancelled, { session = null } = {}) {
    const ahead = this.inflight;
    this.inflight += 1;
    this.queuedJobs.set(jobId, { text: String(label).slice(0, 300), at: Date.now() });
    const done = this._add({ jobId, priority: false, session, cancelled, run: task });
    const leave = () => {
      this.inflight -= 1;
    };
    done.then(leave, leave);
    return { done, ahead };
  }

  /** Cancel a prompt that is still waiting. False when it is not waiting (running, over, or unknown). */
  cancelWaiting(jobId) {
    const i = this.items.findIndex((x) => x.jobId === jobId);
    if (i < 0) return false;
    const [item] = this.items.splice(i, 1);
    this.queuedJobs.delete(jobId);
    item.reject(item.cancelled());
    return true;
  }

  /**
   * Move a waiting prompt to the front: it goes next, after the one that runs now. Several promoted prompts keep the order they
   * were promoted in, ahead of everything that was not. `{ promoted: false, reason }` when it is not waiting, or cannot be moved.
   *
   * A task that runs in the conversation an earlier switch in the line opens must still run in it, and what is left behind must
   * still find the conversation it expects: the move takes a copy of that switch along in front of the task, and puts the
   * conversation back afterwards. A task that waits for a new conversation to be made cannot be moved (that cannot be done twice).
   */
  promote(jobId) {
    const i = this.items.findIndex((x) => x.jobId === jobId);
    if (i < 0) return { promoted: false, reason: 'not waiting: it is running, over, or unknown' };
    const item = this.items[i];
    // which conversation it runs in: its own, else the one the nearest switch before it opens, else the one in use when its turn comes
    let own = item.session;
    if (!own) for (let k = i - 1; k >= 0 && !own; k -= 1) own = this.items[k].session;
    if (own?.kind === 'other') return { promoted: false, reason: 'it waits for a new conversation to be made first, which cannot be moved ahead of it' };
    const wraps = Boolean(own) && Boolean(this.switcher);
    if (own && !this.switcher) return { promoted: false, reason: 'cannot be moved here' };
    this.items.splice(i, 1);
    item.priority = true;
    const block = [item];
    if (wraps) {
      let before = null;
      const op = (run) => {
        const x = { jobId: null, priority: true, session: null, run };
        x.resolve = () => {};
        x.reject = () => {};
        return x;
      };
      block.unshift(
        op(async () => {
          before = this.switcher.current();
          if (own.id && !item.session && before !== own.id) await this.switcher.use(own.id);
        }),
      );
      block.push(
        op(async () => {
          if (before && before !== this.switcher.current()) await this.switcher.use(before);
        }),
      );
    }
    let at = 0;
    while (at < this.items.length && this.items[at].priority) at += 1;
    this.items.splice(at, 0, ...block);
    return { promoted: true, position: this.items.slice(0, at).filter((x) => x.jobId).length + 1 };
  }

  /** The waiting prompts, next first. */
  waiting() {
    return this.items.filter((x) => x.jobId).map((x) => ({ jobId: x.jobId, ...this.queuedJobs.get(x.jobId), priority: Boolean(x.priority) })).map(({ jobId, text, at, priority }) => ({ jobId, text, at, priority }));
  }
}
