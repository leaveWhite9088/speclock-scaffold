/**
 * Operations on providers: another endpoint and key that the CLIs can use, kept once per device (core/pool/providers.mjs).
 * None of them is for a dispatcher (guard.mjs), and none returns a key.
 */

import { getProvider, listProviders, pool, providerClis, providerSupport, removeProvider, saveProvider, testProviderAll } from '../../core/pool/index.mjs';

/** The executors that are set to a provider (`type` narrows it to one CLI). */
function usedBy(id, type) {
  return [...pool.values()]
    .filter((a) => (typeof a.spec.provider === 'function' ? a.spec.provider() : a.spec.provider)?.id === id && (!type || a.type === type))
    .map((a) => a.name);
}

/** Tests that are running, by provider and CLIs: asking for the same one again waits for the running one. */
const testing = new Map();

/** @param {object} _ctx */
export function providerOps(_ctx) {
  return {
    'provider.list': () => ({
      providers: listProviders().map((p) => ({ ...p, support: providerSupport(p), usedBy: usedBy(p.id) })),
      /** The CLIs that can take a provider, so a form can offer them before there is one. */
      clis: providerClis(),
    }),

    /** Add or change one. An empty `apiKey` keeps the stored key. A CLI cannot be taken off while an executor of it uses the provider. */
    'provider.save': (spec) => {
      const before = Array.isArray(spec.types) ? listProviders().find((p) => p.id === spec.id) : null;
      for (const type of before?.types.filter((t) => !spec.types.includes(t)) ?? []) {
        const using = usedBy(spec.id, type);
        if (using.length) throw new Error(`${type} cannot be taken off: still used by ${using.join(', ')}; change those executors first`);
      }
      return saveProvider(spec);
    },

    'provider.remove': ({ id }) => {
      const using = usedBy(id);
      if (using.length) throw new Error(`still used by: ${using.join(', ')}; change those executors first`);
      return removeProvider(id);
    },

    /** Test the endpoints, then every CLI that can take the provider. Takes a minute or two at most. */
    'provider.test': async ({ id, model, types }) => {
      getProvider(id);
      const key = `${id}|${model ?? ''}|${(types ?? []).join()}`;
      if (!testing.has(key)) {
        const run = testProviderAll(id, { model, types }).finally(() => testing.delete(key));
        testing.set(key, run);
      }
      return testing.get(key);
    },
  };
}
