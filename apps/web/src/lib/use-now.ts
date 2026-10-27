import { useEffect, useState } from "react";

/** The current time, re-read every `everyMs` while `active` (a live clock for elapsed times). */
export function useNow(everyMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs, active]);
  return now;
}
