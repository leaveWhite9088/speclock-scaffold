/**
 * OpenCode. Speaks ACP natively (`opencode acp`).
 *
 *   rules   OPENCODE_CONFIG_CONTENT = {"instructions":[file]}  (an existing value of the variable is kept)
 *   mcp     `mcpServers` of session/new and session/resume
 *   compact /compact works although it is not in the advertised command list
 */

import { exe, NO_RULES, RULES_IN_PROMPT, packageDir } from './lib.mjs';

const PKG = 'opencode-ai';

export default {
  type: 'opencode',
  label: 'OpenCode',
  description: 'OpenCode. Speaks ACP natively; many providers.',

  packages: [{ name: PKG, version: '1.19.1' }],
  verified: { on: '2026-11-10', note: 'rules, MCP servers and /compact checked on 1.19.1' },
  capabilities: { compact: '/compact', rules: 'env', mcp: 'acp', mcpStart: 'eager' },

  launch(install) {
    const missing = [];
    const dir = packageDir(install, PKG, missing);
    return { cmd: `${dir}/bin/${exe('opencode')}`, args: ['acp'], env: {}, missing };
  },

  /** `env` is the environment the daemon runs in, for a configuration the user already passes this way. */
  rules({ file, env = {} }) {
    if (!file) return RULES_IN_PROMPT;
    let base = {};
    try {
      base = JSON.parse(env.OPENCODE_CONFIG_CONTENT || '{}');
    } catch {
      /* not JSON: replaced */
    }
    const instructions = [...(Array.isArray(base.instructions) ? base.instructions : []), file];
    return { ...NO_RULES, env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...base, instructions }) } };
  },
};
