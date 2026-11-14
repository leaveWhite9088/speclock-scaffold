/** Where the data lives (by whom it belongs to) and the settings: the entry of core/base. Anything not listed here is internal. */

export { CONFIG } from './app-config.mjs';
export { DATA_DIR, GLOBAL_DIR, PROJECTS_DIR, PROJECT_SEP, ensureDir, instanceIdOf, projectDir, projectIdOf, projectIdsOnDisk, projectPath } from './data-dir.mjs';
export { TOOL_CALL_AS_TEXT } from './leak.mjs';
export { killTree } from './process.mjs';
