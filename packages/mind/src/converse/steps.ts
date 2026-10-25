/**
 * The projection of a durable conversation into renderable steps: committed
 * transcript entries plus the in-flight generation partial (`pi.live`).
 * A pure function of the conversation view — every surface of the mind
 * renders through this. Shape: `@ultiv/contracts` TranscriptEntry.
 */
import type { EntryRecord, LiveState } from "@earendil-works/pi-durable";
import type { TranscriptEntry } from "@ultiv/contracts";

export type Step = TranscriptEntry;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((block) => String((block as { text?: string }).text ?? "")).join("");
  }
  return JSON.stringify(content);
}

interface ToolResult {
  readonly content: unknown;
  readonly isError: boolean;
  readonly durationMs: number | null;
}

/** toolCallId -> committed result, paired into the toolCall steps below. */
function toolResultsOf(entries: readonly EntryRecord[]): Map<string, ToolResult> {
  const results = new Map<string, ToolResult>();
  for (const entry of entries) {
    for (const message of (entry.model ?? []) as readonly unknown[]) {
      const record = message as {
        role?: string;
        toolCallId?: unknown;
        content?: unknown;
        isError?: boolean;
        durationMs?: unknown;
      };
      if (record.role !== "toolResult" || record.toolCallId === undefined) continue;
      results.set(String(record.toolCallId), {
        content: record.content,
        isError: record.isError === true,
        durationMs: typeof record.durationMs === "number" ? record.durationMs : null,
      });
    }
  }
  return results;
}

/** Committed entries -> steps; tool results surface through the paired call's collapsible. */
function committedSteps(entries: readonly EntryRecord[], results: Map<string, ToolResult>): Step[] {
  const out: Step[] = [];
  for (const entry of entries) {
    for (const message of (entry.model ?? []) as readonly unknown[]) {
      const record = message as { role?: string; content?: unknown; timestamp?: unknown };
      if (record.role === "toolResult" || record.role === "system") continue;
      const at = typeof record.timestamp === "number" ? record.timestamp : Date.now();
      const blocks = Array.isArray(record.content)
        ? (record.content as readonly unknown[])
        : [{ type: "text", text: textOf(record.content) }];
      let blockIndex = 0;
      for (const block of blocks) {
        const id = entry.id * 100 + blockIndex++;
        if (record.role === "user") {
          const text = String((block as { text?: unknown }).text ?? "").trim();
          if (text !== "") out.push({ id, kind: "input", at, text });
          break;
        }
        const kind = (block as { type?: string }).type;
        if (kind === "thinking") {
          const text = String((block as { thinking?: unknown }).thinking ?? "").trim();
          if (text !== "") out.push({ id, kind: "thinking", at, text });
        } else if (kind === "toolCall") {
          out.push(
            toolStep(block, id, at, results.get(String((block as { id?: unknown }).id ?? id))),
          );
        } else if (kind === "text") {
          const text = String((block as { text?: unknown }).text ?? "").trim();
          if (text !== "") out.push({ id, kind: "output", at, text, streaming: false });
        }
      }
    }
  }
  return out;
}

function toolStep(block: unknown, id: number, at: number, result: ToolResult | undefined): Step {
  return {
    id,
    kind: "tool",
    at,
    step: {
      callId: String((block as { id?: unknown }).id ?? id),
      name: String((block as { name?: unknown }).name ?? "tool"),
      status: result === undefined ? "running" : result.isError ? "error" : "done",
      input: (block as { arguments?: unknown }).arguments ?? null,
      output: result === undefined ? null : textOf(result.content).trim(),
      durationMs: result === undefined ? null : result.durationMs,
    },
  };
}

/** The in-flight generation partial (negative ids) streams before any entry lands. */
function liveSteps(live: LiveState | undefined, out: Step[]): void {
  const partial = live?.generation?.message as
    | { content?: unknown; timestamp?: unknown }
    | undefined;
  if (partial === undefined) return;
  const at = typeof partial.timestamp === "number" ? partial.timestamp : Date.now();
  const blocks = Array.isArray(partial.content) ? (partial.content as readonly unknown[]) : [];
  let partialIndex = 0;
  for (const block of blocks) {
    const id = -1000 - partialIndex++;
    const kind = (block as { type?: string }).type;
    if (kind === "thinking") {
      const text = String((block as { thinking?: unknown }).thinking ?? "");
      if (text !== "") out.push({ id, kind: "thinking", at, text });
    } else if (kind === "text") {
      const text = String((block as { text?: unknown }).text ?? "");
      const last = out[out.length - 1] as Step | undefined;
      // Skip when the settled entry already carries this text (it is a prefix of it):
      // covers the commit/clear overlap without dropping genuine growth.
      if (text !== "" && !(last?.kind === "output" && last.text.startsWith(text))) {
        out.push({ id, kind: "output", at, text, streaming: true });
      }
    } else if (kind === "toolCall") {
      out.push(toolStep(block, id, at, undefined));
    }
  }
}

/** The newest agent text is streaming while the agent works. */
function markStreaming(out: Step[], working: boolean): Step[] {
  if (!working) return out;
  for (let index = out.length - 1; index >= 0; index--) {
    const entry = out[index] as Step;
    if (entry.kind === "output") {
      out[index] = { ...entry, streaming: true };
      break;
    }
    if (entry.kind !== "thinking") break;
  }
  return out;
}

/** Token/cost spend summed over committed assistant messages (pi-ai `Usage`). */
export interface UsageSummary {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  /** Reasoning tokens, when the provider reports them; null when never reported. */
  readonly reasoning: number | null;
  readonly totalTokens: number;
  readonly costUsd: number;
}

/** Sum the usage recorded on each committed assistant message. */
export function usageOf(entries: readonly EntryRecord[]): UsageSummary | undefined {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let totalTokens = 0;
  let costUsd = 0;
  let reasoning: number | null = null;
  let seen = false;
  for (const entry of entries) {
    for (const message of (entry.model ?? []) as readonly unknown[]) {
      const usage = (message as { usage?: Record<string, unknown> }).usage;
      if (usage === undefined || usage === null) continue;
      seen = true;
      input += Number(usage.input ?? 0);
      output += Number(usage.output ?? 0);
      cacheRead += Number(usage.cacheRead ?? 0);
      totalTokens += Number(usage.totalTokens ?? 0);
      costUsd += Number((usage.cost as { total?: number } | undefined)?.total ?? 0);
      if (typeof usage.reasoning === "number") {
        reasoning = (reasoning ?? 0) + usage.reasoning;
      }
    }
  }
  return seen ? { input, output, cacheRead, reasoning, totalTokens, costUsd } : undefined;
}

/** Project the conversation view: committed transcript + live partial + phase. */
export function projectTranscript(
  entries: readonly EntryRecord[],
  live: LiveState | undefined,
  working: boolean,
): Step[] {
  const out = committedSteps(entries, toolResultsOf(entries));
  liveSteps(live, out);
  return markStreaming(out, working);
}
