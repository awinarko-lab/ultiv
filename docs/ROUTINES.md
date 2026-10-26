# Routines — the durability and delivery contract

A **Routine** is anything that wakes an entity on its own: cron schedules,
inbound webhooks, and (planned) sensors. This document is the contract every
Routine shares. It exists because the worst failure in this space is one that
_looks like success_ — a trigger that never fired, a payload silently
dropped, a rotated key indistinguishable from a quiet day.

## What is durable

| Thing                                      | Durable?                                  | Where                                 |
| ------------------------------------------ | ----------------------------------------- | ------------------------------------- |
| Cron registry (`ultiv.cronjobs`) | yes | mind doc, re-armed on boot |
| Webhook registry (`ultiv.webhooks`) | yes | mind doc, v3 (schemas + counters) |
| Sensor registry + dedup rings (`ultiv.sensors`) | yes | mind doc |
| **Profile KV state** (`ultiv.kv.<profile>`) | yes | mind doc family |
| **Fire receipts** (`ultiv.routine-events`) | yes | mind doc, newest first, capped at 400 |
| Mailbox envelopes, dead-letters            | yes                                       | mind docs                             |
| Rate-limit token buckets                   | **no** (in-memory, restart resets)        | server process                        |
| Debounce windows                           | **no** (payloads already receipted first) | server process                        |

Agents may rely on the registry and the receipt log. They may NOT treat
"no state" as "never acted" — a wiped store and a first run are
indistinguishable from inside; the receipt log exists so they never have to
guess.

## Fire receipts (write-ahead)

Every fire writes a receipt BEFORE delivery is attempted, then settles it:

- `accepted` — durably recorded, delivery pending. **A receipt stuck here is
  a crash signature** (a visible incomplete pair), never silence.
- `delivered` — admitted into the session conversation (admission is the
  contract; a failed TURN afterwards is the transcript's problem).
- `failed` — delivery exhausted its retries (webhooks) or admission failed
  (cron, 3 consecutive → job disabled + audit escalation).
- `rejected` — ingress refused the call; `reason` is the class.

Lookup: `GET /api/routines/events?routine=<id>&source=cron|webhook|test&limit=N`.
Schedules expose `fireCount` / `lastFiredAt`; webhooks expose counters plus
`rejectsLast24h` via the receipt log. "Did it actually fire?" is a lookup.

## Webhooks — one-way, ack-then-process

The ingress answers the sender ONCE, fast, and honestly:

1. unknown id → `404`; wrong token → `401` (counted per webhook — a climbing
   `rejectedLast24h` with flat accepts is key rotation).
2. body over 64 KB → `413`.
3. rate limit (30/min default, `WEBHOOK_RATE_PER_MIN`) → `429` +
   `retryAfterS`.
4. schema check (pre-ack): invalid JSON or schema mismatch → `422` with
   detail; the body is retained (last 5, truncated) for the webhook's AUTHOR
   — the entity — to diagnose its own schema drift.
5. everything passed → receipt written (write-ahead), counters bumped,
   payload queued, ack `200 {ok, eventId}`. The `eventId` is the
   correlation handle for "what happened to my event".

After the ack the sender walks away and never retries, so post-ack failure
is the pump's problem: 3 attempts (1s, 4s backoff), then `failed` receipts +
an audit escalation (`webhook-dead-letter`). Deliveries to one session
coalesce within `WEBHOOK_DEBOUNCE_MS` (default 2.5s) — a burst arrives as
one wake carrying every payload, each with its own receipt.

**The bearer token is never shown to the entity.** Tools and tool outputs
carry the id/path and the accounting; the owner reads the token in the app.
Test-fire (`POST /api/webhooks/:id/test`, owner) validates a probe payload
against the schema without delivering — rejected probes are receipted.

## Cron

- Schedules render in the **profile's timezone**; new profiles default to
  **Asia/Jakarta (WIB)**.
- Creation (`schedule_set` tool, `POST /api/cron`) returns the **next 3 fire
  times** so the author verifies intent before the schedule commits.
- One-shots (`once`, epoch ms) self-retire on success; on 3 consecutive
  failures they are **disabled in place** (visibly dead, not vanished) with
  an audit escalation.
- Delivery rides the same admission path as typed input. **Routine wakes STEER a turn in flight** (`whenBusy: "steer"` — admitted at the next tool boundary), so the old "wakes never land mid-turn" constraint is gone. Sensors deliberately queue as follow-ups instead: a low-priority tick must not derail active work. Bursts still coalesce via the webhook debounce; that is a documented behavior, not a bug — check the receipts.

## Sensors

A sensor watches an external source and wakes the entity on events — today,
**calendar** (the owner's ICS feed, `CALENDAR_ICS_URL`), polled by the
server's sensor loop (`SENSOR_POLL_MS`, default 5 min). Tools:
`sensor_set` / `sensor_list` / `sensor_remove` (set/remove gated).

- **Dedup is the source's natural key** (the ICS UID), stored in a ring on
  the sensor row — each real-world event wakes the entity exactly once,
  across restarts. No UID in the feed falls back to `summary@start`.
- Fires are write-ahead receipts (`source: "sensor"`), delivered as
  **follow-ups** (never steering), `leadMinutes` before the event starts
  with a 1h grace window for missed polls.
- No feed configured or feed error lands on the sensor's `lastError` —
  visible in `GET /api/sensors` and `sensor_list`.

## Durable state (the KV plane)

`state_get` / `state_set` / `state_delete` / `state_list` — a profile-scoped
key-value store over a durable doc family (`ultiv.kv.<profile>`), live
across sessions, wakes and restarts. This is where dedup ledgers, generation
tokens and "already acted" markers belong. The semantic rule survives: unset
is NOT proof of never-acted — write generation markers for anything whose
absence must be distinguishable. Values cap at 8KB (store pointers, not
payloads).
