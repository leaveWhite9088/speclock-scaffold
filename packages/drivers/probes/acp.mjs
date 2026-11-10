/**
 * A small ACP client for the probes: start a CLI the way the scaffold does, send requests, collect what the agent says.
 * It is not the scaffold's client (that one is agentd's AcpClient) on purpose: the probes check what the driver hands
 * a CLI at the protocol level, with nothing of the daemon in between.
 */

import { spawn, spawnSync } from 'node:child_process';

export class AcpProcess {
  constructor(child) {
    this.child = child;
    this.pending = new Map();
    this.nextId = 1;
    this.buf = '';
    this.text = '';
    this.stderr = [];
    this.exited = false;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => this._onData(c));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      this.stderr.push(...d.split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter(Boolean));
      this.stderr = this.stderr.slice(-6);
    });
    child.on('close', () => {
      this.exited = true;
      for (const p of this.pending.values()) p.resolve({ error: { message: 'the process ended' } });
      this.pending.clear();
    });
    child.on('error', (e) => this.stderr.push(`spawn error: ${e.message}`));
  }

  static start({ cmd, args, env, cwd }) {
    return new AcpProcess(spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env, cwd }));
  }

  _onData(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        p.resolve(msg);
      } else if (msg.method === 'session/update') {
        const u = msg.params?.update;
        if (u?.sessionUpdate === 'agent_message_chunk' && u.content?.text) this.text += u.content.text;
      } else if (msg.method === 'session/request_permission' && msg.id != null) {
        // The probe's tool is harmless; nothing may hang waiting for an answer.
        const opts = msg.params?.options ?? [];
        const pick = opts.find((o) => /allow/i.test(o.kind ?? o.optionId ?? '')) ?? opts[0];
        this._write({ jsonrpc: '2.0', id: msg.id, result: { outcome: pick ? { outcome: 'selected', optionId: pick.optionId } : { outcome: 'cancelled' } } });
      }
    }
  }

  _write(obj) {
    try {
      this.child.stdin.write(JSON.stringify(obj) + '\n');
    } catch {
      /* the process is gone: the request times out or resolves with its end */
    }
  }

  /** The whole reply message: `{ result }` or `{ error }`. */
  request(method, params, ms = 60_000) {
    return new Promise((resolve) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ error: { message: `no answer to ${method} within ${Math.round(ms / 1000)}s` } });
      }, ms);
      this.pending.set(id, { resolve: (m) => (clearTimeout(timer), resolve(m)) });
      this._write({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** Send a prompt; resolves with what the agent said. */
  async prompt(sessionId, text, ms = 240_000) {
    this.text = '';
    const r = await this.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, ms);
    return { text: this.text, stop: r.result?.stopReason ?? null, error: r.error?.message ?? null };
  }

  /** End the process and what it started (a CLI runs tools and servers as children). */
  async stop() {
    if (this.exited) return;
    try {
      this.child.stdin.end();
    } catch {
      /* ignore */
    }
    if (process.platform === 'win32' && this.child.pid) spawnSync('taskkill', ['/PID', String(this.child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else this.child.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 800));
  }
}
