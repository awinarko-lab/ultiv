/**
 * Mid-turn input against the real engine (faux model, MemoryStorage): where a
 * steered message lands, and that a turn it joins saves one reply.
 */
import { describe, expect, it } from "vite-plus/test";
import { Type } from "typebox";
import { Effect } from "effect";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  AssistantEntry,
  createRegistry,
  defineTool,
  Harness,
  MemoryStorage,
  type HarnessSettings,
} from "@earendil-works/pi-durable";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type FauxResponseStep,
} from "@earendil-works/pi-ai";
import { converseService } from "./converse.ts";

const ctx = BACKGROUND_CONTEXT;

/** The user texts a model request carried, in order. */
const userTexts = (context: unknown): string[] =>
  (context as { messages: readonly { role: string; content: unknown }[] }).messages
    .filter((message) => message.role === "user")
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : (message.content as { text?: string }[]).map((block) => block.text ?? "").join(""),
    );

/** A conversation whose first reply calls `wait`, which blocks until released. */
const steerRig = async (settings: HarnessSettings = {}) => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let started!: () => void;
  const toolStarted = new Promise<void>((resolve) => (started = resolve));
  const registry = createRegistry();
  registry.install({
    name: "probe",
    tools: [
      defineTool({
        name: "wait",
        description: "Waits until the test releases it.",
        parameters: Type.Object({}),
        execute: async () => {
          started();
          await gate;
          return { output: [{ type: "text", text: "waited" }] };
        },
      }),
    ],
  });
  const requests: string[][] = [];
  const reply =
    (message: ReturnType<typeof fauxAssistantMessage>): FauxResponseStep =>
    (context) => {
      requests.push(userTexts(context));
      return message;
    };
  faux.setResponses([
    reply(fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" })),
    reply(fauxAssistantMessage(fauxText("done"))),
    reply(fauxAssistantMessage(fauxText("again"))),
  ]);
  const model = faux.getModel();
  const harness = await Harness.open(new MemoryStorage(), { models, registry, settings }, ctx);
  const converse = converseService(harness, {
    model: { provider: model.provider, modelId: model.id },
  });
  const chat = await Effect.runPromise(converse.ensure("steer-test"));
  const assistantReplies = async (): Promise<number> =>
    (await Effect.runPromise(converse.entriesOf(String(chat.id), 200))).filter((entry) =>
      AssistantEntry.is(entry),
    ).length;
  return { harness, converse, chat, requests, toolStarted, release, assistantReplies };
};

describe("Mid-turn input (faux model)", () => {
  it("a steer lands before the next model call and the turn saves one reply", async () => {
    const rig = await steerRig();
    const { converse, chat } = rig;
    const first = await Effect.runPromise(converse.submit(chat, "first"));
    await rig.toolStarted;
    const second = await Effect.runPromise(converse.submit(chat, "second", "steer"));
    rig.release();
    // Both submissions settle with the same answer; settling each must not
    // append the answer twice (settle reads the stored entry, never writes one).
    const [a, b] = await Promise.all([
      Effect.runPromise(converse.settle(chat, first)),
      Effect.runPromise(converse.settle(chat, second)),
    ]);
    expect(a.text).toBe("done");
    expect(b.text).toBe("done");
    expect(rig.requests).toEqual([["first"], ["first", "second"]]);
    // One tool-call reply plus one final answer — no duplicate.
    expect(await rig.assistantReplies()).toBe(2);
    await rig.harness.close(ctx);
  });
});
