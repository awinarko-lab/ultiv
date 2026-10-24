import {
  createHost,
  webSocketLink,
  type Host,
  type Ref,
  type WebSocketLike,
} from "@earendil-works/chord";
import { Chat } from "@ultiv/contracts";

export type ChatRef = Ref<typeof Chat>;
export type GuestPrincipal = { kind: "guest" };

let hostPromise: Promise<Host<GuestPrincipal>> | undefined;

function wsUrl(): string {
  const override = import.meta.env.VITE_CHORD_URL;
  if (override !== undefined && override !== "") return override;
  if (import.meta.env.DEV) return "ws://127.0.0.1:8787";
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}`;
}

/** The browser's chord host: a client peer linked upstream to the server. One per page. */
function clientHost(): Promise<Host<GuestPrincipal>> {
  hostPromise ??= (async () => {
    const host = createHost<GuestPrincipal>({
      name: "web",
      self: { kind: "guest" },
      kind: "client",
    });
    const socket = new WebSocket(wsUrl());
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("chord link failed")), {
        once: true,
      });
    });
    host.connect(webSocketLink(socket as unknown as WebSocketLike), {
      principal: { kind: "guest" },
    });
    return host;
  })();
  return hostPromise;
}

/** Opens (and holds) the conversation object for `id` on the server. */
export async function openChat(id: string): Promise<ChatRef> {
  const host = await clientHost();
  return host.get(Chat, { id });
}
