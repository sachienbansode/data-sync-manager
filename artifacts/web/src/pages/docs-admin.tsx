import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useListDocApps,
  useCreateDocApp,
  useUpdateDocApp,
  useDeleteDocApp,
  useGetDocAppRbac,
  useUpdateDocAppRbac,
  useListDocAppSpecs,
  getListDocAppsQueryKey,
  getListDocAppSpecsQueryKey,
  getGetDocAppRbacQueryKey,
} from "@workspace/api-client-react";
import { getAccessToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Plus, Settings, Trash2, Upload, LinkIcon, Shield, FileCode,
  ChevronDown, ChevronRight, Edit3, Eye, ArrowLeft, CheckCircle,
  AlertCircle, Copy, Download,
} from "lucide-react";

const SAMPLE_OPENAPI = `openapi: "3.0.3"
info:
  title: My API
  description: Enter a description for your API here.
  version: "1.0.0"
servers:
  - url: https://api.example.com/v1
paths:
  /users:
    get:
      summary: List users
      operationId: listUsers
      tags:
        - Users
      responses:
        "200":
          description: A list of users
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/User"
  /users/{id}:
    get:
      summary: Get user by ID
      operationId: getUserById
      tags:
        - Users
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: A user
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/User"
        "404":
          description: User not found
components:
  schemas:
    User:
      type: object
      properties:
        id:
          type: integer
        name:
          type: string
        email:
          type: string
          format: email
`;

export default function DocsAdmin() {
  const queryClient = useQueryClient();
  const { data: apps, isLoading } = useListDocApps();

  const [createOpen, setCreateOpen] = useState(false);
  const [editApp, setEditApp] = useState<{ id: number; name: string; description: string; tags: string[] } | null>(null);
  const [deleteAppId, setDeleteAppId] = useState<number | null>(null);
  const [specAppId, setSpecAppId] = useState<number | null>(null);
  const [rbacAppId, setRbacAppId] = useState<number | null>(null);
  const [expandedAppId, setExpandedAppId] = useState<number | null>(null);

  const deleteMutation = useDeleteDocApp();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="space-y-3">
          {[1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/docs">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">API Docs Admin</h1>
            <p className="text-muted-foreground mt-1">
              Register applications, write or upload OpenAPI specs, and control access by role.
            </p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" />
          New Application
        </Button>
      </div>

      {/* Workflow steps hint */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { step: "1", title: "Register", desc: "Add a new API application with name, description and tags." },
          { step: "2", title: "Add Spec", desc: "Write an OpenAPI spec inline, upload a YAML/JSON file, or link a URL." },
          { step: "3", title: "Set Access", desc: "Grant roles permission to view each application's documentation." },
        ].map((s) => (
          <div key={s.step} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border">
            <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">
              {s.step}
            </div>
            <div>
              <p className="text-sm font-semibold">{s.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {(apps ?? []).length === 0 ? (
        <div className="text-center py-16 border rounded-lg bg-muted/20">
          <FileCode className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
          <p className="text-muted-foreground font-medium">No applications registered yet.</p>
          <p className="text-sm text-muted-foreground mt-1">Create your first application to get started.</p>
          <Button className="mt-4 gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Register First Application
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {(apps ?? []).map((app) => (
            <Card key={app.id} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div
                    className="flex items-center gap-2 cursor-pointer flex-1 min-w-0"
                    onClick={() => setExpandedAppId(expandedAppId === app.id ? null : app.id)}
                  >
                    {expandedAppId === app.id
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    }
                    <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <FileCode className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{app.name}</CardTitle>
                      {app.description && (
                        <CardDescription className="text-xs truncate">{app.description}</CardDescription>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {app.latestVersion != null ? (
                        <Badge variant="secondary" className="text-xs">v{app.latestVersion}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          No spec
                        </Badge>
                      )}
                      {(app.tags ?? []).map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs hidden sm:flex">{tag}</Badge>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-1 shrink-0 ml-2">
                    <Button variant="ghost" size="icon" title="Manage spec versions" onClick={() => setSpecAppId(app.id)}>
                      <Upload className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title="View docs" asChild>
                      <Link href={`/docs/${app.id}`}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button variant="ghost" size="icon" title="Role access" onClick={() => setRbacAppId(app.id)}>
                      <Shield className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title="Edit" onClick={() => setEditApp({ id: app.id, name: app.name, description: app.description, tags: app.tags ?? [] })}>
                      <Settings className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      title="Delete"
                      onClick={() => setDeleteAppId(app.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
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

      {/* Dialogs */}
      <CreateAppDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: getListDocAppsQueryKey() });
          setCreateOpen(false);
        }}
      />

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

      <AlertDialog open={deleteAppId != null} onOpenChange={() => setDeleteAppId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Application</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the application and all its spec versions. This cannot be undone.
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

      {specAppId != null && (
        <SpecManagerDialog
          appId={specAppId}
          onClose={() => setSpecAppId(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: getListDocAppsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListDocAppSpecsQueryKey(specAppId) });
            setSpecAppId(null);
          }}
        />
      )}

      {rbacAppId != null && (
        <RbacDialog
          appId={rbacAppId}
          onClose={() => setRbacAppId(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: [getGetDocAppRbacQueryKey(rbacAppId)] });
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
    return <p className="text-sm text-muted-foreground italic">No spec versions uploaded yet.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Spec Versions</p>
      {specs.map((spec) => (
        <div key={spec.id} className="flex items-center justify-between p-2.5 rounded-md bg-muted/30 border text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium">v{spec.version}</span>
            {spec.isActive && <Badge className="h-4 text-xs px-1.5">active</Badge>}
            {(spec as { hasInlineContent?: boolean }).hasInlineContent && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Edit3 className="h-3 w-3" /> inline
              </span>
            )}
            {spec.specUrl && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <LinkIcon className="h-3 w-3" /> url
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
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
      <div className="flex flex-wrap gap-1 p-2 border rounded-md min-h-[40px] focus-within:ring-2 focus-within:ring-ring">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
            {tag}
            <button type="button" onClick={() => onChange(tags.filter((t) => t !== tag))} className="hover:text-destructive">×</button>
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Register New Application</DialogTitle>
          <DialogDescription>Add an API service to the documentation directory.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. User Service API" autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description of what this API does" rows={3} />
          </div>
          <TagsInput tags={tags} onChange={setTags} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Registering…" : "Register Application"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditAppDialog({ app, onClose, onSuccess }: {
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Application</DialogTitle>
          <DialogDescription>Update the application's name, description or tags.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
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

function SpecManagerDialog({ appId, onClose, onSuccess }: {
  appId: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { data: specs } = useListDocAppSpecs(appId);
  const [tab, setTab] = useState<"write" | "upload" | "url">("write");
  const [specContent, setSpecContent] = useState(SAMPLE_OPENAPI);
  const [specUrl, setSpecUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingVersion, setEditingVersion] = useState<number | null>(null);
  const [loadingVersion, setLoadingVersion] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadVersionForEdit = async (version: number) => {
    setLoadingVersion(true);
    setEditingVersion(version);
    try {
      const token = getAccessToken();
      const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
      const resp = await fetch(`${base}/api/docs/apps/${appId}/specs/${version}/raw`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (resp.ok) {
        const data = await resp.json() as { content: string };
        setSpecContent(data.content || SAMPLE_OPENAPI);
        setTab("write");
      }
    } finally {
      setLoadingVersion(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = getAccessToken();
      const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      if (tab === "write") {
        if (!specContent.trim()) { toast.error("Spec content cannot be empty"); return; }

        if (editingVersion != null) {
          // Update existing version's inline content
          const resp = await fetch(`${base}/api/docs/apps/${appId}/specs/${editingVersion}/content`, {
            method: "PUT",
            headers,
            body: JSON.stringify({ content: specContent }),
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({})) as { error?: string };
            throw new Error(err.error ?? "Failed to update spec");
          }
          toast.success(`Spec v${editingVersion} updated`);
        } else {
          // Create new version
          const resp = await fetch(`${base}/api/docs/apps/${appId}/specs`, {
            method: "POST",
            headers,
            body: JSON.stringify({ content: specContent }),
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({})) as { error?: string };
            throw new Error(err.error ?? "Failed to save spec");
          }
          toast.success("New spec version saved");
        }
      } else if (tab === "upload") {
        if (!file) { toast.error("Please select a file"); return; }
        const text = await file.text();
        const resp = await fetch(`${base}/api/docs/apps/${appId}/specs`, {
          method: "POST",
          headers,
          body: JSON.stringify({ content: text }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? "Upload failed");
        }
        toast.success("Spec uploaded successfully");
      } else if (tab === "url") {
        if (!specUrl.trim()) { toast.error("Spec URL is required"); return; }
        const resp = await fetch(`${base}/api/docs/apps/${appId}/specs`, {
          method: "POST",
          headers,
          body: JSON.stringify({ specUrl: specUrl.trim() }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? "Failed to add URL spec");
        }
        toast.success("Spec URL registered");
      }

      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save spec");
    } finally {
      setSaving(false);
    }
  };

  const handleFilePick = async (f: File) => {
    setFile(f);
    if (tab === "write" || tab === "upload") {
      const text = await f.text();
      setSpecContent(text);
      setTab("write");
      setEditingVersion(null);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(specContent);
    toast.success("Copied to clipboard");
  };

  const downloadSpec = () => {
    const blob = new Blob([specContent], { type: "text/yaml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `openapi-v${editingVersion ?? "new"}.yaml`;
    a.click();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-full h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileCode className="h-5 w-5 text-primary" />
            {editingVersion != null ? `Edit Spec v${editingVersion}` : "Add Spec Version"}
          </DialogTitle>
          <DialogDescription>
            Write your OpenAPI spec inline, upload a file, or link an external URL.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: version history */}
          <div className="w-48 border-r flex flex-col shrink-0 bg-muted/20">
            <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b">
              Versions
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              <button
                className={`w-full text-left px-2 py-2 rounded-md text-sm transition-colors flex items-center gap-2 ${
                  editingVersion == null
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
                onClick={() => { setEditingVersion(null); setSpecContent(SAMPLE_OPENAPI); setTab("write"); }}
              >
                <Plus className="h-3 w-3 shrink-0" />
                New version
              </button>
              {(specs ?? []).map((spec) => (
                <button
                  key={spec.id}
                  className={`w-full text-left px-2 py-2 rounded-md text-sm transition-colors flex items-center gap-2 ${
                    editingVersion === spec.version
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                  onClick={() => loadVersionForEdit(spec.version)}
                  disabled={loadingVersion}
                >
                  <span className="font-medium shrink-0">v{spec.version}</span>
                  {spec.isActive && (
                    <CheckCircle className="h-3 w-3 shrink-0 text-emerald-500" />
                  )}
                </button>
              ))}
              {(specs ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground px-2 py-1">No versions yet</p>
              )}
            </div>
          </div>

          {/* Right: editor area */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <div className="border-b px-4 py-2 flex items-center gap-2 shrink-0">
              <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex-1">
                <TabsList className="h-8">
                  <TabsTrigger value="write" className="text-xs gap-1.5 h-6 px-3">
                    <Edit3 className="h-3 w-3" /> Write
                  </TabsTrigger>
                  <TabsTrigger value="upload" className="text-xs gap-1.5 h-6 px-3">
                    <Upload className="h-3 w-3" /> Upload File
                  </TabsTrigger>
                  <TabsTrigger value="url" className="text-xs gap-1.5 h-6 px-3">
                    <LinkIcon className="h-3 w-3" /> URL
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {tab === "write" && (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Copy" onClick={copyToClipboard}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Download" onClick={downloadSpec}>
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload className="h-3 w-3" /> Import
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".yaml,.yml,.json"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFilePick(f); }}
                  />
                </div>
              )}
            </div>

            <div className="flex-1 overflow-auto p-4">
              <Tabs value={tab}>
                <TabsContent value="write" className="mt-0 h-full">
                  <div className="space-y-2 h-full flex flex-col">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        OpenAPI 3.x YAML or JSON — stored directly in the database, no external storage needed.
                      </p>
                      <Button
                        variant="link"
                        size="sm"
                        className="text-xs h-auto p-0"
                        onClick={() => setSpecContent(SAMPLE_OPENAPI)}
                      >
                        Load sample
                      </Button>
                    </div>
                    <textarea
                      className="flex-1 w-full font-mono text-sm border rounded-md p-3 bg-muted/20 focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                      style={{ minHeight: "420px" }}
                      value={specContent}
                      onChange={(e) => setSpecContent(e.target.value)}
                      spellCheck={false}
                      placeholder="Paste or write your OpenAPI spec here (YAML or JSON)…"
                    />
                  </div>
                </TabsContent>

                <TabsContent value="upload" className="mt-0">
                  <div className="border-2 border-dashed rounded-lg p-10 text-center space-y-3">
                    <Upload className="h-10 w-10 text-muted-foreground/40 mx-auto" />
                    <div>
                      <p className="font-medium">Upload OpenAPI YAML or JSON</p>
                      <p className="text-sm text-muted-foreground mt-1">The file will be read and stored inline — no S3 required.</p>
                    </div>
                    <Input
                      type="file"
                      accept=".yaml,.yml,.json"
                      className="max-w-xs mx-auto"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFilePick(f); }}
                    />
                    {file && (
                      <div className="flex items-center justify-center gap-2 text-sm text-emerald-600">
                        <CheckCircle className="h-4 w-4" />
                        {file.name} — {(file.size / 1024).toFixed(1)} KB
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="url" className="mt-0">
                  <div className="space-y-4 max-w-lg">
                    <div className="space-y-2">
                      <Label>OpenAPI Spec URL</Label>
                      <Input
                        value={specUrl}
                        onChange={(e) => setSpecUrl(e.target.value)}
                        placeholder="https://api.example.com/openapi.json"
                      />
                      <p className="text-xs text-muted-foreground">
                        Must be a publicly accessible URL returning a valid OpenAPI JSON or YAML document.
                        The URL will be stored as a reference and fetched by the documentation viewer.
                      </p>
                    </div>
                    <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
                      <AlertCircle className="h-3.5 w-3.5 inline mr-1" />
                      Private/internal URLs are blocked for security. The URL must resolve to a public IP address.
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t flex items-center justify-between shrink-0 bg-muted/10">
          <p className="text-xs text-muted-foreground">
            {editingVersion != null
              ? `Updating inline content of v${editingVersion} — this replaces the existing spec content.`
              : "A new version number will be assigned automatically and set as the active version."}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving
                ? "Saving…"
                : editingVersion != null
                ? <><Edit3 className="h-4 w-4" /> Update Spec</>
                : <><Plus className="h-4 w-4" /> Save New Version</>
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RbacDialog({ appId, onClose, onSuccess }: {
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
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Role Access Control
          </DialogTitle>
          <DialogDescription>
            Select which roles can view this application's API documentation.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <div className="space-y-2">
            {(rbac ?? []).map((role) => (
              <div key={role.roleId} className="flex items-center gap-3 p-2.5 rounded-md border hover:bg-muted/30 transition-colors">
                <Checkbox
                  id={`role-${role.roleId}`}
                  checked={selectedRoleIds.includes(role.roleId)}
                  onCheckedChange={(checked) =>
                    setSelectedRoleIds((prev) =>
                      checked ? [...prev, role.roleId] : prev.filter((id) => id !== role.roleId)
                    )
                  }
                />
                <Label htmlFor={`role-${role.roleId}`} className="cursor-pointer flex-1 font-medium">
                  {role.roleName}
                </Label>
                {selectedRoleIds.includes(role.roleId) && (
                  <Badge variant="secondary" className="text-xs">Access granted</Badge>
                )}
              </div>
            ))}
            {(rbac ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No roles defined yet.</p>
            )}
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
