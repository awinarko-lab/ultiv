/**
 * The bots panel: create (with full identity onboarding), edit identity and
 * model preference, set-main, delete — the "profile" surfaced as what it is,
 * a bot. Creation sends name/description/persona/model; the server seeds the
 * bot's first main-chat turn from those details.
 */
import { BotIcon, PencilIcon, StarIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
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
}: {
  title: string;
  initial: BotForm;
  models: ModelInfo[];
  confirm: (form: BotForm) => Promise<void>;
  children: React.ReactElement;
}) {
  const [form, setForm] = useState<BotForm>(initial);
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
    } catch (cause) {
      setError(String((cause as Error).message ?? cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog>
      <DialogTrigger render={children} />
      <DialogContent>
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="mt-4 flex flex-col gap-3">
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
            <label className="flex flex-1 flex-col gap-1 text-sm">
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
            <DialogClose
              render={
                <Button
                  variant="default"
                  disabled={busy || form.name.trim() === ""}
                  onClick={() => void submit()}
                />
              }
            >
              {busy ? "Working…" : "Save"}
            </DialogClose>
          </div>
          <p className="text-muted-foreground text-xs">
            A new bot introduces itself in its main chat from these details; the persona applies to
            its existing chats too (sections re-render per request). The model choice becomes the
            bot's durable default across its chats.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function BotsPanel({
  profiles,
  models,
  mainId,
  refresh,
  onOpenMain,
}: {
  profiles: ProfileInfo[];
  models: ModelInfo[];
  mainId: string | null;
  refresh: () => Promise<void>;
  onOpenMain: (profileId: string) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);

  const act = async (run: () => Promise<unknown>): Promise<void> => {
    try {
      await run();
      setError(null);
      await refresh();
    } catch (cause) {
      const message = await (cause as Response).text?.().catch(() => null);
      setError(message ?? String((cause as Error).message ?? cause));
    }
  };

  const modelPayload = (form: BotForm) =>
    form.modelId === ""
      ? { model: null }
      : {
          model: {
            id: form.modelId,
            ...(form.effort !== "" ? { effort: form.effort } : {}),
          },
        };

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
            await api.createProfile({
              name: form.name.trim(),
              ...(form.description !== "" ? { description: form.description } : {}),
              ...(form.persona !== "" ? { persona: form.persona } : {}),
              ...modelPayload(form),
            });
          }}
        >
          <Button variant="outline" size="sm">
            New bot
          </Button>
        </BotDialog>
      </CardHeader>
      {error !== null && <CardContent className="text-destructive text-sm">{error}</CardContent>}
      {profiles.length > 0 && (
        <CardContent className="flex flex-col gap-1">
          {profiles.map((bot, index) => (
            <div key={bot.id} className="contents">
              {index > 0 && <Separator className="my-1" />}
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  className="min-w-0 flex-1 justify-start"
                  onClick={() => void onOpenMain(bot.id)}
                >
                  <span className="truncate font-medium">{bot.name}</span>
                  {bot.id === mainId && <Badge variant="secondary">main</Badge>}
                  {bot.archivedAt !== null && <Badge variant="outline">archived</Badge>}
                  {bot.model !== null && <Badge variant="outline">{bot.model.id}</Badge>}
                  {bot.description !== "" && (
                    <span className="text-muted-foreground truncate text-xs">
                      {bot.description}
                    </span>
                  )}
                </Button>
                {bot.id !== mainId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Make ${bot.name} the main bot`}
                    onClick={() => void act(() => api.setMain(bot.id))}
                  >
                    <StarIcon />
                  </Button>
                )}
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
                  <Button variant="ghost" size="icon" aria-label={`Edit ${bot.name}`}>
                    <PencilIcon />
                  </Button>
                </BotDialog>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${bot.name}`}
                  disabled={bot.id === mainId || profiles.length <= 1}
                  onClick={() => void act(() => api.deleteProfile(bot.id))}
                >
                  <Trash2Icon />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
