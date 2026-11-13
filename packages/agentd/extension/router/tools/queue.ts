/** Tools for an executor's line of waiting tasks: look at it, take a task back, move one to the front. */

import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { daemon, agentNames } from "../daemon.ts";
import { agentParam } from "../params.ts";

const jobParam = Type.String({ description: "The task id: from agent_run's result, or from agent_queue." });

const say = (text: string, details?: unknown) => ({ content: [{ type: "text" as const, text }], details });

export const queueTool = defineTool({
	name: "agent_queue",
	label: "Agent queue",
	description:
		"Show what an executor is running and the tasks waiting behind it (next first), each with its task id. Use it to find the id " +
		"for agent_cancel or agent_queue_jump. Without `agent`, every executor of this project that has something waiting.",
	parameters: Type.Object({ agent: Type.Optional(agentParam) }),

	async execute(_id, params) {
		const c = await daemon();
		const names = params.agent ? [params.agent] : await agentNames(c);
		const blocks: string[] = [];
		const data: any[] = [];
		for (const name of names) {
			const q = await c.call("queue", { agent: name });
			data.push(q);
			if (!params.agent && !q.running && !q.waiting.length) continue;
			const rows = q.waiting.map((j: any, i: number) => `  ${i + 1}. ${j.jobId}${j.priority ? " (moved to the front)" : ""}  ${String(j.text).replace(/\s+/g, " ").slice(0, 80)}`);
			blocks.push(`### ${name}\nrunning: ${q.running ? q.running.jobId : "nothing"}\nwaiting: ${q.waiting.length ? "\n" + rows.join("\n") : "nothing"}`);
		}
		return say(blocks.join("\n\n") || "Nothing is running or waiting.", { agents: data });
	},
});

export const cancelTool = defineTool({
	name: "agent_cancel",
	label: "Agent cancel",
	description:
		"Take back a task that is still waiting in an executor's line: it never starts, and nothing is lost but the task. With the id of the " +
		"task that is running now, that one is asked to stop. Without `jobId`, whatever the executor is running now is asked to stop " +
		"(prefer giving the id). Only do this when the user asks, or when the task is no longer wanted.",
	parameters: Type.Object({ agent: agentParam, jobId: Type.Optional(jobParam) }),

	async execute(_id, params) {
		const c = await daemon();
		const r = await c.call("cancel", { agent: params.agent, jobId: params.jobId });
		const text = r.cancelled
			? r.queued
				? `Took back ${r.jobId} from ${params.agent}'s line: it will not run.`
				: `Asked ${params.agent} to stop the task it is running.`
			: `Nothing cancelled: ${r.reason ?? "no such task"}.`;
		return say(text, r);
	},
});

export const jumpTool = defineTool({
	name: "agent_queue_jump",
	label: "Agent queue jump",
	description:
		"Move a task that is waiting in an executor's line to the front: it runs next, right after the task that runs now (it does " +
		"not interrupt that one). Several moved tasks keep the order they were moved in. Only for a task that is still waiting.",
	parameters: Type.Object({ agent: agentParam, jobId: jobParam }),

	async execute(_id, params) {
		const c = await daemon();
		const r = await c.call("promote", { agent: params.agent, jobId: params.jobId });
		return say(r.promoted ? `${params.jobId} now goes next on ${params.agent}${r.position > 1 ? ` (position ${r.position}, behind earlier moved tasks)` : ""}.` : `Not moved: ${r.reason ?? "it is not waiting"}.`, r);
	},
});
