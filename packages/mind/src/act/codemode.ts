/**
 * Codemode for the act: pi-durable's durable code mode — one tool whose input
 * is JavaScript, run in a QuickJS-WASM sandbox (no network, no filesystem, no
 * timers) whose ONLY capability is calling the conversation's tools as
 * `tools.<name>(args)`. Scripts compose, fan out and filter tool results
 * without round-tripping everything through model context; a script survives
 * a restart via the harness's replay journal.
 *
 * Gated tools called from a script still hit the approval broker: nested
 * calls execute the same wrapped tool objects the act installed, so a script
 * waiting on `web_fetch`'s gated cousin parks the same pending approval the
 * UI already renders.
 */
import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import {
  createCodemodeExtension,
  type CodemodeNamespace,
} from "@earendil-works/pi-durable/codemode";
import type { Extension } from "@earendil-works/pi-durable";

/**
 * The codemode extension over the act's tools. One namespace: everything the
 * registry installed, addressed as `tools.<name>`. `models: true` also gives
 * scripts the catalog (`models.getAvailableOfType`, …) and the paid globals
 * (`models.classify` for Jev, `models.generateImages` when an image provider
 * exists), each journaled as an internal durable call.
 */
export const codemodeExtension = (namespaces: readonly CodemodeNamespace[] = []): Extension =>
  createCodemodeExtension({
    sandbox: new CodemodeSandbox(),
    ...(namespaces.length > 0 ? { namespaces } : {}),
  });
