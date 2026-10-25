/**
 * Every environment key the mind knows, in one place. Keys are optional: the
 * faculties they enable report themselves through `mind.describe()`, so the
 * stack boots offline and degrades loudly instead of crashing.
 */
import { Config } from "effect";

/** Single grep-able fallbacks (kenari-model-ops rule: KENARI_MODEL is the source of truth). */
export const KENARI_FALLBACK_MODEL = "deepseek-v4-1-flash";
export const JEV_FALLBACK_MODEL = "jev-latest";
export const KENARI_DEFAULT_BASE_URL = "https://kenari.id/v1";
export const HARNESS_DB_DEFAULT = "var/harness.sqlite";

export const kenariApiKey = Config.option(Config.String("KENARI_API_KEY"));
export const kenariModel = Config.String("KENARI_MODEL").pipe(
  Config.withDefault(KENARI_FALLBACK_MODEL),
);
export const kenariBaseUrl = Config.String("KENARI_BASE_URL").pipe(
  Config.withDefault(KENARI_DEFAULT_BASE_URL),
);
export const openaiApiKey = Config.option(Config.String("OPENAI_API_KEY"));
export const typesafeApiKey = Config.option(Config.String("TYPESAFE_API_KEY"));
export const typesafeModel = Config.String("TYPESAFE_MODEL").pipe(
  Config.withDefault(JEV_FALLBACK_MODEL),
);
export const harnessDb = Config.String("HARNESS_DB").pipe(Config.withDefault(HARNESS_DB_DEFAULT));
