/**
 * Human times in one place. Dividers read "Today 5:46 PM" / "Yesterday …" /
 * "Oct 25 5:46 PM" (with the year only when it differs).
 */
const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const clock = (date: Date): string =>
  date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** A chat time divider: day word (or date) plus the clock time. */
export function formatDivider(at: number, now: Date = new Date()): string {
  const date = new Date(at);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, now)) return `Today ${clock(date)}`;
  if (sameDay(date, yesterday)) return `Yesterday ${clock(date)}`;
  const day = date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
  return `${day} ${clock(date)}`;
}

/** Full date and time, for tooltips. */
export const formatFull = (at: number): string => new Date(at).toLocaleString();
