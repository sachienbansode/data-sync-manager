import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDocApps,
  useListRoles,
  useCreateDocApp,
  useUpdateDocApp,
  useDeleteDocApp,
  useUploadDocAppSpec,
  useGetDocAppRbac,
  useUpdateDocAppRbac,
  useListDocAppSpecs,
  getListDocAppsQueryKey,
  getListDocAppSpecsQueryKey,
  getGetDocAppRbacQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, Settings, Trash2, Upload, Link, Shield, FileCode, ChevronDown, ChevronRight } from "lucide-react";

export default function DocsAdmin() {
  const queryClient = useQueryClient();
  const { data: apps, isLoading } = useListDocApps();

  const [createOpen, setCreateOpen] = useState(false);
  const [editApp, setEditApp] = useState<{ id: number; name: string; description: string; tags: string[] } | null>(null);
  const [deleteAppId, setDeleteAppId] = useState<number | null>(null);
  const [specAppId, setSpecAppId] = useState<number | null>(null);
  const [rbacAppId, setRbacAppId] = useState<number | null>(null);
  const [expandedAppId, setExpandedAppId] = useState<number | null>(null);

  const createMutation = useCreateDocApp();
  const updateMutation = useUpdateDocApp();
  const deleteMutation = useDeleteDocApp();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">API Docs Admin</h1>
          <p className="text-muted-foreground mt-2">Manage registered applications and their specs.</p>
        </div>
        <div className="space-y-3">
          {[1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">API Docs Admin</h1>
          <p className="text-muted-foreground mt-2">Manage API applications, spec versions, and role access.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New Application
        </Button>
      </div>

      {(apps ?? []).length === 0 ? (
        <div className="text-center py-16 border rounded-lg bg-muted/20">
          <FileCode className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
          <p className="text-muted-foreground font-medium">No applications registered yet.</p>
          <Button className="mt-4 gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Register first application
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {(apps ?? []).map((app) => (
            <Card key={app.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div
                    className="flex items-center gap-2 cursor-pointer flex-1 min-w-0"
                    onClick={() => setExpandedAppId(expandedAppId === app.id ? null : app.id)}
                  >
                    {expandedAppId === app.id ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <FileCode className="h-4 w-4 text-primary shrink-0" />
                    <CardTitle className="text-base truncate">{app.name}</CardTitle>
                    {app.latestVersion != null && (
                      <Badge variant="secondary">v{app.latestVersion}</Badge>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Manage role access"
                      onClick={() => setRbacAppId(app.id)}
                    >
                      <Shield className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Upload spec"
                      onClick={() => setSpecAppId(app.id)}
                    >
                      <Upload className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Edit application"
                      onClick={() => setEditApp({ id: app.id, name: app.name, description: app.description, tags: app.tags ?? [] })}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      title="Delete application"
                      onClick={() => setDeleteAppId(app.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {app.description && (
                  <CardDescription className="ml-10">{app.description}</CardDescription>
                )}
              </CardHeader>
              {expandedAppId === app.id && (
                <CardContent className="pt-0">
                  <Separator className="mb-4" />
                  <SpecVersionList appId={app.id} />
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Create Application Dialog */}
      <CreateAppDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: getListDocAppsQueryKey() });
          setCreateOpen(false);
        }}
      />

      {/* Edit Application Dialog */}
      {editApp && (
        <EditAppDialog
          app={editApp}
          onClose={() => setEditApp(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: getListDocAppsQueryKey() });
            setEditApp(null);
          }}
        />
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={deleteAppId != null} onOpenChange={() => setDeleteAppId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Application</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the application and all its spec versions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deleteAppId) return;
                try {
                  await deleteMutation.mutateAsync({ id: deleteAppId });
                  queryClient.invalidateQueries({ queryKey: getListDocAppsQueryKey() });
                  toast.success("Application deleted");
                } catch {
                  toast.error("Failed to delete application");
                }
                setDeleteAppId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Upload Spec Dialog */}
      {specAppId != null && (
        <UploadSpecDialog
          appId={specAppId}
          onClose={() => setSpecAppId(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: getListDocAppsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListDocAppSpecsQueryKey(specAppId) });
            setSpecAppId(null);
          }}
        />
      )}

      {/* RBAC Dialog */}
      {rbacAppId != null && (
        <RbacDialog
          appId={rbacAppId}
          onClose={() => setRbacAppId(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: getListDocAppsQueryKey() });
            setRbacAppId(null);
          }}
        />
      )}
    </div>
  );
}

function SpecVersionList({ appId }: { appId: number }) {
  const { data: specs, isLoading } = useListDocAppSpecs(appId);

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (!specs || specs.length === 0) {
    return <p className="text-sm text-muted-foreground">No spec versions uploaded yet.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground mb-2">Spec Versions</p>
      {specs.map((spec) => (
        <div key={spec.id} className="flex items-center justify-between p-2 rounded-md bg-muted/30 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium">v{spec.version}</span>
            {spec.isActive && <Badge variant="default" className="h-4 text-xs">active</Badge>}
            {spec.specUrl && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Link className="h-3 w-3" />
                URL spec
              </span>
            )}
          </div>
          <span className="text-muted-foreground text-xs">
            {new Date(spec.uploadedAt).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

function TagsInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState("");

  const addTag = (value: string) => {
    const tag = value.trim().replace(/\s+/g, "-");
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setInput("");
  };

  return (
    <div className="space-y-2">
      <Label>Tags</Label>
      <div className="flex flex-wrap gap-1 p-2 border rounded-md min-h-[40px]">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="hover:text-destructive transition-colors"
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder="Add tag, press Enter…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(input); }
            if (e.key === "Backspace" && !input && tags.length > 0) onChange(tags.slice(0, -1));
          }}
          onBlur={() => { if (input.trim()) addTag(input); }}
        />
      </div>
      <p className="text-xs text-muted-foreground">Press Enter or comma to add a tag</p>
    </div>
  );
}

function CreateAppDialog({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const createMutation = useCreateDocApp();

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    try {
      await createMutation.mutateAsync({ data: { name: name.trim(), description: description.trim(), tags } });
      toast.success("Application registered");
      setName(""); setDescription(""); setTags([]);
      onSuccess();
    } catch {
      toast.error("Failed to register application");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register Application</DialogTitle>
          <DialogDescription>Add a new application to the API documentation directory.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My API Service" />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this application's API"
              rows={3}
            />
          </div>
          <TagsInput tags={tags} onChange={setTags} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Registering…" : "Register"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditAppDialog({
  app,
  onClose,
  onSuccess,
}: {
  app: { id: number; name: string; description: string; tags: string[] };
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(app.name);
  const [description, setDescription] = useState(app.description);
  const [tags, setTags] = useState<string[]>(app.tags ?? []);
  const updateMutation = useUpdateDocApp();

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    try {
      await updateMutation.mutateAsync({ id: app.id, data: { name: name.trim(), description: description.trim(), tags } });
      toast.success("Application updated");
      onSuccess();
    } catch {
      toast.error("Failed to update application");
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Application</DialogTitle>
          <DialogDescription>Update the application details.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <TagsInput tags={tags} onChange={setTags} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadSpecDialog({
  appId,
  onClose,
  onSuccess,
}: {
  appId: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [mode, setMode] = useState<"file" | "url">("file");
  const [specUrl, setSpecUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const uploadMutation = useUploadDocAppSpec();

  const handleSubmit = async () => {
    try {
      if (mode === "url") {
        if (!specUrl.trim()) { toast.error("Spec URL is required"); return; }
        await uploadMutation.mutateAsync({
          id: appId,
          data: { specUrl: specUrl.trim() },
        });
      } else {
        if (!file) { toast.error("Please select a file"); return; }
        const formData = new FormData();
        formData.append("file", file);
        const token = (await import("@/lib/auth")).getAccessToken();
        const resp = await fetch(
          `${import.meta.env.BASE_URL}api/docs/apps/${appId}/specs`,
          {
            method: "POST",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
          }
        );
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error ?? "Upload failed");
        }
      }
      toast.success("Spec version uploaded successfully");
      onSuccess();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to upload spec");
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Spec Version</DialogTitle>
          <DialogDescription>Upload a new OpenAPI spec version for this application.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              variant={mode === "file" ? "default" : "outline"}
              size="sm"
              className="gap-2"
              onClick={() => setMode("file")}
            >
              <Upload className="h-3 w-3" />
              File Upload
            </Button>
            <Button
              variant={mode === "url" ? "default" : "outline"}
              size="sm"
              className="gap-2"
              onClick={() => setMode("url")}
            >
              <Link className="h-3 w-3" />
              Spec URL
            </Button>
          </div>

          {mode === "file" ? (
            <div className="space-y-2">
              <Label>OpenAPI YAML or JSON file</Label>
              <Input
                type="file"
                accept=".yaml,.yml,.json"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">Max file size: 10 MB</p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Spec URL</Label>
              <Input
                value={specUrl}
                onChange={(e) => setSpecUrl(e.target.value)}
                placeholder="https://your-api.example.com/openapi.json"
              />
              <p className="text-xs text-muted-foreground">
                The spec will be fetched and cached. Must return a valid OpenAPI JSON or YAML document.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={uploadMutation.isPending}>
            {uploadMutation.isPending ? "Uploading…" : "Upload Spec"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RbacDialog({
  appId,
  onClose,
  onSuccess,
}: {
  appId: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { data: rbac, isLoading } = useGetDocAppRbac(appId);
  const updateRbacMutation = useUpdateDocAppRbac();
  const [selectedRoleIds, setSelectedRoleIds] = useState<number[]>([]);
  const [initialized, setInitialized] = useState(false);

  if (rbac && !initialized) {
    setSelectedRoleIds(rbac.filter((r) => r.hasAccess).map((r) => r.roleId));
    setInitialized(true);
  }

  const toggleRole = (roleId: number, checked: boolean) => {
    setSelectedRoleIds((prev) =>
      checked ? [...prev, roleId] : prev.filter((id) => id !== roleId)
    );
  };

  const handleSave = async () => {
    try {
      await updateRbacMutation.mutateAsync({ id: appId, data: { roleIds: selectedRoleIds } });
      toast.success("Role access updated");
      onSuccess();
    } catch {
      toast.error("Failed to update role access");
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage Role Access</DialogTitle>
          <DialogDescription>
            Control which roles can view this application's API documentation.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : (
          <div className="space-y-3">
            {(rbac ?? []).map((role) => (
              <div key={role.roleId} className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted/30">
                <Checkbox
                  id={`role-${role.roleId}`}
                  checked={selectedRoleIds.includes(role.roleId)}
                  onCheckedChange={(checked) => toggleRole(role.roleId, checked === true)}
                />
                <Label htmlFor={`role-${role.roleId}`} className="cursor-pointer flex-1">
                  <span className="font-medium">{role.roleName}</span>
                </Label>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={updateRbacMutation.isPending || isLoading}>
            {updateRbacMutation.isPending ? "Saving…" : "Save Access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
