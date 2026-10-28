/**
 * The bot form: name, role, personality and model, used to create a bot (from
 * the Bots page or the switcher) and to edit one. On phones the selects stack
 * and Save spans the sheet.
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-state";
import type { ModelInfo, ProfileApprovalMode, ProfileInfo } from "@ultiv/contracts";

export interface BotForm {
  name: string;
  description: string;
  persona: string;
  /** "" = workspace default model. */
  modelId: string;
  effort: string;
  /** Who answers the bot's gated tool calls. */
  approvalMode: ProfileApprovalMode;
}

export const emptyForm: BotForm = {
  name: "",
  description: "",
  persona: "",
  modelId: "",
  effort: "",
  approvalMode: "manual",
};

/** The approval modes and their labels (shared by the edit dialog and the chat details). */
export const APPROVAL_MODE_OPTIONS: readonly {
  value: ProfileApprovalMode;
  label: string;
}[] = [
  { value: "manual", label: "Manual — ask me" },
  { value: "jev", label: "Jev decides" },
  { value: "yolo", label: "Fully automatic" },
];

/** Model and effort: side by side only when both selects have room for their labels. */
function ModelFields({
  form,
  setForm,
  models,
}: {
  form: BotForm;
  setForm: (form: BotForm) => void;
  models: ModelInfo[];
}) {
  const efforts = useMemo(
    () => models.find((model) => model.id === form.modelId)?.efforts ?? [],
    [models, form.modelId],
  );
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:gap-2">
      <label className="flex flex-1 flex-col gap-1 text-sm">
        Model
        <Select
          className="w-full"
          value={form.modelId}
          onChange={(event) => setForm({ ...form, modelId: event.target.value, effort: "" })}
        >
          <option value="">Workspace default</option>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </Select>
      </label>
      <label
        className="flex flex-1 flex-col gap-1 text-sm"
        title={efforts.length === 0 ? "Pick a model with effort levels first" : undefined}
      >
        Effort
        <Select
          className="w-full"
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
        </Select>
      </label>
    </div>
  );
}

/** Save (full width on phones) and what saving changes. */
function SaveRow({ busy, unnamed }: { busy: boolean; unnamed: boolean }) {
  return (
    <>
      <div className="flex justify-end gap-2">
        {/* Disabled buttons swallow hover, so the reason sits on a wrapper. */}
        <span
          className="w-full sm:w-auto"
          title={unnamed ? "Give the bot a name first" : undefined}
        >
          <Button type="submit" className="w-full sm:w-auto" disabled={busy || unnamed}>
            {busy ? "Working…" : "Save"}
          </Button>
        </span>
      </div>
      <p className="text-muted-foreground text-xs">
        A new bot introduces itself in its main chat. Changes to the role, personality and model
        apply to all of this bot's chats from the next message.
      </p>
    </>
  );
}

export function BotDialog({
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
  children?: React.ReactElement | undefined;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
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
        <DialogTitle>{title}</DialogTitle>
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
            Personality and instructions
            <Textarea
              rows={6}
              value={form.persona}
              onChange={(event) => setForm({ ...form, persona: event.target.value })}
              placeholder={"You are meticulous. You check rather than guess…"}
            />
          </label>
          <ModelFields form={form} setForm={setForm} models={models} />
          <label className="flex flex-col gap-1 text-sm">
            Approval mode
            <Select
              className="w-full"
              value={form.approvalMode}
              onChange={(event) =>
                setForm({ ...form, approvalMode: event.target.value as ProfileApprovalMode })
              }
            >
              {APPROVAL_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <span className="text-muted-foreground text-xs">
              Who answers when the bot wants to act: you each time, its own judgment, or nobody.
            </span>
          </label>
          {error !== null && <p className="text-destructive text-sm">{error}</p>}
          <SaveRow busy={busy} unnamed={form.name.trim() === ""} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Create a bot from the form; resolves to its id. */
export const createBot = async (form: BotForm): Promise<string> =>
  (
    await api.createProfile({
      name: form.name.trim(),
      ...(form.description !== "" ? { description: form.description } : {}),
      ...(form.persona !== "" ? { persona: form.persona } : {}),
      ...modelPayload(form),
      // The default needs no key; a delegated mode rides the per-key merge.
      ...(form.approvalMode !== "manual" ? { policies: { approvalMode: form.approvalMode } } : {}),
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

export function modelPayload(form: BotForm) {
  return form.modelId === ""
    ? { model: null }
    : {
        model: {
          id: form.modelId,
          ...(form.effort !== "" ? { effort: form.effort } : {}),
        },
      };
}

/** Edit an existing bot; refreshes the list after a save. */
export function EditBotDialog({
  bot,
  models,
  open,
  onOpenChange,
  refresh,
}: {
  bot: ProfileInfo;
  models: ModelInfo[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refresh: () => Promise<void>;
}) {
  return (
    <BotDialog
      title={`Edit ${bot.name}`}
      models={models}
      open={open}
      onOpenChange={onOpenChange}
      initial={{
        name: bot.name,
        description: bot.description,
        persona: bot.persona,
        modelId: bot.model?.id ?? "",
        effort: bot.model?.effort ?? "",
        approvalMode: bot.policies.approvalMode,
      }}
      confirm={async (form) => {
        // Throws on failure, so the form stays open with the reason.
        await api.updateProfile(bot.id, {
          name: form.name.trim(),
          // Always sent on edit, so an emptied field clears.
          description: form.description,
          persona: form.persona,
          ...modelPayload(form),
          // Per-key merge server-side: only the mode key changes.
          policies: { approvalMode: form.approvalMode },
        });
        await refresh();
      }}
    />
  );
}
