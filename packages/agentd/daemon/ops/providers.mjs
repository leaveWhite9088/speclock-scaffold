/**
 * Operations on providers: another endpoint and key that the CLIs can use, kept once per device (core/pool/providers.mjs).
 * None of them is for a dispatcher (guard.mjs), and none returns a key.
 */

import { getProvider, listProviders, pool, providerSupport, removeProvider, saveProvider, testProviderAll } from '../../core/agent-pool.mjs';

/** A provider is in use while an executor is set to it. */
function usedBy(id) {
  return [...pool.values()].filter((a) => (typeof a.spec.provider === 'function' ? a.spec.provider() : a.spec.provider)?.id === id).map((a) => a.name);
}

/** One test at a time per provider: it starts every CLI that can take it. */
const testing = new Map();

/** @param {object} _ctx */
export function providerOps(_ctx) {
  return {
    'provider.list': () => ({
      providers: listProviders().map((p) => ({ ...p, support: providerSupport(p), usedBy: usedBy(p.id) })),
    }),

    /** Add or change one. An empty `apiKey` keeps the stored key. */
    'provider.save': (spec) => saveProvider(spec),

    'provider.remove': ({ id }) => {
      const using = usedBy(id);
      if (using.length) throw new Error(`still used by: ${using.join(', ')}; change those executors first`);
      return removeProvider(id);
    },

    /** Test the endpoints, then every CLI that can take the provider. Takes a minute or two at most. */
    'provider.test': async ({ id, model, types }) => {
      getProvider(id);
      if (testing.has(id)) throw new Error(`provider "${id}" is being tested already`);
      const run = testProviderAll(id, { model, types });
      testing.set(id, run);
      try {
        return await run;
      } finally {
        testing.delete(id);
      }
    },
  };
}
