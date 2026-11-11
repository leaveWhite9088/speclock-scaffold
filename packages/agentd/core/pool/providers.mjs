/**
 * Providers: another endpoint and key that the CLIs can use, kept once per device.
 *
 * What is kept here is what a person typed (`data/global/providers.json`, never in git, readable by this user only):
 * an id, a name, an API key, the endpoint for each protocol the provider speaks, and the model ids it offers. How a
 * CLI takes them is the CLI's driver (`driver.provider`); this file only stores them, starts the drivers' tests and
 * hands the result of `apply` to a process that is about to start.
 *
 * The key leaves this file in two ways: into the environment of a CLI process that is started with the provider, and
 * to the provider's own endpoint when it is tested. It is never listed, logged or put in an error message.
 */

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyProvider, checkEndpoint, discoverModels, drivers, getDriver, scrub, testProvider } from '@speclock-scaffold/drivers';
import { GLOBAL_DIR, instanceIdOf, projectPath } from '../base/index.mjs';
import { currentInstall } from './install.mjs';

export const PROVIDERS_FILE = process.env.AGENTD_PROVIDERS_FILE || join(GLOBAL_DIR, 'providers.json');
const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const PROTOCOLS = ['anthropic', 'openai'];

function load() {
  try {
    const data = JSON.parse(readFileSync(PROVIDERS_FILE, 'utf8'));
    return data && typeof data === 'object' && data.providers ? data : { schema: 1, providers: {} };
  } catch {
    return { schema: 1, providers: {} };
  }
}

function persist(data) {
  mkdirSync(dirname(PROVIDERS_FILE), { recursive: true });
  const tmp = `${PROVIDERS_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, PROVIDERS_FILE);
  try {
    chmodSync(PROVIDERS_FILE, 0o600);
  } catch {
    /* not supported here (Windows): the file is in the user's own folder */
  }
}

/** What a list or a dashboard may show: everything except the key, of which only the end is kept as a hint. */
function view(p) {
  return { id: p.id, name: p.name, keyHint: p.apiKey ? `…${p.apiKey.slice(-4)}` : '', endpoints: p.endpoints, models: p.models, types: p.types, updatedAt: p.updatedAt };
}

/**
 * The CLIs that can take a provider at all, from the drivers. `scope: 'global'` means the CLI keeps providers in its own
 * configuration (testing one writes there for a moment), so it is only used when the person ticks it.
 */
export const providerClis = () =>
  Object.values(drivers)
    .filter((d) => d.provider)
    .map((d) => ({ type: d.type, label: d.label, protocol: d.provider.protocol, scope: d.provider.scope }));

/** What a provider may be used with when nothing was chosen: every CLI that takes it per process, not the ones that change their own configuration. */
const defaultTypes = () => providerClis().filter((c) => c.scope === 'process').map((c) => c.type);

/** A stored record always has `types` (records saved before the choice existed get the default). */
const withTypes = (p) => ({ ...p, types: Array.isArray(p.types) ? p.types : defaultTypes() });

export const listProviders = () => Object.values(load().providers).map((p) => view(withTypes(p)));

/** The full record, key included. For the code that starts a process or runs a test; never for a response. */
export function getProvider(id) {
  const p = load().providers[id];
  if (!p) throw new Error(`unknown provider "${id}"`);
  return withTypes(p);
}

const cleanUrl = (v, what) => {
  const s = String(v ?? '').trim().replace(/\/+$/, '');
  if (!s) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error(`${what} is not a URL: ${s.slice(0, 80)}`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`${what} must start with http:// or https://`);
  return s;
};

/**
 * Add or change a provider. An empty `apiKey` on a provider that already exists keeps its key, so a form can be saved
 * without typing the key again.
 */
export function saveProvider({ id, name, apiKey, endpoints = {}, models = [], types }) {
  if (!ID_RE.test(String(id ?? ''))) throw new Error('provider id: lowercase letters, digits and "-", at most 32, starting with a letter or digit');
  const data = load();
  const old = data.providers[id];
  const key = String(apiKey ?? '').trim() || old?.apiKey;
  if (!key) throw new Error('an API key is required');
  if (key.startsWith('!')) throw new Error('an API key must not start with "!"');
  const eps = {};
  for (const proto of PROTOCOLS) {
    const url = cleanUrl(endpoints[proto], `${proto} endpoint`);
    if (url) eps[proto] = url;
  }
  if (!Object.keys(eps).length) throw new Error('give at least one endpoint (anthropic or openai)');
  const list = [...new Set((Array.isArray(models) ? models : String(models).split(/[,\s]+/)).map((m) => String(m).trim()).filter(Boolean))];
  if (!list.length) throw new Error('give at least one model id');
  // Which CLIs may use it: what was given, else what it had, else the default.
  const known = providerClis().map((c) => c.type);
  const allowed = types === undefined ? (old ? withTypes(old).types : defaultTypes()) : [...new Set(Array.isArray(types) ? types.map(String) : [])];
  const bad = allowed.find((t) => !known.includes(t));
  if (bad) throw new Error(`"${bad}" cannot take a provider; choose from: ${known.join(', ')}`);
  const record = { id, name: String(name || id).slice(0, 80), apiKey: key, endpoints: eps, models: list, types: allowed, updatedAt: new Date().toISOString() };
  data.providers[id] = record;
  persist(data);
  return view(record);
}

export function removeProvider(id) {
  const data = load();
  if (!data.providers[id]) throw new Error(`unknown provider "${id}"`);
  delete data.providers[id];
  persist(data);
  return { id, removed: true };
}

/**
 * The models an endpoint offers. For a provider being typed in, `endpoints` and `apiKey` are what is on the form; for one that is
 * saved already, `id` supplies what the form leaves out (the stored key stays on this side).
 */
export async function discoverProviderModels({ id, endpoints, apiKey }) {
  const old = id ? load().providers[id] : null;
  const key = String(apiKey ?? '').trim() || old?.apiKey;
  if (!key) throw new Error('an API key is needed to list the models');
  const eps = {};
  for (const proto of PROTOCOLS) {
    const url = cleanUrl(endpoints?.[proto] ?? old?.endpoints?.[proto], `${proto} endpoint`);
    if (url) eps[proto] = url;
  }
  if (!Object.keys(eps).length) throw new Error('give an endpoint first');
  return discoverModels({ endpoints: eps, apiKey: key });
}

/** What each CLI can do with a provider, from the drivers: which protocol it speaks and whether it works per process. */
export function providerSupport(p) {
  return Object.values(drivers).map((d) => {
    const cap = d.provider;
    if (!cap) return { type: d.type, label: d.label, supported: false, reason: 'no way to take another provider' };
    const has = Boolean(p.endpoints?.[cap.protocol]);
    return {
      type: d.type,
      label: d.label,
      supported: has,
      enabled: (p.types ?? []).includes(d.type),
      protocol: cap.protocol,
      scope: cap.scope,
      reason: has ? null : `needs an ${cap.protocol} endpoint`,
    };
  });
}

/**
 * Check that an executor may use a provider, and which model: `{ id, model }` or null. A CLI that keeps providers in its
 * own configuration (scope "global") is not started with one: it would have to change that configuration for good.
 */
export function cleanInstanceProvider(value, type) {
  if (value == null || value === '' || value.id === '' || value.id == null) return null;
  const driver = getDriver(type);
  if (!driver?.provider) throw new Error(`${type} cannot use another provider`);
  if (driver.provider.scope !== 'process') {
    throw new Error(`${type} keeps its providers in its own configuration, so an executor cannot be started with one; use the provider test to see that it works`);
  }
  const p = getProvider(String(value.id));
  if (!p.types.includes(type)) throw new Error(`provider "${p.id}" is not enabled for ${type}: tick it in the provider's settings first`);
  if (!p.endpoints[driver.provider.protocol]) throw new Error(`provider "${p.id}" has no ${driver.provider.protocol} endpoint, which ${type} needs`);
  const model = String(value.model || p.models[0]);
  return { id: p.id, model: model.slice(0, 200) };
}

/**
 * What to add to a process that is about to start with a provider: environment, arguments and the model to choose.
 * @returns {{ env: object, args: string[], model: string | null }}
 */
export function providerForSpawn({ driver, name, choice, env }) {
  const p = getProvider(choice.id);
  // Where a driver may write the files its provider needs: one folder per executor, in its project's folder.
  const dir = projectPath(name, 'provider-config', String(instanceIdOf(name)).replace(/[^a-zA-Z0-9._~-]/g, '_'));
  const r = applyProvider({ driver, provider: p, model: choice.model, dir, env });
  if (!r.ok) throw new Error(`provider "${p.id}" cannot be used by ${driver.type}: ${r.skipped}`);
  return { env: r.env, args: r.args, model: r.model };
}

/** The same for a project's dispatcher (a pi process the daemon starts itself): `{ env, args }` to add to its start. */
export function providerForDispatcher({ project, choice, env }) {
  const r = providerForSpawn({ driver: getDriver('pi'), name: `dispatcher-${project}`, choice, env });
  return { env: r.env, args: r.args };
}

/**
 * Test a provider: the endpoints themselves first (one request each), then every CLI that can take it, at the same time.
 * A CLI whose protocol's endpoint was refused is not started: the answer would be the same, and slower.
 */
export async function testProviderAll(id, { model, types } = {}) {
  const p = getProvider(id);
  const secrets = [p.apiKey];
  const testModel = model || p.models[0];
  const endpoints = {};
  await Promise.all(
    Object.entries(p.endpoints).map(async ([protocol, endpoint]) => {
      endpoints[protocol] = await checkEndpoint({ protocol, endpoint, apiKey: p.apiKey, model: testModel });
    }),
  );
  const install = currentInstall();
  const agentdRoot = process.env.AGENTD_ROOT || fileURLToPath(new URL('../..', import.meta.url));
  // only the CLIs the provider is enabled for: a test is a start of each of them
  const wanted = Object.values(drivers).filter((d) => p.types.includes(d.type) && (!types || types.includes(d.type)));
  const results = await Promise.all(
    wanted.map(async (d) => {
      const proto = d.provider?.protocol;
      const ep = proto ? endpoints[proto] : null;
      if (!d.provider) return { type: d.type, ok: false, skipped: 'no way to take another provider', detail: 'no way to take another provider', ms: 0 };
      if (!ep) return { type: d.type, ok: false, skipped: `needs an ${proto} endpoint`, detail: `needs an ${proto} endpoint, and this provider has none`, ms: 0 };
      if (!ep.ok && ep.status != null) {
        return { type: d.type, ok: false, skipped: 'endpoint refused', detail: `the ${proto} endpoint refused the test request (${ep.status}): ${ep.detail}`, ms: 0 };
      }
      const workRoot = mkdtempSync(join(tmpdir(), `provider-test-${d.type}-`));
      try {
        return await testProvider({ driver: d, install, agentdRoot, provider: p, model: testModel, workRoot, timeoutMs: 120_000 });
      } finally {
        rmSync(workRoot, { recursive: true, force: true });
      }
    }),
  );
  return { id, model: testModel, at: new Date().toISOString(), endpoints, results: results.map((r) => ({ ...r, detail: scrub(r.detail, secrets) })) };
}

