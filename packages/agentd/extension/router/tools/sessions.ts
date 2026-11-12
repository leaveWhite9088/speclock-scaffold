/** Tools for an executor's sessions, models and status. */

import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { daemon, agentNames } from "../daemon.ts";
import { attentionLines, flatten } from "../format.ts";
import { agentParam } from "../params.ts";

export const sessionsTool = defineTool({
	name: "agent_sessions",
	label: "Agent sessions",
	description: "List stored sessions for one or all agents, with labels, cwd and timestamps.",
	parameters: Type.Object({
		agent: agentParam,
		limit: Type.Optional(Type.Number({ description: "Max rows per agent. Default 20." })),
	}),

	async execute(_id, params) {
		const c = await daemon();
		const names = params.agent ? [params.agent] : await agentNames(c);
		const blocks: string[] = [];
		const data: any[] = [];

		for (const name of names) {
			const { sessions } = await c.call("sessions", { agent: name });
			const status = await c.call("status", { agent: name }).catch(() => null);
			const limit = params.limit ?? 20;
			data.push({ agent: name, activeSessionId: status?.sessionId, sessions: sessions.slice(0, limit) });
			const rows = sessions.slice(0, limit).map((s: any, i: number) => {
				const mark = s.active ? "*" : " ";
				const when = s.updatedAt ? s.updatedAt.slice(0, 19).replace("T", " ") : "-";
				return `${mark} ${String(i + 1).padStart(2)}. ${s.label || s.title || "(untitled)"}   ${s.sessionId}\n      ${s.cwd ?? "-"}   ${when}`;
			});
			blocks.push(`### ${name} — ${sessions.length} session(s)\n${rows.join("\n") || "(none)"}`);
		}
		return { content: [{ type: "text", text: blocks.join("\n\n") }], details: { agents: data } };
	},

	renderResult(result, opts, theme) {
		const text = result.content?.find((c: any) => c.type === "text")?.text ?? "";
		return theme.text(opts.isPartial ? theme.dim("loading sessions…") : text);
	},
});

export const modelsTool = defineTool({
	name: "agent_models",
	label: "Agent models",
	description: "List model / thinking-level options an agent exposes and the current value.",
	parameters: Type.Object({ agent: agentParam, sessionId: Type.Optional(Type.String()) }),
	async execute(_id, params) {
		const c = await daemon();
		const { sessionId, configOptions } = await c.call("models", {
			agent: params.agent,
			sessionId: params.sessionId,
		});
		const blocks = [`session ${sessionId}`];
		for (const opt of configOptions ?? []) {
			blocks.push(`\n${opt.id} (current: ${opt.currentValue})`);
			for (const o of flatten(opt.options)) {
				blocks.push(`${o.value === opt.currentValue ? "*" : " "} ${o.value}  ${o.name ?? ""}`.trimEnd());
			}
		}
		return { content: [{ type: "text", text: blocks.join("\n") }], details: { sessionId, configOptions } };
	},
});

export const setModelTool = defineTool({
	name: "agent_set_model",
	label: "Agent set model",
	description: "Set the model (or reasoning effort) for a session.",
	parameters: Type.Object({
		value: Type.String({ description: "Exact option value from agent_models." }),
		configId: Type.Optional(Type.String({ description: 'Default "model".' })),
		agent: agentParam,
		sessionId: Type.Optional(Type.String()),
	}),
	async execute(_id, params) {
		const c = await daemon();
		const configId = params.configId ?? "model";
		const r = await c.call("setModel", {
			agent: params.agent,
			value: params.value,
			configId,
			sessionId: params.sessionId,
		});
		const opt = r.configOptions?.find((o: any) => o.id === configId);
		const name = flatten(opt?.options).find((o: any) => o.value === params.value)?.name;
		return {
			content: [{ type: "text", text: `${configId} = ${opt?.currentValue ?? params.value}${name ? ` (${name})` : ""}` }],
			details: { configId, value: opt?.currentValue, name },
		};
	},
});

export const statusTool = defineTool({
	name: "agent_status",
	label: "Agent status",
	description: "Liveness, active session, model, spawn count for one or all agents.",
	parameters: Type.Object({ agent: agentParam }),
	async execute(_id, params) {
		const c = await daemon();
		const names = params.agent ? [params.agent] : await agentNames(c);
		const rows = [];
		for (const name of names) rows.push(await c.call("status", { agent: name }));
		const text = rows
			.map((s: any) => {
				const att = attentionLines(s);
				return [
					`${s.agent}: ${s.alive ? "alive" : "stopped"}  health ${s.health ?? "ok"}  pid ${s.pid ?? "-"}  spawns ${s.spawns}`,
					`  cwd     ${s.cwd}${s.defaultCwd && s.defaultCwd !== s.cwd ? `  (default ${s.defaultCwd})` : ""}`,
					`  session ${s.sessionId ?? "(none)"}${s.sessionLabel ? ` "${s.sessionLabel}"` : ""}`,
					`  model   ${s.modelName ?? s.model ?? "(unknown)"}`,
					s.lastError ? `  lastError ${s.lastError}` : "",
					att,
				]
					.filter(Boolean)
					.join("\n");
			})
			.join("\n");
		return { content: [{ type: "text", text }], details: { agents: rows } };
	},
});

/** The session of `agent` that `ref` names: a session id, or the label it was given. A label must match exactly one. */
async function findSession(c: any, agent: string, ref: string) {
	const { sessions } = await c.call("sessions", { agent });
	const want = ref.trim().toLowerCase();
	const byId = sessions.find((s: any) => s.sessionId === ref.trim());
	if (byId) return byId;
	const hits = sessions.filter((s: any) => (s.label ?? "").trim().toLowerCase() === want);
	if (hits.length === 1) return hits[0];
	if (hits.length > 1) throw new Error(`${hits.length} conversations of ${agent} are named "${ref}"; use the session id from agent_sessions`);
	throw new Error(`${agent} has no conversation named "${ref}"; agent_sessions lists them`);
}

export const newSessionTool = defineTool({
	name: "agent_session_new",
	label: "Agent session new",
	description:
		"Start a new, empty conversation for one executor and give it a name. It becomes the one the executor is in, so the next agent_run goes to it. " +
		"One conversation is for one block of work: name it after the block. Open it once per block, then keep sending that block's work to it. " +
		"If a conversation for the block already exists (agent_sessions), switch to it with agent_session_use instead of opening a second one.",
	parameters: Type.Object({
		agent: Type.String({ description: "The executor, as named in the roster." }),
		label: Type.String({ description: "The name of the conversation: the block it is for." }),
	}),
	async execute(_id, params) {
		const label = params.label.trim();
		if (!label) throw new Error("label is required: name the conversation after its block");
		const c = await daemon();
		const { sessions } = await c.call("sessions", { agent: params.agent });
		if (sessions.some((s: any) => (s.label ?? "").trim().toLowerCase() === label.toLowerCase())) {
			throw new Error(`${params.agent} already has a conversation named "${label}"; switch to it with agent_session_use`);
		}
		const r = await c.call("new", { agent: params.agent, label });
		if (r.queued) {
			return {
				content: [{ type: "text", text: `${params.agent} is working: the new conversation "${label}" will be opened as soon as it is done, and a run sent to it now goes to that conversation` }],
				details: { agent: params.agent, label, queued: true },
			};
		}
		return {
			content: [{ type: "text", text: `${params.agent}: new conversation "${label}" (${r.sessionId}); it is the active one now` }],
			details: { agent: params.agent, sessionId: r.sessionId, label },
		};
	},
});

export const useSessionTool = defineTool({
	name: "agent_session_use",
	label: "Agent session use",
	description:
		"Switch one executor to an existing conversation, by its name (the block) or session id, so the next agent_run continues that one. " +
		"The executor keeps everything it said and did there.",
	parameters: Type.Object({
		agent: Type.String({ description: "The executor, as named in the roster." }),
		session: Type.String({ description: "The conversation's name, or its session id from agent_sessions." }),
	}),
	async execute(_id, params) {
		const c = await daemon();
		const s = await findSession(c, params.agent, params.session);
		const r = await c.call("use", { agent: params.agent, sessionId: s.sessionId });
		const later = r?.queued ? " (it is working: the switch happens when it is done, and a run sent now goes to that conversation)" : "";
		return {
			content: [{ type: "text", text: `${params.agent}: now in "${s.label || s.title || s.sessionId}" (${s.sessionId})${later}` }],
			details: { agent: params.agent, sessionId: s.sessionId, label: s.label ?? null, queued: Boolean(r?.queued) },
		};
	},
});

export const renameSessionTool = defineTool({
	name: "agent_session_rename",
	label: "Agent session rename",
	description: "Rename a conversation of one executor (the one it is in now, unless you name another). Keep the name equal to the block it is for.",
	parameters: Type.Object({
		agent: Type.String({ description: "The executor, as named in the roster." }),
		label: Type.String({ description: "The new name." }),
		session: Type.Optional(Type.String({ description: "The conversation to rename, by name or session id. Default: the active one." })),
	}),
	async execute(_id, params) {
		const label = params.label.trim();
		if (!label) throw new Error("label is required");
		const c = await daemon();
		const sessionId = params.session ? (await findSession(c, params.agent, params.session)).sessionId : undefined;
		const r = await c.call("rename", { agent: params.agent, sessionId, label });
		return {
			content: [{ type: "text", text: `${params.agent}: ${r.sessionId} is now named "${r.label}"` }],
			details: r,
		};
	},
});

export const deleteSessionTool = defineTool({
	name: "agent_session_delete",
	label: "Agent session delete",
	description:
		"Delete a conversation of one executor that is not needed any more: the old one left behind by a handoff (named \"（已交接）…\"), the conversation of a block that is finished, or a stray one nobody can tell the purpose of. " +
		"The conversation is hidden from the lists (nothing in the project's files is touched). The one the executor is in now cannot be deleted: switch it elsewhere first. " +
		"Do not delete a conversation whose block is still being worked on.",
	parameters: Type.Object({
		agent: Type.String({ description: "The executor, as named in the roster." }),
		session: Type.String({ description: "The conversation's name, or its session id from agent_sessions." }),
	}),
	async execute(_id, params) {
		const c = await daemon();
		const s = await findSession(c, params.agent, params.session);
		await c.call("deleteSession", { agent: params.agent, sessionId: s.sessionId });
		return {
			content: [{ type: "text", text: `${params.agent}: deleted "${s.label || s.title || s.sessionId}" (${s.sessionId})` }],
			details: { agent: params.agent, sessionId: s.sessionId, label: s.label ?? null },
		};
	},
});
