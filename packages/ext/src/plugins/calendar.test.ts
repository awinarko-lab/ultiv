import { describe, expect, it } from "vite-plus/test";
import { parseIcs, parseIcsDate } from "./calendar.ts";
import { emailConfigured, emailPlugin } from "./email.ts";

describe("calendar ICS parsing", () => {
  it("parses ICS dates in all three forms", () => {
    const allDay = parseIcsDate("20260303");
    expect(allDay?.allDay).toBe(true);
    const zulu = parseIcsDate("20260303T093000Z");
    expect(zulu?.allDay).toBe(false);
    expect(zulu?.at).toBe(Date.UTC(2026, 2, 3, 9, 30, 0));
    const floating = parseIcsDate("20260303T093000");
    expect(floating?.allDay).toBe(false);
    expect(parseIcsDate("garbage")).toBeNull();
  });

  it("parses VEVENTs, unfolds wrapped lines, sorts by start", () => {
    const raw = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:1",
      "DTSTART:20260303T090000Z",
      "DTEND:20260303T100000Z",
      "SUMMARY:Standup",
      "LOCATION:Room 4",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:2",
      "DTSTART;VALUE=DATE:20260302",
      "SUMMARY:Offsite",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:3",
      "DTSTART:20260304T100000Z",
      "SUMMARY:Wrapped",
      "  double",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcs(raw);
    expect(events.map((event) => event.summary)).toEqual(["Offsite", "Standup", "Wrapped double"]);
    expect(events[1]?.location).toBe("Room 4");
    expect(events[2]?.end).toBeNull();
  });

  it("skips malformed events without crashing", () => {
    expect(parseIcs("BEGIN:VEVENT\nSUMMARY:no dates\nEND:VEVENT")).toEqual([]);
    expect(parseIcs("")).toEqual([]);
  });
});

describe("email_send tool", () => {
  it("refuses invalid addresses and reports provider failures", async () => {
    const calls: unknown[] = [];
    const post = async (_url: string, _key: string, body: unknown) => {
      calls.push(body);
      return { ok: true, status: 200, id: "abc-123" };
    };
    const [send] = emailPlugin({ post }).capabilities.map((capability) =>
      capability.kind === "tool" ? capability.tool : undefined,
    );
    if (send === undefined) throw new Error("missing email tool");
    expect(send.name).toBe("email_send");
    expect(send.gated).toBe(true);

    const bad = await send.execute(
      { to: ["not-an-email"], subject: "s", text: "b" },
      {} as never,
      {} as never,
    );
    expect(bad.isError).toBe(true);
    expect(calls).toHaveLength(0);

    const ok = await send.execute(
      { to: ["a@example.com"], subject: "Hello", text: "World" },
      {} as never,
      {} as never,
    );
    expect(ok.structuredOutput).toEqual({ sent: true, id: "abc-123" });
    expect(calls[0]).toMatchObject({ from: "", to: ["a@example.com"] });

    const failing = emailPlugin({
      post: async () => ({ ok: false, status: 422 }),
    });
    const [fail] = failing.capabilities.map((capability) =>
      capability.kind === "tool" ? capability.tool : undefined,
    );
    const denied = await (fail as NonNullable<typeof fail>).execute(
      { to: ["a@example.com"], subject: "s", text: "b" },
      {} as never,
      {} as never,
    );
    expect(denied.isError).toBe(true);
  });

  it("stays uninstalled without keys", () => {
    const hadKey = process.env.RESEND_API_KEY;
    const hadFrom = process.env.EMAIL_FROM;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    expect(emailConfigured()).toBe(false);
    if (hadKey !== undefined) process.env.RESEND_API_KEY = hadKey;
    if (hadFrom !== undefined) process.env.EMAIL_FROM = hadFrom;
  });
});
