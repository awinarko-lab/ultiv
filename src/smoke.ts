// Toolchain smoke test: every runtime dep type-resolves under TS 7,
// and Effect actually executes under the mise-pinned Node.
// Run: npm run smoke (typecheck first: npm run typecheck)
import { Effect } from "effect";
import { Type } from "typebox";
import { hostNamed, method, remote } from "@earendil-works/chord";
import type { Harness } from "@earendil-works/pi-durable";
import type { createModels } from "@earendil-works/pi-ai/models";

// A chord contract, in the shape the chord README prescribes.
export const Ping = remote("ultiv.ping", {
	version: 1,
	input: Type.Object({ name: Type.String() }),
	host: hostNamed("server"),
	variants: {
		default: {
			state: { count: Type.Number() },
			methods: { increment: method(Type.Object({ by: Type.Number() })) },
		},
	},
});

// Type-level only: the agent harness and model registry resolve.
export type AgentHarness = Harness;
export type Models = ReturnType<typeof createModels>;

// Runtime: Effect 4 executes end to end.
const schema = Effect.runSync(Effect.sync(() => Type.Object({ count: Type.Number() })));
console.log("smoke ok:", JSON.stringify(schema));
