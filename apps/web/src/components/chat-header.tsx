/**
 * The slim chat bar: a round back button, the bot as a centred avatar+name
 * pill, and a round "…" that opens the session details (model, effort, spend,
 * connection). Details live in the popover so the messages get the room.
 */
import { Popover } from "@base-ui/react/popover";
import { ChevronLeftIcon, EllipsisIcon } from "lucide-react";
import type { ModelInfo, ThinkingLevel, UsageSummary } from "@ultiv/contracts";
import { Button } from "@/components/ui/button";

export type LinkState = "connecting" | "live" | "lost";

/** Who the chat is with — names the header, the composer and the empty state. */
export interface ChatBot {
  name: string;
  description: string;
}

const linkLabel = { connecting: "Connecting…", live: "Connected", lost: "Disconnected" } as const;

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter((part) => part !== "")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

/** A round initials avatar (no images are stored for bots). */
export function BotAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const box =
    size === "sm" ? "size-5 text-[9px]" : size === "lg" ? "size-14 text-lg" : "size-7 text-[11px]";
  return (
    <span
      aria-hidden
      className={`bg-primary text-primary-foreground inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${box}`}
    >
      {initialsOf(name)}
    </span>
  );
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Model and effort selection, this session's spend and the link state. */
function SessionDetails({
  link,
  usage,
  model,
  effort,
  models,
  onConfigure,
}: {
  link: LinkState;
  usage: UsageSummary | null;
  model: string | null;
  effort: ThinkingLevel | null;
  models: ModelInfo[];
  onConfigure: (model: string | null, effort: ThinkingLevel | null) => void;
}) {
  const selected = models.find((candidate) => candidate.id === model);
  const efforts = selected?.efforts ?? (["off", "low", "high", "max"] as const);
  const select = "bg-background w-full min-w-0 rounded-md border px-2 py-1.5 text-sm";
  return (
    <div className="flex flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">Model</span>
        <select
          className={select}
          value={model ?? ""}
          onChange={(event) =>
            onConfigure(event.target.value === "" ? null : event.target.value, null)
          }
        >
          <option value="">Default model</option>
          {models.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">Effort</span>
        <select
          className={select}
          value={effort ?? ""}
          onChange={(event) =>
            onConfigure(
              model,
              event.target.value === "" ? null : (event.target.value as ThinkingLevel),
            )
          }
        >
          <option value="">Default effort</option>
          {efforts.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>
      {usage !== null && (
        <p className="text-muted-foreground text-xs">
          {formatTokens(usage.totalTokens)} tokens · {formatTokens(usage.input)} in ·{" "}
          {formatTokens(usage.output)} out
        </p>
      )}
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <span
          className={`size-2 rounded-full ${link === "live" ? "bg-emerald-500" : link === "lost" ? "bg-destructive" : "bg-muted-foreground"}`}
        />
        {linkLabel[link]}
      </p>
    </div>
  );
}

export function ChatHeader({
  bot,
  link,
  onBack,
  usage,
  model,
  effort,
  models,
  onConfigure,
}: {
  bot?: ChatBot | undefined;
  link: LinkState;
  onBack?: (() => void) | undefined;
  usage: UsageSummary | null;
  model: string | null;
  effort: ThinkingLevel | null;
  models: ModelInfo[];
  onConfigure: (model: string | null, effort: ThinkingLevel | null) => void;
}) {
  const name = bot?.name !== undefined && bot.name !== "" ? bot.name : "Chat";
  const round = "bg-muted/60 hover:bg-muted rounded-full";
  return (
    <header className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center gap-2">
      {onBack !== undefined ? (
        <Button variant="ghost" size="icon-lg" className={round} aria-label="Back" onClick={onBack}>
          <ChevronLeftIcon />
        </Button>
      ) : (
        <span />
      )}
      <div className="flex min-w-0 justify-center">
        <div className="bg-muted/60 flex max-w-full min-w-0 items-center gap-2 rounded-full py-1 pr-3.5 pl-1">
          <BotAvatar name={name} />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-medium">{name}</span>
            {link !== "live" && (
              <span
                className={`text-[11px] ${link === "lost" ? "text-destructive" : "text-muted-foreground"}`}
              >
                {linkLabel[link]}
              </span>
            )}
          </span>
        </div>
      </div>
      <Popover.Root>
        <Popover.Trigger
          render={
            <Button variant="ghost" size="icon-lg" className={round} aria-label="Chat details">
              <EllipsisIcon />
            </Button>
          }
        />
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
            <Popover.Popup className="bg-popover text-popover-foreground w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border p-4 shadow-lg outline-none">
              <SessionDetails
                link={link}
                usage={usage}
                model={model}
                effort={effort}
                models={models}
                onConfigure={onConfigure}
              />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </header>
  );
}
