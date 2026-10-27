/**
 * The one approval card: a tool call waiting on the owner, shown inline in the
 * chat (and in a background task's activity). A plain one-line summary, the
 * risk as icon + words, the raw input behind "Details", and Deny / Approve as
 * the main choices; "Always allow" and "Take over" sit in the overflow menu.
 * Buttons lock while a decision is in flight; a failed one can be retried.
 */
import { Menu } from "@base-ui/react/menu";
import { ChevronRightIcon, EllipsisIcon, ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { cn } from "@/lib/utils";

/** Tools that reach outside the conversation (delete/send/pay/publish). */
const RISKY_TOOL =
  /delete|remove|purge|drop|send|post|email|tweet|publish|pay|transfer|archive|overwrite/i;

/** Input fields worth quoting in the summary, most telling first. */
const HINT_KEYS = ["to", "url", "subject", "title", "path", "name", "query", "command", "text"];

export type Decide = (
  callId: string,
  approved: boolean,
  always?: boolean,
  takeover?: boolean,
) => Promise<void>;

/** "schedule_set" -> "schedule set"; camelCase too. */
const humanize = (tool: string): string =>
  tool
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .trim()
    .toLowerCase();

function hintOf(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const record = input as Record<string, unknown>;
  for (const key of HINT_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") {
      const flat = value.replace(/\s+/g, " ").trim();
      return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat;
    }
  }
  return null;
}

export function ApprovalCard({
  name,
  input,
  who,
  onDecide,
}: {
  /** The tool's name. */
  name: string;
  input: unknown;
  /** Who is asking ("Eve"); defaults to "Your bot". */
  who?: string | undefined;
  onDecide: (approved: boolean, always?: boolean, takeover?: boolean) => Promise<void>;
}) {
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const risky = RISKY_TOOL.test(name);
  const hint = hintOf(input);
  const RiskIcon = risky ? ShieldAlertIcon : ShieldCheckIcon;

  const decide = async (label: string, run: () => Promise<void>): Promise<void> => {
    setDeciding(label);
    setError(null);
    try {
      await run();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeciding(null);
    }
  };
  const busy = deciding !== null;
  const label = (key: string, text: string): string => (deciding === key ? "Sending…" : text);
  const item =
    "data-highlighted:bg-muted flex cursor-pointer flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-sm outline-none";

  return (
    <div
      role="group"
      aria-label="Approval needed"
      className={cn(
        "bg-card flex w-full flex-col gap-2 rounded-xl border p-3",
        risky ? "border-destructive/60" : "border-ring/60",
      )}
    >
      <p className="text-sm font-medium">
        {who ?? "Your bot"} wants to {humanize(name)}
        {hint !== null && <span className="text-muted-foreground font-normal">: {hint}</span>}
      </p>
      <p
        className={cn(
          "flex items-center gap-1.5 text-xs",
          risky ? "text-destructive" : "text-muted-foreground",
        )}
      >
        <RiskIcon className="size-3.5 shrink-0" aria-hidden />
        {risky
          ? "Higher risk: this reaches outside the chat and may not be undoable."
          : "Lower risk: nothing leaves the chat without another check."}
      </p>
      <button
        type="button"
        aria-expanded={details}
        onClick={() => setDetails((open) => !open)}
        className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer items-center gap-1 text-xs"
      >
        <ChevronRightIcon className={cn("size-3.5 transition-transform", details && "rotate-90")} />
        Details
      </button>
      {details && (
        <CodeBlock size="sm">
          <CodeBlockContent wrap className="max-h-48 overflow-y-auto">
            {`${name}\n${JSON.stringify(input, null, 2)}`}
          </CodeBlockContent>
        </CodeBlock>
      )}
      {error !== null && (
        <p className="text-destructive text-xs" role="alert">
          Decision not sent: {error}. Try again.
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Menu.Root>
          <Menu.Trigger
            render={
              <Button size="icon-sm" variant="ghost" disabled={busy} aria-label="More choices" />
            }
          >
            <EllipsisIcon />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="top" align="end" sideOffset={6} className="z-50">
              <Menu.Popup className="bg-popover text-popover-foreground w-64 rounded-xl border p-1 shadow-lg outline-none">
                <Menu.Item
                  className={item}
                  onClick={() => void decide("always", () => onDecide(true, true))}
                >
                  Always allow
                  <span className="text-muted-foreground text-xs">
                    Approve now and stop asking about {humanize(name)}.
                  </span>
                </Menu.Item>
                <Menu.Item
                  className={item}
                  onClick={() => void decide("takeover", () => onDecide(false, undefined, true))}
                >
                  Take over
                  <span className="text-muted-foreground text-xs">
                    Decline and tell the bot you'll do it yourself.
                  </span>
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void decide("deny", () => onDecide(false))}
        >
          {label("deny", "Deny")}
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => void decide("approve", () => onDecide(true))}
        >
          {label(
            "approve",
            deciding === "always" || deciding === "takeover" ? "Sending…" : "Approve",
          )}
        </Button>
      </div>
    </div>
  );
}
