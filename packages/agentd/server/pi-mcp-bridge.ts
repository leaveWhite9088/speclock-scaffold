/**
 * pi extension: registers the MCP servers agentd gives this executor.
 *
 * pi reads MCP servers from ~/.pi/agent/mcp.json and the project's .pi/mcp.json, and has no flag for a list. The
 * adapter (pi-acp-adapter.mjs) starts pi with `-e` this file and `-e builtin:mcp`; agentd puts the servers, already
 * in pi's own format, in AGENTD_MCP_SERVERS (see core/pool/mcp.mjs `piMcpServers`). Nothing is written to disk.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function mcpBridge(pi: ExtensionAPI) {
	const raw = process.env.AGENTD_MCP_SERVERS;
	if (!raw) return;
	let servers: Record<string, Record<string, unknown>>;
	try {
		servers = JSON.parse(raw);
	} catch {
		process.stderr.write("[pi-mcp-bridge] AGENTD_MCP_SERVERS is not JSON, ignoring\n");
		return;
	}
	for (const [name, config] of Object.entries(servers)) {
		try {
			// "direct": the model sees the tools like built-in ones. pi's default (codemode) hides them behind a script tool,
			// which would make an executor on pi behave differently from one on the other CLIs.
			pi.registerMcpServer(name, { exposure: "direct", ...config } as never);
		} catch (err) {
			process.stderr.write(`[pi-mcp-bridge] could not register "${name}": ${(err as Error).message}\n`);
		}
	}
}
