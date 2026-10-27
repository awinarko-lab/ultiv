import { describe, expect, it, vi } from "vite-plus/test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueuedChips } from "./queued-chips.tsx";
import { canSend } from "./send-button.tsx";
import { queueLabel } from "../lib/queue-text.ts";

const QUEUED = [
  { id: "7", text: "also check the weather", mode: "steer" as const },
  { id: "9", text: "then book it", mode: "followUp" as const },
];

/** Every element in a rendered tree (function components are not expanded). */
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

describe("Send while busy", () => {
  it("stays enabled while the bot works; only link, sending or an empty draft disable it", () => {
    expect(canSend(true, false, "and also this")).toBe(true);
    expect(canSend(false, false, "x")).toBe(false);
    expect(canSend(true, true, "x")).toBe(false);
    expect(canSend(true, false, "   ")).toBe(false);
  });
});

describe("QueuedChips", () => {
  it("renders each queued message with when it will send", () => {
    const html = renderToStaticMarkup(
      <QueuedChips queued={QUEUED} approvalPending={false} onWithdraw={() => {}} />,
    );
    expect(html).toContain("also check the weather");
    expect(html).toContain("Will send at the next step");
    expect(html).toContain("Will send after it finishes");
    expect(html).toContain('aria-label="Cancel queued message: then book it"');
  });

  it("says an approval comes first, and renders nothing when the queue is empty", () => {
    expect(queueLabel("steer", true)).toBe("Waiting for your approval first");
    const empty = renderToStaticMarkup(
      <QueuedChips queued={[]} approvalPending={false} onWithdraw={() => {}} />,
    );
    expect(empty).toBe("");
  });

  it("the x withdraws that message", () => {
    const onWithdraw = vi.fn();
    const tree = QueuedChips({ queued: QUEUED, approvalPending: false, onWithdraw });
    const cancels = elements(tree).filter((el) =>
      String(el.props["aria-label"] ?? "").startsWith("Cancel queued message"),
    );
    expect(cancels).toHaveLength(2);
    (cancels[1]!.props.onClick as () => void)();
    expect(onWithdraw).toHaveBeenCalledWith("9");
  });
});
