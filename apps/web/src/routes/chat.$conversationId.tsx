import { Link, createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { ChatView } from "@/components/chat-view";
import { useChat } from "@/lib/use-chat";

export const Route = createFileRoute("/chat/$conversationId")({
  component: ChatPage,
});

function ChatPage() {
  const { conversationId } = Route.useParams();
  const chat = useChat(conversationId);

  return (
    <main className="mx-auto flex h-dvh max-w-2xl flex-col gap-4 p-8">
      <header className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Chat</h1>
        <Badge variant="outline">{conversationId}</Badge>
      </header>
      <ChatView
        phase={chat.phase}
        messages={chat.messages}
        turn={chat.turn}
        lastError={chat.lastError}
        onSend={chat.send}
      />
      <Link
        className="w-fit text-sm text-muted-foreground underline-offset-4 hover:underline"
        to="/"
      >
        ← Back
      </Link>
    </main>
  );
}
