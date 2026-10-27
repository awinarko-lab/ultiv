/**
 * The vault manager: human-only secret entry (login/card/key/note) plus
 * readable contacts. Items are owner-shared by default — every bot sees them
 * through `vault_list` masks; scope one to a single bot if needed. Responses
 * carry metadata only; secret bytes never return to the browser — and after a
 * save the entry fields are cleared, so no value is ever shown twice.
 */
import { Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ProfileInfo, VaultItemInfo, VaultKind } from "@ultiv/contracts";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DevDetails } from "@/components/ui/dev-details";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ApiError, api } from "@/lib/api";
import { formatWhen } from "@/lib/format";

const KINDS: VaultKind[] = ["login", "card", "key", "note", "contact"];

/** The vault manager content — shared by the header dialog and the mobile view. */
export function VaultContent({ profiles }: { profiles: ProfileInfo[] }) {
  const [items, setItems] = useState<VaultItemInfo[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [kind, setKind] = useState<VaultKind>("login");
  const [name, setName] = useState("");
  const [scope, setScope] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Without VAULT_KEY the server answers { items: [], configured: false }
      // instead of an array — that shape is what drives the warning.
      const list = (await api.vault()) as unknown;
      if (Array.isArray(list)) {
        setItems(list as VaultItemInfo[]);
        setConfigured(true);
      } else {
        setItems([]);
        setConfigured(
          !(typeof list === "object" && list !== null && "configured" in list) ||
            list.configured !== false,
        );
      }
      setLoadFailed(false);
    } catch (cause) {
      setLoadFailed(true);
      if (cause instanceof ApiError && cause.status === 503) setConfigured(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (key: string, value: string): void => setFields({ ...fields, [key]: value });

  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.vaultCreate({
        kind,
        name,
        ...(scope !== "" ? { profile: scope } : {}),
        ...(kind === "login"
          ? {
              login: {
                ...(fields.url !== "" ? { url: fields.url } : {}),
                username: fields.username ?? "",
                password: fields.password ?? "",
              },
            }
          : {}),
        ...(kind === "card"
          ? {
              card: {
                ...(fields.brand !== "" ? { brand: fields.brand } : {}),
                number: fields.number ?? "",
                exp: fields.exp ?? "",
                cvc: fields.cvc ?? "",
              },
            }
          : {}),
        ...(kind === "key"
          ? {
              key: {
                ...(fields.service !== "" ? { service: fields.service } : {}),
                secret: fields.secret ?? "",
              },
            }
          : {}),
        ...(kind === "note" ? { note: { secret: fields.secret ?? "" } } : {}),
        ...(kind === "contact"
          ? {
              contact: {
                ...(fields.email !== "" ? { email: fields.email } : {}),
                ...(fields.phone !== "" ? { phone: fields.phone } : {}),
              },
            }
          : {}),
      });
      setName("");
      setFields({});
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      if (cause instanceof ApiError && cause.status === 503) setConfigured(false);
    } finally {
      setBusy(false);
    }
  };

  const inputs: Record<VaultKind, { key: string; label: string; secret?: boolean }[]> = {
    login: [
      { key: "url", label: "URL" },
      { key: "username", label: "Username" },
      { key: "password", label: "Password", secret: true },
    ],
    card: [
      { key: "brand", label: "Brand" },
      { key: "number", label: "Number", secret: true },
      { key: "exp", label: "Expiry (MM/YY)", secret: true },
      { key: "cvc", label: "CVC", secret: true },
    ],
    key: [
      { key: "service", label: "Service" },
      { key: "secret", label: "Secret", secret: true },
    ],
    note: [{ key: "secret", label: "Secret note", secret: true }],
    contact: [
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
    ],
  };

  return (
    <>
      {!configured && (
        <p className="text-destructive mt-2 text-sm">
          The vault isn't set up on the server yet, so nothing can be saved.
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2">
        {loadFailed && items.length === 0 ? (
          <p className="text-destructive flex items-center gap-2 text-sm">
            Couldn't load the vault.
            <Button variant="link" size="xs" className="h-auto p-0" onClick={() => void load()}>
              Retry
            </Button>
          </p>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground text-sm">No items yet.</p>
        ) : (
          items.map((item, index) => (
            <div key={item.id} className="contents">
              {index > 0 && <Separator />}
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {item.name}
                  <span className="text-muted-foreground ml-2 font-normal">
                    {item.masked}
                    {" · "}
                    {item.lastUsedAt === null
                      ? "never used"
                      : `used ${formatWhen(item.lastUsedAt)}`}
                  </span>
                </span>
                <Badge variant="outline">{item.kind}</Badge>
                <Badge variant={item.access === "secret" ? "secondary" : "outline"}>
                  {item.profile === null ? "shared" : "scoped"}
                </Badge>
                <ConfirmDialog
                  title={`Remove ${item.name}?`}
                  warning="Bots lose access immediately, and the secret must be entered again to restore it. This cannot be undone."
                  confirmLabel="Remove item"
                  onConfirm={async () => {
                    await api.vaultRemove(item.id);
                    await load();
                  }}
                >
                  <Button variant="ghost" size="icon" aria-label={`Remove ${item.name}`}>
                    <Trash2Icon />
                  </Button>
                </ConfirmDialog>
              </div>
            </div>
          ))
        )}
      </div>
      <Separator className="my-4" />
      <form
        className="flex flex-col gap-2"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && name.trim() !== "") void create();
        }}
      >
        {/* Nothing can be saved without VAULT_KEY, so the fields say so by being off. */}
        <fieldset
          disabled={!configured}
          className="flex min-w-0 flex-col gap-2 disabled:opacity-60"
        >
          <div className="flex flex-wrap gap-2">
            <Select
              aria-label="Item type"
              className="min-w-32 flex-1"
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as VaultKind);
                setFields({});
              }}
            >
              {KINDS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate.charAt(0).toUpperCase() + candidate.slice(1)}
                </option>
              ))}
            </Select>
            <Input
              className="min-w-32 flex-1"
              aria-label="Item name"
              autoComplete="off"
              placeholder="Name (e.g. Gmail)"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Select
              aria-label="Which bots can use it"
              className="min-w-32 flex-1"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            >
              <option value="">Shared (all bots)</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} only
                </option>
              ))}
            </Select>
          </div>
          {inputs[kind].map((field) => (
            <Input
              key={field.key}
              type={field.secret ? "password" : "text"}
              aria-label={field.label}
              autoComplete={field.secret ? "new-password" : "off"}
              placeholder={field.label}
              value={fields[field.key] ?? ""}
              onChange={(event) => set(field.key, event.target.value)}
            />
          ))}
          {error !== null && <p className="text-destructive text-sm">{error}</p>}
          <Button type="submit" disabled={busy || name.trim() === ""}>
            {busy ? "Saving…" : "Add item"}
          </Button>
        </fieldset>
        <p className="text-muted-foreground text-xs">
          Saved items are encrypted on the server. Bots only see a masked stand-in and use it for
          you without reading the secret, and this screen won't show it again.
        </p>
        <DevDetails>
          Sealed with AES-256-GCM under the server's VAULT_KEY.
          {!configured && " Set VAULT_KEY in the server's environment to turn the vault on."}
        </DevDetails>
      </form>
    </>
  );
}
