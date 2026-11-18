/** The rule texts handed to the dispatcher and the executors, and the executor templates. Entry of core/prompts; the rest is internal. */

export { dispatcherRules, handoffStartPrompt, handoffWritePrompt, rosterPrompt } from './rules.mjs';
export { executorRulesFor, getTemplate, listTemplates, removeTemplate, saveTemplate } from './templates.mjs';
export {
  DEFAULT_PRESET_ID,
  cleanProjectPrompts,
  getPreset,
  hasPreset,
  listPresets,
  removePreset,
  resetPreset,
  resolveDispatcherRules,
  resolveExecutorBaseRules,
  savePreset,
  viewProjectPrompts,
} from './presets.mjs';
