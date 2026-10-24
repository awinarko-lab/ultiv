import { hostNamed, method, remote } from "@earendil-works/chord";
import { Type, type Static } from "typebox";

export const ToolStepSchema = Type.Object({
  callId: Type.String(),
  name: Type.String(),
  status: Type.Union([Type.Literal("running"), Type.Literal("done"), Type.Literal("error")]),
  input: Type.Unknown(),
  output: Type.Union([Type.String(), Type.Null()]),
  durationMs: Type.Union([Type.Number(), Type.Null()]),
});

export type ToolStep = Static<typeof ToolStepSchema>;

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
  version: 2,
  input: Type.Object({ id: Type.String() }),
  host: hostNamed("server"),
  variants: {
    default: {
      state: {
        transcript: TranscriptSchema,
        phase: PhaseSchema,
        lastError: SessionErrorSchema,
      },
      methods: {
        input: method(Type.Object({ text: Type.String() })),
      },
    },
  },
});
