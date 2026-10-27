/**
 * Copy text on any origin. `navigator.clipboard` only exists in secure
 * contexts (https or localhost); over plain http — the phone on the tailnet
 * URL — it is undefined, so fall back to a hidden textarea + execCommand.
 */
export async function writeClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    // Deprecated but still the only copy path outside secure contexts.
    if (!document.execCommand("copy")) throw new Error("copy was refused");
  } finally {
    area.remove();
  }
}
