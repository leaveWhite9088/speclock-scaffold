/**
 * Executor templates: a name, what the executor is for, where it works, and the system prompt that makes it that
 * kind of executor. They are markdown files in `contexts/templates/<id>.md`, next to the other rules:
 *
 *   ---
 *   name: spec-agent
 *   role: 负责工程规格、接口契约与任务书      (what the dispatcher reads when it picks someone)
 *   dir: .                                  (where it works, inside the project; "." is the project root)
 *   type:                                   (the CLI it suggests; empty: the person picks)
 *   model:                                  (the model it suggests; empty: the CLI's default)
 *   spec:                                   (the role it suggests in the spec library: requirements, executor, tester or scanner; empty: none)
 *   ---
 *   The system prompt, in markdown. HTML comments are notes for whoever edits it and never reach the agent.
 *
 * An executor made from a template remembers the template's id. Its rules are the executor rules plus the template's
 * prompt, read again every time it starts, so editing the file applies to the next start of every executor made from it.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTEXTS, executorRules, isSpecRole, specRules, stripComments } from './rules.mjs';

const DIR = process.env.AGENTD_TEMPLATES_DIR || join(CONTEXTS, 'templates');
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const KEYS = ['name', 'role', 'dir', 'type', 'model', 'spec'];

function checkId(id) {
  if (!ID.test(String(id ?? ''))) throw new Error('a template id is letters, digits, "-" and "_", at most 40, starting with a letter or digit');
}

/** `---` block of `key: value` lines, then the body. A file without the block is all body. */
function parse(id, raw) {
  const text = String(raw).replace(/\r\n/g, '\n');
  const out = { id, name: id, role: '', dir: '.', type: '', model: '', spec: '', prompt: text.trim() };
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const at = line.indexOf(':');
    if (at < 0) continue;
    const key = line.slice(0, at).trim();
    if (KEYS.includes(key)) out[key] = line.slice(at + 1).trim();
  }
  out.prompt = m[2].trim();
  if (!out.name) out.name = id;
  if (!out.dir) out.dir = '.';
  if (!isSpecRole(out.spec)) out.spec = ''; // a hand-edited file with a role that does not exist suggests none
  return out;
}

const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

function render(t) {
  const head = KEYS.map((k) => `${k}: ${oneLine(t[k])}`).join('\n');
  return `---\n${head}\n---\n\n${String(t.prompt ?? '').trim()}\n`;
}

function read(id) {
  try {
    return parse(id, readFileSync(join(DIR, `${id}.md`), 'utf8'));
  } catch {
    return null;
  }
}

/** All templates, by id. */
export function listTemplates() {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => read(f.slice(0, -3)))
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getTemplate(id) {
  if (!ID.test(String(id ?? ''))) return null;
  return read(id);
}

/** Create or replace a template. `type`, `model` and `prompt` may be empty. */
export function saveTemplate({ id, name, role, dir, type, model, spec, prompt }) {
  checkId(id);
  if (spec && !isSpecRole(spec)) throw new Error(`unknown spec role "${spec}"; use requirements, executor, tester, scanner, or leave it empty`);
  const t = { id, name: oneLine(name) || id, role: oneLine(role).slice(0, 500), dir: oneLine(dir) || '.', type: oneLine(type), model: oneLine(model).slice(0, 200), spec: oneLine(spec), prompt: String(prompt ?? '') };
  if (/^(\/|[A-Za-z]:|\\)/.test(t.dir) || t.dir.split(/[\\/]/).includes('..')) throw new Error('a template directory is inside the project: "." or a relative path');
  mkdirSync(DIR, { recursive: true });
  const file = join(DIR, `${id}.md`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, render(t), 'utf8');
  renameSync(tmp, file);
  return read(id);
}

export function removeTemplate(id) {
  checkId(id);
  const file = join(DIR, `${id}.md`);
  if (!existsSync(file)) throw new Error(`unknown template "${id}"`);
  rmSync(file);
  return { removed: id };
}

/** The rules of an executor: the common ones, then (when it was made from a template) the template's prompt. */
export function executorRulesFor(templateId, specRole = null) {
  const base = executorRules();
  const t = templateId ? getTemplate(templateId) : null;
  const extra = t ? stripComments(t.prompt) : '';
  return [base, extra, specRules(specRole)].filter(Boolean).join('\n\n---\n\n');
}
