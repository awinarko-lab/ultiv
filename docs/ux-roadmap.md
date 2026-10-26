# UX roadmap — patterns from the Grok Bot / Dots / Muse review

Source: external review (2026-10-26) comparing Cursor's Grok Bot, OpenAI's Dots
and Meta's Muse against our web app. Effort: S small, M medium, L large.

## Wave 1 — DONE (security-adjacent smalls)

| #   | Pattern                                        | Where                                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7   | Specific errors that keep your draft           | `lib/api.ts` — every REST failure now throws `ApiError` carrying the server's `{ error }` body; `DELETE` fails loudly instead of returning `false` (a 409 on the main/last bot used to read as success)                                                    |
| 5   | Warning labels on risky cards                  | `session-view.tsx` — approval cards for outside-reaching tools get a red border + "may not be reversible" warning                                                                                                                                          |
| 6   | Hide as the safe option; confirm before delete | `bots-panel.tsx` — hide/unhide via the archive routes, hidden bots sort under a "Hidden" label and leave the profile picker; bot delete, session delete and vault-item remove all go through `ConfirmDialog`; profile purge requires typing the bot's name |
| 8   | Vault never shows a value after saving         | `ext/vault.ts` — key masks reveal zero characters (the 2-char prefix leak is gone); vault panel shows `last used` metadata, fields clear after save                                                                                                        |

## Wave 2 — next (M)

- **3 — Approval cards on the server** (M): DONE for the chat surface —
  Allow once / Always allow / Deny; "Always allow" appends the tool to the
  bot's `policies.autoApprove` (contract v8, `approve {always}`); pending
  cards already survive reload (server-mirrored `pendingFor` cell); Stop now
  releases pending cards (each waiter denied) instead of leaving them active.
  Remaining: expiry tuning for background asks, and `always` support in the
  REST approval inbox.
- **2 — Sidebar badge** (S): DONE — bots with a pending approval show a
  destructive "needs you" badge (polls the owner-scoped
  `GET /api/approvals` inbox every 5 s; Hide landed in wave 1).
- **Push instead of poll** (M): still polling (3 s tasks, 5 s badge, 250 ms
  approvals in the session projection). Needs a push path (REST has none —
  chord replicated-object attach desyncs, so SSE/long-poll on REST is the
  option). The Stop affordance exists in the composer and tasks panel.

## Wave 3 — then (M/L)

- **1 — One chat per profile as the home screen** (M): profile switcher on top,
  Activity/Scheduled/Memory/Files as profile tabs; other panels move behind it.
- **9 — Activity view per task** (M): progress, files, results.
- **4 — Three outcomes for actions** (M): proceed / approve / "you do it"
  (Take over button).
- **11 — First-run onboarding** (M): template bots, "what can this bot do"
  checklist, suggestion chips under an empty chat.
- **10 — Memory view per profile** (M): DONE as a per-bot panel — "What X
  remembers" on every bot row: list / add / per-item forget (new
  `mind.memory.remove` + `DELETE /api/profiles/:id/memory/:recordId`) and an
  artifacts shelf with downloads. The review's "(unknown)" attachments turned
  out to be the prompt-side fallback for missing artifact ids in
  `session.ts` `withAttachments`, not a UI label — nothing to fix there.
  Remaining: fold the panel into profile tabs when pattern 1 lands.
- **12 — Phone-first layout** (L): bottom tab bar, large targets, no
  hover-only controls — the UI is usually reached over Tailscale from a phone.

Basics to fold in continuously (8): dark mode, Cmd-K palette, streaming with
stable keys, a11y labels, empty/loading states.
