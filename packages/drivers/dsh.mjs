/**
 * DeepSeek Harness. Speaks ACP natively (`dsh --profile acp`).
 *
 *   rules   none: the text goes in front of the first prompt of each session (and again after a compaction)
 *   mcp     `mcpServers` of session/new and session/resume
 *   compact none over ACP, so a compaction threshold does nothing for it
 *   disk    its sessions can be listed straight from ~/.dsh without starting it (a private format; null = ask the CLI)
 */

import { dshSessions } from './dsh-sessions.mjs';
import { RULES_IN_PROMPT, packageDir } from './lib.mjs';

const PKG = '@deepseek-ai/dsh';

/**
 * The levels offered for a provider's model. dsh keeps a model's reasoning only when its own catalog knows the id; a model
 * written here without this is a non-reasoning one, which has the one level "off". `off:` with no value means "send nothing".
 */
const REASONING_EFFORTS = ['            reasoningEfforts:', '              off:', '              low: low', '              medium: medium', '              high: high', '              max: max'];

export default {
  type: 'dsh',
  label: 'DeepSeek Harness',
  description: 'DeepSeek Harness agent. Fast startup and short answers.',

  packages: [{ name: PKG, version: '0.1.5-rc.2' }],
  verified: { on: '2026-11-10', note: 'rules, MCP servers and the on-disk session format checked on 0.1.5-rc.2' },
  capabilities: { compact: null, rules: 'prompt', mcp: 'acp', mcpStart: 'eager', sessionsOnDisk: true },

  launch(install) {
    const missing = [];
    const dir = packageDir(install, PKG, missing);
    return { cmd: install.node, args: [`${dir}/lib/bin.js`, '--profile', 'acp'], env: {}, missing };
  },

  /**
   * Another endpoint and key: a patch file (`--patch`) that declares the route in the llm-pi-ai plugin, with the key
   * read from an environment variable. The route is added to the model list; the default model stays dsh's, so the
   * caller selects `model` (a config option value) after the session starts.
   */
  provider: {
    protocol: 'openai',
    scope: 'process',
    apply({ provider, endpoint, model, dir }) {
      const models = (provider.models?.length ? provider.models : [model]).filter(Boolean);
      const yaml = [
        '- id: llm-pi-ai',
        '  config:',
        '    providers:',
        `      ${provider.id}:`,
        `        displayName: ${provider.id}`,
        '        apiKeyEnv: SCAFFOLD_PROVIDER_KEY',
        '        api: openai-completions',
        `        baseURL: ${JSON.stringify(endpoint)}`,
        // many compatible endpoints reject the `developer` role that reasoning models are sent by default
        '        compat:',
        '          supportsDeveloperRole: false',
        '        models:',
        ...models.flatMap((m) => [`          - id: ${JSON.stringify(m)}`, `            name: ${JSON.stringify(m)}`, '            contextWindow: 200000', ...REASONING_EFFORTS]),
        '',
      ].join('\n');
      return {
        env: { SCAFFOLD_PROVIDER_KEY: provider.apiKey },
        args: ['--patch', `${dir}/dsh-patch.yml`],
        files: [{ name: 'dsh-patch.yml', content: yaml }],
        model: model ? JSON.stringify([provider.id, model]) : null,
      };
    },
  },

  rules() {
    return RULES_IN_PROMPT;
  },

  /** Sessions saved for exactly this directory, newest first; null when it cannot tell. */
  diskSessions: (cwd) => dshSessions(cwd),
};
