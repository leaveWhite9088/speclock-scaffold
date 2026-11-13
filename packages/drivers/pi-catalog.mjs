/**
 * What pi knows about a model's reasoning levels.
 *
 * pi ships a catalog of the models of its own providers (pi-ai's `providers/data/*.json`, next to its cli.js). A custom
 * provider's model with the same id has the same levels, so the entry written for it takes them from there. A model pi
 * does not know gets the default levels.
 *
 * pi offers off, minimal, low, medium, high, xhigh, max. A level whose map value is null is out; xhigh and max are in only when
 * the map names them.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** A model nobody told pi about: off, low, medium, high and max. */
export const DEFAULT_REASONING = { reasoning: true, thinkingLevelMap: { minimal: null, max: 'max' } };

const catalogs = new Map();

/** Every model of pi's catalog as `{ provider, id, reasoning, map }`, or null when the catalog cannot be read. `cli` is pi's cli.js. */
function catalogOf(cli) {
  const pkg = String(cli ?? '').replace(/[\\/]dist[\\/]bundle[\\/]cli\.js$/, '');
  if (!cli || pkg === cli) return null;
  if (catalogs.has(pkg)) return catalogs.get(pkg);
  let list = null;
  try {
    const dir = join(pkg, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data');
    list = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      for (const group of Object.values(data)) {
        for (const m of Object.values(group)) {
          if (m?.id && m.reasoning !== undefined) list.push({ provider: file.slice(0, -5), id: m.id, reasoning: Boolean(m.reasoning), map: m.thinkingLevelMap ?? null });
        }
      }
    }
  } catch {
    list = null;
  }
  catalogs.set(pkg, list);
  return list;
}

/** The levels pi offers for a model entry. */
const levelsOf = ({ reasoning, map }) => (reasoning ? LEVELS.filter((l) => map?.[l] !== null && (l === 'xhigh' || l === 'max' ? map?.[l] !== undefined : true)) : []);

/** Entries of the catalog for `id`: the same id, else the same ignoring case, else the same after the last "/". */
function matches(list, id) {
  const lower = String(id).toLowerCase();
  const tail = lower.split('/').pop();
  for (const same of [(m) => m.id === id, (m) => m.id.toLowerCase() === lower, (m) => m.id.toLowerCase().split('/').pop() === tail]) {
    const hit = list.filter(same);
    if (hit.length) return hit;
  }
  return [];
}

/**
 * The reasoning part of a model entry for `models.json`. A model pi knows keeps its levels (each named as pi names it, not as the
 * catalog's provider calls it on the wire); another gets the default. Where several providers list the model, the one named
 * like this provider wins, else the first.
 * @param {string} id  @param {string | undefined} cli  pi's cli.js  @param {string} providerId
 */
export function reasoningFor(id, cli, providerId) {
  const list = catalogOf(cli);
  if (!list) return DEFAULT_REASONING;
  const found = matches(list, id);
  const hit = found.find((m) => m.provider === providerId) ?? found[0];
  if (!hit) return DEFAULT_REASONING;
  const levels = levelsOf(hit);
  if (!levels.length) return { reasoning: false };
  const map = {};
  for (const l of LEVELS) {
    if (!levels.includes(l)) map[l] = null;
    else if (l === 'xhigh' || l === 'max') map[l] = l;
  }
  return { reasoning: true, thinkingLevelMap: map };
}
