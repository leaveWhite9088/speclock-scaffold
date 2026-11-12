/**
 * The reasoning level among a CLI's config options. ACP gives it the category `thought_level`; the CLIs name the option
 * themselves (pi: `thinking`, others `effort`, `reasoning`, …), so both are looked at. It is a choice like the model: one value
 * out of a list, set per session with `session/set_config_option`.
 */

import { flattenOptions } from './config.mjs';

export const isEffortOption = (o) => Boolean(o) && o.id !== 'model' && (o.category === 'thought_level' || /^(thinking|thought|effort|reasoning)/i.test(String(o.id ?? '')));

/** `{ id, current, options: [{ value, name }] }`, or null when the CLI has no such option. */
export function effortOf(configOptions) {
  const o = (configOptions ?? []).find(isEffortOption);
  if (!o) return null;
  return { id: o.id, current: o.currentValue ?? null, options: flattenOptions(o.options).map((x) => ({ value: x.value, name: x.name ?? x.value })) };
}
