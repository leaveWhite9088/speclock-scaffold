/**
 * Run tests against a private daemon: its own data directory (empty), its own temp folder, its own pipe. The daemon a person is using, and
 * its tasks and files, are not touched, and nothing here waits for it to be idle or asks for it to be restarted.
 *
 * Usage: node scripts/run-isolated.mjs [npm-script ...]        (default: test:all, the whole suite)
 *        node scripts/run-isolated.mjs test:projects test:events
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// one folder holds everything the run makes: the daemon's data, and a temp folder for what the tests make; it is removed at the end
const root = mkdtempSync(join(tmpdir(), 'agentd-iso-'));
const dataDir = join(root, 'data');
const tmpDir = join(root, 'tmp');
mkdirSync(dataDir);
mkdirSync(tmpDir);
const pipe = `\\\\.\\pipe\\agentd-iso-${Date.now().toString(36)}`;
const env = { ...process.env, TEMP: tmpDir, TMP: tmpDir, TMPDIR: tmpDir, AGENTD_DATA_DIR: dataDir, AGENTD_PIPE: pipe, AGENTD_PORT: '', AGENTD_STOP_WAIT_MS: '5000' };
delete env.AGENTD_PORT;
const scripts = process.argv.slice(2).length ? process.argv.slice(2) : ['test:all'];
console.log(`private daemon: data ${dataDir}, pipe ${pipe}`);

let code = 0;
for (const script of scripts) {
  code = await new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], { cwd: ROOT, env, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('close', (c) => resolve(c ?? 1));
  });
  if (code) break;
}

// Stop the private daemon, and only that one.
try {
  const pid = Number(JSON.parse(readFileSync(join(dataDir, 'agentd.endpoint.json'), 'utf8')).pid);
  if (pid) spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Where-Object { $_.CommandLine -like '*agentd.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { stdio: 'ignore' });
} catch {
  /* it never started, or is already gone */
}
await new Promise((r) => setTimeout(r, 800));
try {
  rmSync(root, { recursive: true, force: true });
} catch {
  /* left behind in the temp folder */
}
process.exit(code);
