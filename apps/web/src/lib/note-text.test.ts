import { describe, expect, it } from "vite-plus/test";
import { readNote } from "./note-text.ts";

const id = "e8f80ac3-4a7f-43e2-8f6b-b3551373148f";
const names = (value: string): string | undefined => (value === id ? "Lucas" : undefined);

describe("readNote", () => {
  it("cleans a delivered message header and drops the bot-only footer", () => {
    const note = readNote(
      `[message from Eve • Owner introduction • notify • re: ${id}]\n\nHello Lucas.\n\n(A notification from another bot, not your owner. NO reply is needed.)`,
      names,
    );
    expect(note).toEqual({ header: "Message from Eve · Owner introduction", body: "Hello Lucas." });
  });

  it("names the recipient of a sent message", () => {
    expect(readNote(`✉ → ${id} (request • Plans)\n\nCan you help?`, names)).toEqual({
      header: "Message to Lucas · asks for a reply · Plans",
      body: "Can you help?",
    });
  });

  it("marks requests and hides unknown ids", () => {
    expect(
      readNote(`[reply from Eve • request • re: ${id}]\n\nDone.`, () => undefined).header,
    ).toBe("Reply from Eve · asks for a reply");
    expect(readNote(`✉ → b5c27b8b-faff-4769-9a37-607d4c33582a (notify)\n\nHi`, names).header).toBe(
      "Message to another bot",
    );
  });

  it("leaves plain notes alone", () => {
    expect(readNote("just text", names)).toEqual({ header: "Note", body: "just text" });
  });
});
