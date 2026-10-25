/**
 * The mailbox as native tools of the agent loop: `message` and `relay`.
 * Messaging is asynchronous by design — the tool admits the envelope into
 * the pair's contextual room and returns immediately; the sender's turn
 * ends, and the reply arrives later as a new input in the sender's seat.
 * `relay` is the way back to the owner: it surfaces an outcome on the bot's
 * MAIN thread, so conclusions never stay buried in a room.
 */
import { Type } from "typebox";
import { Effect } from "effect";
import { definePlugin, defineTool, toolCapability, type Plugin, type Tool } from "@ultiv/ext";
import type { MailboxService } from "./mailbox.ts";
import type { ProfilesService } from "../profiles/profiles.ts";
import type { ConverseService } from "../converse/converse.ts";

const MessageParams = Type.Object({
  to: Type.String({
    description: "The sibling profile's id (see your identity section for the roster).",
  }),
  kind: Type.Union([Type.Literal("request"), Type.Literal("notify")], {
    description:
      '"request" expects an answer (you are woken with the reply) — use it for questions and ' +
      'delegations. "notify" is fire-and-forget information.',
  }),
  body: Type.String({
    description:
      "The full, self-contained message. The recipient sees only this, not your context.",
  }),
  topic: Type.Optional(
    Type.String({
      description:
        'The conversation context, e.g. "Q3 report". REUSE the same topic to continue a ' +
        "thread — near-duplicate topics splinter the exchange into extra rooms. Omit only " +
        "for a new general thread.",
    }),
  ),
  artifacts: Type.Optional(
    Type.Array(Type.String(), {
      description: "Artifact ids to grant the recipient (read access to exactly these).",
    }),
  ),
});

const messageTool = (mailbox: MailboxService, profiles: ProfilesService): Tool =>
  defineTool({
    name: "message",
    description:
      "Send a message to a sibling bot in your workspace. Asynchronous: it lands in your " +
      "shared room for the topic, the sibling answers there, and you are WOKEN with the " +
      "reply as a new input in that same room — END YOUR TURN after sending; never wait or " +
      "poll. Exchanges are capped (the tool output shows your remaining budget to each " +
      "sibling) — say everything you need to say in as few messages as possible. Requests " +
      "cost a model turn for the sibling; prefer notify when no answer is needed.",
    parameters: MessageParams,
    structuredOutputSchema: Type.Object({ id: Type.String(), status: Type.String() }),
    execute: (args, api) => {
      const scope = profiles.scopeOf(String(api.conversationId));
      if (scope === undefined) {
        return Promise.resolve({
          output: [
            {
              type: "text" as const,
              text: "refused: this conversation belongs to no bot — messaging is a bot capability.",
            },
          ],
          isError: true as const,
        });
      }
      return mailbox
        .send({
          owner: scope.owner,
          from: scope.profileId,
          to: args.to,
          kind: args.kind,
          body: args.body,
          ...(args.topic !== undefined ? { topic: args.topic } : {}),
          ...(args.artifacts !== undefined ? { artifacts: args.artifacts } : {}),
          origin: "tool",
        })
        .then(async (entry) => {
          const budget = await mailbox.budgetOf(scope.owner, scope.profileId, args.to);
          const left = budget.cap - budget.used;
          const budgetNote =
            left <= 0
              ? " That was your FINAL message to this sibling for this exchange — conclude now."
              : ` ${left} of ${budget.cap} messages left to this sibling.`;
          return {
            output: [
              {
                type: "text" as const,
                text:
                  `message ${entry.envelope.id} admitted to ${args.to}.` +
                  budgetNote +
                  " End your turn now; you will be woken with any reply.",
              },
            ],
            structuredOutput: { id: entry.envelope.id, status: entry.status },
          };
        })
        .catch((cause: unknown) => ({
          output: [
            {
              type: "text" as const,
              text: `refused: ${(cause as { reason?: string }).reason ?? String(cause)}`,
            },
          ],
          isError: true as const,
        }));
    },
  });

const RelayParams = Type.Object({
  body: Type.String({
    description:
      "The owner-facing summary of the outcome — self-contained, written for the owner " +
      "(they have not read the room).",
  }),
  topic: Type.Optional(
    Type.String({ description: "The room topic this outcome came from, if any." }),
  ),
});

const relayTool = (converse: ConverseService, profiles: ProfilesService): Tool =>
  defineTool({
    name: "relay",
    description:
      "Surface an outcome on YOUR MAIN THREAD, where your owner reads you. Use it when a " +
      "sibling's reply (or any background result) concludes something the owner asked " +
      "about — otherwise they will never see it. Write the summary for the owner, not " +
      "for yourself; the owner does not read bot-to-bot rooms.",
    parameters: RelayParams,
    execute: (args, api) => {
      const scope = profiles.scopeOf(String(api.conversationId));
      if (scope === undefined) {
        return Promise.resolve({
          output: [
            {
              type: "text" as const,
              text: "refused: this conversation belongs to no bot — relay is a bot capability.",
            },
          ],
          isError: true as const,
        });
      }
      return (async () => {
        const main = await profiles.ensureMain(scope.owner, scope.profileId);
        const mainId = await Effect.runPromise(
          converse.conversationIdOf(await profiles.keyOfRow(main)),
        );
        if (mainId !== undefined && String(mainId) === String(api.conversationId)) {
          return {
            output: [
              {
                type: "text" as const,
                text: "refused: you are already on your main thread — just say it directly.",
              },
            ],
            isError: true as const,
          };
        }
        const chat = await Effect.runPromise(converse.ensure(await profiles.keyOfRow(main)));
        const header =
          args.topic !== undefined && args.topic !== "" ? `[relay • ${args.topic}]` : "[relay]";
        const submission = await Effect.runPromise(
          converse.submit(
            chat,
            `${header}\n\n${args.body.slice(0, 6_000)}\n\n(Relayed from a bot-to-bot room. Summarize this for your owner in your own voice now.)`,
          ),
        );
        // The main-thread turn settles in the background, like every delivery.
        void Effect.runPromise(converse.settle(chat, submission)).catch(() => undefined);
        return {
          output: [
            {
              type: "text" as const,
              text: "relayed — your main thread now carries the outcome; your owner will see your summary there.",
            },
          ],
        };
      })().catch((cause: unknown) => ({
        output: [
          {
            type: "text" as const,
            text: `refused: ${(cause as { reason?: string }).reason ?? String(cause)}`,
          },
        ],
        isError: true as const,
      }));
    },
  });

/** The message + relay tools, for late pi-registry installs. */
export const messageTools = (
  mailbox: MailboxService,
  profiles: ProfilesService,
  converse: ConverseService,
): readonly Tool[] => [messageTool(mailbox, profiles), relayTool(converse, profiles)];

/** The mailbox faculty as an installable plugin. */
export const mailboxPlugin = (
  mailbox: MailboxService,
  profiles: ProfilesService,
  converse: ConverseService,
): Plugin =>
  definePlugin({
    id: "ultiv.mind.mailbox",
    version: "1.1.0",
    description:
      "Inter-entity messaging on contextual rooms — asynchronous, exchange-capped — plus relay to the owner's main thread.",
    capabilities: [
      toolCapability(messageTool(mailbox, profiles)),
      toolCapability(relayTool(converse, profiles)),
    ],
  });
