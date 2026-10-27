/**
 * Chat markdown (GFM). Fenced code renders as a CodeBlock with a copy button,
 * highlighted by shiki once its language has loaded (plain text until then,
 * and for languages we don't ship).
 */
import { isValidElement, memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";

function FencedCode({ code, language }: { code: string; language: string }) {
  const lines = useHighlightedCode(code, language);
  return (
    <CodeBlock size="sm" className="not-prose my-2">
      <CodeBlockHeader>
        <CodeBlockTitle>{language === "" ? "code" : language}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent>
        {lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines only append
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

const components: Components = {
  pre: ({ children }) => {
    const child = Array.isArray(children) ? children[0] : children;
    if (!isValidElement(child)) return <pre>{children}</pre>;
    const props = child.props as { className?: string; children?: unknown };
    const language = /language-(\S+)/.exec(props.className ?? "")?.[1] ?? "";
    const code = typeof props.children === "string" ? props.children : String(props.children ?? "");
    return <FencedCode code={code.replace(/\n$/, "")} language={language} />;
  },
};

function MarkdownImpl({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
}

/** Re-parses only when its text changes. */
export const Markdown = memo(MarkdownImpl);
export default Markdown;
