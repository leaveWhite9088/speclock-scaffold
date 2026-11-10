/** Parameters several tools share. */

import { Type } from "@earendil-works/pi-ai";

export const agentParam = Type.String({
	description: "Which executor of this project to use: its id from agent_instances. There is no default one.",
});
