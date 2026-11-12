/**
 * A project's dispatcher gets the live roster of its executors in the system prompt of every run, so an executor
 * registered while the conversation is open is known at once. Without this the model reuses the list from the last
 * agent_instances call earlier in the conversation. The text around the roster is `contexts/roster.md`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { rosterPrompt } from "../../core/prompts/index.mjs";
import { PROJECT, daemon } from "./daemon.ts";

/** What each role in the spec library means, as the dispatcher reads it. */
const SPEC_MEANING: Record<string, string> = {
	requirements: "requirements (writes change requests and submits the commits that change the spec)",
	executor: "executor (implements work items from the spec)",
	tester: "tester (independently verifies implemented work items)",
	scanner: "scanner (reads the spec and only gives advice)",
};

/** The conversations an executor has by name (the one it is in marked), so the dispatcher sees at once whether a block already has one. */
function sessionsText(i: any): string {
	const names: { label: string; active?: boolean }[] = i.sessionNames ?? [];
	if (names.length) return `, conversations: ${names.map((s) => `"${s.label}"${s.active ? " (current)" : ""}`).join(", ")}`;
	return i.sessionLabel ? `, conversation "${i.sessionLabel}"` : "";
}

/** One line per executor: who it is, what state it is in, what it is for, and a warning when it cannot be trusted with work. */
export function rosterLines(instances: any[]): string {
	return instances
		.map(
			(i: any) =>
				`- ${i.id} [${i.type}] ${i.busy ? "busy" : i.alive ? "running" : "idle"}, dir ${i.cwd ?? "(base)"}${sessionsText(i)}${i.role ? `, role: ${i.role}` : ""}${i.spec ? `, spec library: ${SPEC_MEANING[i.spec] ?? i.spec}` : ""}` +
				(i.unstable ? "\n  ! UNSTABLE: its process had to be killed several times lately; it refuses tasks until a person recovers it. Do not send it work." : "") +
				(i.interrupted
					? `\n  ! INTERRUPTED: its last task (${i.interrupted.startedAt}${i.interrupted.prompt ? `, "${String(i.interrupted.prompt).slice(0, 80)}"` : ""}) was cut off when the daemon stopped, so it may have done only part of it. Check its files before deciding whether to send the task again, and tell the user.`
					: ""),
		)
		.join("\n");
}

export function registerRoster(pi: ExtensionAPI): void {
	if (!PROJECT) return;
	pi.on("before_agent_start", async (event) => {
		let roster = "";
		try {
			const c = await daemon();
			const { instances } = await c.call("instances");
			roster = rosterLines(instances);
		} catch {
			return undefined; // no daemon answer: leave the prompt alone
		}
		if (!roster) return undefined;
		return { systemPrompt: `${event.systemPrompt}\n\n${rosterPrompt(roster)}` };
	});
}
