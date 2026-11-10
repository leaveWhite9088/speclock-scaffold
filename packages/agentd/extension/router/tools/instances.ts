/** Tools to list this project's executors and to add one. */

import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { daemon } from "../daemon.ts";

export const instancesTool = defineTool({
	name: "agent_instances",
	label: "Agent instances",
	description:
		"List this project's executors. Each one is a resident process of a CLI, pinned to one directory of the project.",
	parameters: Type.Object({}),
	async execute() {
		const c = await daemon();
		const { instances, types } = await c.call("instances");
		const rows = instances.map(
			(i: any) =>
				`${i.id}  [${i.type}]  ${i.alive ? "alive" : "stopped"}${i.busy ? ", busy" : ""}\n  cwd ${i.cwd ?? "-"}${i.role ? `\n  role: ${i.role}` : ""}`,
		);
		return {
			content: [{ type: "text", text: `${rows.join("\n")}\n\ntypes you can create: ${types.join(", ")}` }],
			details: { instances, types },
		};
	},
});

export const createInstanceTool = defineTool({
	name: "agent_instance_create",
	label: "Agent instance create",
	description:
		"Add an executor to this project: an instance of a CLI type, pinned to a directory inside the project. " +
		"Use it when the work needs one that does not exist yet.",
	parameters: Type.Object({
		id: Type.String({ description: "New instance id: a-z, 0-9, - or _, starts with a letter." }),
		type: Type.String({ description: "mcode, dsh, pi, opencode, claude or codex." }),
		cwd: Type.String({
			description: "Directory the executor works in, relative to the project root.",
		}),
		role: Type.Optional(Type.String({ description: "What this instance is for (shown to whoever dispatches)." })),
	}),
	async execute(_id, params) {
		const c = await daemon();
		const r = await c.call("instance.create", params);
		return { content: [{ type: "text", text: `created ${r.id} (${r.type}) in ${r.cwd}` }], details: r };
	},
});
