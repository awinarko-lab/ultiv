/** Small pieces the Connectors screen shares: status dot, switches, chips, secret rows. */
import { PlusIcon, XIcon } from "lucide-react";
import type { McpState, VaultItemInfo } from "@ultiv/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { stateTone, type SecretRow } from "@/lib/connector-text";
import { cn } from "@/lib/utils";

const TONE = {
  good: "bg-emerald-500",
  busy: "bg-amber-400 animate-pulse motion-reduce:animate-none",
  warn: "bg-amber-500",
  bad: "bg-destructive",
  off: "bg-muted-foreground/40",
} as const;

export function StatusDot({ state }: { state: McpState }) {
  return (
    <span aria-hidden className={cn("size-2 shrink-0 rounded-full", TONE[stateTone(state)])} />
  );
}

/** A full-width 44px switch row: label, optional hint, a checkbox on the right. */
export function ToggleRow(props: {
  label: string;
  hint?: string | undefined;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "hover:bg-muted/60 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm",
        props.disabled === true && "cursor-default opacity-60",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span>{props.label}</span>
        {props.hint !== undefined && (
          <span className="text-muted-foreground text-xs">{props.hint}</span>
        )}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span
        aria-hidden
        className="bg-input peer-checked:bg-primary peer-focus-visible:ring-ring/50 relative h-6 w-10 shrink-0 rounded-full transition-colors peer-focus-visible:ring-3 motion-reduce:transition-none dark:bg-input/80 peer-checked:*:translate-x-4"
      >
        <span className="bg-background absolute top-0.5 left-0.5 size-5 rounded-full shadow-sm transition-transform motion-reduce:transition-none" />
      </span>
    </label>
  );
}

export function Chip(props: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center rounded-lg border px-3 text-sm select-none",
        props.checked ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground",
      )}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      {props.label}
    </label>
  );
}

/** Header or env rows whose values come from vault items (never typed here). */
export function SecretRows(props: {
  rows: SecretRow[];
  onChange: (rows: SecretRow[]) => void;
  items: VaultItemInfo[];
  namePlaceholder: string;
  addLabel: string;
  withPrefix: boolean;
}) {
  const set = (index: number, patch: Partial<SecretRow>): void =>
    props.onChange(props.rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  return (
    <div className="flex flex-col gap-2">
      {props.rows.map((row, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
          <Input
            className="min-w-28 flex-1"
            aria-label="Name"
            placeholder={props.namePlaceholder}
            value={row.name}
            onChange={(event) => set(index, { name: event.target.value })}
          />
          {props.withPrefix && (
            <Input
              className="w-24"
              aria-label="Value prefix"
              placeholder="Prefix"
              value={row.prefix}
              onChange={(event) => set(index, { prefix: event.target.value })}
            />
          )}
          <Select
            aria-label="Vault item"
            className="min-w-40 flex-[2]"
            value={row.item}
            onChange={(event) => set(index, { item: event.target.value })}
          >
            <option value="">Pick a vault item…</option>
            {props.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.masked})
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remove row"
            onClick={() => props.onChange(props.rows.filter((_, at) => at !== index))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() =>
          props.onChange([
            ...props.rows,
            { name: "", item: "", prefix: props.withPrefix ? "Bearer " : "" },
          ])
        }
      >
        <PlusIcon />
        {props.addLabel}
      </Button>
      {props.items.length === 0 && (
        <p className="text-muted-foreground text-xs">
          Save the key in the Vault first (as a Key or Note), then pick it here.
        </p>
      )}
    </div>
  );
}
