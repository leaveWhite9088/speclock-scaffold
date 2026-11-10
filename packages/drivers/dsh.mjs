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

  rules() {
    return RULES_IN_PROMPT;
  },

  /** Sessions saved for exactly this directory, newest first; null when it cannot tell. */
  diskSessions: (cwd) => dshSessions(cwd),
};
