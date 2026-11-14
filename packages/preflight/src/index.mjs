/** What the preflight does, as functions: find the CLIs, plan and run the install, write the manifest, run the probes, report. The command line (bin/preflight.mjs) uses nothing else. */

export { defaultBinDirs, defaultRoots, detectBinaries, detectPackages, manifestPath, ownPrefix } from './detect.mjs';
export { installPlan, runInstall } from './install.mjs';
export { buildManifest, writeManifest } from './manifest.mjs';
export { readProbes, runProbes } from './probe.mjs';
export { CORE, corePlan, formatCore, inspectCore, runCorePlan } from './speclock.mjs';
export { formatReport, summarize } from './report.mjs';
