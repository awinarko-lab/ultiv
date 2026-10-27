import { describe, expect, it } from "vite-plus/test";
import type { ProfileInfo } from "@ultiv/contracts";
import type { ProfilesService } from "./profiles.ts";
import { profilesExtension } from "./section.ts";

const profile = (timezone: string): ProfileInfo => ({
  id: "p1",
  owner: "harry",
  name: "Scout",
  description: "",
  persona: "",
  timezone,
  model: null,
  toolAllowlist: null,
  policies: { autoApprove: [] } as unknown as ProfileInfo["policies"],
  createdAt: 0,
  archivedAt: null,
});

const render = async (me: ProfileInfo | undefined): Promise<string> => {
  const profiles = {
    profileOf: () => me,
    list: async () => (me === undefined ? [] : [me]),
  } as unknown as ProfilesService;
  const section = profilesExtension(profiles, "Ultius").sections?.[0];
  if (section === undefined) throw new Error("missing identity section");
  return String(await section.render({ conversationId: "c1" } as never, {} as never));
};

describe("identity section: owner's time zone", () => {
  it("states the zone when the profile has one", async () => {
    const text = await render(profile("Asia/Jakarta"));
    expect(text).toContain("You are Scout");
    expect(text).toContain("Your owner's time zone: Asia/Jakarta.");
  });

  it("omits the line when the zone is empty", async () => {
    expect(await render(profile(""))).not.toContain("time zone:");
  });

  it("omits the line for unmapped conversations", async () => {
    const text = await render(undefined);
    expect(text).toContain("You are Ultius");
    expect(text).not.toContain("time zone:");
  });
});
