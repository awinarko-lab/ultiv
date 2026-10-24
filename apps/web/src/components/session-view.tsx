import { useEffect, useRef, useState } from "react";
import type { Phase, TranscriptEntry } from "@ultiv/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

const roleStyles = {
  user: "self-end rounded-lg bg-primary px-3 py-2 text-primary-foreground",
  agent: "self-start rounded-lg bg-muted px-3 py-2",
} as const;

export function SessionView({
  link,
  transcript,
  phase,
  lastError,
  onInput,
}: {
  link: "connecting" | "live" | "lost";
  transcript: TranscriptEntry[];
  phase: Phase;
  lastError: string | null;
  onInput: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const busy = phase === "working";

  // Pin the transcript to the newest entry: on open, on every turn.
  useEffect(() => {
    const viewport = transcriptRef.current?.querySelector("[data-slot=scroll-area-viewport]");
    if (viewport === null || viewport === undefined) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [transcript, busy]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text === "" || busy) return;
    onInput(text);
    setDraft("");
  };

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardHeader>
        <CardTitle>Transcript</CardTitle>
        <Badge variant={link === "live" ? "secondary" : "outline"}>{link}</Badge>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        <div ref={transcriptRef} className="h-full min-h-0">
          <ScrollArea className="h-full">
            <ul className="flex flex-col gap-3 pr-3">
              {transcript.map((entry) => (
                <li key={entry.id} className={roleStyles[entry.role]}>
                  {entry.text}
                </li>
              ))}
              {busy && <li className="self-start text-sm text-muted-foreground">working…</li>}
            </ul>
          </ScrollArea>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        {lastError !== null && <p className="w-full text-sm text-destructive">{lastError}</p>}
        <form className="flex w-full gap-2" onSubmit={submit}>
          <Input
            placeholder={link === "live" ? "Give the agent a task…" : "Waiting for link…"}
            value={draft}
            disabled={link !== "live"}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" disabled={link !== "live" || busy}>
            Run
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
