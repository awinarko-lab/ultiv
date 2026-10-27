/**
 * Any one session (an extra session from History, or a bot's main chat by
 * id). Back returns to wherever the owner came from, else to History.
 */
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { Chat } from "@/components/chat";
import { useApp } from "@/lib/app-state";
import { chatColumn } from "./index";

export const Route = createFileRoute("/c/$sessionId")({
  component: SessionPage,
});

function SessionPage() {
  const { sessionId } = Route.useParams();
  const { sessions } = useApp();
  const router = useRouter();
  const navigate = useNavigate();
  const row = sessions.sessions.find((candidate) => candidate.id === sessionId);
  const bot = sessions.profiles.find((profile) => profile.id === row?.profile);

  const back = (): void => {
    if (router.history.canGoBack()) router.history.back();
    else void navigate({ to: "/history" });
  };

  return (
    <div className={chatColumn}>
      <Chat
        key={sessionId}
        sessionId={sessionId}
        models={sessions.models}
        bot={bot}
        onBack={back}
      />
    </div>
  );
}
