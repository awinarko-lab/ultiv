import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A native select styled like Input: the OS picker on phones (big, familiar),
 * our look everywhere. className sizes the wrapper (w-full, flex-1, …).
 * Like Input, it grows to a 44px tap target on touch screens.
 */
export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div data-slot="select" className={cn("relative min-w-0", className)}>
      <select
        className="border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full min-w-0 cursor-pointer pointer-coarse:min-h-11 appearance-none rounded-lg border bg-transparent py-1 pr-8 pl-2.5 text-base outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2"
      />
    </div>
  );
}
