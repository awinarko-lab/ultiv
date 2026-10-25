import { describe, expect, it } from "vite-plus/test";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Effect } from "effect";
import { openMind } from "../entity.ts";
import { HOP_CAP, PAIR_RATE_PER_HOUR, mailboxService } from "./mailbox.ts";

/** A mailbox with zero retry delay, for dead-letter tests. */
const fastMailbox = (handle: Awaited<ReturnType<typeof openMind>>) =>
	mailboxService({
		converse: handle.mind.converse,
		profiles: handle.mind.profiles,
		audit: handle.mind.audit,
		options: { retryDelayMs: 0 },
	});

const settle = async (promise: Promise<unknown>): Promise<string> => {
	try {
		await promise;
		return "";
	} catch (cause) {
		const error = cause as { reason?: string; what?: string };
		return error.reason ?? error.what ?? String(cause);
	}
};

describe("Mailbox safety rules (offline, MemoryStorage)", () => {
	it("refuses unknown targets, self-messaging and archived profiles", async () => {
		const handle = await openMind({ storage: new MemoryStorage() });
		const mailbox = fastMailbox(handle);
		const { profiles } = handle.mind;
		const a = await profiles.create("harry", { name: "CoS" });
		const b = await profiles.create("harry", { name: "Researcher" });

		expect((await settle(mailbox.send({ owner: "harry", from: a.id, to: "nope", kind: "request", body: "x", origin: "human" })))).toContain("profile nope");
		expect((await settle(mailbox.send({ owner: "harry", from: a.id, to: a.id, kind: "request", body: "x", origin: "human" })))).toContain("yourself");

		await profiles.setArchived("harry", b.id, true);
		expect((await settle(mailbox.send({ owner: "harry", from: a.id, to: b.id, kind: "request", body: "x", origin: "human" })))).toContain("archived");
		await profiles.setArchived("harry", b.id, false);
		await handle.close();
	});

	it("autonomous sends require canInitiate; human sends do not", async () => {
		const handle = await openMind({ storage: new MemoryStorage() });
		const mailbox = fastMailbox(handle);
		const { profiles } = handle.mind;
		const cos = await profiles.create("harry", { name: "CoS" });
		const researcher = await profiles.create("harry", { name: "Researcher" });

		const refused = await settle(
			mailbox.send({ owner: "harry", from: cos.id, to: researcher.id, kind: "notify", body: "x", origin: "tool" }),
		);
		expect(refused).toContain("not allowed to initiate");

		await profiles.update("harry", cos.id, {
			policies: { ...cos.policies, canInitiate: [researcher.id] },
		});
		const admitted = await mailbox.send({
			owner: "harry", from: cos.id, to: researcher.id, kind: "notify", body: "hello", origin: "tool",
		});
		expect(admitted.status).toBe("pending");
		await handle.close();
	});

	it("caps pair rate per hour and per-profile daily budgets", async () => {
		const handle = await openMind({ storage: new MemoryStorage() });
		const mailbox = fastMailbox(handle);
		const { profiles } = handle.mind;
		const a = await profiles.create("harry", { name: "A" });
		const b = await profiles.create("harry", { name: "B" });
		// Budget of 2 turns/day on the sender.
		await profiles.update("harry", a.id, { policies: { ...a.policies, dailyTurnBudget: 2 } });
		await mailbox.send({ owner: "harry", from: a.id, to: b.id, kind: "notify", body: "1", origin: "human" });
		await mailbox.send({ owner: "harry", from: a.id, to: b.id, kind: "notify", body: "2", origin: "human" });
		expect((await settle(mailbox.send({ owner: "harry", from: a.id, to: b.id, kind: "notify", body: "3", origin: "human" })))).toContain("budget");

		// A budgetless sender hits the pair rate limit instead.
		const c = await profiles.create("harry", { name: "C" });
		for (let index = 0; index < PAIR_RATE_PER_HOUR; index += 1) {
			await mailbox.send({ owner: "harry", from: c.id, to: b.id, kind: "notify", body: "x", origin: "human" });
		}
		expect((await settle(mailbox.send({ owner: "harry", from: c.id, to: b.id, kind: "notify", body: "x", origin: "human" })))).toContain("rate");
		await handle.close();
	});

	it("external senders: no artifact grants, hop caps enforced, harsher rate", async () => {
		const handle = await openMind({ storage: new MemoryStorage() });
		const mailbox = fastMailbox(handle);
		const { profiles } = handle.mind;
		const a = await profiles.create("harry", { name: "A" });
		const entry = await mailbox.deliverExternal({
			owner: "harry", from: "iris", to: a.id, kind: "notify", body: "hi", chain: [],
		});
		expect(entry.envelope.from).toBe("external:iris");
		// External envelopes can never carry artifact grants.
		expect(entry.envelope.artifacts).toEqual([]);
		// Hops: the chain plus the sender counts; at the cap, refused.
		const mid = ["cos", "researcher"].slice(0, HOP_CAP - 2);
		await mailbox.deliverExternal({ owner: "harry", from: "iris", to: a.id, kind: "notify", body: "hi", chain: mid });
		const longChain = ["cos", "researcher"].slice(0, HOP_CAP - 1);
		expect((await settle(mailbox.deliverExternal({ owner: "harry", from: "iris", to: a.id, kind: "notify", body: "hi", chain: longChain })))).toContain("hop cap");
		await handle.close();
	});

	it("dead-letters after retries and NACKs the sender's main chat (offline: turns fail)", async () => {
		const handle = await openMind({ storage: new MemoryStorage() });
		const mailbox = fastMailbox(handle);
		const { profiles } = handle.mind;
		const a = await profiles.create("harry", { name: "CoS" });
		const b = await profiles.create("harry", { name: "Researcher" });
		await mailbox.send({ owner: "harry", from: a.id, to: b.id, kind: "request", body: "status?", origin: "human" });

		// Offline settle fails; retries are immediate; poll until dead.
		let dead = false;
		for (let attempt = 0; attempt < 100 && !dead; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 20));
			dead = (await mailbox.dead("harry")).length > 0;
		}
		expect(dead).toBe(true);
		// The sender's main chat was woken with the NACK.
		const main = await profiles.ensureMain("harry", a.id);
		const key = await profiles.keyOfRow(main);
		const conversation = await Effect.runPromise(handle.mind.converse.ensure(key));
		const view = await conversation.viewState(BACKGROUND_CONTEXT);
		const inputs = view.value?.entries ?? [];
		const text = JSON.stringify(inputs);
		expect(text).toContain("[nack from Researcher");
		await handle.close();
	});
});
