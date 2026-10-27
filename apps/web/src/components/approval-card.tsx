/**
 * The gate card: a tool call waiting on the owner. Buttons lock while a
 * decision is in flight; a failed decision stays visible so it can be retried.
 */
import { useState } from "react";
import type { PendingApproval } from "@ultiv/contracts";
import { CircleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";

/**
 * Tools that reach outside the conversation (delete/send/pay/publish): their
 * approval cards carry an explicit warning and a red border.
 */
const RISKY_TOOL =
  /delete|remove|purge|drop|send|post|email|tweet|publish|pay|transfer|archive|overwrite/i;

export type Decide = (
  callId: string,
  approved: boolean,
  always?: boolean,
  takeover?: boolean,
) => Promise<void>;

export function ApprovalCard({
  pending,
  onDecide,
}: {
  pending: NonNullable<PendingApproval>;
  onDecide: Decide;
}) {
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const risky = RISKY_TOOL.test(pending.name);

  const decide = async (label: string, run: () => Promise<void>): Promise<void> => {
    setDeciding(label);
    setError(null);
    try {
      await run();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeciding(null);
    }
  };
  const busy = deciding !== null;
  const label = (name: string, text: string): string => (deciding === name ? "Sending…" : text);

  return (
    <Card className={risky ? "w-full border-destructive" : "w-full border-ring"}>
      <CardHeader className="pb-0">
        <CardTitle className="text-sm">Approve {pending.name}?</CardTitle>
      </CardHeader>
      {risky && (
        <CardContent className="pb-0">
          <p className="text-destructive flex items-center gap-1 text-xs">
            <CircleAlertIcon className="size-3.5" />
            This reaches outside the conversation and may not be reversible — check the details.
          </p>
        </CardContent>
      )}
      <CardContent className="pt-2">
        <p className="text-muted-foreground text-xs">
          “Always allow” saves {pending.name} to this bot’s auto-approve rules. “Take over” declines
          the call and tells the bot you are doing it yourself.
        </p>
        <CodeBlock size="sm">
          <CodeBlockContent wrap className="max-h-48 overflow-y-auto">
            {JSON.stringify(pending.input, null, 2)}
          </CodeBlockContent>
        </CodeBlock>
        {error !== null && (
          <p className="text-destructive mt-2 text-xs">Decision not sent: {error}. Try again.</p>
        )}
      </CardContent>
      <CardFooter className="flex-wrap justify-end gap-2 pb-3">
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={busy}
          onClick={() =>
            void decide("takeover", () => onDecide(pending.callId, false, undefined, true))
          }
        >
          {label("takeover", "Take over")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void decide("deny", () => onDecide(pending.callId, false))}
        >
          {label("deny", "Deny")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void decide("always", () => onDecide(pending.callId, true, true))}
        >
          {label("always", "Always allow")}
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => void decide("approve", () => onDecide(pending.callId, true))}
        >
          {label("approve", "Approve")}
        </Button>
      </CardFooter>
    </Card>
  );
}
