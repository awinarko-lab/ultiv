/**
 * Follow the OS colour scheme: `.dark` on <html> tracks prefers-color-scheme
 * (no toggle). Called once before the first render so there is no flash.
 */
export function followColorScheme(): void {
  if (typeof window === "undefined") return;
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = (): void => {
    document.documentElement.classList.toggle("dark", query.matches);
  };
  apply();
  query.addEventListener("change", apply);
}
