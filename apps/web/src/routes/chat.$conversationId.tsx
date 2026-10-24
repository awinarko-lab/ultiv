import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

export const Route = createFileRoute("/chat/$conversationId")({
  component: ChatPage,
});

type ChatMessage = { role: "user" | "agent"; text: string };

const seedMessages: ChatMessage[] = [
  { role: "user", text: "Ping" },
  {
    role: "agent",
    text: "Static scaffold for now — chord/pi-durable wiring lands next. Messages here are local state only.",
  },
];

function ChatPage() {
  const { conversationId } = Route.useParams();
  const [messages, setMessages] = useState<ChatMessage[]>(seedMessages);
  const [draft, setDraft] = useState("");

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text === "") {
      return;
    }
    setMessages((current) => [...current, { role: "user", text }]);
    setDraft("");
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 p-8">
      <header className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Chat</h1>
        <Badge variant="outline">{conversationId}</Badge>
      </header>
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader>
          <CardTitle>Conversation</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex-1">
          <ScrollArea className="h-80">
            <ul className="flex flex-col gap-3 pr-3">
              {messages.map((message, index) => (
                <li
                  key={index}
                  className={
                    message.role === "user"
                      ? "self-end rounded-lg bg-primary px-3 py-2 text-primary-foreground"
                      : "self-start rounded-lg bg-muted px-3 py-2"
                  }
                >
                  {message.text}
                </li>
              ))}
            </ul>
          </ScrollArea>
        </CardContent>
        <CardFooter>
          <form className="flex w-full gap-2" onSubmit={send}>
            <Input
              placeholder="Message…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button type="submit">Send</Button>
          </form>
        </CardFooter>
      </Card>
      <Link
        className="w-fit text-sm text-muted-foreground underline-offset-4 hover:underline"
        to="/"
      >
        ← Back
      </Link>
    </main>
  );
}
