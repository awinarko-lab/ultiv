/**
 * The entity's composition parts, split out of entity.ts: the routine
 * services, the late pi-registry installs, the approval policy and the
 * describe() truth. Each profile runs as its own entity over these.
 */
import { Effect } from "effect";
import { defineExtension, type ToolRegistration } from "@earendil-works/pi-durable";
import { FIRST_USE_APPROVAL, type ScopeHolder } from "@ultiv/ext";
import { isMcpFirstUse } from "./mcp/access.ts";
import { isNeverAutoApproved } from "./mcp/manage.ts";
import { adjudicationOf, type ApprovalsService } from "./approvals.ts";
import type { ApprovalRequest } from "./approvals.ts";
import type { actService } from "./act/act.ts";
import { codemodeExtension } from "./act/codemode.ts";
import { taskTools } from "./act/task-tools.ts";
import { ENTITY_NAME } from "./act/identity.ts";
import { runningTasksSection } from "./act/task-live.ts";
import type { AuditService } from "./audit/audit.ts";
import type { ConverseService } from "./converse/converse.ts";
import type { TasksService } from "./tasks/tasks.ts";
import type { ProfilesService } from "./profiles/profiles.ts";
import { profilesExtension, memoryCoreExtension } from "./profiles/section.ts";
import type { RoomsService } from "./profiles/rooms.ts";
import type { MailboxService } from "./mailbox/mailbox.ts";
import { messageTools } from "./mailbox/tools.ts";
import { memoryService, type MemoryService } from "./memory/memory.ts";
import { memoryTools } from "./memory/tools.ts";
import { historyService, type HistoryService } from "./history/history.ts";
import { historyTools } from "./history/tools.ts";
import { schedulesService, type SchedulesService } from "./schedules/schedules.ts";
import { scheduleTools } from "./schedules/tools.ts";
import { receiptsService, type ReceiptsService } from "./routines/receipts.ts";
import { webhooksService, type WebhooksService } from "./webhooks/webhooks.ts";
import { webhookTools } from "./webhooks/tools.ts";
import { kvService, type KvService } from "./state/kv.ts";
import { stateTools } from "./state/tools.ts";
import { sensorsService, type SensorsService } from "./sensors/sensors.ts";
import { sensorTools } from "./sensors/tools.ts";
import type { GenerateService } from "./generate/generate.ts";
import type { DecideService } from "./decide/decide.ts";

/** The services whose tools ride the pi-durable registry as late installs. */
interface Faculties {
  readonly converse: ConverseService;
  readonly act: ReturnType<typeof actService>;
  readonly tasks: TasksService;
  readonly profiles: ProfilesService;
  readonly rooms: RoomsService;
  readonly mailbox: MailboxService;
  readonly memory: MemoryService;
  readonly schedules: SchedulesService;
  readonly receipts: ReceiptsService;
  readonly webhooks: WebhooksService;
  readonly state: KvService;
  readonly sensors: SensorsService;
  readonly history: HistoryService;
  /** The write guard reads the turn's origin and taint through these. */
  readonly audit?: AuditService;
  /** Names beyond the guard's base set that taint a turn (installed MCP tools). */
  readonly untrustedTool?: (name: string) => boolean;
  /** bots_list / bot_info: read-only sibling discovery, in the allowlist universe. */
  readonly botTools: readonly ToolRegistration[];
}

/** Late installs are legal: the harness reconsiders its tools as the registry changes. */
export const installFaculties = (
  piRegistry: { readonly install: (extension: ReturnType<typeof defineExtension>) => void },
  f: Faculties,
): void => {
  const { act, tasks, profiles, rooms, mailbox, memory, schedules, receipts } = f;
  const { webhooks, state, sensors, history } = f;
  piRegistry.install(act.extension());
  piRegistry.install(codemodeExtension());
  piRegistry.install(profilesExtension(profiles, ENTITY_NAME));
  piRegistry.install(memoryCoreExtension(memory, profiles));
  piRegistry.install(defineExtension({ name: "ultius.mind.bots", tools: [...f.botTools] }));
  piRegistry.install(
    defineExtension({
      name: "ultius.mind.tasks",
      tools: taskTools(tasks, profiles),
      sections: [runningTasksSection(tasks, profiles)],
    }),
  );
  piRegistry.install(
    defineExtension({
      name: "ultius.mind.mailbox",
      tools: messageTools(mailbox, profiles, rooms),
    }),
  );
  piRegistry.install(
    defineExtension({
      name: "ultius.mind.memory",
      tools: memoryTools(memory, profiles, {
        converse: f.converse,
        ...(f.audit !== undefined ? { audit: f.audit } : {}),
        ...(f.untrustedTool !== undefined ? { untrustedTool: f.untrustedTool } : {}),
      }),
    }),
  );
  piRegistry.install(
    defineExtension({
      name: "ultius.mind.schedules",
      tools: scheduleTools(schedules, profiles),
    }),
  );
  piRegistry.install(
    defineExtension({
      name: "ultius.mind.webhooks",
      tools: webhookTools(webhooks, receipts, profiles),
    }),
  );
  piRegistry.install(
    defineExtension({
      name: "ultius.mind.state",
      tools: stateTools(state, profiles),
    }),
  );
  piRegistry.install(
    defineExtension({
      name: "ultius.mind.sensors",
      tools: sensorTools(sensors, profiles),
    }),
  );
  piRegistry.install(
    defineExtension({
      name: "ultius.mind.history",
      tools: historyTools(history, profiles),
    }),
  );
};

/** Jev's rubric for the 'jev' approval mode: what the delegated judge may wave through. */
const JEV_RUBRIC =
  "You are the approval gate for an AI assistant acting on its owner's behalf. " +
  "Approve routine, low-risk, reversible actions that are clearly within the " +
  "role the owner delegated to this bot. Deny anything that spends money, " +
  "deletes or overwrites data, messages people, exposes secrets, or touches " +
  "credentials and connectors. When unsure, decline to decide.";

/** Ask Jev about one gated call; undefined = no opinion (the owner decides). */
const adjudicateWith =
  (decide: DecideService, audit: AuditService, profiles: ProfilesService) =>
  (conversationId: string, request: ApprovalRequest) => {
    const profile = profiles.profileOf(conversationId);
    // The gate reads the profile LIVE: a chat-box switch must apply to the
    // next gated call without re-wiring the hooks.
    if (profile?.policies.approvalMode !== "jev" || !decide.available) {
      return Effect.succeed(undefined);
    }
    const state = JSON.stringify({
      bot: profile.name + (profile.description !== "" ? ` — ${profile.description}` : ""),
      tool: request.name,
      input: request.input,
    });
    return Effect.map(decide.yesNo(state, JEV_RUBRIC), (probability) => {
      const verdict = adjudicationOf("jev", decide.available, probability);
      if (verdict === "human") return undefined;
      audit.record({
        at: Date.now(),
        kind: "adjudication",
        conversationId,
        profile: profile.id,
        callId: request.callId,
        name: request.name,
        durationMs: null,
        ok: verdict === "approve",
        error:
          verdict === "deny"
            ? `jev denied (probability ${probability.toFixed(2)})`
            : `jev approved (probability ${probability.toFixed(2)})`,
      });
      return verdict === "approve"
        ? { approved: true }
        : {
            approved: false,
            note:
              `denied by the bot's own judgment (Jev, probability ${probability.toFixed(2)}) — ` +
              "this looks outside what the owner delegated; do not retry",
          };
    });
  };

/**
 * Profile scoping for the ext plugins and the per-profile approval policy.
 * `decide` is the Jev faculty: it powers the 'jev' approval mode's gate.
 */
export const wirePolicies = (
  holder: ScopeHolder,
  approvals: ApprovalsService,
  audit: AuditService,
  profiles: ProfilesService,
  decide: DecideService,
): void => {
  // Profile scoping reaches the ext plugins (artifacts dirs, vault lists)
  // through the holder the registry was built with — set now that the
  // conversation→profile index exists.
  holder.set({
    scopeOf: (conversationId) => {
      const scope = profiles.scopeOf(conversationId);
      return scope === undefined ? undefined : { owner: scope.owner, profile: scope.profileId };
    },
  });
  // Per-profile approval policy (auto-approve lists, Jev gate, timeout
  // escalation). The hard floors stand whatever the mode says.
  approvals.setHooks({
    // A credential's first use on a host, and a connector's first use, are
    // always asked, whatever the list says.
    autoApprove: (conversationId, request) => {
      const mode = profiles.profileOf(conversationId)?.policies.approvalMode;
      return (
        request.name !== FIRST_USE_APPROVAL &&
        !isMcpFirstUse(request.name) &&
        !isNeverAutoApproved(request.name) &&
        // 'yolo' waves everything past the floors through.
        (mode === "yolo" ||
          profiles.profileOf(conversationId)?.policies.autoApprove.includes(request.name) === true)
      );
    },
    adjudicate: adjudicateWith(decide, audit, profiles),
    onExpire: (conversationId, request) => {
      audit.record({
        at: Date.now(),
        kind: "escalation",
        conversationId,
        profile: profiles.profileOf(conversationId)?.id ?? null,
        callId: request.callId,
        name: request.name,
        durationMs: null,
        ok: false,
        error: "approval timed out",
      });
    },
  });
};

/** The truth: registry plugins AND the late pi-registry installs act.tools() misses. */
export const describeMind = (
  act: ReturnType<typeof actService>,
  decide: DecideService,
  piRegistry: {
    readonly snapshot: () => {
      readonly tools: () => ReadonlyArray<{ readonly tool: { readonly name: string } }>;
    };
  },
) => ({
  entity: ENTITY_NAME,
  decide: decide.available,
  tools: [
    ...new Set([
      ...act.tools().map((tool) => tool.name),
      ...piRegistry
        .snapshot()
        .tools()
        .map(({ tool }) => tool.name),
    ]),
  ],
});

/** The per-profile routine services (memory, history, schedules, triggers, state). */
export const routineServices = (
  converse: ConverseService,
  profiles: ProfilesService,
  onSchedulesChanged: (() => Promise<void>) | undefined,
  models: {
    /** The extraction/decision models for the memory v2 write pipeline. */
    readonly generate?: GenerateService;
    readonly decide?: DecideService;
    /** Taint sources for the memory write/forget guard. */
    readonly audit?: AuditService;
    readonly untrustedTool?: (name: string) => boolean;
  } = {},
) => ({
  memory: memoryService({ converse, profiles, ...models }),
  history: historyService({ converse, profiles }),
  schedules: schedulesService({
    converse,
    profiles,
    ...(onSchedulesChanged !== undefined ? { onChanged: onSchedulesChanged } : {}),
  }),
  receipts: receiptsService({ converse }),
  webhooks: webhooksService({ converse, profiles }),
  state: kvService({ converse }),
  sensors: sensorsService({ converse, profiles }),
});
