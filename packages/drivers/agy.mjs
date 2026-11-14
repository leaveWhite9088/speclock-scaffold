/**
 * Google Antigravity CLI (`agy`). Standalone binary; speaks ACP v1 natively over stdio (`agy acp`).
 *
 *   rules     session/new and session/resume `_meta.antigravity.systemPrompt.append`
 *   mcp       `mcpServers` of session/new and session/resume (`--dangerously-skip-permissions` lets a headless
 *             executor call session-supplied MCP tools and edit inside its workspace without interactive prompts)
 *   compact   `/compact`, advertised and handled natively over ACP
 *   provider  none: `agy` signs in only through Google accounts, Gemini API keys or Vertex ADC, not arbitrary
 *             OpenAI/Anthropic base URLs
 */

import { binaryPath, NO_RULES } from './lib.mjs';

const BIN = 'agy';

export default {
  type: 'agy',
  label: 'Antigravity',
  description: 'Google Antigravity CLI; native ACP, uses its own Google login.',

  packages: [],
  binaries: [{ name: BIN, version: '1.5.9' }],
  verified: { on: '2026-11-14', note: 'ACP v1 over stdio, _meta.antigravity.systemPrompt.append, MCP servers and /compact checked on 1.5.9' },
  capabilities: { compact: '/compact', rules: 'meta', mcp: 'acp', mcpStart: 'eager' },

  launch(install) {
    const missing = [];
    const cmd = binaryPath(install, BIN, missing);
    return {
      cmd,
      args: ['acp', '--dangerously-skip-permissions'],
      env: {},
      missing,
    };
  },

  rules({ text }) {
    return { ...NO_RULES, meta: { antigravity: { systemPrompt: { append: text } } } };
  },
};
