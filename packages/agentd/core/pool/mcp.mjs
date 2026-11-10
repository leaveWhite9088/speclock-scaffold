/**
 * MCP servers an executor is given. agentd does not know what the servers are for (SpecLock Core is one of them): an
 * instance carries a list in ACP's own shape and agentd hands it to the CLI each time a session starts or is resumed.
 * Nothing is written into the project or into the CLI's own configuration.
 *
 *   stdio  { name, command, args: [], env: [{ name, value }] }
 *   http   { type: "http", name, url, headers: [{ name, value }] }
 *
 * A CLI starts the servers of a session only if it was handed them in that very request (`session/resume` included),
 * which the drivers' probes (packages/drivers/probes) check for mcode, dsh, opencode, claude and codex. pi has no such parameter: its
 * driver turns the servers into AGENTD_MCP_SERVERS and the adapter loads them through `server/pi-mcp-bridge.ts`.
 */

const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;

const pairs = (v, what) => {
  if (v == null) return [];
  const list = Array.isArray(v) ? v : Object.entries(v).map(([name, value]) => ({ name, value }));
  return list.map((p) => {
    if (typeof p?.name !== 'string' || !p.name || typeof p.value !== 'string') throw new Error(`${what} must be {name, value} strings`);
    return { name: p.name, value: p.value };
  });
};

/** Check a list from a request or a saved file and return it in ACP's shape. Throws a readable error. */
export function cleanMcpServers(list) {
  if (list == null || (Array.isArray(list) && !list.length)) return [];
  if (!Array.isArray(list)) throw new Error('mcpServers must be a list');
  const seen = new Set();
  return list.map((s, i) => {
    const where = `mcpServers[${i}]`;
    if (!s || typeof s !== 'object') throw new Error(`${where} must be an object`);
    if (!NAME_RE.test(String(s.name ?? ''))) throw new Error(`${where}.name must be 1-32 letters, digits, "_" or "-"`);
    if (seen.has(s.name)) throw new Error(`${where}.name "${s.name}" is used twice`);
    seen.add(s.name);
    if (s.type === 'http' || (s.url && !s.command)) {
      if (typeof s.url !== 'string' || !/^https?:\/\//.test(s.url)) throw new Error(`${where}.url must be an http(s) URL`);
      return { type: 'http', name: s.name, url: s.url, headers: pairs(s.headers, `${where}.headers`) };
    }
    if (typeof s.command !== 'string' || !s.command.trim()) throw new Error(`${where}.command is required`);
    const args = s.args ?? [];
    if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) throw new Error(`${where}.args must be a list of strings`);
    return { name: s.name, command: s.command, args, env: pairs(s.env, `${where}.env`) };
  });
}

/** An instance's servers: a list, or a function giving it (read again each time, so an edit applies at once). */
export const mcpServersOf = (spec) => cleanMcpServers(typeof spec?.mcpServers === 'function' ? spec.mcpServers() : spec?.mcpServers);

/** For `session/new` and `session/resume`. */
export const acpMcpServers = mcpServersOf;

/** The same servers as the `mcp.json` entries pi reads (what `server/pi-mcp-bridge.ts` registers). */
export function piMcpServers(list) {
  const toObj = (arr) => Object.fromEntries((arr ?? []).map((p) => [p.name, p.value]));
  return Object.fromEntries(
    cleanMcpServers(list).map((s) => [
      s.name,
      s.type === 'http' ? { url: s.url, headers: toObj(s.headers) } : { command: s.command, args: s.args, env: toObj(s.env) },
    ]),
  );
}

/** What a status row may show: names and kinds, never an environment or a header (they can hold keys). */
export const describeMcpServers = (list) =>
  cleanMcpServers(list).map((s) => ({ name: s.name, kind: s.type === 'http' ? 'http' : 'stdio' }));
