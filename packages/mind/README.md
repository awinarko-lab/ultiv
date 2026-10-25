# @ultiv/mind

The platform's one AI entity — **Ultius** (the package keeps its working name,
`mind`; the entity it implements is Ultius).
AI is native infrastructure here, not a feature bolted on: chat is only one of
the entity's forms, and every LLM/decision call goes through it.

Faculties of the one entity:

- `converse` — durable conversations over the pi-durable harness
  (`root`/`ensure`/`turn`: submit -> wait -> commit is the only path an input
  reaches a model), plus `docs` (app-level durable documents) and the transcript
  projection every surface renders through.
- `decide` — typed decisions through Jev, **independent of chat**: `yesNo`,
  `pick`, `rate`, `ask` work with zero conversation infrastructure. The same
  faculty also appears as native agent tools (`jev`, `jev_score`, `jev_pick`,
  `jev_rate`) via the extension registry — one capability, two faces.
- `act` — the mind's executable tool surface, assembled from `@ultiv/ext`
  plugins; `gated` tools pass through the approval broker at the act. The act
  extension also carries the **identity section** ("You are Ultius.") rendered
  into every system prompt — models have no self-knowledge; undeclared, they
  answer from training priors.

Owner rule: nothing here may call a raw provider completion in app code — all
generation rides the harness. Enter with `openMind()` (the promise-land door);
Effect-native composition goes through `mindLayer`.
