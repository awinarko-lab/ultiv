/**
 * The chat area of one session: live session wiring, the conversation's
 * background tasks, and the full SessionView. Shared by the home screen (the
 * active bot's main chat) and the /sessions/$id page.
 */
import type { ChatBot } from "@/components/chat-header";
import { SessionView } from "@/components/session-view";
import { TasksPill } from "@/components/tasks-pill";
import { StopDialog } from "@/components/stop-dialog";
import { useSession } from "@/lib/use-session";
import { useTasks } from "@/lib/use-tasks";
import { useState } from "react";
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
  const chatTasks = useTasks(session.conversationId);
  const [askStop, setAskStop] = useState(false);
  // Stop asks first only when this chat has background tasks running.
  const requestStop = async (): Promise<void> => {
    if (chatTasks.running.length === 0) await session.interrupt();
    else setAskStop(true);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SessionView
        tasks={<TasksPill chatTasks={chatTasks} />}
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
        queued={session.queued}
        onInput={session.input}
        onWithdraw={session.withdraw}
        onDecide={session.decide}
        onConfigure={session.configure}
        onInterrupt={requestStop}
      />
      <StopDialog
        open={askStop}
        running={chatTasks.running.length}
        onOpenChange={setAskStop}
        onStop={async (tasks) => {
          await session.interrupt(tasks);
          if (tasks) await chatTasks.refresh();
        }}
      />
    </div>
  );
}
