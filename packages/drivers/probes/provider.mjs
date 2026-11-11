/**
 * Does a CLI work with another provider (an endpoint and a key)? Two checks, both with the real thing:
 *
 *   checkEndpoint  one tiny request straight to the endpoint: is the address right, the key accepted, the model known
 *   testProvider   the CLI itself, started the way the scaffold starts it with the provider applied, asked to answer
 *                  one word through it. The answer coming back is the proof that this CLI really uses the provider.
 *
 * Both only use the driver's `launch`, `provider.apply` and the other start-up hooks, so nothing here is specific to
 * one CLI. A provider with `scope: 'global'` (the CLI keeps providers in its own configuration) is added before the
 * test and removed after it, so a test leaves nothing behind.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AcpProcess } from './acp.mjs';

const slash = (p) => String(p).replace(/\\/g, '/');
const clip = (s, n = 240) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** A message with every secret in it blanked out. */
export const scrub = (text, secrets) =>
  [...secrets].filter((s) => s && String(s).length > 6).reduce((t, s) => t.split(String(s)).join('***'), String(text ?? ''));

/**
 * One request to the endpoint itself.
 * @returns {Promise<{ ok: boolean, status: number | null, detail: string, ms: number }>}
 */
export async function checkEndpoint({ protocol, endpoint, apiKey, model, timeoutMs = 30_000, fetchImpl = fetch }) {
  const t0 = Date.now();
  const base = String(endpoint).replace(/\/+$/, '');
  const anthropic = protocol === 'anthropic';
  const url = anthropic ? `${base}/v1/messages` : `${base}/chat/completions`;
  const headers = anthropic
    ? { 'content-type': 'application/json', 'x-api-key': apiKey, authorization: `Bearer ${apiKey}`, 'anthropic-version': '2023-06-01' }
    : { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with the word OK.' }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let message = text;
    try {
      const j = JSON.parse(text);
      message = j?.error?.message ?? j?.message ?? text;
    } catch {
      /* not JSON */
    }
    return { ok: res.ok, status: res.status, detail: res.ok ? 'answered' : scrub(clip(message), [apiKey]), ms: Date.now() - t0 };
  } catch (e) {
    const why = e.name === 'TimeoutError' ? `no answer within ${Math.round(timeoutMs / 1000)}s` : e.message;
    return { ok: false, status: null, detail: scrub(`${why}${e.cause?.code ? ` (${e.cause.code})` : ''}`, [apiKey]), ms: Date.now() - t0 };
  }
}

/**
 * The provider applied the way the scaffold applies it at a process start. Shared by the test and by the daemon, so what is
 * tested is what runs.
 * @returns {{ ok: boolean, skipped?: string, env?: object, args?: string[], model?: string|null, applied?: object }}
 */
export function applyProvider({ driver, provider, model, dir, env = {} }) {
  const cap = driver.provider;
  if (!cap) return { ok: false, skipped: 'this CLI has no way to take another provider' };
  const endpoint = provider.endpoints?.[cap.protocol];
  if (!endpoint) return { ok: false, skipped: `needs an ${cap.protocol} endpoint, and this provider has none` };
  const applied = cap.apply({ provider, endpoint, model, dir: slash(dir), env });
  mkdirSync(dir, { recursive: true });
  for (const f of applied.files ?? []) writeFileSync(join(dir, f.name), f.content, 'utf8');
  return { ok: true, env: applied.env ?? {}, args: applied.args ?? [], model: applied.model ?? null, applied };
}

/**
 * @param {{ driver: any, install: any, agentdRoot: string, provider: { id: string, apiKey: string, endpoints: Record<string,string>, models?: string[] },
 *           model: string, workRoot: string, timeoutMs?: number }} o
 * @returns {Promise<{ type: string, ok: boolean, skipped?: string, detail: string, ms: number }>}
 */
export async function testProvider({ driver, install, agentdRoot, provider, model, workRoot, timeoutMs = 90_000 }) {
  const type = driver.type;
  const t0 = Date.now();
  const out = (ok, detail, extra = {}) => ({ type, ok, detail: scrub(detail, [provider.apiKey]), ms: Date.now() - t0, ...extra });
  const skip = (why) => out(false, why, { skipped: why });

  const launch = driver.launch(install, { agentdRoot });
  if (launch.missing?.length) return skip(`not installed: ${launch.missing.join(', ')}`);

  const cwd = join(workRoot, 'work');
  mkdirSync(cwd, { recursive: true });
  const base = {
    ...process.env,
    ...launch.env,
    ...(driver.instanceEnv?.({ id: `provider-test-${type}`, conversationsDir: join(workRoot, 'conv') }) ?? {}),
    ...(driver.envFn?.() ?? {}),
    ...(driver.spawnEnv?.({ cwd, mcpServers: [] }) ?? {}),
  };
  const ap = applyProvider({ driver, provider, model, dir: join(workRoot, 'config'), env: base });
  if (!ap.ok) return skip(ap.skipped);

  const env = { ...base, ...ap.env };
  const g = ap.applied.global;
  const tool = (args) => spawnSync(launch.tool.cmd, [...launch.tool.args, ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  let proc = null;
  let added = false;
  try {
    if (g) {
      if (!launch.tool) return skip('this CLI cannot be driven from the command line here');
      const r = tool(g.add);
      added = r.status === 0;
      if (!added) return out(false, `adding the provider to the CLI failed: ${clip(r.stderr || r.stdout)}`);
    }
    proc = AcpProcess.start({ cmd: launch.cmd, args: [...launch.args, ...ap.args], env, cwd });
    const init = await proc.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } }, 90_000);
    if (init.error) return out(false, `did not start: ${init.error.message}${proc.stderr.length ? ` | ${proc.stderr.slice(-2).join(' | ')}` : ''}`);
    const sess = await proc.request('session/new', { cwd, mcpServers: [] }, 90_000);
    const sid = sess.result?.sessionId;
    if (!sid) return out(false, `no session: ${sess.error?.message ?? 'no session id'}`);
    if (ap.model) {
      const set = await proc.request('session/set_config_option', { sessionId: sid, configId: 'model', value: ap.model }, 30_000);
      if (set.error) return out(false, `the CLI does not offer the model: ${set.error.message}`);
    }
    const r = await proc.prompt(sid, 'Reply with exactly the word PONG and nothing else.', timeoutMs);
    if (r.error) return out(false, r.error);
    if (!/PONG/i.test(r.text)) {
      return out(false, r.text ? `unexpected answer: ${clip(r.text, 120)}` : 'the CLI ended the turn with no text (the provider refused it, or answered nothing)');
    }
    return out(true, 'answered through the provider');
  } catch (e) {
    return out(false, e.message);
  } finally {
    await proc?.stop().catch(() => {});
    if (g && added) tool(g.remove);
  }
}
