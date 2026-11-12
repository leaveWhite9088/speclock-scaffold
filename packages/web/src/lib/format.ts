import type { Member, ModelCatalog } from './types';

/**
 * Directories are shown and typed relative to the project root: "./server", "./" for the root.
 * An absolute path inside the root becomes its relative form; anything else is left for the backend to refuse.
 */
export function relDir(value: string | null | undefined, root?: string): string {
  const fwd = (x: string) => x.trim().split(String.fromCharCode(92)).join('/');
  const r = fwd(root ?? '').replace(/\/+$/, '');
  let d = fwd(value ?? '');
  if (r && d.toLowerCase() === r.toLowerCase()) d = '.';
  else if (r && d.toLowerCase().startsWith(r.toLowerCase() + '/')) d = d.slice(r.length + 1);
  while (d.startsWith('./')) d = d.slice(2);
  d = d.replace(/\/+$/, '');
  if (d === '' || d === '.') return './';
  return d.startsWith('..') || /^([a-z]:|\/)/i.test(d) ? d : './' + d;
}

export function when(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The time of a message: the clock today ("10:26:59"), the date and the clock for an earlier day ("10/21 10:26"). */
export function clock(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `${hm}:${pad(d.getSeconds())}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/** A duration for people: "0.8 秒", "12 秒", "2 分 5 秒". */
export function took(ms: number): string {
  const s = ms / 1000;
  if (s < 1) return `${s.toFixed(1)} 秒`;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} 秒`;
  const m = Math.floor(s / 60);
  return `${m} 分 ${Math.round(s - m * 60)} 秒`;
}

/** An id made from a name: lowercase letters, digits and "-"; `taken` ids get a number so it stays unique. */
/** A context length typed as people write it ("1M", "200k", "131072") as a number; 0 when it is not one. */
export function parseSize(text: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kKmM]?)\s*$/.exec(text);
  if (!m) return 0;
  return Math.round(Number(m[1]) * (m[2] ? (m[2].toLowerCase() === 'm' ? 1_000_000 : 1000) : 1));
}

/** The same, short: 1000000 -> "1M", 200000 -> "200K". */
export function sizeText(n: number): string {
  if (n >= 1_000_000 && n % 100_000 === 0) return `${n / 1_000_000}M`;
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000}K`;
  return String(n);
}

export const slug = (name: string, taken: string[] = [], fallback = 'item') => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || fallback;
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}-${n}`;
  return id;
};

export const oneLine = (t: string, n: number) => {
  const x = t.split(/\s+/).join(' ').trim();
  return x.length > n ? `${x.slice(0, n)}…` : x;
};

/**
 * A model value of the form "provider/id" gets its provider in front: the same model name can come from two
 * platforms. Names that already carry a platform ("Anthropic/Claude Opus") are left alone.
 */
export function modelLabel(value: string, name?: string | null): string {
  const label = name || value;
  const slash = value.indexOf('/');
  if (slash <= 0 || label.includes('/')) return label;
  return `${value.slice(0, slash)} · ${label}`;
}

export function modelName(catalog: ModelCatalog | undefined, value: string | null | undefined): string | null {
  if (!value) return null;
  const found = catalog?.models.find((m) => m.value === value);
  return found ? modelLabel(found.value, found.name) : (value.split(':')[2] ?? value);
}

/** The model an executor will use: its own choice, else the preferred one, else the CLI default. */
export function memberLlm(m: Member, catalog?: ModelCatalog, providerName?: (id: string) => string) {
  if (m.provider) return { text: `${providerName?.(m.provider.id) ?? m.provider.id} · ${m.provider.model}`, faint: false };
  const value = m.model ?? m.preferModel ?? catalog?.default ?? null;
  return { text: modelName(catalog, value), faint: !m.model };
}

/** The roles an executor can have in the spec library, as the pickers list them (empty: not connected). */
export const SPEC_ROLE_OPTIONS = [
  { value: '', label: '不接入规格库' },
  { value: 'requirements', label: '需求：整理并维护规格' },
  { value: 'executor', label: '执行：按规格实现' },
  { value: 'tester', label: '测试：独立验收' },
  { value: 'scanner', label: '扫描：只读，提建议' },
];

export const specRoleName = (role?: string | null) => SPEC_ROLE_OPTIONS.find((o) => o.value === role)?.label.split('：')[0] ?? null;

/** The reasoning levels a CLI offers as a picker's options, with "default" (what the CLI does on its own) first. A saved level that is not in the list still shows. */
export function effortOptions(levels: { value: string; name: string }[] | undefined | null, current: string | null | undefined, saved = ''): { value: string; label: string }[] {
  const out = [{ value: '', label: current ? `默认（${current}）` : '默认' }, ...(levels ?? []).filter((l) => l.value !== 'default').map((l) => ({ value: l.value, label: l.name || l.value }))];
  if (saved && !out.some((o) => o.value === saved)) out.push({ value: saved, label: saved });
  return out;
}
