/**
 * The environment a stdio MCP server starts with: a minimal allowlist of the
 * host's variables (no API keys, no VAULT_KEY, nothing from .env) plus only
 * the vault-provided vars its config names.
 */
const PASS_THROUGH = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TZ",
  "TERM",
  "SYSTEMROOT",
  "PATHEXT",
  "COMSPEC",
] as const;

export const scrubbedEnv = (
  extra: Readonly<Record<string, string>>,
  host: NodeJS.ProcessEnv = process.env,
): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const key of PASS_THROUGH) {
    const value = host[key];
    // Shell functions exported into the env are a known injection vector.
    if (value !== undefined && !value.startsWith("()")) env[key] = value;
  }
  return { ...env, ...extra };
};
