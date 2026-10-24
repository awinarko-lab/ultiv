import { useState } from "react";
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
  const busy = turn === "thinking";

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
        <ScrollArea className="h-80">
          <ul className="flex flex-col gap-3 pr-3">
            {messages.map((message, index) => (
              <li key={index} className={roleStyles[message.role]}>
                {message.text}
              </li>
            ))}
            {busy && <li className="self-start text-sm text-muted-foreground">thinking…</li>}
          </ul>
        </ScrollArea>
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
