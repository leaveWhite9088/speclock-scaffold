/**
 * Which session an executor's process is on, and which model and options it has: starting one, going back to one,
 * switching, naming, hiding, listing; picking the model and remembering what a session was given (a CLI may forget it
 * when its process restarts). It owns that state. It reaches the process only through the functions it is given, and
 * what it needs to know about the executor through `agent` (its name, type, directory, whether it works).
 */

import { CONFIG, flattenOptions, log, normPath } from '../config.mjs';
import { acpMcpServers } from '../mcp.mjs';
import { effortOf, isEffortOption } from '../effort.mjs';
import { defaultModelFor } from '../registry.mjs';
import { entry, noteSession, saveStore, saved, savedAll } from '../store.mjs';

export class Sessions {
  /**
   * @param {{
   *   agent: { name: string, type: string, custom: boolean, spec: any, child: any, busy: boolean, onSession?: (id: string) => void },
   *   request: (method: string, params: object, opts?: object) => Promise<any>,   // to the CLI
   *   init: () => Promise<any>,                                                    // the process is up
   *   enqueue: <T>(fn: () => Promise<T>) => Promise<T>,                            // in line with the prompts
   *   rulesMeta: () => object,                                                     // `_meta` for session requests
   * }} deps
   */
  constructor({ agent, request, init, enqueue, rulesMeta }) {
    this.agent = agent;
    this.request = request;
    this.init = init;
    this.enqueue = enqueue;
    this.rulesMeta = rulesMeta;
    this.mcpServers = () => acpMcpServers(agent.spec);
    const spec = agent.spec;
    /** The session it is on, or null before the first use and after the process went away. */
    this.sessionId = null;
    /** Where it works. Before the first start this is the directory it will start in, not the global base. */
    this.cwd = spec.defaultCwd;
    /** Session to come back to: the one chosen at creation, then whichever was last active. */
    this.preferSession = spec.sessionId ?? null;
    /** Model this instance should use (config value); applied to sessions that have no choice of their own. */
    this.preferModel = spec.model ?? CONFIG?.defaultModels?.[spec.type ?? agent.name] ?? null;
    /** The reasoning level this instance should use (the CLI's own value, e.g. "high"); null: the CLI's default. */
    this.preferEffort = spec.effort ?? null;
    /** The model was changed in the settings while it worked: applied before the next prompt. */
    this.modelDirty = false;
    this.models = null;
    /**
     * Sessions known to be live in this process. `dsh` keeps every session it created active, so `session/resume` on
     * one of them fails with "session is already active". Tracking them lets us switch by simply pointing `sessionId`
     * at the right one.
     */
    this.live = new Set();
    this.sessionConfig = new Map();
    /** Latest `configOptions` for the active session (model, effort, permissions). */
    this.configOptions = [];
  }

  /** The process is gone: nothing is live in it any more. The remembered session stays, to come back to. */
  forgetProcess() {
    this.sessionId = null;
    this.live.clear();
  }

  /** Record the config options returned by session/new, resume or set_config_option. */
  captureConfig(result) {
    const opts = result?.configOptions;
    if (Array.isArray(opts)) this.configOptions = opts;
  }

  /** Current model id, if the agent exposes one. */
  currentModel() {
    return this.configOptions?.find((o) => o.id === 'model')?.currentValue ?? null;
  }

  async reapplyStoredConfig() {
    const stored = saved(this.agent.name, this.sessionId)?.config;
    if (!stored) return [];
    const applied = [];
    for (const [configId, value] of Object.entries(stored)) {
      const opt = this.configOptions?.find((o) => o.id === configId);
      if (!opt || opt.currentValue === value) continue;
      try {
        const r = await this.request('session/set_config_option', {
          sessionId: this.sessionId,
          configId,
          value,
        });
        this.captureConfig(r);
        applied.push({ configId, value });
        log(`[${this.agent.name}] re-applied ${configId}=${value}`);
      } catch (err) {
        log(`[${this.agent.name}] could not re-apply ${configId}: ${err.message}`);
      }
    }
    return applied;
  }

  /** Remember which session is active, so a recycled process comes back to it. */
  noteActive() {
    if (!this.sessionId || this.preferSession === this.sessionId) return;
    this.preferSession = this.sessionId;
    try {
      this.agent.onSession?.(this.sessionId);
    } catch (err) {
      log(`[${this.agent.name}] onSession failed: ${err.message}`);
    }
  }

  /** Give a session the instance's model unless it already has a choice of its own. */
  async applyPreferredModel() {
    const want = this.preferModel;
    const opt = this.configOptions?.find((o) => o.id === 'model');
    if (!want || !opt || opt.currentValue === want || !this.sessionId) return;
    if (saved(this.agent.name, this.sessionId)?.config?.model) return;
    try {
      const r = await this.request('session/set_config_option', {
        sessionId: this.sessionId,
        configId: 'model',
        value: want,
      });
      this.captureConfig(r);
      const meta = entry(this.agent.name, this.sessionId);
      meta.config = { ...(meta.config ?? {}), model: want };
      if (!meta.cwd) meta.cwd = this.cwd;
      saveStore(this.agent.name);
      log(`[${this.agent.name}] applied instance model ${want}`);
    } catch (err) {
      log(`[${this.agent.name}] could not apply instance model ${want}: ${err.message}`);
    }
  }

  /** Give a session the instance's reasoning level, unless it has a choice of its own or the CLI has no such level. */
  async applyPreferredEffort() {
    const want = this.preferEffort;
    const opt = this.configOptions?.find(isEffortOption);
    if (!want || !opt || opt.currentValue === want || !this.sessionId) return;
    if (!effortOf(this.configOptions)?.options.some((o) => o.value === want)) return; // a level this CLI does not have
    if (saved(this.agent.name, this.sessionId)?.config?.[opt.id]) return;
    try {
      const r = await this.request('session/set_config_option', { sessionId: this.sessionId, configId: opt.id, value: want });
      this.captureConfig(r);
      const meta = entry(this.agent.name, this.sessionId);
      meta.config = { ...(meta.config ?? {}), [opt.id]: want };
      if (!meta.cwd) meta.cwd = this.cwd;
      saveStore(this.agent.name);
      log(`[${this.agent.name}] applied reasoning level ${want}`);
    } catch (err) {
      log(`[${this.agent.name}] could not apply reasoning level ${want}: ${err.message}`);
    }
  }

  /** The instance's level was changed: it replaces the session's own choice and applies to the session it is in. */
  async chooseEffort(value) {
    this.preferEffort = value || null;
    const opt = this.configOptions?.find(isEffortOption);
    const sid = this.sessionId ?? this.preferSession;
    const cfg = sid && opt ? saved(this.agent.name, sid)?.config : null;
    if (cfg?.[opt.id]) {
      delete cfg[opt.id];
      saveStore(this.agent.name);
    }
    if (!this.agent.child || !this.sessionId || this.agent.busy) return;
    if (this.preferEffort) await this.applyPreferredEffort();
  }

  async chooseModel(value) {
    this.preferModel = value ?? defaultModelFor(this.agent.type);
    const sid = this.sessionId ?? this.preferSession;
    const cfg = sid ? saved(this.agent.name, sid)?.config : null;
    if (cfg?.model) {
      delete cfg.model;
      saveStore(this.agent.name);
    }
    if (!this.agent.child || !this.sessionId) return;
    if (this.agent.busy) this.modelDirty = true;
    else await this.applyPreferredModel();
  }

  /** Init + ensure an active session for `cwd`. */
  async ensureReady(cwd) {
    await this.init();
    const wantCwd = cwd || this.agent.spec.defaultCwd || this.cwd;
    if (this.sessionId && wantCwd === this.cwd) return this.sessionId;

    // First use after a (re)start: go back to the chosen / last active session.
    if (!this.sessionId && this.preferSession) {
      try {
        await this.attach(this.preferSession, wantCwd);
        return this.sessionId;
      } catch (err) {
        log(`[${this.agent.name}] could not resume ${this.preferSession}: ${err.message}; starting a new session`);
        this.preferSession = null;
      }
    }

    const t0 = Date.now();
    const sess = await this.request('session/new', { cwd: wantCwd, mcpServers: this.mcpServers(), ...this.rulesMeta() });
    this.sessionId = sess?.sessionId;
    this.cwd = wantCwd;
    if (this.sessionId) this.live.add(this.sessionId);
    this.captureConfig(sess);
    this.sessionConfig.set(this.sessionId, this.configOptions);
    noteSession(this.agent.name, this.sessionId, { cwd: wantCwd, updatedAt: new Date().toISOString() });
    log(`[${this.agent.name}] new session ${this.sessionId} in ${Date.now() - t0}ms`);
    await this.applyPreferredModel();
    await this.applyPreferredEffort();
    this.noteActive();
    return this.sessionId;
  }

  async attach(sessionId, cwd) {
    const res = await this.attachRaw(sessionId, cwd);
    await this.applyPreferredModel();
    await this.applyPreferredEffort();
    this.noteActive();
    return res;
  }

  async attachRaw(sessionId, cwd) {
    const wantCwd = cwd || saved(this.agent.name, sessionId)?.cwd || this.cwd;

    if (this.live.has(sessionId)) {
      this.sessionId = sessionId;
      this.cwd = wantCwd;
      if (this.sessionConfig.has(sessionId)) this.configOptions = this.sessionConfig.get(sessionId);
      const reApplied = await this.reapplyStoredConfig();
      return { sessionId, cwd: wantCwd, resumed: false, live: true, reApplied };
    }

    try {
      // A CLI starts a session's MCP servers only if this very request names them, resume included.
      const res = await this.request('session/resume', { sessionId, cwd: wantCwd, mcpServers: this.mcpServers(), ...this.rulesMeta() });
      this.sessionId = res?.sessionId ?? sessionId;
      this.cwd = wantCwd;
      this.models = res?.models ?? this.models;
      this.live.add(this.sessionId);
      this.captureConfig(res);
      this.sessionConfig.set(this.sessionId, this.configOptions);
      noteSession(this.agent.name, this.sessionId, { cwd: wantCwd, updatedAt: new Date().toISOString() });
      const reApplied = await this.reapplyStoredConfig();
      return { sessionId: this.sessionId, cwd: wantCwd, resumed: true, live: true, reApplied };
    } catch (err) {
      // Some agents report an already-active session instead of resuming it.
      if (/already active/i.test(err.message)) {
        this.sessionId = sessionId;
        this.cwd = wantCwd;
        this.live.add(sessionId);
        const reApplied = await this.reapplyStoredConfig();
        return { sessionId, cwd: wantCwd, resumed: false, live: true, reApplied };
      }
      throw err;
    }
  }

  /** Set a config option (model, effort, permission) for a session and remember it. */
  async setConfigOption(configId, value, sessionId) {
    return this.enqueue(async () => {
      await this.init();
      if (sessionId && sessionId !== this.sessionId) await this.attach(sessionId);
      else if (!this.sessionId) await this.ensureReady();

      const r = await this.request('session/set_config_option', {
        sessionId: this.sessionId,
        configId,
        value,
      });
      this.captureConfig(r);

      const meta = entry(this.agent.name, this.sessionId);
      meta.config = { ...(meta.config ?? {}), [configId]: value };
      if (!meta.cwd) meta.cwd = this.cwd;
      saveStore(this.agent.name);

      return { sessionId: this.sessionId, configOptions: this.configOptions };
    });
  }

  /** Describe the config options and their current values for a session. */
  async describeModels(sessionId) {
    // While the agent works, its run holds the queue, so asking through it would wait for the whole run (and hold the
    // dispatcher that called this): answer from what the session reported last.
    if (this.agent.busy && this.sessionId && this.configOptions && (!sessionId || sessionId === this.sessionId)) {
      return { sessionId: this.sessionId, configOptions: this.configOptions.map((opt) => ({ ...opt, options: flattenOptions(opt.options) })) };
    }
    return this.enqueue(async () => {
      await this.init();
      if (sessionId && sessionId !== this.sessionId) await this.attach(sessionId);
      else await this.ensureReady();
      // Agents may nest options in provider groups (dsh). Normalise so every
      // front end sees one flat list per config option.
      return {
        sessionId: this.sessionId,
        configOptions: this.configOptions.map((opt) => ({
          ...opt,
          options: flattenOptions(opt.options),
        })),
      };
    }, sessionId ? { session: { kind: 'other' } } : undefined);
  }

  /** Reattach to an existing session. Requires cwd for both agents. */
  async useSession(sessionId, cwd) {
    return this.enqueue(
      async () => {
        await this.init();
        return this.attach(sessionId, cwd);
      },
      // marked for the line: a task that follows runs in this conversation, and a copy of the switch can be made (see PromptQueue.promote)
      { session: { kind: 'use', id: sessionId } },
    );
  }

  async newSession(cwd) {
    return this.enqueue(
      async () => {
        await this.init();
        this.sessionId = null;
        this.preferSession = null; // an explicit "new" must not fall back to the remembered session
        return this.ensureReady(cwd);
      },
      { session: { kind: 'other' } }, // a new conversation cannot be made twice
    );
  }

  /**
   * The conversations of this executor, from what agentd recorded: it knows every conversation it started and its labels, and
   * reading it neither starts the process nor asks the CLI, so a CLI's other conversations (those agentd never saw) stay out of
   * the list. `remote: true` also asks the CLI (`session/list`, which starts it): only for finding conversations to take over.
   */
  async list({ remote: askCli = false } = {}) {
    let remote = [];
    let remoteError = null;
    if (askCli) {
      await this.init();
      try {
        // While it works the CLI may answer late (or not at all until the run ends): ask briefly, and fall back to what is known.
        const res = await this.request('session/list', {}, { timeoutMs: this.agent.busy ? 5_000 : 60_000 });
        remote = res?.sessions ?? (Array.isArray(res) ? res : []);
      } catch (err) {
        remoteError = err.message;
      }
    }

    const local = savedAll(this.agent.name);
    const byId = new Map();

    const hidden = (id) => Boolean(local[id]?.hidden);
    for (const s of remote) {
      if (hidden(s.sessionId)) continue;
      // A CLI lists every session it has. An instance only owns the ones in its own directory, so two instances of one CLI do not mix.
      if (s.cwd && normPath(s.cwd) !== normPath(this.agent.spec.defaultCwd)) continue;
      byId.set(s.sessionId, {
        sessionId: s.sessionId,
        cwd: s.cwd ?? local[s.sessionId]?.cwd ?? null,
        title: s.title ?? null,
        updatedAt: s.updatedAt ?? local[s.sessionId]?.updatedAt ?? null,
        label: local[s.sessionId]?.label ?? null,
        source: 'agent',
      });
    }
    for (const [id, meta] of Object.entries(local)) {
      if (byId.has(id) || meta.hidden) continue;
      byId.set(id, {
        sessionId: id,
        cwd: meta.cwd ?? null,
        title: null,
        updatedAt: meta.updatedAt ?? null,
        label: meta.label ?? null,
        source: 'local',
      });
    }
    // Sessions created in this process may be too new for the agent's list.
    for (const id of this.live) {
      if (byId.has(id) || hidden(id)) continue;
      byId.set(id, {
        sessionId: id,
        cwd: local[id]?.cwd ?? this.cwd,
        title: null,
        updatedAt: local[id]?.updatedAt ?? null,
        label: local[id]?.label ?? null,
        source: 'live',
      });
    }
    // The active session may be too new to appear in the agent's list.
    if (this.sessionId && !byId.has(this.sessionId)) {
      byId.set(this.sessionId, {
        sessionId: this.sessionId,
        cwd: this.cwd,
        title: null,
        updatedAt: local[this.sessionId]?.updatedAt ?? null,
        label: local[this.sessionId]?.label ?? null,
        source: 'local',
      });
    }

    const rows = [...byId.values()].map((r) => ({ ...r, active: r.sessionId === this.sessionId }));
    rows.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    return { sessions: rows, remoteError };
  }

  remove(sessionId) {
    if (!sessionId) throw new Error('sessionId is required');
    if (sessionId === this.sessionId) throw new Error('cannot delete the active session; switch to another first');
    const e = entry(this.agent.name, sessionId);
    e.hidden = true;
    delete e.label;
    this.live.delete(sessionId);
    saveStore(this.agent.name);
    return { sessionId, deleted: true };
  }

  rename(sessionId, label) {
    const id = sessionId || this.sessionId;
    if (!id) throw new Error('no active session to rename');
    const e = entry(this.agent.name, id);
    if (label === null || label === '') delete e.label;
    else e.label = label;
    if (!e.cwd) e.cwd = this.cwd;
    saveStore(this.agent.name);
    return { sessionId: id, label: e.label ?? null };
  }
}
