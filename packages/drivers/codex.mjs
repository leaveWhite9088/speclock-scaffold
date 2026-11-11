/**
 * OpenAI Codex, through the official ACP adapter (@agentclientprotocol/codex-acp). Uses the ChatGPT login of the
 * Codex app.
 *
 *   rules   session/new _meta.jetbrains.air.customInstructions  (becomes the thread's developer instructions)
 *   mcp     `mcpServers` of session/new and session/resume
 *   compact /compact
 */

import { NO_RULES, packageDir } from './lib.mjs';

const PKG = '@agentclientprotocol/codex-acp';

export default {
  type: 'codex',
  label: 'Codex',
  description: 'OpenAI Codex through the ACP adapter. Uses the ChatGPT login of the Codex app.',

  packages: [{ name: PKG, version: '2.2.2' }],
  verified: { on: '2026-11-10', note: 'rules, MCP servers and /compact checked on 2.2.2' },
  capabilities: { compact: '/compact', rules: 'meta', mcp: 'acp', mcpStart: 'eager' },

  launch(install) {
    const missing = [];
    const dir = packageDir(install, PKG, missing);
    return { cmd: install.node, args: [`${dir}/dist/index.js`], env: {}, missing };
  },

  /**
   * Another endpoint and key. The adapter merges `CODEX_CONFIG` into the session's Codex config and takes the provider
   * from `MODEL_PROVIDER`; the key goes in an environment variable the provider names. This Codex speaks the Responses
   * protocol only, so the endpoint must offer `/responses`.
   */
  provider: {
    protocol: 'openai',
    scope: 'process',
    apply({ provider, endpoint, model }) {
      const config = {
        ...(model ? { model } : {}),
        model_providers: { [provider.id]: { name: provider.id, base_url: endpoint, env_key: 'SCAFFOLD_PROVIDER_KEY', wire_api: 'responses' } },
      };
      return { env: { MODEL_PROVIDER: provider.id, SCAFFOLD_PROVIDER_KEY: provider.apiKey, CODEX_CONFIG: JSON.stringify(config) }, args: [], files: [], model: null };
    },
  },

  rules({ text }) {
    return { ...NO_RULES, meta: { jetbrains: { air: { customInstructions: text } } } };
  },
};
