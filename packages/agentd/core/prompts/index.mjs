/** The rule texts handed to the dispatcher and the executors, and the executor templates. Entry of core/prompts; the rest is internal. */

export { dispatcherRules, handoffStartPrompt, handoffWritePrompt, rosterPrompt } from './rules.mjs';
export { executorRulesFor, getTemplate, listTemplates, removeTemplate, saveTemplate } from './templates.mjs';
