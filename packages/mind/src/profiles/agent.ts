/** The agent a profile's new conversations start with: model default + tool allowlist. */
import type { AgentChange } from "@earendil-works/pi-durable";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ProfileInfo } from "@ultiv/contracts";

export const agentForProfile = (
  profile: ProfileInfo,
  tools: () => readonly { readonly name: string }[],
): AgentChange => {
  const allowed =
    profile.toolAllowlist === null
      ? undefined
      : (tools().filter((tool) =>
          profile.toolAllowlist?.includes(tool.name),
        ) as unknown as NonNullable<AgentChange["tools"]>);
  return {
    ...(profile.model !== null
      ? {
          model: { provider: "kenari", modelId: profile.model.id },
          // An empty effort string means "the model's default".
          ...(profile.model.effort !== ""
            ? { thinkingLevel: profile.model.effort as ModelThinkingLevel }
            : {}),
        }
      : {}),
    ...(allowed !== undefined ? { tools: allowed } : {}),
  };
};
