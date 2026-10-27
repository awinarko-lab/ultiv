import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** A collapsed "Details" toggle for developer-level facts behind plain copy. */
export function DevDetails({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("text-muted-foreground text-xs", className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="hover:text-foreground flex cursor-pointer items-center gap-1"
      >
        <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        Details
      </button>
      {open && <div className="mt-1 pl-4.5">{children}</div>}
    </div>
  );
}
