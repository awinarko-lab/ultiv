import { describe, expect, it } from "vite-plus/test";
import { Effect } from "effect";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { openMind } from "../entity.ts";
import { historyService } from "./history.ts";
import { historyTools } from "./tools.ts";

describe("History faculty (offline, MemoryStorage)", () => {
  it("finds admitted inputs across a profile's sessions, newest first", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { converse, profiles } = handle.mind;
    const bot = await profiles.create("harry", { name: "Edison" });
    const history = historyService({ converse, profiles });

    const main = await profiles.ensureMain("harry", bot.id);
    const mainKey = await profiles.keyForSession("harry", main.id);
    const mainConversation = await Effect.runPromise(converse.ensure(mainKey));
    // Profile creation seeds an onboarding turn; retire it so the scan sees
    // the admitted inputs rather than the queued inbox.
    await Effect.runPromise(converse.interrupt(mainConversation));
    await Effect.runPromise(
      converse.submit(mainConversation, "we decided the launch date is March 3"),
    );

    const extra = await profiles.createSession("harry", bot.id, "Notes");
    const extraKey = await profiles.keyForSession("harry", extra.id);
    const extraConversation = await Effect.runPromise(converse.ensure(extraKey));
    await Effect.runPromise(
      converse.submit(extraConversation, "reminder: renew the SSL certificate"),
    );

    const hits = await history.search("harry", bot.id, "launch date", 8);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.sessionId).toBe(main.id);
    expect(hits[0]?.role).toBe("user");
    expect(hits[0]?.snippet).toContain("March 3");

    const renew = await history.search("harry", bot.id, "ssl", 8);
    expect(renew).toHaveLength(1);
    expect(renew[0]?.sessionId).toBe(extra.id);

    expect(await history.search("harry", bot.id, "nonexistent", 8)).toEqual([]);
    expect(await history.search("harry", bot.id, "", 8)).toEqual([]);
    await handle.close();
  });

  it("never crosses profiles and exposes the tool surface", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { converse, profiles } = handle.mind;
    const edison = await profiles.create("harry", { name: "Edison" });
    const other = await profiles.create("harry", { name: "Researcher" });
    const history = historyService({ converse, profiles });

    const main = await profiles.ensureMain("harry", edison.id);
    const key = await profiles.keyForSession("harry", main.id);
    const conversation = await Effect.runPromise(converse.ensure(key));
    await Effect.runPromise(converse.interrupt(conversation));
    await Effect.runPromise(converse.submit(conversation, "edison private: token 9f8e7d"));

    expect((await history.search("harry", other.id, "9f8e7d", 8)).length).toBe(0);

    const [search] = historyTools(history, profiles);
    if (search === undefined) throw new Error("missing history tool");
    expect(search.name).toBe("history_search");
    const api = { conversationId: String(conversation.id) } as never;
    const found = await search.execute({ query: "token" }, api, {} as never);
    expect(found.structuredOutput).toHaveLength(1);
    const scopedOut = await search.execute(
      { query: "token" },
      { conversationId: String((await Effect.runPromise(converse.root())).id) } as never,
      {} as never,
    );
    expect(scopedOut.structuredOutput).toEqual([]);
    await handle.close();
  });
});
