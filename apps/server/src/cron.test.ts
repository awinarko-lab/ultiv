import { describe, expect, it } from "vite-plus/test";
import { isValidSchedule } from "./cron.ts";

describe("Cron schedule validation", () => {
  it("accepts ordinary 5-field expressions", () => {
    expect(isValidSchedule("* * * * *")).toBe(true);
    expect(isValidSchedule("30 7 * * 1-5")).toBe(true);
    expect(isValidSchedule("0 */6 * * *")).toBe(true);
  });

  it("rejects garbage and impossible schedules", () => {
    expect(isValidSchedule("not a cron")).toBe(false);
    expect(isValidSchedule("99 99 * * *")).toBe(false);
    expect(isValidSchedule("")).toBe(false);
  });
});
