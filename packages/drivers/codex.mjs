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

  rules({ text }) {
    return { ...NO_RULES, meta: { jetbrains: { air: { customInstructions: text } } } };
  },
};
