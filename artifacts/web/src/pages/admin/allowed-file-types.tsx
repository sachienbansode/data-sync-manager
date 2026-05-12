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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { FileType, Plus, Trash2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

type FileTypeRow = {
  id: number;
  extension: string;
  mimeType: string;
  label: string;
  enabled: boolean;
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

export default function AllowedFileTypes() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<FileTypeRow[]>({
    queryKey: ["allowed-file-types"],
    queryFn: () => apiFetch("/admin/allowed-file-types"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiFetch(`/admin/allowed-file-types/${id}`, { method: "PUT", body: JSON.stringify({ enabled }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["allowed-file-types"] }),
    onError: () => toast.error("Failed to update"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/admin/allowed-file-types/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allowed-file-types"] });
      toast.success("File type removed");
    },
    onError: () => toast.error("Failed to delete"),
  });

  const enabledCount = data?.filter(t => t.enabled).length ?? 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Allowed File Types</h1>
          <p className="text-muted-foreground mt-2">
            Control which file types users can attach across the platform.{" "}
            <span className="font-medium text-foreground">{enabledCount} types</span> currently allowed.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Type
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileType className="h-5 w-5 text-primary" />
            File Types
          </CardTitle>
          <CardDescription>Toggle to enable or disable each file type platform-wide.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array(8).fill(0).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : (
            <div className="space-y-2">
              {(data ?? []).map((type) => (
                <div
                  key={type.id}
                  className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                    type.enabled ? "bg-card" : "bg-muted/30 opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Badge variant="outline" className="font-mono text-xs shrink-0">{type.extension}</Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{type.label}</p>
                      <p className="text-xs text-muted-foreground truncate font-mono">{type.mimeType}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="text-xs text-muted-foreground hidden sm:block">
                      {type.enabled ? "Allowed" : "Blocked"}
                    </span>
                    <Switch
                      checked={type.enabled}
                      onCheckedChange={(enabled) => toggleMutation.mutate({ id: type.id, enabled })}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteId(type.id)}
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

      <AddTypeDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["allowed-file-types"] });
          setAddOpen(false);
        }}
      />

      <AlertDialog open={deleteId != null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove file type?</AlertDialogTitle>
            <AlertDialogDescription>This file type will no longer be available for attachments.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteId) deleteMutation.mutate(deleteId); setDeleteId(null); }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddTypeDialog({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [extension, setExtension] = useState("");
  const [mimeType, setMimeType] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!extension.trim() || !mimeType.trim() || !label.trim()) {
      toast.error("All fields are required");
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/admin/allowed-file-types", {
        method: "POST",
        body: JSON.stringify({ extension: extension.trim(), mimeType: mimeType.trim(), label: label.trim() }),
      });
      toast.success("File type added");
      setExtension(""); setMimeType(""); setLabel("");
      onSuccess();
    } catch {
      toast.error("Failed to add file type");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add File Type</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Extension <span className="text-muted-foreground text-xs">(e.g. .pdf)</span></Label>
            <Input value={extension} onChange={(e) => setExtension(e.target.value)} placeholder=".pdf" />
          </div>
          <div className="space-y-1.5">
            <Label>MIME Type <span className="text-muted-foreground text-xs">(e.g. application/pdf)</span></Label>
            <Input value={mimeType} onChange={(e) => setMimeType(e.target.value)} placeholder="application/pdf" />
          </div>
          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="PDF Document" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Adding…" : "Add Type"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
