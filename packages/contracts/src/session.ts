import { hostNamed, method, remote } from "@earendil-works/chord";
import { Type, type Static } from "typebox";

export const TranscriptEntrySchema = Type.Object({
  /** Durable entry id (positive) or a negative optimistic id until the transcript confirms it. */
  id: Type.Number(),
  role: Type.Union([Type.Literal("user"), Type.Literal("agent")]),
  text: Type.String(),
  at: Type.Number(),
});

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
  version: 1,
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
