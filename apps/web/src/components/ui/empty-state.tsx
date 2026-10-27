import { CircleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** "Nothing here yet" with an optional hint of how something gets here. */
export function EmptyState({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <p className={cn("text-muted-foreground text-sm", className)}>{children}</p>;
}

/** A load that failed: say so plainly and offer a retry (never an empty list). */
export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <p role="alert" className={cn("text-destructive flex items-center gap-2 text-sm", className)}>
      <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0">{message}</span>
      {onRetry !== undefined && (
        <Button variant="outline" size="xs" onClick={onRetry}>
          Retry
        </Button>
      )}
    </p>
  );
}
