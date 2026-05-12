import { useState, useEffect, useCallback } from "react";
import { getAccessToken } from "@/lib/auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Mail, Plus, Pencil, Trash2, SendHorizonal, Search, Eye, Tag } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

interface EmailTemplate {
  id: number;
  slug: string;
  name: string;
  subject: string;
  body: string;
  variables: string[];
  isSystem: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

const SAMPLE_VARS: Record<string, string> = {
  firstName: "Ananya",
  otp: "847362",
  expiryMinutes: "10",
  appName: "Ashika Platform",
  pipelineName: "Daily Sales Sync",
  pipelineId: "42",
  recordCount: "1,250",
  completedAt: "12 May 2026, 09:30:00",
  failures: "3",
  errorMessage: "Connection refused — destination host unreachable",
  timestamp: "12 May 2026, 09:30:00",
};

function renderPreview(html: string): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_, k) => SAMPLE_VARS[k] ?? `{{${k}}}`);
}

async function apiFetch(path: string, opts?: RequestInit) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...opts?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.status === 204 ? null : res.json();
}

const EMPTY_FORM = {
  name: "", slug: "", subject: "", body: "", description: "",
  variables: "" as string, // comma-separated input
};

export default function EmailTemplates() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EmailTemplate | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [deleteTarget, setDeleteTarget] = useState<EmailTemplate | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("edit");

  const { data: templates = [], isLoading } = useQuery<EmailTemplate[]>({
    queryKey: ["email-templates"],
    queryFn: () => apiFetch("api/admin/email-templates"),
  });

  const filtered = templates.filter(t =>
    !search || t.name.toLowerCase().includes(search.toLowerCase())
      || t.slug.toLowerCase().includes(search.toLowerCase())
  );

  function openCreate() {
    setEditTarget(null);
    setForm({ ...EMPTY_FORM });
    setActiveTab("edit");
    setDialogOpen(true);
  }

  function openEdit(t: EmailTemplate) {
    setEditTarget(t);
    setForm({
      name: t.name, slug: t.slug, subject: t.subject, body: t.body,
      description: t.description ?? "",
      variables: t.variables.join(", "),
    });
    setActiveTab("edit");
    setDialogOpen(true);
  }

  const updatePreview = useCallback(() => {
    setPreviewHtml(renderPreview(form.body));
  }, [form.body]);

  useEffect(() => { updatePreview(); }, [updatePreview]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        subject: form.subject.trim(),
        body: form.body.trim(),
        description: form.description.trim() || null,
        variables: form.variables.split(",").map(v => v.trim()).filter(Boolean),
      };
      if (editTarget) {
        return apiFetch(`api/admin/email-templates/${editTarget.id}`, {
          method: "PUT", body: JSON.stringify(payload),
        });
      }
      return apiFetch("api/admin/email-templates", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-templates"] });
      toast.success(editTarget ? "Template updated" : "Template created");
      setDialogOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`api/admin/email-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-templates"] });
      toast.success("Template deleted");
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function sendTest(id: number) {
    setSendingId(id);
    try {
      const res = await apiFetch(`api/admin/email-templates/${id}/send-test`, { method: "POST" });
      toast.success(`Test email sent to ${res.sentTo}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSendingId(null);
    }
  }

  const isFormValid = form.name.trim() && form.slug.trim() && form.subject.trim() && form.body.trim();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Email Templates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage transactional email templates. System templates are used by OTP, pipelines, and SMTP test emails.
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Template
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search templates…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {filtered.length} template{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Mail className="h-10 w-10 mb-3 opacity-30" />
              <p className="font-medium">No templates found</p>
              {search && <p className="text-sm mt-1">Try a different search term</p>}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map(t => (
                <div key={t.id} className="flex items-start justify-between gap-3 p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Mail className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{t.name}</span>
                        {t.isSystem && (
                          <Badge variant="secondary" className="text-xs px-1.5 py-0">System</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 font-mono">{t.slug}</p>
                      <p className="text-xs text-muted-foreground mt-1 truncate max-w-md">{t.subject}</p>
                      {t.description && (
                        <p className="text-xs text-muted-foreground/70 mt-0.5 truncate max-w-md">{t.description}</p>
                      )}
                      {t.variables.length > 0 && (
                        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                          <Tag className="h-3 w-3 text-muted-foreground shrink-0" />
                          {t.variables.map(v => (
                            <span key={v} className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">{`{{${v}}}`}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8"
                      title="Send test email"
                      onClick={() => sendTest(t.id)}
                      disabled={sendingId === t.id}
                    >
                      <SendHorizonal className={`h-4 w-4 ${sendingId === t.id ? "animate-pulse" : ""}`} />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8"
                      title="Edit template"
                      onClick={() => openEdit(t)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {!t.isSystem && (
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                        title="Delete template"
                        onClick={() => setDeleteTarget(t)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTarget ? `Edit Template — ${editTarget.name}` : "New Email Template"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-name">Name <span className="text-destructive">*</span></Label>
                <Input
                  id="tpl-name"
                  placeholder="Pipeline Success Notification"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-slug">
                  Slug <span className="text-destructive">*</span>
                  <span className="ml-1 text-xs text-muted-foreground">(unique identifier)</span>
                </Label>
                <Input
                  id="tpl-slug"
                  placeholder="pipeline_success"
                  value={form.slug}
                  readOnly={!!editTarget}
                  onChange={e => setForm(p => ({ ...p, slug: e.target.value }))}
                  className={editTarget ? "bg-muted cursor-not-allowed" : ""}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-subject">Subject <span className="text-destructive">*</span></Label>
              <Input
                id="tpl-subject"
                placeholder='Pipeline "{{pipelineName}}" completed successfully'
                value={form.subject}
                onChange={e => setForm(p => ({ ...p, subject: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-vars">
                Available Variables
                <span className="ml-1 text-xs text-muted-foreground">(comma-separated, used in subject/body as {"{{name}}"})</span>
              </Label>
              <Input
                id="tpl-vars"
                placeholder="firstName, otp, expiryMinutes"
                value={form.variables}
                onChange={e => setForm(p => ({ ...p, variables: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-desc">Description</Label>
              <Input
                id="tpl-desc"
                placeholder="When this template is sent…"
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              />
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="edit">HTML Body</TabsTrigger>
                <TabsTrigger value="preview" onClick={updatePreview}>
                  <Eye className="h-3.5 w-3.5 mr-1" /> Preview
                </TabsTrigger>
              </TabsList>

              <TabsContent value="edit">
                <div className="space-y-1.5">
                  <Label htmlFor="tpl-body">
                    Body (HTML) <span className="text-destructive">*</span>
                    <span className="ml-1 text-xs text-muted-foreground">— use {"{{variable}}"} placeholders</span>
                  </Label>
                  <Textarea
                    id="tpl-body"
                    value={form.body}
                    onChange={e => setForm(p => ({ ...p, body: e.target.value }))}
                    className="font-mono text-xs min-h-[260px] resize-y"
                    placeholder="<p>Hello {{firstName}},</p>"
                  />
                </div>
              </TabsContent>

              <TabsContent value="preview">
                <div className="border rounded-md overflow-hidden bg-white">
                  <div className="bg-muted px-3 py-1.5 text-xs text-muted-foreground border-b">
                    Rendered with sample data — variables shown as their placeholder values
                  </div>
                  <iframe
                    srcDoc={`<!DOCTYPE html><html><body style="font-family:sans-serif;margin:20px">${previewHtml}</body></html>`}
                    className="w-full min-h-[280px] border-0"
                    title="Email preview"
                    sandbox="allow-same-origin"
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!isFormValid || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : editTarget ? "Save Changes" : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
