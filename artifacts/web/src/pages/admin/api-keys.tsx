import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Key, Plus, Trash2, ToggleLeft, ToggleRight, Copy, Check, Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getAccessToken } from "@/lib/auth";
import { formatDate } from "@/lib/date";

interface ApiKey {
  id: number;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = await getAccessToken();
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export default function ApiKeys() {
  const qc = useQueryClient();

  const [createOpen, setCreateOpen]   = useState(false);
  const [newName, setNewName]         = useState("");
  const [newExpiry, setNewExpiry]     = useState("");
  const [createdKey, setCreatedKey]   = useState<string | null>(null);
  const [copied, setCopied]           = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null);

  const { data: keys = [], isLoading } = useQuery<ApiKey[]>({
    queryKey: ["api-keys"],
    queryFn: () => apiFetch("/api/api-keys"),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), expiresAt: newExpiry || undefined }),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      setCreatedKey(data.key);
      setNewName("");
      setNewExpiry("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/api-keys/${id}/toggle`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("API key deleted.");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function copyKey() {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleCreate() {
    if (!newName.trim()) { toast.error("Key name is required."); return; }
    createMutation.mutate();
  }

  function handleCreateDialogClose(open: boolean) {
    if (!open) {
      setCreateOpen(false);
      setCreatedKey(null);
      setCopied(false);
      setNewName("");
      setNewExpiry("");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Key className="h-6 w-6 text-primary" />
            API Keys
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Generate keys to authenticate external API requests (e.g. Branch Migration status look-up).
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Generate Key
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Your API Keys
            {keys.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">({keys.length})</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key Prefix</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <TableCell key={j}><div className="h-4 bg-muted rounded animate-pulse w-24" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : keys.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                      No API keys yet. Click "Generate Key" to create one.
                    </TableCell>
                  </TableRow>
                ) : keys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{k.keyPrefix}…</TableCell>
                    <TableCell>
                      {k.isActive
                        ? <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Active</Badge>
                        : <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">Disabled</Badge>
                      }
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {k.lastUsedAt ? formatDate(k.lastUsedAt) : "Never"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {k.expiresAt ? formatDate(k.expiresAt) : "Never"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(k.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title={k.isActive ? "Disable key" : "Enable key"}
                          onClick={() => toggleMutation.mutate(k.id)}
                          disabled={toggleMutation.isPending}
                        >
                          {k.isActive
                            ? <ToggleRight className="h-4 w-4 text-green-600" />
                            : <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                          }
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(k)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Create / Show Key Dialog */}
      <Dialog open={createOpen} onOpenChange={handleCreateDialogClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{createdKey ? "Key Created — Copy Now" : "Generate API Key"}</DialogTitle>
          </DialogHeader>

          {createdKey ? (
            <div className="space-y-4">
              <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800 dark:text-amber-300 font-medium">
                  This is the only time the full key will be shown. Copy it now and store it safely.
                </AlertDescription>
              </Alert>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-muted px-3 py-2 rounded font-mono break-all select-all">
                  {createdKey}
                </code>
                <Button variant="outline" size="icon" onClick={copyKey} title="Copy to clipboard">
                  {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => handleCreateDialogClose(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Key Name *</label>
                <Input
                  placeholder="e.g. CBS Integration, Postman Test"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Expiry Date <span className="text-muted-foreground font-normal">(optional)</span></label>
                <Input
                  type="date"
                  value={newExpiry}
                  onChange={(e) => setNewExpiry(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => handleCreateDialogClose(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={createMutation.isPending}>
                  {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Generate
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete API Key</AlertDialogTitle>
            <AlertDialogDescription>
              Delete key <strong>{deleteTarget?.name}</strong> ({deleteTarget?.keyPrefix}…)?
              Any system using this key will immediately lose access. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
