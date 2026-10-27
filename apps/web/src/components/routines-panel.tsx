/**
 * The Routines manager: everything that wakes a bot, with the receipts that
 * prove it did. Schedules (fire counts + failures), webhooks (reject
 * counters, recent rejected bodies, test-fire, URL+token for the OWNER —
 * the entity never sees the token), calendar sensors, and the shared
 * receipt tail. The counterpart of docs/ROUTINES.md for humans.
 */
import { BellIcon, CopyIcon, PlugIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  AuditEvent,
  CronJobInfo,
  ProfileInfo,
  RoutineEvent,
  SensorInfo,
  WebhookInfo,
} from "@ultiv/contracts";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { notifyError } from "@/lib/notify";
import { formatClock, formatWhen } from "@/lib/format";

const when = (at: number | null): string => (at === null ? "never" : formatWhen(at));

/** "Ran 3 times, last 9:15 PM" instead of "fired ×3". */
const runs = (count: number, last: number | null): string =>
  count === 0
    ? "Hasn't run yet"
    : `Ran ${count === 1 ? "once" : `${count} times`}, last ${when(last)}`;

/** What a job does when its bot is mid-reply ("steer" is the default, unlabelled). */
const BUSY_LABEL: Record<string, string> = {
  followUp: "Waits its turn",
  reject: "Skips if busy",
};

const SOURCE_LABEL: Record<string, string> = {
  cron: "Schedule",
  webhook: "Webhook",
  sensor: "Sensor",
};

/** The routines content — shared by the header dialog and the mobile view. */
export function RoutinesContent({ profiles }: { profiles: ProfileInfo[] }) {
  const [cron, setCron] = useState<CronJobInfo[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookInfo[]>([]);
  const [sensors, setSensors] = useState<SensorInfo[]>([]);
  const [events, setEvents] = useState<RoutineEvent[]>([]);
  const [escalations, setEscalations] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [cronList, hookList, sensorList, eventList, auditTail] = await Promise.all([
      api.cron(),
      api.webhooks(),
      api.sensors(),
      api.routineEvents(30),
      api.audit(200),
    ]);
    setCron(cronList);
    setWebhooks(hookList);
    setSensors(sensorList);
    setEvents(eventList);
    setEscalations(
      auditTail
        .filter((event) => event.kind === "escalation")
        .slice(-8)
        .reverse(),
    );
  }, []);

  useEffect(() => {
    void load().catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [load]);

  const active = profiles.filter((profile) => profile.archivedAt === null);
  const profileName = (id: string): string =>
    active.find((profile) => profile.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <p className="text-destructive text-sm">{error}</p>}

      <Section title="Schedules">
        {cron.length === 0 && (
          <Empty text="No schedules yet. Ask a bot to remind you or to do something regularly." />
        )}
        {cron.map((job) => (
          <div key={job.id} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <code className="text-xs">
                  {job.once !== undefined && job.once !== null
                    ? `Once, ${when(job.once)}`
                    : job.schedule}
                </code>
                {!job.enabled && <Badge variant="secondary">Off</Badge>}
                {job.whenBusy !== undefined && job.whenBusy !== "steer" && (
                  <Badge variant="outline">{BUSY_LABEL[job.whenBusy] ?? job.whenBusy}</Badge>
                )}
                {job.failures > 0 && <Badge variant="destructive">Failed {job.failures}×</Badge>}
                <span className="text-muted-foreground text-xs">{profileName(job.profile)}</span>
              </div>
              <p className="text-muted-foreground text-xs">
                {runs(job.fireCount ?? 0, job.lastFiredAt ?? null)}
                {job.lastError !== null && job.lastError !== ""
                  ? `. Last error: ${job.lastError}`
                  : ""}
              </p>
            </div>
            <ConfirmDialog
              title="Delete schedule?"
              warning="The bot will no longer be woken by it."
              onConfirm={async () => {
                await api.removeCron(job.id);
                await load();
              }}
            >
              <Button variant="ghost" size="icon" className="shrink-0" aria-label="Delete schedule">
                <Trash2Icon />
              </Button>
            </ConfirmDialog>
          </div>
        ))}
      </Section>

      <Section title="Webhooks">
        <CreateWebhook profiles={active} onCreated={load} />
        {webhooks.length === 0 && <Empty text="No inbound webhooks yet." />}
        {webhooks.map((hook) => (
          <WebhookRow key={hook.id} hook={hook} profiles={profiles} onDone={load} />
        ))}
      </Section>

      <Section title="Watching">
        {sensors.length === 0 && (
          <Empty text="Nothing watched yet. Ask a bot to keep an eye on a calendar or a web page." />
        )}
        {sensors.map((sensor) => (
          <div key={sensor.id} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs">
                  {sensor.kind === "calendar" ? "calendar" : `${sensor.kind}: ${sensor.url ?? ""}`}{" "}
                  · {sensor.kind === "watch" ? "on change" : `${sensor.leadMinutes}min before`}
                  {sensor.match !== "" && ` · “${sensor.match}”`}
                </span>
                {sensor.lastError !== null && sensor.lastError !== "" && (
                  <Badge variant="destructive">error</Badge>
                )}
                <span className="text-muted-foreground text-xs">{profileName(sensor.profile)}</span>
              </div>
              <p className="text-muted-foreground text-xs">
                {runs(sensor.fireCount, sensor.lastFiredAt)}
                {sensor.lastError !== null && sensor.lastError !== ""
                  ? `. Last error: ${sensor.lastError}`
                  : ""}
              </p>
            </div>
            <ConfirmDialog
              title="Delete sensor?"
              warning="The bot will no longer be woken by these events."
              onConfirm={async () => {
                await api.removeSensor(sensor.id);
                await load();
              }}
            >
              <Button variant="ghost" size="icon" className="shrink-0" aria-label="Delete sensor">
                <Trash2Icon />
              </Button>
            </ConfirmDialog>
          </div>
        ))}
      </Section>

      <Section title="Needs attention">
        {escalations.length === 0 && (
          <Empty text="All good. Jobs that keep failing or get switched off show up here." />
        )}
        {escalations.map((event, index) => (
          <div key={`${event.at}-${index}`} className="flex flex-wrap items-center gap-1.5 text-xs">
            <time className="text-muted-foreground">{formatWhen(event.at)}</time>
            <Badge variant="destructive">{event.name}</Badge>
            <span className="text-muted-foreground">
              {event.profile ?? "—"} · {event.error ?? ""}
            </span>
          </div>
        ))}
      </Section>

      <Section title="Recent activity">
        {events.length === 0 && <Empty text="Nothing has run yet." />}
        {events.map((event) => (
          <div key={event.id} className="flex flex-wrap items-center gap-1.5 text-xs">
            <time className="text-muted-foreground">{formatClock(event.at)}</time>
            <Badge variant={event.source === "cron" ? "secondary" : "outline"}>
              {SOURCE_LABEL[event.source] ?? event.source}
            </Badge>
            <Badge
              variant={
                event.status === "delivered"
                  ? "secondary"
                  : event.status === "failed" || event.status === "rejected"
                    ? "destructive"
                    : "outline"
              }
            >
              {event.status.charAt(0).toUpperCase() + event.status.slice(1)}
            </Badge>
            {event.reason !== null && <span className="text-muted-foreground">{event.reason}</span>}
          </div>
        ))}
      </Section>
    </div>
  );
}

/** One webhook row: URL+token (owner-only), counters, rejects, test-fire. */
function WebhookRow({
  hook,
  profiles,
  onDone,
}: {
  hook: WebhookInfo;
  profiles: ProfileInfo[];
  onDone: () => Promise<void>;
}) {
  const [testPayload, setTestPayload] = useState("{}");
  const [testResult, setTestResult] = useState<string | null>(null);
  const profileName =
    profiles.find((profile) => profile.id === hook.profile)?.name ?? hook.profile.slice(0, 8);
  const rejected = hook.rejectedAuth + hook.rejectedSchema + hook.rejectedRate + hook.rejectedSize;

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch (cause) {
      notifyError("Couldn't copy", cause);
    }
  };

  const runTest = async (): Promise<void> => {
    setTestResult(null);
    try {
      const payload = JSON.parse(testPayload) as unknown;
      const result = await api.testWebhook(hook.id, payload);
      setTestResult(
        result.accepted
          ? "Accepted: the payload matches."
          : `Turned away: ${result.detail ?? "the payload doesn't match the expected format"}`,
      );
    } catch (cause) {
      setTestResult(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <code className="text-xs">POST /hooks/{hook.id.slice(0, 8)}…</code>
          {hook.name !== null && <Badge variant="secondary">{hook.name}</Badge>}
          {hook.schema !== null && <Badge variant="outline">Checks format</Badge>}
          {hook.whenBusy !== undefined && hook.whenBusy !== "steer" && (
            <Badge variant="outline">{BUSY_LABEL[hook.whenBusy] ?? hook.whenBusy}</Badge>
          )}
          <span className="text-muted-foreground text-xs">{profileName}</span>
        </div>
        <p className="text-muted-foreground text-xs">
          Accepted {hook.accepted}. {runs(hook.fireCount, hook.lastFiredAt)}
          {rejected > 0 && (
            <>
              {" · "}
              <span className="text-destructive">
                Turned away {rejected} (wrong token {hook.rejectedAuth}, wrong format{" "}
                {hook.rejectedSchema}, too often {hook.rejectedRate}, too large {hook.rejectedSize})
              </span>
            </>
          )}
        </p>
        {hook.lastRejectAt !== null && (
          <p className="text-muted-foreground text-xs">
            Last turned away {when(hook.lastRejectAt)} ({hook.lastRejectReason})
            {hook.recentRejects[0] !== undefined && `: ${hook.recentRejects[0].detail}`}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void copy(`${location.origin}/hooks/${hook.id}?token=${hook.token}`)}
          >
            <CopyIcon /> Copy URL
          </Button>
          <Button variant="ghost" size="xs" onClick={() => void copy(hook.token)}>
            <CopyIcon /> Copy token
          </Button>
          <Input
            className="h-6 w-40 px-1.5 text-xs"
            value={testPayload}
            onChange={(event) => setTestPayload(event.target.value)}
            aria-label={`Test payload for webhook ${hook.name ?? hook.id}`}
          />
          <Button variant="ghost" size="xs" onClick={() => void runTest()}>
            <PlugIcon /> Test
          </Button>
          {testResult !== null && (
            <span className="text-muted-foreground text-xs">{testResult}</span>
          )}
        </div>
      </div>
      <ConfirmDialog
        title="Delete webhook?"
        warning="Senders will start receiving 404s. This cannot be undone."
        onConfirm={async () => {
          await api.removeWebhook(hook.id);
          await onDone();
        }}
      >
        <Button variant="ghost" size="icon" className="shrink-0" aria-label="Delete webhook">
          <Trash2Icon />
        </Button>
      </ConfirmDialog>
    </div>
  );
}

/** Creation form: a webhook needs a bot to deliver into (optional schema). */
function CreateWebhook({
  profiles,
  onCreated,
}: {
  profiles: ProfileInfo[];
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [name, setName] = useState("");
  const [schema, setSchema] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      let parsed: Record<string, unknown> | null = null;
      if (schema.trim() !== "") {
        parsed = JSON.parse(schema) as Record<string, unknown>;
      }
      await api.createWebhook({
        sessionId,
        ...(name.trim() !== "" ? { name: name.trim() } : {}),
        ...(parsed !== null ? { schema: parsed } : {}),
      });
      setName("");
      setSchema("");
      setOpen(false);
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (profiles.length === 0) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="xs" className="w-fit">
            <BellIcon /> New webhook
          </Button>
        }
      />
      <DialogContent>
        <DialogTitle>New inbound webhook</DialogTitle>
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (sessionId !== "" && !busy) void create();
          }}
        >
          <Select
            className="w-full"
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
            aria-label="Deliver into bot"
          >
            <option value="">Choose a bot…</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </Select>
          <Input
            aria-label="Webhook name (optional)"
            placeholder="Name (optional)"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <textarea
            aria-label="JSON Schema (optional)"
            className="bg-background min-h-20 rounded-lg border px-2 py-1.5 font-mono text-xs"
            placeholder='Expected format as JSON Schema (optional), e.g. {"type":"object","required":["event"]}'
            value={schema}
            onChange={(event) => setSchema(event.target.value)}
          />
          {error !== null && <p className="text-destructive text-xs">{error}</p>}
          <Button type="submit" size="sm" disabled={sessionId === "" || busy}>
            Create
          </Button>
          <p className="text-muted-foreground text-xs">
            After you create it, the list shows its URL and secret token. Bots never see the token.
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <SectionHeader title={title} />
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <EmptyState>{text}</EmptyState>;
}
