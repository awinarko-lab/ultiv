/** The task's brief, folded to a two-line preview; tap to read it all. */
import { useId, useState } from "react";
import { ChevronDownIcon, FileTextIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function BriefRow({ brief }: { brief: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="bg-muted/40 rounded-xl">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="focus-visible:ring-ring/50 flex min-h-11 w-full cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2.5 text-left outline-none focus-visible:ring-3"
      >
        <FileTextIcon aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium">Task brief</span>
          <span
            id={id}
            className={cn(
              "text-muted-foreground mt-0.5 block text-sm break-words whitespace-pre-wrap",
              !open && "line-clamp-2",
            )}
          >
            {brief}
          </span>
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
    </div>
  );
}
