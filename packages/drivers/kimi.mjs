/**
 * Kimi Code (`@moonshot-ai/kimi-code`). Speaks ACP v1 natively over stdio (`kimi acp`).
 *
 *   rules   none in `kimi acp`: the text goes in front of the first prompt of each session (and again after a compaction)
 *   mcp     `mcpServers` of session/new and session/resume
 *   compact `/compact`, handled natively as an ACP slash command
 */

import { RULES_IN_PROMPT, packageDir } from './lib.mjs';

const PKG = '@moonshot-ai/kimi-code';

export default {
  type: 'kimi',
  label: 'Kimi Code',
  description: 'Moonshot AI coding agent; native ACP.',

  packages: [{ name: PKG, version: '2.4.1' }],
  verified: { on: '2026-11-14', note: 'ACP v1 over stdio, rules in first prompt, MCP servers, /compact and custom provider checked on 2.4.1' },
  capabilities: { compact: '/compact', rules: 'prompt', mcp: 'acp', mcpStart: 'eager' },

  launch(install) {
    const missing = [];
    const dir = packageDir(install, PKG, missing);
    return {
      cmd: install.node,
      args: [`${dir}/dist/main.mjs`, 'acp'],
      env: { KIMI_CODE_NO_AUTO_UPDATE: '1', KIMI_CODE_TRUST_WORKSPACE: '1' },
      missing,
    };
  },

  /**
   * Another endpoint and key: a private `KIMI_CODE_HOME` folder with a `config.toml` that names the key by environment
   * variable (`api_key_env`). Giving the process its own home keeps `~/.kimi-code` logins out of reach, so a bad key
   * cannot silently fall back to the user's own account.
   */
  provider: {
    protocol: 'openai',
    scope: 'process',
    apply({ provider, endpoint, model, dir }) {
      const models = (provider.models?.length ? provider.models : [model]).filter(Boolean);
      const exact = model ? models.find((m) => m === model) : models[0] ?? null;
      if (model && !exact) {
        throw new Error(`model "${model}" is not one of provider "${provider.id}"'s models: ${models.join(', ')}`);
      }
      const q = (s) => JSON.stringify(String(s));
      const lines = [
        `default_provider = ${q(provider.id)}`,
        ...(exact ? [`default_model = ${q(exact)}`] : []),
        '',
        '[thinking]',
        'enabled = false',
        '',
        '[model_catalog]',
        'refresh_on_start = false',
        '',
        `[providers.${q(provider.id)}]`,
        'type = "openai"',
        `base_url = ${q(endpoint)}`,
        'api_key_env = "SCAFFOLD_PROVIDER_KEY"',
        '',
        ...models.flatMap((m) => [
          `[models.${q(m)}]`,
          `provider = ${q(provider.id)}`,
          `model = ${q(m)}`,
          `max_context_size = ${provider.contexts?.[m] || 262144}`,
          'capabilities = ["image_in", "thinking"]',
          '',
        ]),
      ];
      return {
        env: { KIMI_CODE_HOME: dir, SCAFFOLD_PROVIDER_KEY: provider.apiKey },
        args: [],
        files: [{ name: 'config.toml', content: lines.join('\n') }],
        model: exact ?? null,
      };
    },
  },

  rules() {
    return RULES_IN_PROMPT;
  },
};
