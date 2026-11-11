/**
 * Gives an in-process test a folder of its own and removes it when the test ends, so that nothing is left behind:
 *
 *   - the data directory (AGENTD_DATA_DIR) points into it, so the test never writes into the real `data/`, nor into the one
 *     of a private daemon that scripts/run-isolated.mjs started (a test that needs another sets it itself afterwards);
 *   - the system temp folder (TEMP / TMP / TMPDIR) points into it as well, so the folders a test makes with
 *     `mkdtempSync(join(tmpdir(), ...))` go away with it.
 *
 * Import it first in a test, before anything from core/: the data paths are worked out when core is loaded.
 *
 *   import '../lib/isolate.mjs';
 *
 * Only for tests that run the code in-process. A test that talks to a daemon does not use this: the daemon keeps its own
 * data, which is why those are run through scripts/run-isolated.mjs.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'agentd-test-'));
const tmp = join(root, 'tmp');
mkdirSync(tmp);
process.env.AGENTD_DATA_DIR = join(root, 'data');
process.env.TEMP = process.env.TMP = process.env.TMPDIR = tmp;

process.on('exit', () => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* a child process may still hold a file; the system temp folder takes it from there */
  }
});
