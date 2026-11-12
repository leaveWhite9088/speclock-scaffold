/**
 * Core's REST API (`/api/v1`), called with one key. Errors carry Core's own `code` (see speclock_core/errors.py), so a
 * caller can tell "already exists" from "not allowed" without reading the message.
 */

export class CoreError extends Error {
  constructor(message, { code = null, status = 0 } = {}) {
    super(message);
    this.name = 'CoreError';
    this.code = code;
    this.status = status;
  }
}

const textOf = (detail) => (typeof detail === 'string' ? detail : JSON.stringify(detail));

/** `await call(base, 'GET', '/projects', { key })` → the parsed body. */
export async function call(base, method, path, { key = null, body, timeoutMs = 15_000 } = {}) {
  let res;
  try {
    res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { ...(key ? { 'X-API-Key': key } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new CoreError(`the SpecLock service is not reachable at ${base} (${err.cause?.code ?? err.message})`, { code: 'unreachable' });
  }
  const raw = await res.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    /* not JSON: the text goes into the error below */
  }
  if (!res.ok) throw new CoreError(textOf(data?.detail ?? raw) || `HTTP ${res.status}`, { code: data?.code ?? null, status: res.status });
  return data;
}
