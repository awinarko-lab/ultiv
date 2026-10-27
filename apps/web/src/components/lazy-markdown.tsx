/**
 * Markdown, loaded on first use: react-markdown, remark-gfm and the shiki
 * highlighter live in their own chunk, out of the startup bundle. Until it
 * arrives the text shows as plain wrapped text.
 */
import { lazy, Suspense } from "react";

const Markdown = lazy(() => import("@/components/markdown"));

export function LazyMarkdown({ text }: { text: string }) {
  return (
    <Suspense fallback={<p className="whitespace-pre-wrap">{text}</p>}>
      <Markdown text={text} />
    </Suspense>
  );
}
