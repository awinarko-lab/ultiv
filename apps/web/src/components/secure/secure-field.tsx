/**
 * One masked field for a key or token: paste-friendly (no autocomplete, no
 * spellcheck, no password-manager save prompts), with a Show toggle. The
 * value lives only in this component's state until it is posted.
 */
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useId, useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

export function SecureField({
  label,
  value,
  onChange,
  disabled,
  autoFocus,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean | undefined;
  autoFocus?: boolean | undefined;
  invalid?: boolean | undefined;
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <InputGroup>
        <InputGroupInput
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-invalid={invalid === true ? true : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          className="font-mono"
          placeholder="Paste it here"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-sm"
            aria-label={shown ? `Hide ${label}` : `Show ${label}`}
            aria-pressed={shown}
            disabled={disabled}
            onClick={() => setShown((open) => !open)}
          >
            {shown ? <EyeOffIcon /> : <EyeIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
