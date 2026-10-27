/** A raw tool payload, pretty-printed in a small mono block, cut at a preview with "Show more". */
import { useState } from "react";
import { previewOf } from "@/lib/task-steps";

const PREVIEW_CHARS = 600;

export function Payload({ label, text }: { label: string; text: string }) {
  const [all, setAll] = useState(false);
  const preview = previewOf(text, PREVIEW_CHARS);
  return (
    <div>
      <p className="text-muted-foreground mb-1 text-xs font-medium">{label}</p>
      <pre className="bg-muted/60 max-h-80 overflow-auto rounded-lg p-2.5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
        {all ? text : preview.text}
      </pre>
      {preview.more && (
        <button
          type="button"
          onClick={() => setAll((value) => !value)}
          className="text-primary focus-visible:ring-ring/50 -ml-1 min-h-11 cursor-pointer rounded-md px-1 text-xs font-medium outline-none hover:underline focus-visible:ring-3"
        >
          {all ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
