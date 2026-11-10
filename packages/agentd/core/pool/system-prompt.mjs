/**
 * Handing rules to an agent without writing anything into the user's project.
 *
 * The rules (what an executor may and may not do, how to report) used to be an AGENTS.md / CLAUDE.md dropped into the
 * project. The project has its own, and a file that already exists was never overwritten, so our rules silently did
 * not apply there. Each CLI is now given them through whatever it offers for extra system instructions. The text
 * lives in agentd's own data directory.
 *
 * Which channel each CLI uses is in its driver (packages/drivers). A CLI with no channel gets the text in front of the
 * first prompt of each session (`prefix`).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUTPUTS_DIR } from '../data-dir.mjs';
import { getDriver } from '@speclock-scaffold/drivers';
import { log } from './config.mjs';

const RULES_DIR = join(OUTPUTS_DIR, 'rules');
const safe = (s) => String(s).replace(/[^A-Za-z0-9._~-]/g, '_');

/** @returns {{ args: string[], env: Record<string,string>, meta: object | null, prefix: boolean, file: string | null }} */
export function injectionFor(type, text, name) {
  const none = { args: [], env: {}, meta: null, prefix: false, file: null };
  if (!text?.trim()) return none;

  let file = join(RULES_DIR, `${safe(name)}.md`);
  try {
    mkdirSync(RULES_DIR, { recursive: true });
    writeFileSync(file, text, 'utf8');
  } catch (err) {
    log(`[${name}] could not write the rules file:`, err.message);
    file = null;
  }

  // How a CLI takes the rules is its driver's business; one without a driver gets the text in front of the first prompt.
  const d = getDriver(type);
  const how = d ? d.rules({ text, file, env: process.env }) : { ...none, prefix: true };
  return { ...none, ...how, file };
}
