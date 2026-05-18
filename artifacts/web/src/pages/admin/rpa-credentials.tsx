import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAccessToken } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { KeyRound, Plus, Pencil, Trash2, Loader2, CheckCircle2, XCircle, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const BASE = import.meta.env.BASE_URL;

async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = getAccessToken();
  const res = await fetch(`${BASE}api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers as Record<string, string> ?? {}),
    },
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

interface RpaCredential {
  id: number;
  name: string;
  description: string | null;
  notes: string | null;
  hasUsername: boolean;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
}

const EMPTY_FORM = { name: "", description: "", username: "", password: "", notes: "" };

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

// ── Add / Edit Dialog ─────────────────────────────────────────────────────────
function CredentialDialog({
  open, onClose, existing, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  existing?: RpaCredential;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [showUser, setShowUser] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);

  const isEdit = !!existing;

  const set = (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  function resetAndClose() {
    setForm(EMPTY_FORM);
    setShowUser(false);
    setShowPass(false);
    onClose();
  }

  async function submit() {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const body: Record<string, string> = {
        name: form.name.trim(),
        description: form.description.trim(),
        notes: form.notes.trim(),
      };
      if (form.username) body.username = form.username;
      if (form.password) body.password = form.password;

      if (isEdit) {
        await apiFetch(`/rpa/credentials/${existing.id}`, { method: "PUT", body: JSON.stringify(body) });
        toast.success("Credential updated");
      } else {
        await apiFetch("/rpa/credentials", { method: "POST", body: JSON.stringify(body) });
        toast.success("Credential created");
      }
      onSaved();
      resetAndClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  }

  function handleOpen(isOpen: boolean) {
    if (isOpen) {
      setForm({
        name: existing?.name ?? "",
        description: existing?.description ?? "",
        username: "",
        password: "",
        notes: existing?.notes ?? "",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) resetAndClose(); handleOpen(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            {isEdit ? "Edit Credential" : "Add Credential"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Name <span className="text-destructive">*</span></Label>
            <Input
              placeholder='e.g. "admin", "platform-user", "api-key-prod"'
              value={form.name}
              onChange={set("name")}
              disabled={isEdit}
              className={isEdit ? "bg-muted text-muted-foreground cursor-not-allowed" : ""}
            />
            {isEdit && (
              <p className="text-xs text-muted-foreground">
                Name cannot be changed — bots reference this by label.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input placeholder="Short description of what this credential is for" value={form.description} onChange={set("description")} />
          </div>

          <Separator />

          <div className="space-y-3">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
              Credentials — stored AES-256 encrypted
            </p>

            <div className="space-y-1.5">
              <Label>Username / Email{isEdit && <span className="text-muted-foreground font-normal"> (leave blank to keep existing)</span>}</Label>
              <div className="relative">
                <Input
                  type={showUser ? "text" : "password"}
                  placeholder={isEdit ? "••••••••" : "Enter username or email"}
                  value={form.username}
                  onChange={set("username")}
                  className="pr-9"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowUser(v => !v)}
                  tabIndex={-1}
                >
                  {showUser ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Password / Secret{isEdit && <span className="text-muted-foreground font-normal"> (leave blank to keep existing)</span>}</Label>
              <div className="relative">
                <Input
                  type={showPass ? "text" : "password"}
                  placeholder={isEdit ? "••••••••" : "Enter password or secret"}
                  value={form.password}
                  onChange={set("password")}
                  className="pr-9"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowPass(v => !v)}
                  tabIndex={-1}
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea placeholder="Optional — e.g. which bots use this, rotation schedule, etc." value={form.notes} onChange={set("notes")} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? "Save Changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function RpaCredentialsPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<RpaCredential | undefined>();
  const [deleteItem, setDeleteItem] = useState<RpaCredential | undefined>();

  const { data: creds = [], isLoading } = useQuery<RpaCredential[]>({
    queryKey: ["rpa-credentials"],
    queryFn: () => apiFetch("/rpa/credentials"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/rpa/credentials/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Credential deleted");
      qc.invalidateQueries({ queryKey: ["rpa-credentials"] });
      setDeleteItem(undefined);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["rpa-credentials"] });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <KeyRound className="h-8 w-8 text-primary" />Credential Vault
          </h1>
          <p className="text-muted-foreground mt-1">
            Centrally manage encrypted credentials shared across all RPA bots.
            Reference a credential in a bot step using its <code className="text-xs bg-muted px-1 py-0.5 rounded">cred_label</code> field.
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" />Add Credential
        </Button>
      </div>

      {/* Security notice */}
      <div className="flex items-start gap-3 rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-3">
        <ShieldCheck className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-green-700 dark:text-green-400">AES-256 Encrypted at Rest</p>
          <p className="text-muted-foreground text-xs mt-0.5">
            All usernames and passwords are encrypted before storage using the platform encryption key.
            Bot-specific credentials (set in Bot Manager → Creds tab) override global vault credentials with the same name.
          </p>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Stored Credentials</CardTitle>
          <CardDescription>
            {creds.length === 0
              ? "No credentials yet — add one to get started."
              : `${creds.length} credential${creds.length !== 1 ? "s" : ""} in vault`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : creds.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <KeyRound className="h-12 w-12 opacity-20 mb-3" />
              <p className="text-sm">No credentials stored yet.</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => setShowAdd(true)}>
                <Plus className="h-4 w-4 mr-1" />Add First Credential
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label / Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-center w-24">Username</TableHead>
                  <TableHead className="text-center w-24">Password</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-28">Last Updated</TableHead>
                  <TableHead className="w-20 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {creds.map(c => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <code className="text-sm font-mono font-semibold bg-muted px-2 py-0.5 rounded">{c.name}</code>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                      {c.description || <span className="italic opacity-50">—</span>}
                    </TableCell>
                    <TableCell className="text-center">
                      {c.hasUsername
                        ? <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/20 text-xs gap-1"><CheckCircle2 className="h-3 w-3" />Set</Badge>
                        : <Badge variant="outline" className="text-muted-foreground text-xs gap-1"><XCircle className="h-3 w-3" />—</Badge>}
                    </TableCell>
                    <TableCell className="text-center">
                      {c.hasPassword
                        ? <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/20 text-xs gap-1"><CheckCircle2 className="h-3 w-3" />Set</Badge>
                        : <Badge variant="outline" className="text-muted-foreground text-xs gap-1"><XCircle className="h-3 w-3" />—</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">
                      {c.notes || <span className="italic opacity-50">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmt(c.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditItem(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteItem(c)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* How to use section */}
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">How to use credentials in bot steps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>In a bot <strong>fill</strong> step, reference a vault credential by its label:</p>
          <pre className="bg-muted rounded-md px-4 py-3 text-xs font-mono overflow-x-auto">{`{
  "selector": "input[type=email]",
  "cred_label": "admin",       ← matches the credential Name
  "cred_field": "username"     ← "username" or "password"
}`}</pre>
          <p className="text-xs">The bot runner will look up the credential named <code className="bg-muted px-1 rounded">admin</code> from the vault and fill the field with its decrypted value. Bot-specific credentials (Creds tab) override global vault entries with the same name.</p>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <CredentialDialog open={showAdd} onClose={() => setShowAdd(false)} onSaved={refresh} />
      <CredentialDialog open={!!editItem} onClose={() => setEditItem(undefined)} existing={editItem} onSaved={refresh} />

      <AlertDialog open={!!deleteItem} onOpenChange={v => !v && setDeleteItem(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete credential?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteItem?.name}</strong> from the vault.
              Any bots that reference this label via <code className="text-xs bg-muted px-1 rounded">cred_label</code> will
              fall back to bot-specific credentials or fail if none exist.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteItem && deleteMut.mutate(deleteItem.id)}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
