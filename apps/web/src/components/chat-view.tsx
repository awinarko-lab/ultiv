import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatTurn } from "@ultiv/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

const roleStyles = {
  user: "self-end rounded-lg bg-primary px-3 py-2 text-primary-foreground",
  assistant: "self-start rounded-lg bg-muted px-3 py-2",
} as const;

export function ChatView({
  phase,
  messages,
  turn,
  lastError,
  onSend,
}: {
  phase: "connecting" | "live" | "lost";
  messages: ChatMessage[];
  turn: ChatTurn;
  lastError: string | null;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const busy = turn === "thinking";

  // Pin the transcript to the newest message: on open, on every turn.
  useEffect(() => {
    const viewport = transcriptRef.current?.querySelector("[data-slot=scroll-area-viewport]");
    if (viewport === null || viewport === undefined) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [messages, busy]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text === "" || busy) return;
    onSend(text);
    setDraft("");
  };

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardHeader>
        <CardTitle>Conversation</CardTitle>
        <Badge variant={phase === "live" ? "secondary" : "outline"}>{phase}</Badge>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        <div ref={transcriptRef} className="h-full min-h-0">
          <ScrollArea className="h-full">
            <ul className="flex flex-col gap-3 pr-3">
              {messages.map((message) => (
                <li key={message.id} className={roleStyles[message.role]}>
                  {message.text}
                </li>
              ))}
              {busy && <li className="self-start text-sm text-muted-foreground">thinking…</li>}
            </ul>
          </ScrollArea>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        {lastError !== null && <p className="w-full text-sm text-destructive">{lastError}</p>}
        <form className="flex w-full gap-2" onSubmit={submit}>
          <Input
            placeholder={phase === "live" ? "Message…" : "Waiting for link…"}
            value={draft}
            disabled={phase !== "live"}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" disabled={phase !== "live" || busy}>
            Send
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
