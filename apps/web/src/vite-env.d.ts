declare module "*.css";

interface ImportMetaEnv {
  /** True under `vp dev` (and other non-build runtimes). */
  readonly DEV: boolean;
  readonly PROD: boolean;
  /** Overrides the chord server URL (e.g. `ws://127.0.0.1:8797`). */
  readonly VITE_CHORD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
