/** What the check says, per CLI: one status, the packages behind it, and hints that something outside our reach is not set up. */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { behaviourOf } from './probe.mjs';

const RANK = { ok: 0, newer: 1, unknown: 2, older: 3, missing: 4 };

/** The worst status among a CLI's packages. */
export const worst = (statuses) => statuses.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'ok');

/**
 * Login and configuration are the user's, and no version check sees them. Where we know a file a CLI needs, say so.
 * Only hints: nothing here blocks, and nothing is created.
 */
export function hintsFor(type, env = process.env) {
  const home = homedir();
  if (type === 'claude') {
    const file = join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'settings.json');
    return existsSync(file) ? [] : [`no ${file}: the endpoint and login of Claude Code are not configured here`];
  }
  if (type === 'pi') {
    const dir = env.PI_CODING_AGENT_DIR || join(home, '.pi', 'agent');
    return existsSync(join(dir, 'auth.json')) || existsSync(join(dir, 'models.json')) ? [] : [`pi has no credentials or custom models in ${dir}`];
  }
  if (type === 'kimi') {
    const dir = env.KIMI_CODE_HOME || join(home, '.kimi-code');
    return existsSync(join(dir, 'config.toml')) || existsSync(join(dir, 'credentials')) ? [] : [`kimi has no login or config in ${dir}`];
  }
  return [];
}

/** @param {Record<string, any>} detected from detectPackages; `probes` is what readProbes gave (or null) */
export function summarize(drivers, detected, env = process.env, probes = null) {
  return Object.values(drivers).map((d) => {
    const pkgs = d.packages.map((p) => detected[p.name]);
    const status = worst(pkgs.map((p) => p.status));
    return {
      type: d.type,
      status,
      packages: pkgs.map((p) => ({ name: p.name, wanted: p.wanted, version: p.version, status: p.status, source: p.source, dir: p.dir })),
      verified: d.verified,
      hints: hintsFor(d.type, env),
      behaviour: behaviourOf(probes, d.type, pkgs),
    };
  });
}

const MARK = { ok: '✓', newer: '~', unknown: '?', older: '!', missing: '✗' };
const NOTE = {
  ok: 'at the verified version',
  newer: 'newer than verified: not checked by us (run the probes)',
  older: 'older than verified',
  unknown: 'version could not be read',
  missing: 'not installed',
};

export function formatReport({ node, roots, rows }) {
  const lines = [];
  lines.push(`node      ${node}  (${process.version})`);
  roots.forEach((r, i) => lines.push(`${i === 0 ? 'looked in ' : '          '}${r.label.padEnd(8)} ${r.path}${r.exists === false ? '  (not there)' : ''}`));
  lines.push('');
  for (const row of rows) {
    lines.push(`${MARK[row.status]} ${row.type.padEnd(9)} ${NOTE[row.status]}`);
    for (const p of row.packages) {
      const at = p.version ? `${p.version} (${p.source})` : '-';
      lines.push(`    ${p.name.padEnd(40)} found ${at.padEnd(22)} verified ${p.wanted}`);
    }
    if (row.status !== 'ok') lines.push(`    verified on ${row.verified.on}: ${row.verified.note}`);
    lines.push(`    behaviour: ${describeBehaviour(row.behaviour)}`);
    for (const h of row.hints) lines.push(`    hint: ${h}`);
  }
  return lines.join('\n');
}

const day = (iso) => String(iso).slice(0, 10);

export function describeBehaviour(b) {
  if (b.state === 'verified') return `rules and MCP verified at these versions (${day(b.at)})`;
  if (b.state === 'failed') return `FAILED at these versions (${day(b.at)}): ${b.failed.join(', ')}`;
  if (b.state === 'stale') return `last probed at other versions (${day(b.at)}); not verified at these: run preflight probe`;
  return 'never probed: preflight probe';
}
