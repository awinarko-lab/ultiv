/**
 * Keep a scroll area pinned to its newest content while the reader is at the
 * bottom; once they scroll up, stop following and offer "Jump to latest".
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const NEAR_PX = 48;

export function useFollow(contentKey: unknown): {
  ref: (node: HTMLDivElement | null) => void;
  atBottom: boolean;
  jump: () => void;
} {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const following = useRef(true);

  useEffect(() => {
    if (node === null) return;
    const onScroll = (): void => {
      const near = node.scrollHeight - node.scrollTop - node.clientHeight < NEAR_PX;
      following.current = near;
      setAtBottom(near);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, [node]);

  useLayoutEffect(() => {
    if (node !== null && following.current) node.scrollTop = node.scrollHeight;
  }, [node, contentKey]);

  const jump = useCallback(() => {
    if (node === null) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    following.current = true;
    node.scrollTo({ top: node.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [node]);

  return { ref: setNode, atBottom, jump };
}
