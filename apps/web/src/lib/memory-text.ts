/**
 * Every string the memory panel shows, hard-coded English, in one place
 * (the owner's app ships en-only; same pattern as the other *-text modules).
 */

export const panelTitle = (name: string): string => `What ${name} remembers`;

export const TABS = {
  facts: "Facts",
  people: "People & things",
  core: "Core",
  tidy: "Tidy",
  files: "Files",
} as const;

export const factsEmpty = (name: string): string =>
  `Nothing yet. Facts ${name} keeps about its work show up here, and you can edit or delete them.`;
export const addPlaceholder = (name: string): string => `Something ${name} should always know…`;
export const addLabel = (name: string): string => `Something ${name} should always know`;

export const forgetTitle = "Forget this?";
export const forgetWarning = (name: string): string =>
  `${name} will stop recalling it. It stays as a restorable tombstone until you purge.`;
export const forgetAria = (text: string): string => `Forget: ${text.slice(0, 40)}`;

export const coreIntro = "The few lines that sit in every prompt — always in context.";
export const coreEmpty = (name: string): string =>
  `Empty. Core lines are always in ${name}'s context, so keep them short and few.`;
export const coreAddLabel = "A core line";
export const coreAddPlaceholder = "A short line always in context…";
export const coreRemoveTitle = "Remove this core line?";
export const coreRemoveWarning =
  "The bot stops seeing it from its next turn. This cannot be undone.";
export const coreRemoveAria = (text: string): string => `Remove core line: ${text.slice(0, 40)}`;
export const pinnedLabel = "pinned";

export const tidyIntro = "The Sunday tidy proposes; nothing changes until you accept.";
export const tidyEmpty = "No suggestions right now.";
export const tidyOpenBadge = (count: number): string => `${count} open`;
export const tidyRunLabel = "Run tidy now";
export const purgeLabel = "Purge forgotten";
export const purgeTitle = "Purge forgotten facts?";
export const purgeWarning =
  "Every forgotten fact loses its text for good. Tombstones stay, but the words are gone. This cannot be undone.";

export const kvEmpty = (name: string): string =>
  `Nothing yet. ${name} notes what it has already done here, so it doesn't do it twice.`;
export const kvDeleteWarning = (name: string): string =>
  `${name} may redo work this marker was guarding against. This cannot be undone.`;

export const filesEmpty = "No files yet.";
export const downloadAria = (name: string): string => `Download ${name}`;

export const footer = (name: string): string =>
  `${name} reads this store plus your workspace-wide memory. Forgetting an item hides it until you purge; the workspace-wide store is editable from any bot's panel.`;
