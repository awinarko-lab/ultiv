/**
 * The composer's round send arrow. While the bot works a send joins the
 * running turn at its next step; long-press (touch) or right-click opens a
 * small menu that can hold the message until the turn finishes instead.
 */
import { useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import type { WhenBusy } from "@ultiv/contracts";
import { ArrowUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const LONG_PRESS_MS = 500;

/** Whether Send is usable: busy no longer blocks it, only the link, an in-flight send, or an empty draft. */
export function canSend(live: boolean, sending: boolean, draft: string): boolean {
  return live && !sending && draft.trim() !== "";
}

export function SendButton({
  busy,
  enabled,
  onSend,
}: {
  busy: boolean;
  enabled: boolean;
  onSend: (whenBusy?: WhenBusy) => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The click that ends a long-press must not also send.
  const pressed = useRef(false);
  const [open, setOpen] = useState(false);
  const menu = busy && enabled;
  const cancelPress = () => clearTimeout(timer.current);
  const pick = (whenBusy: WhenBusy) => {
    setOpen(false);
    onSend(whenBusy);
  };
  return (
    <Popover.Root open={open && menu} onOpenChange={setOpen}>
      <Button
        ref={anchor}
        type="submit"
        size="icon-lg"
        className="shrink-0 rounded-full select-none [-webkit-touch-callout:none]"
        aria-label="Send"
        aria-haspopup={menu ? "menu" : undefined}
        title={
          busy
            ? "Send: joins at the next step. Alt+Enter or long-press: send after it finishes"
            : "Send"
        }
        disabled={!enabled}
        onPointerDown={() => {
          pressed.current = false;
          if (!menu) return;
          cancelPress();
          timer.current = setTimeout(() => {
            pressed.current = true;
            setOpen(true);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(event) => {
          if (!menu) return;
          event.preventDefault();
          cancelPress();
          pressed.current = true;
          setOpen(true);
        }}
        onClick={(event) => {
          if (!pressed.current) return;
          pressed.current = false;
          event.preventDefault();
        }}
      >
        <ArrowUpIcon />
      </Button>
      <Popover.Portal>
        <Popover.Positioner anchor={anchor} side="top" align="end" sideOffset={8} className="z-50">
          <Popover.Popup className="bg-popover text-popover-foreground flex w-64 max-w-[calc(100vw-1.5rem)] flex-col rounded-xl border p-1 shadow-lg outline-none">
            <Button
              variant="ghost"
              className="h-auto justify-start py-2.5 text-left whitespace-normal"
              onClick={() => pick("steer")}
            >
              Send now, at the next step
            </Button>
            <Button
              variant="ghost"
              className="h-auto justify-start py-2.5 text-left whitespace-normal"
              onClick={() => pick("followUp")}
            >
              Send after it finishes
            </Button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
