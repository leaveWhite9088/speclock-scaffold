/**
 * The daemon's side of the manifest: what core/pool/install.mjs does with what the preflight wrote, and without it.
 * No process, no model.
 */

import '../lib/isolate.mjs';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'agentd-install-'));
const manifestFile = join(base, 'clis.json');
const nodeModules = join(base, 'nm');
process.env.AGENTD_CLIS_FILE = manifestFile;
process.env.AGENTD_NODE_MODULES = nodeModules;
process.env.AGENTD_DATA_DIR = join(base, 'data');
delete process.env.MCODE_NODE_BIN;

const { currentInstall, nodeBin, readManifest, piPaths } = await import('../../core/pool/install.mjs');
const { AGENTS } = await import('../../core/pool/config.mjs');

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || !extra ? '' : `  (${extra})`}`);
  if (!ok) failed++;
};
const put = (root, name, version) => {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, 'package.json'), JSON.stringify({ name, version }));
};

console.log('\n=== install (the manifest, on the daemon side) ===\n');

check('no manifest: node is the one running the daemon', readManifest() === null && nodeBin() === process.execPath);
check('no manifest and nothing installed: a package is not found', currentInstall().dir('@minimax-ai/code') === null);

put(nodeModules, '@minimax-ai/code', '0.7.6');
check('no manifest: packages are looked for in the node_modules next to node (AGENTD_NODE_MODULES here)', currentInstall().dir('@minimax-ai/code') === join(nodeModules, '@minimax-ai/code') && currentInstall().version('@minimax-ai/code') === '0.7.6');

// a manifest points elsewhere
const own = join(base, 'tools', 'node_modules');
put(own, '@minimax-ai/code', '0.7.6');
writeFileSync(manifestFile, JSON.stringify({ schema: 1, node: 'M:/node/node.exe', packages: { '@minimax-ai/code': { dir: join(own, '@minimax-ai/code'), version: '0.7.6', source: 'scaffold' } } }));
check('a manifest is read, and wins over the fallback', currentInstall().dir('@minimax-ai/code') === join(own, '@minimax-ai/code'));
check('and gives the node to use', nodeBin() === 'M:/node/node.exe' && currentInstall().node === 'M:/node/node.exe');
process.env.MCODE_NODE_BIN = 'E:/override/node.exe';
check('the environment still overrides the node', nodeBin() === 'E:/override/node.exe');
delete process.env.MCODE_NODE_BIN;

// a manifest naming a folder that is gone falls back instead of failing
writeFileSync(manifestFile, JSON.stringify({ schema: 1, packages: { '@minimax-ai/code': { dir: join(base, 'gone') } } }));
const later = new Date(Date.now() + 5000);
utimesSync(manifestFile, later, later);
check('a changed manifest is read again without a restart; a folder that is gone falls back', currentInstall().dir('@minimax-ai/code') === join(nodeModules, '@minimax-ai/code'));
writeFileSync(manifestFile, '{ not json');
const later2 = new Date(Date.now() + 10_000);
utimesSync(manifestFile, later2, later2);
check('an unreadable manifest is ignored', readManifest() === null && currentInstall().dir('@minimax-ai/code') === join(nodeModules, '@minimax-ai/code'));

// the registry: worked out at read time from what is installed
const mcode = AGENTS.mcode;
check('AGENTS gives the command from the driver and the install', mcode.cmd === process.execPath && mcode.args[0] === `${join(nodeModules, '@minimax-ai/code').replace(/\\/g, '/')}/cli.js` && mcode.args[1] === 'acp', JSON.stringify(mcode.args));
check('a CLI that is not installed says what is missing, and does not throw', AGENTS.dsh.launch().missing[0] === '@deepseek-ai/dsh');
check('piPaths names what is missing for the dispatcher', piPaths().missing[0] === '@earendil-works/pi-coding-agent');
put(nodeModules, '@earendil-works/pi-coding-agent', '1.3.0');
check('and gives pi\'s cli.js once it is there', piPaths().missing.length === 0 && piPaths().cli.endsWith('pi-coding-agent/dist/bundle/cli.js'));

console.log(failed ? `\n=> ✗ ${failed} FAILED` : '\n=> ✓ INSTALL OK');
process.exit(failed ? 1 : 0);
