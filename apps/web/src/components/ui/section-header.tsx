import { cn } from "@/lib/utils";

/** The one in-page heading style: a short title with an optional action on the right. */
export function SectionHeader({
  title,
  action,
  className,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-8 items-center justify-between gap-2", className)}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {action}
    </div>
  );
}
