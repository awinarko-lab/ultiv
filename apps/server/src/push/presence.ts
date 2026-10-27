/**
 * Is the owner looking at the app right now? Each open tab reports its own
 * visibility (on change and every ~30s while visible) under a random tab id.
 * A report older than the window counts as away, so a closed laptop or a
 * killed tab does not silence pushes forever.
 */
export interface Presence {
  readonly report: (owner: string, tab: string, visible: boolean) => void;
  readonly isVisible: (owner: string) => boolean;
}

export const PRESENCE_WINDOW_MS = 75_000;
/** Tabs tracked per owner; a flood of ids cannot grow memory without bound. */
const MAX_TABS = 20;

export const makePresence = (now: () => number = Date.now): Presence => {
  const seen = new Map<string, Map<string, number>>();
  return {
    report: (owner, tab, visible) => {
      const tabs = seen.get(owner) ?? new Map<string, number>();
      tabs.delete(tab);
      if (visible) tabs.set(tab, now());
      while (tabs.size > MAX_TABS) tabs.delete(tabs.keys().next().value ?? "");
      seen.set(owner, tabs);
    },
    isVisible: (owner) => {
      const tabs = seen.get(owner);
      if (tabs === undefined) return false;
      const cutoff = now() - PRESENCE_WINDOW_MS;
      return [...tabs.values()].some((at) => at > cutoff);
    },
  };
};
