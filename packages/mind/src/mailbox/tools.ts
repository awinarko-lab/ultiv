/**
 * The mailbox as a native tool of the agent loop: `message`. Asynchronous by
 * design — the tool admits the envelope into the pair's DM thread and returns
 * immediately; the sender's turn ends, and any reply arrives later as a new
 * input in its main chat. The description carries the discipline (end your
 * turn, reply up the chain) — the mailbox's lineage caps enforce it.
 */
import { Type } from "typebox";
import { definePlugin, defineTool, toolCapability, type Plugin, type Tool } from "@ultiv/ext";
import type { MailboxService } from "./mailbox.ts";
import type { ProfilesService } from "../profiles/profiles.ts";

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
      "Send a message to a sibling entity in your workspace. Asynchronous: your message " +
      "lands in your shared DM thread, the sibling answers there, and you are WOKEN with the " +
      "reply as a new input — END YOUR TURN after sending; never wait or poll. Requests cost " +
      "a model turn for the sibling; prefer notify when no answer is needed.",
    parameters: MessageParams,
    structuredOutputSchema: Type.Object({ id: Type.String(), status: Type.String() }),
    execute: (args, api) => {
      const scope = profiles.scopeOf(String(api.conversationId));
      if (scope === undefined) {
        return Promise.resolve({
          output: [
            {
              type: "text" as const,
              text: "refused: this conversation belongs to no profile — messaging is a profile capability.",
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
          ...(args.artifacts !== undefined ? { artifacts: args.artifacts } : {}),
          origin: "tool",
        })
        .then((entry) => ({
          output: [
            {
              type: "text" as const,
              text: `message ${entry.envelope.id} admitted to ${args.to}. End your turn now; you will be woken with any reply.`,
            },
          ],
          structuredOutput: { id: entry.envelope.id, status: entry.status },
        }))
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

/** The message tool alone, for late pi-registry installs. */
export const messageTools = (
  mailbox: MailboxService,
  profiles: ProfilesService,
): readonly Tool[] => [messageTool(mailbox, profiles)];

/** The mailbox faculty as an installable plugin. */
export const mailboxPlugin = (mailbox: MailboxService, profiles: ProfilesService): Plugin =>
  definePlugin({
    id: "ultiv.mind.mailbox",
    version: "1.0.0",
    description: "Inter-entity messaging on per-pair DM threads — asynchronous, lineage-capped.",
    capabilities: [toolCapability(messageTool(mailbox, profiles))],
  });
