import { Link, createFileRoute } from "@tanstack/react-router";
import { Ping } from "@ultiv/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-4 p-8">
      <div className="flex items-center gap-3">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">ultiv</h1>
        <Badge variant="secondary">contract v{Ping.def.version}</Badge>
      </div>
      <p className="max-w-prose text-muted-foreground">
        Effect-first, AI-native. UI stack wired: shadcn on Base UI, Tailwind 4, TanStack Router.
      </p>
      <Button
        className="w-fit"
        nativeButton={false}
        render={<Link to="/chat/$conversationId" params={{ conversationId: "demo" }} />}
      >
        Open chat
      </Button>
    </main>
  );
}
