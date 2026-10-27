/**
 * The push endpoint guard. web-push POSTs to whatever endpoint a browser
 * hands us, so an owner could otherwise aim the server at an internal URL.
 * Only https endpoints on the known browser push services pass.
 */
const PUSH_SERVICE_SUFFIXES = [
  "fcm.googleapis.com", // Chrome, Edge, Android
  "android.googleapis.com",
  "push.services.mozilla.com", // Firefox
  "push.apple.com", // Safari / iOS home-screen apps (web.push.apple.com)
  "notify.windows.com", // legacy Edge / WNS
] as const;

const hostMatches = (host: string, suffix: string): boolean =>
  host === suffix || host.endsWith(`.${suffix}`);

export const isPushEndpoint = (raw: string): boolean => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return false;
  if (url.port !== "" && url.port !== "443") return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_SUFFIXES.some((suffix) => hostMatches(host, suffix));
};
