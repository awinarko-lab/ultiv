import { hostNamed, method, remote } from "@earendil-works/chord";
import { Type, type Static } from "typebox";

export const ThinkingLevelSchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("xhigh"),
  Type.Literal("max"),
]);

export type ThinkingLevel = Static<typeof ThinkingLevelSchema>;

export const ModelInfoSchema = Type.Object({
  id: Type.String(),
  label: Type.String(),
  efforts: Type.Array(ThinkingLevelSchema),
  defaultEffort: ThinkingLevelSchema,
});

export type ModelInfo = Static<typeof ModelInfoSchema>;

/** Cumulative token spend of one session, from the committed transcript. Tokens only — cost stays internal. */
export const UsageSummarySchema = Type.Object({
  input: Type.Number(),
  output: Type.Number(),
  cacheRead: Type.Number(),
  reasoning: Type.Union([Type.Number(), Type.Null()]),
  totalTokens: Type.Number(),
});

export type UsageSummary = Static<typeof UsageSummarySchema>;

export const ModelIdSchema = Type.Union([Type.String(), Type.Null()]);

export const EffortSchema = Type.Union([ThinkingLevelSchema, Type.Null()]);

export const ToolStepSchema = Type.Object({
  callId: Type.String(),
  name: Type.String(),
  status: Type.Union([Type.Literal("running"), Type.Literal("done"), Type.Literal("error")]),
  input: Type.Unknown(),
  output: Type.Union([Type.String(), Type.Null()]),
  durationMs: Type.Union([Type.Number(), Type.Null()]),
});

export type ToolStep = Static<typeof ToolStepSchema>;

/** A tool call waiting for the user's approve/deny decision. */
export const PendingApprovalSchema = Type.Union([
  Type.Null(),
  Type.Object({
    callId: Type.String(),
    name: Type.String(),
    input: Type.Unknown(),
  }),
]);

export type PendingApproval = Static<typeof PendingApprovalSchema>;

/** One rendered step of a session: user input, agent output, reasoning, or a tool call. */
export const TranscriptEntrySchema = Type.Union([
  Type.Object({
    id: Type.Number(),
    kind: Type.Literal("input"),
    at: Type.Number(),
    text: Type.String(),
  }),
  Type.Object({
    id: Type.Number(),
    kind: Type.Literal("output"),
    at: Type.Number(),
    text: Type.String(),
    streaming: Type.Boolean(),
  }),
  Type.Object({
    id: Type.Number(),
    kind: Type.Literal("thinking"),
    at: Type.Number(),
    text: Type.String(),
  }),
  Type.Object({
    id: Type.Number(),
    kind: Type.Literal("tool"),
    at: Type.Number(),
    step: ToolStepSchema,
  }),
]);

export type TranscriptEntry = Static<typeof TranscriptEntrySchema>;

export const TranscriptSchema = Type.Array(TranscriptEntrySchema);

export const PhaseSchema = Type.Union([
  Type.Literal("idle"),
  Type.Literal("working"),
  Type.Literal("error"),
]);

export type Phase = Static<typeof PhaseSchema>;

export const SessionErrorSchema = Type.Union([Type.String(), Type.Null()]);

/** One agent session: durable, replayable transcript plus the agent's phase. */
export const Session = remote("ultiv.session", {
  version: 4,
  input: Type.Object({ id: Type.String() }),
  host: hostNamed("server"),
  variants: {
    default: {
      state: {
        transcript: TranscriptSchema,
        phase: PhaseSchema,
        lastError: SessionErrorSchema,
        pending: PendingApprovalSchema,
        usage: UsageSummarySchema,
        model: ModelIdSchema,
        effort: EffortSchema,
      },
      methods: {
        input: method(Type.Object({ text: Type.String() })),
        approve: method(
          Type.Object({ callId: Type.String(), approved: Type.Boolean() }),
          Type.Object({ ok: Type.Boolean() }),
        ),
        configure: method(
          Type.Object({ model: ModelIdSchema, effort: EffortSchema }),
          Type.Object({ ok: Type.Boolean() }),
        ),
      },
    },
  },
});
