/**
 * Messages waiting for the running turn, floated above the composer: each
 * says when it will reach the bot and has an × to take it back. A message the
 * turn already picked up simply drops out of the list.
 */
import type { QueuedInput } from "@ultiv/contracts";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { queueLabel } from "@/lib/queue-text";

export function QueuedChips({
  queued,
  approvalPending,
  onWithdraw,
}: {
  queued: readonly QueuedInput[];
  approvalPending: boolean;
  onWithdraw: (id: string) => void;
}) {
  if (queued.length === 0) return null;
  return (
    <ul
      aria-label="Queued messages"
      className="flex max-w-[85%] min-w-0 flex-col items-end gap-1.5 self-end"
    >
      {queued.map((item) => (
        <li
          key={item.id}
          className="bg-background/70 border-border/70 flex max-w-full items-center gap-1 rounded-2xl border py-1 pr-1 pl-3 text-sm shadow-sm backdrop-blur-md"
        >
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{item.text}</span>
            <span className="text-muted-foreground text-xs">
              {queueLabel(item.mode, approvalPending)}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 rounded-full pointer-coarse:size-11"
            aria-label={`Cancel queued message: ${item.text}`}
            title="Cancel"
            onClick={() => onWithdraw(item.id)}
          >
            <XIcon />
          </Button>
        </li>
      ))}
    </ul>
  );
}
