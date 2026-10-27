/**
 * The bots panel: create (with full identity onboarding), edit identity and
 * model preference, set-main, hide (archive) and delete (typed confirm) —
 * the "profile" surfaced as what it is, a bot. Creation sends
 * name/description/persona/model; the server seeds the bot's first main-chat
 * turn from those details. Hiding is the safe option: reversible, and it only
 * moves the bot under "Hidden". Delete purges everything and asks for the name.
 */
import {
  BotIcon,
  BrainIcon,
  EyeIcon,
  EyeOffIcon,
  PencilIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MemoryPanel } from "@/components/memory-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-state";
import type { ModelInfo, ProfileInfo } from "@ultiv/contracts";

interface BotForm {
  name: string;
  description: string;
  persona: string;
  /** "" = workspace default model. */
  modelId: string;
  effort: string;
}

const emptyForm: BotForm = { name: "", description: "", persona: "", modelId: "", effort: "" };

function BotDialog({
  title,
  initial,
  models,
  confirm,
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  title: string;
  initial: BotForm;
  models: ModelInfo[];
  confirm: (form: BotForm) => Promise<void>;
  /** The trigger; omit it and drive `open` instead. */
  children?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [form, setForm] = useState<BotForm>(initial);
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (next: boolean): void => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const efforts = useMemo(
    () => models.find((model) => model.id === form.modelId)?.efforts ?? [],
    [models, form.modelId],
  );
  const submit = async (): Promise<void> => {
    if (form.name.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await confirm(form);
      setOpen(false);
    } catch (cause) {
      // Stay open — the error must be readable against the draft.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      {children !== undefined && <DialogTrigger render={children} />}
      <DialogContent>
        <h2 className="text-lg font-semibold">{title}</h2>
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            Name
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Robinson"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Role / description
            <Input
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="Research assistant for the workspace"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Identity &amp; persona (free text — becomes who they are)
            <Textarea
              rows={6}
              value={form.persona}
              onChange={(event) => setForm({ ...form, persona: event.target.value })}
              placeholder={"You are meticulous. You check rather than guess…"}
            />
          </label>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Model
              <select
                className="bg-background rounded-md border px-2 py-2 text-sm"
                value={form.modelId}
                onChange={(event) => setForm({ ...form, modelId: event.target.value, effort: "" })}
              >
                <option value="">Workspace default</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="flex flex-1 flex-col gap-1 text-sm"
              title={efforts.length === 0 ? "Pick a model with effort levels first" : undefined}
            >
              Effort
              <select
                className="bg-background rounded-md border px-2 py-2 text-sm"
                value={form.effort}
                disabled={efforts.length === 0}
                onChange={(event) => setForm({ ...form, effort: event.target.value })}
              >
                <option value="">Model default</option>
                {efforts.map((effort) => (
                  <option key={effort} value={effort}>
                    {effort}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error !== null && <p className="text-destructive text-sm">{error}</p>}
          <div className="flex justify-end gap-2">
            {/* Disabled buttons swallow hover, so the reason sits on a wrapper. */}
            <span title={form.name.trim() === "" ? "Give the bot a name first" : undefined}>
              <Button type="submit" variant="default" disabled={busy || form.name.trim() === ""}>
                {busy ? "Working…" : "Save"}
              </Button>
            </span>
          </div>
          <p className="text-muted-foreground text-xs">
            A new bot introduces itself in its main chat from these details; the persona applies to
            its existing chats too (sections re-render per request). The model choice becomes the
            bot's durable default across its chats.
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One bot's row: open main chat, set-main, edit, hide, delete. */
function BotRow({
  bot,
  active,
  mainId,
  deletable,
  needsYou,
  models,
  act,
  refresh,
  onOpenMain,
}: {
  bot: ProfileInfo;
  /** The bot whose chat is on screen — highlighted. */
  active: boolean;
  mainId: string | null;
  deletable: boolean;
  needsYou: boolean;
  models: ModelInfo[];
  act: (run: () => Promise<unknown>) => Promise<void>;
  refresh: () => Promise<void>;
  onOpenMain: (profileId: string) => void;
}) {
  const archived = bot.archivedAt !== null;
  // Mirrors the server's 409s, so the reason shows before the click.
  const deleteBlocked = !deletable
    ? "You need at least one bot"
    : bot.id === mainId
      ? "The main bot can't be removed — make another bot main first"
      : null;
  // Two-line row: the name opens the bot's main chat; the actions live under
  // the name, so they never fight the text for width. The row is its own
  // container: secondary info yields before anything overlaps.
  return (
    <div
      className={
        archived ? "@container flex flex-col gap-1 opacity-60" : "@container flex flex-col gap-1"
      }
    >
      <Button
        variant={active ? "secondary" : "ghost"}
        className="min-w-0 flex-1 justify-start"
        aria-current={active ? "true" : undefined}
        onClick={() => void onOpenMain(bot.id)}
      >
        <span className="truncate font-medium">{bot.name}</span>
        {needsYou && <Badge variant="destructive">needs you</Badge>}
        {bot.id === mainId && <Badge variant="secondary">main</Badge>}
        {archived && <Badge variant="outline">hidden</Badge>}
        {bot.model !== null && (
          <Badge variant="outline" className="hidden max-w-28 truncate @[320px]:inline-flex">
            {bot.model.id}
          </Badge>
        )}
        {bot.description !== "" && (
          <span className="text-muted-foreground hidden min-w-0 truncate text-xs @[440px]:inline">
            {bot.description}
          </span>
        )}
      </Button>
      <div className="flex items-center gap-0.5 pl-2">
        {bot.id !== mainId && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={`Make ${bot.name} the main bot`}
            onClick={() => void act(() => api.setMain(bot.id))}
          >
            <StarIcon />
          </Button>
        )}
        <MemoryPanel profileId={bot.id} name={bot.name}>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={`What ${bot.name} remembers`}
          >
            <BrainIcon />
          </Button>
        </MemoryPanel>
        <BotDialog
          title={`Edit ${bot.name}`}
          models={models}
          initial={{
            name: bot.name,
            description: bot.description,
            persona: bot.persona,
            modelId: bot.model?.id ?? "",
            effort: bot.model?.effort ?? "",
          }}
          confirm={async (form) => {
            await api.updateProfile(bot.id, {
              name: form.name.trim(),
              ...(form.description !== "" ? { description: form.description } : {}),
              ...(form.persona !== "" ? { persona: form.persona } : {}),
              ...modelPayload(form),
            });
          }}
        >
          <Button variant="ghost" size="icon" className="shrink-0" aria-label={`Edit ${bot.name}`}>
            <PencilIcon />
          </Button>
        </BotDialog>
        {bot.id !== mainId && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={archived ? `Unhide ${bot.name}` : `Hide ${bot.name}`}
            onClick={() =>
              void act(() => (archived ? api.unarchiveProfile(bot.id) : api.archiveProfile(bot.id)))
            }
          >
            {archived ? <EyeIcon /> : <EyeOffIcon />}
          </Button>
        )}
        {deleteBlocked !== null ? (
          <span title={deleteBlocked}>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label={`Remove ${bot.name} (${deleteBlocked})`}
              disabled
            >
              <Trash2Icon />
            </Button>
          </span>
        ) : (
          <ConfirmDialog
            title={`Delete ${bot.name}?`}
            warning="This permanently removes the bot with all of their chats, memory and artifacts. It cannot be undone."
            typed={bot.name}
            confirmLabel="Delete bot"
            onConfirm={async () => {
              await api.deleteProfile(bot.id);
              await refresh();
            }}
          >
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label={`Remove ${bot.name}`}
            >
              <Trash2Icon />
            </Button>
          </ConfirmDialog>
        )}
      </div>
    </div>
  );
}

/** Create a bot from the form; resolves to its id. */
const createBot = async (form: BotForm): Promise<string> =>
  (
    await api.createProfile({
      name: form.name.trim(),
      ...(form.description !== "" ? { description: form.description } : {}),
      ...(form.persona !== "" ? { persona: form.persona } : {}),
      ...modelPayload(form),
    })
  ).id;

/** "New bot" without a trigger of its own (the bot switcher drives it). */
export function NewBotDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const { sessions } = useApp();
  return (
    <BotDialog
      title="New bot"
      initial={emptyForm}
      models={sessions.models}
      open={open}
      onOpenChange={onOpenChange}
      confirm={async (form) => {
        await onCreated(await createBot(form));
      }}
    />
  );
}

function modelPayload(form: BotForm) {
  return form.modelId === ""
    ? { model: null }
    : {
        model: {
          id: form.modelId,
          ...(form.effort !== "" ? { effort: form.effort } : {}),
        },
      };
}

export function BotsPanel({
  profiles,
  models,
  activeId,
  mainId,
  refresh,
  onOpenMain,
}: {
  profiles: ProfileInfo[];
  models: ModelInfo[];
  /** The bot whose chat is on screen (null = none). */
  activeId: string | null;
  mainId: string | null;
  refresh: () => Promise<void>;
  onOpenMain: (profileId: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // Which bots have a gate waiting on the owner (polled app-wide).
  const { attention } = useApp();

  const act = async (run: () => Promise<unknown>): Promise<void> => {
    try {
      await run();
      setError(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  // Hidden bots sort to the bottom under their own label — out of the way,
  // never out of reach.
  const ordered = [...profiles].sort(
    (a, b) => (a.archivedAt === null ? 0 : 1) - (b.archivedAt === null ? 0 : 1),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BotIcon /> Bots
        </CardTitle>
        <BotDialog
          title="Spawn a bot"
          initial={emptyForm}
          models={models}
          confirm={async (form) => {
            await createBot(form);
            await refresh();
          }}
        >
          <Button variant="outline" size="sm">
            New bot
          </Button>
        </BotDialog>
      </CardHeader>
      {error !== null && <CardContent className="text-destructive text-sm">{error}</CardContent>}
      {ordered.length > 0 && (
        <CardContent className="flex flex-col gap-1">
          {ordered.map((bot, index) => (
            <div key={bot.id} className="contents">
              {index > 0 && <Separator className="my-1" />}
              {bot.archivedAt !== null && ordered[index - 1]?.archivedAt === null && (
                <p className="text-muted-foreground mt-2 text-xs font-semibold uppercase">Hidden</p>
              )}
              <BotRow
                bot={bot}
                active={bot.id === activeId}
                mainId={mainId}
                deletable={ordered.length > 1}
                needsYou={attention.has(bot.id)}
                models={models}
                act={act}
                refresh={refresh}
                onOpenMain={onOpenMain}
              />
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
