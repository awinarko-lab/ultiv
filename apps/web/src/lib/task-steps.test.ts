import { describe, expect, it } from "vite-plus/test";
import {
  formatDuration,
  humanizeToolName,
  prettyPayload,
  previewOf,
  timelineOf,
  toolLine,
} from "./task-steps.ts";

const page = JSON.stringify({
  pages: [{ url: "https://plato.stanford.edu/x", content: "# Aristotle on Causality\n\nbody" }],
});

describe("toolLine", () => {
  it("says what known tools did", () => {
    expect(toolLine("now", {}, '{"utc":"x"}').line).toBe("Checked the time");
    expect(toolLine("web_search", { query: "four causes" }, null).line).toBe(
      "Searched the web for “four causes”",
    );
    expect(toolLine("web_fetch", { urls: ["https://plato.stanford.edu/x"] }, page).line).toBe(
      "Read plato.stanford.edu · Aristotle on Causality",
    );
    expect(
      toolLine("web_fetch", { urls: ["https://www.a.org/", "https://b.org/"] }, null).line,
    ).toBe("Read a.org +1 more");
    expect(toolLine("bash", { script: "ls -la\nwc -l" }, null).line).toBe("Ran ls -la");
    expect(toolLine("artifact_write", { name: "r.md", content: "…" }, null).icon).toBe("file");
  });

  it("falls back safely", () => {
    expect(toolLine("docs_search_pages", {}, null)).toEqual({
      icon: "tool",
      line: "Used docs search pages",
    });
    expect(toolLine("web_fetch", "not json", "{broken").line).toBe("Read a web page");
    expect(toolLine("web_fetch", null, '{"pages":"nope"}').line).toBe("Read a web page");
    expect(toolLine("web_search", { query: 42 }, null).line).toBe("Searched the web");
    expect(toolLine("http_request", { url: "::bad" }, null).line).toBe("GET ::bad");
    expect(humanizeToolName("")).toBe("Used a tool");
    expect(humanizeToolName("getPageText")).toBe("Get page text");
  });
});

describe("timelineOf", () => {
  const brief = "Research the textual basis of a live dispute over Aristotle";
  it("drops the brief and the final result, keeps the rest in order", () => {
    const items = timelineOf(
      [
        { kind: "input", at: 1, text: brief.slice(0, 30) },
        { kind: "thinking", at: 2, text: "plan" },
        { kind: "tool", at: 3, text: 'now → {"utc":"z"}' },
        {
          kind: "tool",
          at: 4,
          text: "web_fetch …",
          tool: {
            name: "web_fetch",
            status: "running",
            input: { urls: ["https://a.org"] },
            output: null,
            durationMs: null,
          },
        },
        { kind: "note", at: 5, text: "[task t1 update] halfway" },
        { kind: "output", at: 6, text: "Final answer" },
      ],
      brief,
      "Final answer",
    );
    expect(items.map((item) => item.kind)).toEqual(["thinking", "tool", "tool", "note"]);
    const [, legacy, live, note] = items;
    expect(legacy).toMatchObject({ line: "Checked the time", status: "done" });
    expect(legacy?.kind === "tool" && legacy.output).toContain('"utc": "z"');
    expect(live).toMatchObject({ line: "Read a.org", status: "running", output: null });
    expect(note).toMatchObject({ text: "halfway" });
  });

  it("keeps bot messages that are not the result", () => {
    const items = timelineOf([{ kind: "output", at: 1, text: "Working on it" }], brief, null);
    expect(items).toEqual([{ kind: "message", key: "1-0", text: "Working on it" }]);
  });
});

describe("helpers", () => {
  it("pretty-prints and previews", () => {
    expect(prettyPayload('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyPayload("plain")).toBe("plain");
    expect(prettyPayload({})).toBeNull();
    expect(prettyPayload(null)).toBeNull();
    expect(previewOf("abcdef", 3)).toEqual({ text: "abc…", more: true });
    expect(previewOf("ab", 3)).toEqual({ text: "ab", more: false });
  });

  it("formats durations", () => {
    expect(formatDuration(12)).toBe("<1s");
    expect(formatDuration(4210)).toBe("4s");
    expect(formatDuration(95_000)).toBe("1m 35s");
    expect(formatDuration(null)).toBeNull();
  });
});
