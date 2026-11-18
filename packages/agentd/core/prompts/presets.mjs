/**
 * Scene presets: reusable pairs of base system prompts (one for the project's dispatcher, one shared by its executors).
 *
 * Built-in presets live as read-only markdown files under `contexts/`; user edits to built-in presets and user-created
 * presets are stored in `data/global/presets.json`, so editing or adding a preset in Settings never dirties git and a
 * built-in preset can always be reset to its original text.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GLOBAL_DIR } from '../base/index.mjs';
import { CONTEXTS, stripComments } from './rules.mjs';

export const DEFAULT_PRESET_ID = 'software-dev';
export const PRESETS_FILE = () => process.env.AGENTD_PRESETS_FILE || join(GLOBAL_DIR, 'presets.json');

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const MODES = new Set(['inherit', 'append', 'override']);

const BUILTINS = [
  {
    id: 'software-dev',
    name: '软件工程研发',
    description: '基于业务规格、模块拆分、前后端协作与独立验收的软件工程研发流程',
    dispatcherFile: 'project.md',
    executorFile: 'executor.md',
  },
  {
    id: 'multi-agent-arena',
    name: '多智能体竞技博弈',
    description: '多席位沙盒防作弊隔离、分轮竞标或策略进化、公证结算与全知视角解说',
    dispatcherFile: 'presets/multi-agent-arena/project.md',
    executorFile: 'presets/multi-agent-arena/executor.md',
  },
  {
    id: 'media-studio',
    name: '自媒体内容工坊',
    description: '选题调研、多模型钩子赛马、口播分镜与代码动画制作、挑刺审稿去 AI 腔',
    dispatcherFile: 'presets/media-studio/project.md',
    executorFile: 'presets/media-studio/executor.md',
  },
];

const BUILTIN_MAP = new Map(BUILTINS.map((b) => [b.id, b]));
const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

function readContextFile(rel) {
  try {
    return readFileSync(join(CONTEXTS, rel), 'utf8').replace(/\r\n/g, '\n').trim();
  } catch {
    return '';
  }
}

function loadStore() {
  try {
    const data = JSON.parse(readFileSync(PRESETS_FILE(), 'utf8'));
    return data && typeof data === 'object' && data.presets && typeof data.presets === 'object' ? data : { schema: 1, presets: {} };
  } catch {
    return { schema: 1, presets: {} };
  }
}

function persistStore(data) {
  const file = PRESETS_FILE();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
}

function buildBuiltIn(def, override = null) {
  if (!override) {
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      dispatcherPrompt: readContextFile(def.dispatcherFile),
      executorPrompt: readContextFile(def.executorFile),
      builtIn: true,
      modified: false,
    };
  }
  return {
    id: def.id,
    name: override.name || def.name,
    description: override.description ?? def.description,
    dispatcherPrompt: override.dispatcherPrompt ?? readContextFile(def.dispatcherFile),
    executorPrompt: override.executorPrompt ?? readContextFile(def.executorFile),
    builtIn: true,
    modified: true,
    updatedAt: override.updatedAt,
  };
}

/** All scene presets: built-ins first (with any user edits overlaid), then user-created presets sorted by id. */
export function listPresets() {
  const store = loadStore();
  const builtIns = BUILTINS.map((def) => buildBuiltIn(def, store.presets[def.id] ?? null));
  const custom = Object.entries(store.presets)
    .filter(([id]) => !BUILTIN_MAP.has(id))
    .map(([id, p]) => ({
      id,
      name: p.name || id,
      description: p.description ?? '',
      dispatcherPrompt: p.dispatcherPrompt ?? '',
      executorPrompt: p.executorPrompt ?? '',
      builtIn: false,
      modified: false,
      updatedAt: p.updatedAt,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return [...builtIns, ...custom];
}

export function getPreset(id) {
  const key = String(id ?? '').trim();
  if (!ID_RE.test(key)) return null;
  const store = loadStore();
  const def = BUILTIN_MAP.get(key);
  if (def) return buildBuiltIn(def, store.presets[key] ?? null);
  const p = store.presets[key];
  if (!p) return null;
  return {
    id: key,
    name: p.name || key,
    description: p.description ?? '',
    dispatcherPrompt: p.dispatcherPrompt ?? '',
    executorPrompt: p.executorPrompt ?? '',
    builtIn: false,
    modified: false,
    updatedAt: p.updatedAt,
  };
}

export const hasPreset = (id) => getPreset(id) !== null;

/** Create or update a preset (built-in overrides and custom presets alike). */
export function savePreset({ id, name, description, dispatcherPrompt, executorPrompt }) {
  const key = String(id ?? '').trim();
  if (!ID_RE.test(key)) {
    throw new Error('preset id must use lowercase letters, digits, "-" or "_", starting with a letter or digit (max 40)');
  }
  const dp = String(dispatcherPrompt ?? '').replace(/\r\n/g, '\n').trim();
  const ep = String(executorPrompt ?? '').replace(/\r\n/g, '\n').trim();
  if (!dp) throw new Error('dispatcherPrompt is required');
  if (!ep) throw new Error('executorPrompt is required');
  const store = loadStore();
  store.presets[key] = {
    name: oneLine(name).slice(0, 80) || BUILTIN_MAP.get(key)?.name || key,
    description: oneLine(description).slice(0, 300),
    dispatcherPrompt: dp,
    executorPrompt: ep,
    updatedAt: new Date().toISOString(),
  };
  persistStore(store);
  return getPreset(key);
}

/** Restore a built-in preset to its original markdown files. */
export function resetPreset(id) {
  const key = String(id ?? '').trim();
  if (!BUILTIN_MAP.has(key)) throw new Error(`"${key}" is not a built-in preset`);
  const store = loadStore();
  delete store.presets[key];
  persistStore(store);
  return getPreset(key);
}

/** Delete a user-created preset. Built-in presets cannot be deleted (reset them instead). */
export function removePreset(id) {
  const key = String(id ?? '').trim();
  if (!ID_RE.test(key)) throw new Error(`unknown preset "${key}"`);
  if (BUILTIN_MAP.has(key)) throw new Error(`"${key}" is a built-in preset and cannot be deleted; reset it instead`);
  const store = loadStore();
  if (!store.presets[key]) throw new Error(`unknown preset "${key}"`);
  delete store.presets[key];
  persistStore(store);
  return { id: key, removed: true };
}

/** Validate and normalize a project's optional prompt overrides; returns null when everything inherits the preset. */
export function cleanProjectPrompts(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'object') throw new Error('prompts must be an object');
  const dm = raw.dispatcherMode ? String(raw.dispatcherMode) : 'inherit';
  const em = raw.executorMode ? String(raw.executorMode) : 'inherit';
  if (!MODES.has(dm)) throw new Error(`invalid dispatcherMode "${dm}"`);
  if (!MODES.has(em)) throw new Error(`invalid executorMode "${em}"`);
  const dp = String(raw.dispatcherPrompt ?? '').replace(/\r\n/g, '\n').trim();
  const ep = String(raw.executorPrompt ?? '').replace(/\r\n/g, '\n').trim();
  if (dm === 'override' && !dp) throw new Error('dispatcherPrompt is required when dispatcherMode is "override"');
  if (em === 'override' && !ep) throw new Error('executorPrompt is required when executorMode is "override"');
  const out = {};
  if (dm !== 'inherit' && dp) {
    out.dispatcherMode = dm;
    out.dispatcherPrompt = dp;
  }
  if (em !== 'inherit' && ep) {
    out.executorMode = em;
    out.executorPrompt = ep;
  }
  return Object.keys(out).length ? out : null;
}

/** Normalized view returned to the UI so forms always see explicit modes and strings. */
export function viewProjectPrompts(prompts) {
  return {
    dispatcherMode: prompts?.dispatcherMode || 'inherit',
    dispatcherPrompt: prompts?.dispatcherPrompt || '',
    executorMode: prompts?.executorMode || 'inherit',
    executorPrompt: prompts?.executorPrompt || '',
  };
}

/** Final dispatcher system prompt for a project (preset + optional project append/override, HTML comments stripped). */
export function resolveDispatcherRules({ presetId, prompts } = {}) {
  const preset = getPreset(presetId || DEFAULT_PRESET_ID) ?? getPreset(DEFAULT_PRESET_ID);
  const base = stripComments(preset?.dispatcherPrompt ?? '');
  const mode = prompts?.dispatcherMode || 'inherit';
  const extra = stripComments(prompts?.dispatcherPrompt ?? '');
  if (mode === 'override' && extra) return extra;
  if (mode === 'append' && extra) return [base, extra].filter(Boolean).join('\n\n---\n\n');
  return base;
}

/** Final shared executor base rules for a project (before template prompt and SpecLock role prompt are appended). */
export function resolveExecutorBaseRules({ presetId, prompts } = {}) {
  const preset = getPreset(presetId || DEFAULT_PRESET_ID) ?? getPreset(DEFAULT_PRESET_ID);
  const base = stripComments(preset?.executorPrompt ?? '');
  const mode = prompts?.executorMode || 'inherit';
  const extra = stripComments(prompts?.executorPrompt ?? '');
  if (mode === 'override' && extra) return extra;
  if (mode === 'append' && extra) return [base, extra].filter(Boolean).join('\n\n---\n\n');
  return base;
}
