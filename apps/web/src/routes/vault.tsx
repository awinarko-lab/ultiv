import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronRightIcon, PlugIcon } from "lucide-react";
import { Page } from "@/components/page";
import { VaultContent } from "@/components/vault-panel";
import { useApp } from "@/lib/app-state";

export const Route = createFileRoute("/vault")({
  component: VaultPage,
});

function VaultPage() {
  const { sessions } = useApp();
  return (
    <Page title="Vault">
      <VaultContent profiles={sessions.profiles} />
      <Link
        to="/connectors"
        className="hover:bg-muted focus-visible:ring-ring/50 flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm outline-none focus-visible:ring-3 sm:hidden"
      >
        <PlugIcon className="size-4" />
        <span className="flex-1">Connectors — use vault keys with other apps' tools</span>
        <ChevronRightIcon className="text-muted-foreground size-4" />
      </Link>
    </Page>
  );
}
