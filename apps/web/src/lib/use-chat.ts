import { useCallback, useEffect, useState } from "react";
import type { ChatMessage, ChatTurn } from "@ultiv/contracts";
import { openChat, type ChatRef } from "./chord.ts";

export type ChatPhase = "connecting" | "live" | "lost";

export function useChat(id: string): {
  phase: ChatPhase;
  messages: ChatMessage[];
  turn: ChatTurn;
  lastError: string | null;
  send: (text: string) => void;
} {
  const [phase, setPhase] = useState<ChatPhase>("connecting");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [turn, setTurn] = useState<ChatTurn>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [ref, setRef] = useState<ChatRef | undefined>(undefined);

  useEffect(() => {
    let active = true;
    let current: ChatRef | undefined;
    const unsubs: Array<() => void> = [];
    openChat(id)
      .then((opened) => {
        if (!active) {
          opened.release();
          return;
        }
        current = opened;
        setRef(opened);
        setPhase("live");
        unsubs.push(opened.messages.subscribe(setMessages));
        unsubs.push(opened.turn.subscribe(setTurn));
        unsubs.push(opened.lastError.subscribe(setLastError));
        unsubs.push(
          opened.onStatus((status) => {
            if (status === "gone") setPhase("lost");
          }),
        );
      })
      .catch(() => {
        if (active) setPhase("lost");
      });
    return () => {
      active = false;
      for (const unsub of unsubs) unsub();
      current?.release();
      setRef(undefined);
      setPhase("connecting");
      setMessages([]);
      setTurn("idle");
      setLastError(null);
    };
  }, [id]);

  const send = useCallback(
    (text: string) => {
      ref?.send({ text }).catch((error) => console.warn("send failed:", error));
    },
    [ref],
  );

  return { phase, messages, turn, lastError, send };
}
