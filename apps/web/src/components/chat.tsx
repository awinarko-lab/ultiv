/**
 * The chat area of one session: live session wiring, the conversation's
 * background tasks, and the full SessionView. Shared by the home screen (the
 * active bot's main chat) and the /sessions/$id page.
 */
import type { ChatBot } from "@/components/chat-header";
import { SessionView } from "@/components/session-view";
import { TasksPanel } from "@/components/tasks-panel";
import { useSession } from "@/lib/use-session";
import type { ModelInfo } from "@ultiv/contracts";

export function Chat({
  sessionId,
  models,
  bot,
  onBack,
}: {
  sessionId: string;
  models: ModelInfo[];
  bot?: ChatBot | undefined;
  onBack?: (() => void) | undefined;
}) {
  const session = useSession(sessionId);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <TasksPanel conversationId={session.conversationId} />
      <SessionView
        bot={bot}
        onBack={onBack}
        link={session.link}
        transcript={session.transcript}
        phase={session.phase}
        lastError={session.lastError}
        pending={session.pending}
        usage={session.usage}
        model={session.model}
        effort={session.effort}
        models={models}
        onInput={session.input}
        onDecide={session.decide}
        onConfigure={session.configure}
        onInterrupt={session.interrupt}
      />
    </div>
  );
}
