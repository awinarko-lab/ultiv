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

- **3 — Approval cards on the server** (M): persist approvals so they survive a
  reload; Allow once / Always allow (saves a rule) / Deny; expiry for
  background asks. Today a stopped turn leaves the card active.
- **2 — Live task updates** (M): replace the 3 s tasks poll with push; add an
  explicit Stop affordance in the composer (interrupt exists, visibility doesn't).

## Wave 3 — then (M/L)

- **1 — One chat per profile as the home screen** (M): profile switcher on top,
  Activity/Scheduled/Memory/Files as profile tabs; other panels move behind it.
- **9 — Activity view per task** (M): progress, files, results.
- **4 — Three outcomes for actions** (M): proceed / approve / "you do it"
  (Take over button).
- **11 — First-run onboarding** (M): template bots, "what can this bot do"
  checklist, suggestion chips under an empty chat.
- **10 — Memory view per profile** (M): per-item edit/delete + artifacts shelf
  (fix "(unknown)" attachment names first).
- **12 — Phone-first layout** (L): bottom tab bar, large targets, no
  hover-only controls — the UI is usually reached over Tailscale from a phone.

Basics to fold in continuously (8): dark mode, Cmd-K palette, streaming with
stable keys, a11y labels, empty/loading states.
