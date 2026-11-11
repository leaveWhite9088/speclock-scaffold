/**
 * Claude Code, through the official ACP adapter (@agentclientprotocol/claude-agent-acp), which runs the installed
 * Claude Code.
 *
 *   rules   session/new _meta.systemPrompt.append  (appended to Claude Code's own prompt)
 *   mcp     `mcpServers` of session/new and session/resume
 *   compact /compact
 *   login   the adapter does not read the `env` block of ~/.claude/settings.json (endpoint, model, token) itself, so
 *           without it the CLI reports "not logged in": `envFn` reads it again at every process start, which makes a
 *           profile switched with cc-switch apply the next time the executor starts
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { exe, NO_RULES, packageDir } from './lib.mjs';

const ADAPTER = '@agentclientprotocol/claude-agent-acp';
const CLI = '@anthropic-ai/claude-code';

/** The `env` block of the user's Claude Code settings, as plain strings. Never logged. */
function settingsEnv() {
  try {
    const file = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json');
    const env = JSON.parse(readFileSync(file, 'utf8'))?.env ?? {};
    return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, String(v)]));
  } catch {
    return {};
  }
}

export default {
  type: 'claude',
  label: 'Claude Code',
  description: 'Claude Code through the ACP adapter. Uses the endpoint and login configured in ~/.claude/settings.json.',

  packages: [
    { name: ADAPTER, version: '0.94.0' },
    { name: CLI, version: '2.1.295' },
  ],
  verified: { on: '2026-11-10', note: 'rules, MCP servers and /compact checked on adapter 0.94.0 with Claude Code 2.1.295' },
  capabilities: { compact: '/compact', rules: 'meta', mcp: 'acp', mcpStart: 'eager' },

  launch(install) {
    const missing = [];
    const adapter = packageDir(install, ADAPTER, missing);
    const cli = packageDir(install, CLI, missing);
    return {
      cmd: install.node,
      args: [`${adapter}/dist/index.js`],
      env: { CLAUDE_CODE_EXECUTABLE: `${cli}/bin/${exe('claude')}` },
      missing,
    };
  },

  /** Added to the environment at every process start. */
  envFn: settingsEnv,

  /**
   * Another endpoint and key, through the environment of this process only. Claude Code speaks the Anthropic protocol.
   * Its model names all point at `model`, whatever alias the CLI picks.
   */
  provider: {
    protocol: 'anthropic',
    scope: 'process',
    apply({ provider, endpoint, model }) {
      const env = { ANTHROPIC_BASE_URL: endpoint, ANTHROPIC_AUTH_TOKEN: provider.apiKey };
      if (model) {
        for (const k of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL']) env[k] = model;
      }
      return { env, args: [], files: [], model: null };
    },
  },

  rules({ text }) {
    return { ...NO_RULES, meta: { systemPrompt: { append: text } } };
  },
};
