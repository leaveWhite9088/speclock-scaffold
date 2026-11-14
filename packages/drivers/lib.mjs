/** Small helpers the drivers share. Node built-ins only. */

/** Forward slashes, so paths read the same everywhere and survive being put in JSON. */
export const slash = (p) => String(p).replace(/\\/g, '/');

/** An executable's file name on this platform. */
export const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);

/** What "no rules channel used" looks like. A driver's `rules()` returns this shape. */
export const NO_RULES = Object.freeze({ args: [], env: {}, meta: null, prefix: false });

/** The rules go in front of the first prompt of each session (the CLI has no channel for them). */
export const RULES_IN_PROMPT = Object.freeze({ ...NO_RULES, prefix: true });

/**
 * The directory of an npm package in the install, or a marker path when it is not installed. A driver never throws
 * for a missing package: it records the name in `missing`, so the caller can say what is missing and where to look.
 */
export function packageDir(install, name, missing) {
  const dir = install.dir(name);
  if (!dir) {
    missing.push(name);
    return `<${name}: not installed>`;
  }
  return slash(dir);
}

/**
 * The path of a standalone executable in the install, or a marker path when it is not installed. Symmetric with
 * `packageDir`: records `name` in `missing` instead of throwing.
 */
export function binaryPath(install, name, missing) {
  const file = install.bin?.(name) ?? null;
  if (!file) {
    missing.push(name);
    return `<${name}: not installed>`;
  }
  return slash(file);
}
