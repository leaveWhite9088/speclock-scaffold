/**
 * Where agentd finds SpecLock Core, and what it says when there is none. Folders of its own making, no Core, no network.
 *
 * Checks:
 *   1. a folder named on purpose (AGENTD_SPECLOCK_DIR) is used as it is
 *   2. otherwise the copy preflight fetched into data/global/tools wins over the one next to the repository
 *   3. a folder that is not a Core checkout is not taken for one
 *   4. with none found, starting says where it looked and how to fetch it
 */

import '../lib/isolate.mjs';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
delete process.env.AGENTD_SPECLOCK_DIR;
const cfg = await import('../../core/specs/config.mjs');
const { ensureRunning } = await import('../../core/specs/index.mjs');
const { check } = await import('../lib/scheduler.mjs');

console.log('\n=== where Core is ===\n');

const fakeCore = (dir) => {
  mkdirSync(join(dir, 'packages', 'config'), { recursive: true });
  writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "x"\n');
};

// 3
mkdirSync(cfg.OWN_CORE_DIR, { recursive: true });
const empty = cfg.coreDir();
check('an empty folder there is not taken for one', empty !== cfg.OWN_CORE_DIR, empty);

// 2
fakeCore(cfg.OWN_CORE_DIR);
check('the copy fetched by preflight is used', cfg.coreDir() === cfg.OWN_CORE_DIR, cfg.coreDir());
check('and its environment is looked for inside it', cfg.venvPython().startsWith(cfg.OWN_CORE_DIR));

// 1
const named = mkdtempSync(join(tmpdir(), 'named-core-'));
process.env.AGENTD_SPECLOCK_DIR = named;
check('a folder named on purpose wins, even over the fetched copy', cfg.coreDir() === named && cfg.venvPython().startsWith(named));

// 4
process.env.AGENTD_SPECLOCK_DIR = join(named, 'not-there');
let said = '';
await ensureRunning().catch((e) => (said = e.message));
check('with none found it says where it looked', said.includes(join(named, 'not-there')), said.slice(0, 120));
check('and how to fetch one', /preflight -- core --yes/.test(said) && /git and uv/.test(said), said.slice(0, 200));

console.log(process.exitCode ? '\n=> ✗ WHERE CORE IS BROKEN' : '\n=> ✓ WHERE CORE IS OK');
process.exit(process.exitCode ?? 0);
