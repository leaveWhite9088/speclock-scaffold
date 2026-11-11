/**
 * MiniMax Code. Speaks ACP natively (`mcode acp`).
 *
 *   rules   a flag of `mcode acp`: --append-system-prompt-file <file>
 *   mcp     `mcpServers` of session/new and session/resume; the server is started when the model first uses it
 *   compact the slash command /compact
 */

import { NO_RULES, RULES_IN_PROMPT, packageDir } from './lib.mjs';

const PKG = '@minimax-ai/code';

export default {
  type: 'mcode',
  label: 'MiniMax Code',
  description: 'MiniMax Code agent. Slower to start, strong at multi-step coding.',

  /** npm packages this CLI needs, at the versions the behaviours below were checked on. */
  packages: [{ name: PKG, version: '0.7.6' }],
  verified: {
    on: '2026-11-10',
    note: 'rules channel and MCP servers checked on 0.7.6 (the rules channel was first checked on 0.6.12, 2026-10-23, and held across the upgrade)',
  },
  capabilities: { compact: '/compact', rules: 'arg', mcp: 'acp', mcpStart: 'lazy' },

  launch(install) {
    const missing = [];
    const dir = packageDir(install, PKG, missing);
    // `tool`: how to run the CLI's own commands (provider add / remove), which the provider test needs
    return { cmd: install.node, args: [`${dir}/cli.js`, 'acp'], env: {}, tool: { cmd: install.node, args: [`${dir}/cli.js`] }, missing };
  },

  /**
   * Another endpoint and key. MiniMax Code keeps providers in its own configuration, not in the environment, so this is
   * `scope: 'global'`: `global.add` registers one (the key is read from `SCAFFOLD_PROVIDER_KEY`), `global.remove` takes it
   * away again. The id is made unique (`speclock-…`) so nothing of the user's own is touched.
   */
  provider: {
    protocol: 'anthropic',
    scope: 'global',
    apply({ provider, endpoint, model }) {
      const name = `speclock-${provider.id}`;
      return {
        env: { SCAFFOLD_PROVIDER_KEY: provider.apiKey },
        args: [],
        files: [],
        model: model ? `m:custom_provider%3A${name}:${model}:v:thinking` : null,
        global: {
          add: ['provider', 'add', '--name', name, '--base-url', endpoint, '--api-format', 'anthropic-messages', '--model', model, '--api-key-env', 'SCAFFOLD_PROVIDER_KEY'],
          remove: ['provider', 'remove', `custom_provider:${name}`, '--yes'],
          test: ['provider', 'test', `custom_provider:${name}`],
        },
      };
    },
  },

  rules({ file }) {
    return file ? { ...NO_RULES, args: ['--append-system-prompt-file', file] } : RULES_IN_PROMPT;
  },
};
