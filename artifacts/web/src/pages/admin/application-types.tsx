import { useState } from "react";
import { getAccessToken } from "@/lib/auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Layers, Plus, Pencil, Trash2, Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

type AppType = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
};

function apiFetch(path: string, opts: RequestInit = {}) {
  const token = getAccessToken();
  return fetch(`${BASE}api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((opts.headers as Record<string, string>) ?? {}),
    },
  }).then(async (r) => {
    if (r.status === 204) return null;
    const d = await r.json();
    if (!r.ok) throw new Error(d.error ?? "Request failed");
    return d;
  });
}

export default function ApplicationTypes() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRow, setEditRow] = useState<AppType | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<AppType[]>({
    queryKey: ["application-types"],
    queryFn: () => apiFetch("/admin/application-types"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiFetch(`/admin/application-types/${id}`, { method: "PUT", body: JSON.stringify({ isActive }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["application-types"] }),
    onError: () => toast.error("Failed to update"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/admin/application-types/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["application-types"] });
      toast.success("Application type removed");
    },
    onError: () => toast.error("Failed to delete"),
  });

  function openAdd() { setEditRow(null); setDialogOpen(true); }
  function openEdit(row: AppType) { setEditRow(row); setDialogOpen(true); }

  const activeCount = data?.filter(t => t.isActive).length ?? 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Application Types</h1>
          <p className="text-muted-foreground mt-2">
            Define connection categories used when registering database connections.{" "}
            <span className="font-medium text-foreground">{activeCount} active</span> type{activeCount !== 1 ? "s" : ""}.
          </p>
        </div>
        <Button onClick={openAdd} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Type
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            Connection Types
          </CardTitle>
          <CardDescription>
            These values appear in the Application Type dropdown when creating or editing a DB connection.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : (data ?? []).length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No application types defined yet.</p>
          ) : (
            <div className="space-y-2">
              {(data ?? []).map((row) => (
                <div
                  key={row.id}
                  className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                    row.isActive ? "bg-card" : "bg-muted/30 opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{row.name}</p>
                        <Badge variant="outline" className="font-mono text-[10px]">{row.slug}</Badge>
                        {!row.isActive && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                      </div>
                      {row.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{row.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <Switch
                      checked={row.isActive}
                      onCheckedChange={(isActive) => toggleMutation.mutate({ id: row.id, isActive })}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={() => openEdit(row)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteId(row.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AppTypeDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        editRow={editRow}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["application-types"] });
          setDialogOpen(false);
        }}
      />

      <AlertDialog open={deleteId != null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete application type?</AlertDialogTitle>
            <AlertDialogDescription>
              Existing connections that use this type will keep their current value, but the type will no longer
              appear in the dropdown for new connections.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteId) deleteMutation.mutate(deleteId); setDeleteId(null); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AppTypeDialog({
  open, onClose, editRow, onSuccess,
}: {
  open: boolean; onClose: () => void; editRow: AppType | null; onSuccess: () => void;
}) {
  const [name, setName] = useState(editRow?.name ?? "");
  const [slug, setSlug] = useState(editRow?.slug ?? "");
  const [description, setDescription] = useState(editRow?.description ?? "");
  const [sortOrder, setSortOrder] = useState(String(editRow?.sortOrder ?? "0"));
  const [saving, setSaving] = useState(false);

  function autoSlug(n: string) {
    return n.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
  }

  function handleNameChange(v: string) {
    setName(v);
    if (!editRow) setSlug(autoSlug(v));
  }

  async function handleSave() {
    if (!name.trim() || !slug.trim()) { toast.error("Name and slug are required"); return; }
    setSaving(true);
    try {
      if (editRow) {
        await apiFetch(`/admin/application-types/${editRow.id}`, {
          method: "PUT",
          body: JSON.stringify({ name: name.trim(), description: description.trim() || null, sortOrder: parseInt(sortOrder) || 0 }),
        });
        toast.success("Application type updated");
      } else {
        await apiFetch("/admin/application-types", {
          method: "POST",
          body: JSON.stringify({ name: name.trim(), slug: slug.trim(), description: description.trim() || null, sortOrder: parseInt(sortOrder) || 0 }),
        });
        toast.success("Application type added");
      }
      onSuccess();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editRow ? "Edit Application Type" : "Add Application Type"}</DialogTitle>
          <DialogDescription>
            {editRow
              ? "Update the name or description. Slug cannot be changed after creation."
              : "Define a new connection category. The slug is auto-generated and stored with connections."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="e.g. Trading Platform" />
          </div>
          <div className="space-y-1.5">
            <Label>Slug * {editRow && <span className="text-xs text-muted-foreground font-normal">(read-only)</span>}</Label>
            <Input
              value={editRow ? editRow.slug : slug}
              onChange={(e) => { if (!editRow) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "")); }}
              readOnly={!!editRow}
              className={editRow ? "bg-muted text-muted-foreground cursor-not-allowed font-mono text-sm" : "font-mono text-sm"}
              placeholder="e.g. trading-platform"
            />
            <p className="text-[11px] text-muted-foreground">Used as the stored value in connections. Must be unique and URL-safe.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description of this connection type" rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>Sort Order</Label>
            <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} placeholder="0" className="w-24" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editRow ? "Save Changes" : "Add Type"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
