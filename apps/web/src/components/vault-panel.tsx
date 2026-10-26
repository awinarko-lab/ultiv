/**
 * The vault manager: human-only secret entry (login/card/key/note) plus
 * readable contacts. Items are owner-shared by default — every bot sees them
 * through `vault_list` masks; scope one to a single bot if needed. Responses
 * carry metadata only; secret bytes never return to the browser — and after a
 * save the entry fields are cleared, so no value is ever shown twice.
 */
import { KeyRoundIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ProfileInfo, VaultItemInfo, VaultKind } from "@ultiv/contracts";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ApiError, api } from "@/lib/api";

const KINDS: VaultKind[] = ["login", "card", "key", "note", "contact"];

export function VaultPanel({ profiles }: { profiles: ProfileInfo[] }) {
  const [items, setItems] = useState<VaultItemInfo[]>([]);
  const [configured, setConfigured] = useState(true);
  const [kind, setKind] = useState<VaultKind>("login");
  const [name, setName] = useState("");
  const [scope, setScope] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.vault();
      setItems(Array.isArray(list) ? list : []);
      setConfigured(true);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load().catch(() => {
      setConfigured(false);
    });
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
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <KeyRoundIcon /> Vault
          </Button>
        }
      />
      <DialogContent>
        <DialogTitle>Vault</DialogTitle>
        {!configured && (
          <p className="text-destructive mt-2 text-sm">
            VAULT_KEY is not configured on the server — secrets cannot be sealed.
          </p>
        )}
        <div className="mt-3 flex flex-col gap-2">
          {items.length === 0 ? (
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
                        : `used ${new Date(item.lastUsedAt).toLocaleDateString()}`}
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
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <select
              className="bg-background rounded-md border px-2 py-1 text-sm"
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as VaultKind);
                setFields({});
              }}
            >
              {KINDS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
            <Input
              className="flex-1"
              placeholder="Name (e.g. Gmail)"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <select
              className="bg-background rounded-md border px-2 py-1 text-sm"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            >
              <option value="">Shared (all bots)</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} only
                </option>
              ))}
            </select>
          </div>
          {inputs[kind].map((field) => (
            <Input
              key={field.key}
              type={field.secret ? "password" : "text"}
              placeholder={field.label}
              value={fields[field.key] ?? ""}
              onChange={(event) => set(field.key, event.target.value)}
            />
          ))}
          {error !== null && <p className="text-destructive text-sm">{error}</p>}
          <Button disabled={busy || name.trim() === ""} onClick={() => void create()}>
            {busy ? "Sealing…" : "Add item"}
          </Button>
          <p className="text-muted-foreground text-xs">
            Secrets are sealed server-side (AES-256-GCM under VAULT_KEY). Bots see masks and redeem
            them on your behalf — they never read the bytes, and neither does this screen again.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
