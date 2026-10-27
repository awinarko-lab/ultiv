import { describe, expect, it } from "vite-plus/test";
import { clockText, cronToText } from "./cron-text.ts";

describe("cronToText", () => {
  it.each([
    ["* * * * *", "Every minute"],
    ["*/1 * * * *", "Every minute"],
    ["*/30 * * * *", "Every 30 minutes"],
    ["0 * * * *", "Every hour"],
    ["5 * * * *", "Every hour at :05"],
    ["0 */2 * * *", "Every 2 hours"],
    ["15 */6 * * *", "Every 6 hours at :15"],
    ["0 9 * * *", "Every day at 9:00 AM"],
    ["30 17 * * *", "Every day at 5:30 PM"],
    ["0 9,17 * * *", "Every day at 9:00 AM and 5:00 PM"],
    ["0 9 * * 1-5", "Every weekday at 9:00 AM"],
    ["0 9 * * mon-fri", "Every weekday at 9:00 AM"],
    ["0 10 * * 0,6", "Every weekend at 10:00 AM"],
    ["0 10 * * 6,7", "Every weekend at 10:00 AM"],
    ["0 8 * * 1", "Every Monday at 8:00 AM"],
    ["0 8 * * 1,3,5", "Every Monday, Wednesday and Friday at 8:00 AM"],
    ["0 0 * * 0-7", "Every day at 12:00 AM"],
    ["0 12 1 * *", "Every month on the 1st at 12:00 PM"],
    ["0 9 22 * *", "Every month on the 22nd at 9:00 AM"],
    ["0 9 11 * *", "Every month on the 11th at 9:00 AM"],
    ["0 9 25 12 *", "Every year on December 25 at 9:00 AM"],
  ])("%s → %s", (cron, text) => {
    expect(cronToText(cron)).toBe(text);
  });

  it.each([
    "",
    "0 9 * *",
    "0 9 * * * *",
    "0-10 9 * * *",
    "0 9 L * *",
    "0 9 1 * 1",
    "61 9 * * *",
    "0 9 * * 5-1",
    "0 9 * 13 *",
  ])("returns null for %j", (cron) => {
    expect(cronToText(cron)).toBeNull();
  });
});

describe("clockText", () => {
  it("formats midnight, noon and afternoons", () => {
    expect(clockText(0, 0)).toBe("12:00 AM");
    expect(clockText(12, 5)).toBe("12:05 PM");
    expect(clockText(23, 59)).toBe("11:59 PM");
  });
});
