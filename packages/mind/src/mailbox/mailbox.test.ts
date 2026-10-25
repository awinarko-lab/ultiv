import { describe, expect, it } from "vite-plus/test";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Effect } from "effect";
import { openMind } from "../entity.ts";
import { HOP_CAP, PAIR_RATE_PER_HOUR, mailboxService } from "./mailbox.ts";
import { messageTools } from "./tools.ts";

/** A mailbox with zero retry delay, for dead-letter tests. */
const fastMailbox = (handle: Awaited<ReturnType<typeof openMind>>) =>
  mailboxService({
    converse: handle.mind.converse,
    profiles: handle.mind.profiles,
    rooms: handle.mind.rooms,
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

    expect(
      await settle(
        mailbox.send({
          owner: "harry",
          from: a.id,
          to: "nope",
          kind: "request",
          body: "x",
          origin: "human",
        }),
      ),
    ).toContain("profile nope");
    expect(
      await settle(
        mailbox.send({
          owner: "harry",
          from: a.id,
          to: a.id,
          kind: "request",
          body: "x",
          origin: "human",
        }),
      ),
    ).toContain("yourself");

    await profiles.setArchived("harry", b.id, true);
    expect(
      await settle(
        mailbox.send({
          owner: "harry",
          from: a.id,
          to: b.id,
          kind: "request",
          body: "x",
          origin: "human",
        }),
      ),
    ).toContain("archived");
    await profiles.setArchived("harry", b.id, false);
    await handle.close();
  });

  it("open by default: tool sends reach any sibling; canInitiate restricts or locks", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const mailbox = fastMailbox(handle);
    const { profiles } = handle.mind;
    const cos = await profiles.create("harry", { name: "CoS" });
    const researcher = await profiles.create("harry", { name: "Researcher" });

    // Default policy is ["*"]: an owner-instructed relay ("tell Researcher…")
    // rides the model's own tool call and must go through.
    const open = await mailbox.send({
      owner: "harry",
      from: cos.id,
      to: researcher.id,
      kind: "notify",
      body: "hello",
      origin: "tool",
    });
    expect(open.status).toBe("pending");

    // An explicit empty list locks the profile out of the mailbox…
    await profiles.update("harry", cos.id, {
      policies: { ...cos.policies, canInitiate: [] },
    });
    expect(
      await settle(
        mailbox.send({
          owner: "harry",
          from: cos.id,
          to: researcher.id,
          kind: "notify",
          body: "x",
          origin: "tool",
        }),
      ),
    ).toContain("not allowed to initiate");
    // …while human-instructed (REST) sends still pass.
    const human = await mailbox.send({
      owner: "harry",
      from: cos.id,
      to: researcher.id,
      kind: "notify",
      body: "y",
      origin: "human",
    });
    expect(human.status).toBe("pending");

    // An explicit list admits exactly its members.
    await profiles.update("harry", cos.id, {
      policies: { ...cos.policies, canInitiate: [researcher.id] },
    });
    const listed = await mailbox.send({
      owner: "harry",
      from: cos.id,
      to: researcher.id,
      kind: "notify",
      body: "z",
      origin: "tool",
    });
    expect(listed.status).toBe("pending");
    await handle.close();
  });

  it("caps ad-hoc room exchanges at 3 per bot per topic (tool sends only)", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const mailbox = fastMailbox(handle);
    const { profiles } = handle.mind;
    const a = await profiles.create("harry", { name: "One" });
    const b = await profiles.create("harry", { name: "Two" });

    const send = (topic: string, origin: "tool" | "human" = "tool") =>
      settle(
        mailbox.send({
          owner: "harry",
          from: a.id,
          to: b.id,
          kind: "notify",
          body: "x",
          topic,
          origin,
        }),
      );

    // Three tool sends to the sibling are fine, across topics…
    expect(await send("pricing")).toBe("");
    expect(await send("pricing")).toBe("");
    expect(await send("onboarding")).toBe("");
    // …the fourth is refused regardless of topic (per-pair cap)…
    expect(await send("pricing")).toContain("pair exchange cap reached");
    // …and deliberate (human/REST) sends are exempt.
    expect(await send("pricing", "human")).toBe("");
    await handle.close();
  });

  it("tunnels: delivery lands on the counterpart's MAIN thread, the room tool reads the transcript, and sessions pin the near endpoint", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const mailbox = fastMailbox(handle);
    const { converse, profiles, rooms } = handle.mind;
    const a = await profiles.create("harry", { name: "One", onboard: false });
    const b = await profiles.create("harry", { name: "Two", onboard: false });
    const tools = messageTools(mailbox, profiles, rooms);

    // The counterpart's main thread is the delivery endpoint.
    expect(
      await settle(
        mailbox.send({
          owner: "harry",
          from: a.id,
          to: b.id,
          kind: "notify",
          body: "knock knock",
          origin: "human",
        }),
      ),
    ).toBe("");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const bMain = await Effect.runPromise(
      converse.ensure(await profiles.keyOfRow(await profiles.ensureMain("harry", b.id))),
    );
    const bView = await bMain.viewState(BACKGROUND_CONTEXT);
    expect(JSON.stringify(bView.value?.entries ?? [])).toContain("[message from One");

    // The room tool reads the full tunnel transcript from an endpoint.
    const roomTool = tools.find((tool) => tool.name === "room");
    expect(roomTool).toBeDefined();
    const aMain = await Effect.runPromise(
      converse.ensure(await profiles.keyOfRow(await profiles.ensureMain("harry", a.id))),
    );
    const read = await roomTool!.execute(
      { peer: b.id },
      { conversationId: aMain.id } as never,
      undefined as never,
    );
    const readText = JSON.stringify(read);
    expect(readText).toContain("knock knock");
    expect(readText).toContain("One");

    // A send pinned to a session routes that bot's tunnel endpoint there.
    const session = await profiles.createSession("harry", a.id, "dig");
    const sessionConversation = await Effect.runPromise(
      converse.ensure(await profiles.keyOfRow(session)),
    );
    expect(
      await settle(
        mailbox.send({
          owner: "harry",
          from: a.id,
          to: b.id,
          kind: "notify",
          body: "from the session",
          topic: "dig",
          origin: "human",
          originConversation: String(sessionConversation.id),
        }),
      ),
    ).toBe("");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const digRoom = (await rooms.list("harry", a.id)).find((room) => room.topic === "dig");
    expect(digRoom).toBeDefined();
    expect(await mailbox.endpointOf("harry", digRoom!, a.id)).toBe(String(sessionConversation.id));
    expect(await mailbox.endpointOf("harry", digRoom!, b.id)).toBe(String(bMain.id));
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
    await mailbox.send({
      owner: "harry",
      from: a.id,
      to: b.id,
      kind: "notify",
      body: "1",
      origin: "human",
    });
    await mailbox.send({
      owner: "harry",
      from: a.id,
      to: b.id,
      kind: "notify",
      body: "2",
      origin: "human",
    });
    expect(
      await settle(
        mailbox.send({
          owner: "harry",
          from: a.id,
          to: b.id,
          kind: "notify",
          body: "3",
          origin: "human",
        }),
      ),
    ).toContain("budget");

    // A budgetless sender hits the pair rate limit instead.
    const c = await profiles.create("harry", { name: "C" });
    for (let index = 0; index < PAIR_RATE_PER_HOUR; index += 1) {
      await mailbox.send({
        owner: "harry",
        from: c.id,
        to: b.id,
        kind: "notify",
        body: "x",
        origin: "human",
      });
    }
    expect(
      await settle(
        mailbox.send({
          owner: "harry",
          from: c.id,
          to: b.id,
          kind: "notify",
          body: "x",
          origin: "human",
        }),
      ),
    ).toContain("rate");
    await handle.close();
  });

  it("external senders: no artifact grants, hop caps enforced, harsher rate", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const mailbox = fastMailbox(handle);
    const { profiles } = handle.mind;
    const a = await profiles.create("harry", { name: "A" });
    const entry = await mailbox.deliverExternal({
      owner: "harry",
      from: "iris",
      to: a.id,
      kind: "notify",
      body: "hi",
      chain: [],
    });
    expect(entry.envelope.from).toBe("external:iris");
    // External envelopes can never carry artifact grants.
    expect(entry.envelope.artifacts).toEqual([]);
    // Hops: the chain plus the sender counts; at the cap, refused.
    const mid = ["cos", "researcher"].slice(0, HOP_CAP - 2);
    await mailbox.deliverExternal({
      owner: "harry",
      from: "iris",
      to: a.id,
      kind: "notify",
      body: "hi",
      chain: mid,
    });
    const longChain = ["cos", "researcher"].slice(0, HOP_CAP - 1);
    expect(
      await settle(
        mailbox.deliverExternal({
          owner: "harry",
          from: "iris",
          to: a.id,
          kind: "notify",
          body: "hi",
          chain: longChain,
        }),
      ),
    ).toContain("hop cap");
    await handle.close();
  });

  it("dead-letters after retries; NACK signals the sender's main thread (offline: turns fail)", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const mailbox = fastMailbox(handle);
    const { profiles } = handle.mind;
    const a = await profiles.create("harry", { name: "CoS", onboard: false });
    const b = await profiles.create("harry", { name: "Researcher", onboard: false });
    await mailbox.send({
      owner: "harry",
      from: a.id,
      to: b.id,
      kind: "request",
      body: "status?",
      origin: "human",
    });

    // Offline settle fails; retries are immediate; poll until dead.
    let dead = false;
    for (let attempt = 0; attempt < 100 && !dead; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      dead = (await mailbox.dead("harry")).length > 0;
    }
    expect(dead).toBe(true);
    // The failed delivery was ATTEMPTED on the counterpart's main thread…
    const bMain = await Effect.runPromise(
      handle.mind.converse.ensure(
        await profiles.keyOfRow(await profiles.ensureMain("harry", b.id)),
      ),
    );
    const bView = await bMain.viewState(BACKGROUND_CONTEXT);
    expect(JSON.stringify(bView.value?.entries ?? [])).toContain("[message from CoS");
    // …and the NACK signal wakes the SENDER's main thread (the origin endpoint).
    const aMain = await Effect.runPromise(
      handle.mind.converse.ensure(
        await profiles.keyOfRow(await profiles.ensureMain("harry", a.id)),
      ),
    );
    const aView = await aMain.viewState(BACKGROUND_CONTEXT);
    expect(JSON.stringify(aView.value?.entries ?? [])).toContain("[nack from Researcher");
    await handle.close();
  });
});
