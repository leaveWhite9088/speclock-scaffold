/**
 * `agentd.config.json` next to the daemon (or the file AGENTD_CONFIG names), parsed once. It holds the settings that
 * are not about one part of agentd: limits (`limits.maxAttempts`, `limits.forcedStopLimit`, …), the default model per CLI
 * type, the default role per CLI type. Each part reads its own section; this file only reads the file. There is no
 * setting for where an executor works: that is the project's root and the executor's own subdirectory.
 *
 *   { "defaultModels": { "mcode": "m:minimax:MiniMax-M3:v:" }, "limits": { "maxAttempts": 3 } }
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** packages/agentd */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = process.env.AGENTD_CONFIG || join(ROOT, 'agentd.config.json');

function load() {
  try {
    if (existsSync(CONFIG_FILE)) return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) ?? {};
  } catch (err) {
    process.stderr.write(`[agentd] agentd.config.json unreadable, ignoring: ${err.message}\n`);
  }
  return {};
}

/** Parsed `agentd.config.json`, or an empty object. */
export const CONFIG = load();
