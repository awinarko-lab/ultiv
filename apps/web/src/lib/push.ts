/**
 * The browser half of Web Push: service worker registration, this tab's
 * presence heartbeat (the server skips pushes while the app is visible) and
 * subscribe/unsubscribe through PushManager with the server's VAPID key.
 */
import { api } from "./api";
import { keyBytes, pushSupport, type PushEnv, type PushSupport } from "./push-support.ts";

const HEARTBEAT_MS = 30_000;

export const pushEnv = (): PushEnv => {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    secure: window.isSecureContext,
    serviceWorker: "serviceWorker" in navigator,
    pushManager: "PushManager" in window,
    notification: "Notification" in window,
    permission: "Notification" in window ? Notification.permission : null,
    ios: /iPad|iPhone|iPod/.test(navigator.userAgent),
    standalone: nav.standalone === true || matchMedia("(display-mode: standalone)").matches,
  };
};

export const currentSupport = (): PushSupport => pushSupport(pushEnv());

/** Register the offline-shell + push service worker (secure origins only). */
export function registerServiceWorker(): void {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((cause: unknown) => {
    console.warn("service worker registration failed", cause);
  });
}

/** Report this tab's visibility so pushes skip while the owner is looking. */
export function startPresence(): () => void {
  const tab = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  const report = (visible: boolean): void => api.pushPresence(tab, visible);
  const onChange = (): void => report(document.visibilityState === "visible");
  const onHide = (): void => report(false);
  document.addEventListener("visibilitychange", onChange);
  window.addEventListener("pagehide", onHide);
  onChange();
  const timer = setInterval(() => {
    if (document.visibilityState === "visible") report(true);
  }, HEARTBEAT_MS);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onChange);
    window.removeEventListener("pagehide", onHide);
    report(false);
  };
}

const registration = async (): Promise<ServiceWorkerRegistration> => {
  registerServiceWorker();
  return navigator.serviceWorker.ready;
};

/** This device's live subscription, if any. */
export const currentSubscription = async (): Promise<PushSubscription | null> => {
  if (currentSupport() !== "ok") return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg === undefined ? null : reg.pushManager.getSubscription();
};

/** Ask permission, subscribe this device, register it with the server. */
export async function enablePush(publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications weren't allowed.");
  const reg = await registration();
  const existing = await reg.pushManager.getSubscription();
  const subscription =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  await api.pushSubscribe(subscription.toJSON());
}

/** Drop this device's subscription here and on the server. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (subscription === null) return;
  await api.pushUnsubscribe(subscription.endpoint);
  await subscription.unsubscribe();
}
