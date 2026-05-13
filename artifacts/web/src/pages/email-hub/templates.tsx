import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";
import { Plus, Edit, Trash2, Eye, History, Copy, Search, ChevronLeft, ChevronRight, Tag } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

async function apiFetch(path: string, options?: RequestInit) {
  const token = getAccessToken();
  const res = await fetch(`${BASE}api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options?.headers },
  });
  if (!res.ok) { const e = await res.json().catch(() => ({ error: res.statusText })); throw new Error(e.error ?? "Request failed"); }
  return res.json();
}

interface CommTemplate {
  id: number; name: string; description: string | null; subject: string;
  htmlBody: string; textBody: string | null; variables: string[];
  version: number; isActive: boolean; createdAt: string; updatedAt: string;
  creatorName: string | null;
}
interface TemplateVersion { id: number; version: number; subject: string; changeNote: string | null; createdAt: string; changedByName: string | null; }

const BLANK_TEMPLATE = `<!DOCTYPE html>
<html><body>
<p>Hello {{first_name}},</p>
<p>Your message here.</p>
<p>Regards,<br/>Ashika Group</p>
</body></html>`;

const PAGE_SIZE = 10;

export default function Templates() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRow, setEditRow] = useState<CommTemplate | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionTemplateId, setVersionTemplateId] = useState<number | null>(null);
  const [sampleData, setSampleData] = useState<Record<string, string>>({});
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [form, setForm] = useState({
    name: "", description: "", subject: "", htmlBody: BLANK_TEMPLATE, textBody: "", changeNote: "", isActive: true,
  });

  const { data: templates = [], isLoading } = useQuery<CommTemplate[]>({
    queryKey: ["comm-templates"],
    queryFn: () => apiFetch("/comm/templates"),
  });

  const { data: versions = [] } = useQuery<TemplateVersion[]>({
    queryKey: ["comm-template-versions", versionTemplateId],
    queryFn: () => apiFetch(`/comm/templates/${versionTemplateId}/versions`),
    enabled: versionTemplateId !== null,
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => apiFetch("/comm/templates", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["comm-templates"] }); toast.success("Template created"); resetDialog(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: (data: typeof form & { id: number }) => apiFetch(`/comm/templates/${data.id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["comm-templates"] }); toast.success("Template updated"); resetDialog(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/comm/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["comm-templates"] }); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  function resetDialog() { setDialogOpen(false); setEditRow(null); setSampleData({}); setForm({ name: "", description: "", subject: "", htmlBody: BLANK_TEMPLATE, textBody: "", changeNote: "", isActive: true }); }

  function openEdit(row: CommTemplate) {
    setEditRow(row);
    setForm({ name: row.name, description: row.description ?? "", subject: row.subject, htmlBody: row.htmlBody, textBody: row.textBody ?? "", changeNote: "", isActive: row.isActive });
    const vars = row.variables ?? [];
    setSampleData(Object.fromEntries(vars.map(v => [v, `Sample_${v}`])));
    setDialogOpen(true);
  }

  function handleSubmit() {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    if (!form.subject.trim()) { toast.error("Subject is required"); return; }
    if (!form.htmlBody.trim()) { toast.error("HTML body is required"); return; }
    if (editRow) updateMutation.mutate({ ...form, id: editRow.id });
    else createMutation.mutate(form);
  }

  async function openPreview(row?: CommTemplate) {
    const id = row?.id ?? editRow?.id;
    if (!id) {
      // Preview from current form state
      setPreviewHtml(form.htmlBody);
      setPreviewOpen(true);
      return;
    }
    try {
      const data = await apiFetch(`/comm/templates/${id}/preview`, { method: "POST", body: JSON.stringify({ sampleData }) });
      setPreviewHtml(data.html);
      setPreviewOpen(true);
    } catch (e) { toast.error("Preview failed"); }
  }

  // Extract variables from current HTML form
  const detectedVars = [...new Set([...form.htmlBody.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))];

  const filtered = templates.filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.subject.toLowerCase().includes(search.toLowerCase()));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Email Templates</h1>
          <p className="text-sm text-muted-foreground">Manage HTML templates with variable placeholders and version history</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 mr-2" />New Template</Button>
      </div>

      <Card>
        <div className="flex items-center gap-2 p-4 border-b">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search templates…" className="pl-9" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </div>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Template Name</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Variables</TableHead>
              <TableHead className="text-center">Ver.</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!isLoading && paged.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No templates yet.</TableCell></TableRow>}
              {paged.map(t => (
                <TableRow key={t.id}>
                  <TableCell>
                    <div className="font-medium text-sm">{t.name}</div>
                    {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                    {!t.isActive && <Badge variant="secondary" className="text-[10px] mt-0.5">Inactive</Badge>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{t.subject}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1 max-w-[200px]">
                      {(t.variables ?? []).slice(0, 4).map(v => (
                        <Badge key={v} variant="outline" className="text-[9px] px-1 py-0 font-mono">{"{{" + v + "}}"}</Badge>
                      ))}
                      {(t.variables ?? []).length > 4 && <span className="text-[10px] text-muted-foreground">+{(t.variables ?? []).length - 4}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-center"><Badge variant="outline" className="text-xs">v{t.version}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(t.updatedAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Preview" onClick={() => openPreview(t)}><Eye className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Version History" onClick={() => { setVersionTemplateId(t.id); setVersionsOpen(true); }}><History className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => openEdit(t)}><Edit className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Delete" onClick={() => { if (confirm("Delete this template?")) deleteMutation.mutate(t.id); }}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t text-sm text-muted-foreground">
              <span>Page {page} of {totalPages}</span>
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={o => { if (!o) resetDialog(); }}>
        <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editRow ? `Edit: ${editRow.name}` : "New Email Template"}</DialogTitle></DialogHeader>
          <Tabs defaultValue="editor">
            <TabsList className="mb-4">
              <TabsTrigger value="editor">Editor</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="text">Plain Text</TabsTrigger>
            </TabsList>
            <TabsContent value="editor" className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Template Name *</Label>
                  <Input placeholder="e.g. Monthly Statement" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Description</Label>
                  <Input placeholder="Brief description…" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Subject Line *</Label>
                  <Input placeholder="Hello {{first_name}}, your {{month}} statement is ready" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label>HTML Body *</Label>
                  {detectedVars.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      <Tag className="h-3 w-3 text-muted-foreground" />
                      {detectedVars.map(v => <Badge key={v} variant="outline" className="text-[9px] px-1 font-mono">{"{{" + v + "}}"}</Badge>)}
                    </div>
                  )}
                </div>
                <Textarea
                  className="font-mono text-xs h-72 resize-none"
                  value={form.htmlBody}
                  onChange={e => setForm(f => ({ ...f, htmlBody: e.target.value }))}
                  placeholder="Enter HTML content…"
                />
                <p className="text-[11px] text-muted-foreground">Use {"{{variable_name}}"} for dynamic placeholders. Detected: {detectedVars.join(", ") || "none"}</p>
              </div>
              {editRow && (
                <div className="space-y-1">
                  <Label>Change Note (optional)</Label>
                  <Input placeholder="What changed in this version?" value={form.changeNote} onChange={e => setForm(f => ({ ...f, changeNote: e.target.value }))} />
                </div>
              )}
              <div className="flex items-center gap-3">
                <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
                <Label>Active</Label>
              </div>
            </TabsContent>
            <TabsContent value="preview">
              <div className="space-y-3">
                {detectedVars.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {detectedVars.map(v => (
                      <div key={v} className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground w-28 shrink-0">{"{{" + v + "}}"}</span>
                        <Input className="h-7 text-xs" placeholder={`Sample ${v}`} value={sampleData[v] ?? ""} onChange={e => setSampleData(d => ({ ...d, [v]: e.target.value }))} />
                      </div>
                    ))}
                  </div>
                )}
                <div className="border rounded-lg overflow-hidden">
                  <iframe
                    ref={iframeRef}
                    className="w-full h-[400px]"
                    srcDoc={(() => {
                      let html = form.htmlBody;
                      for (const [k, v] of Object.entries(sampleData)) html = html.replaceAll(`{{${k}}}`, v);
                      return html;
                    })()}
                    sandbox="allow-same-origin"
                    title="Email Preview"
                  />
                </div>
              </div>
            </TabsContent>
            <TabsContent value="text">
              <div className="space-y-1">
                <Label>Plain Text Version (optional)</Label>
                <Textarea className="font-mono text-sm h-64 resize-none" value={form.textBody} onChange={e => setForm(f => ({ ...f, textBody: e.target.value }))} placeholder="Plain text fallback for email clients that don't support HTML…" />
              </div>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={resetDialog}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
              {editRow ? `Save (v${(editRow.version ?? 0) + 1})` : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog (for list view) */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader><DialogTitle>Template Preview</DialogTitle></DialogHeader>
          <div className="border rounded-lg overflow-hidden h-[500px]">
            <iframe srcDoc={previewHtml} className="w-full h-full" sandbox="allow-same-origin" title="Preview" />
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version History Dialog */}
      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><History className="h-4 w-4" />Version History</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {versions.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No versions found.</p>}
            {versions.map(v => (
              <div key={v.id} className="flex items-start gap-3 p-3 border rounded-lg">
                <Badge variant="outline" className="text-xs shrink-0">v{v.version}</Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{v.subject}</p>
                  <p className="text-xs text-muted-foreground">{v.changeNote ?? "—"}</p>
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                    by {v.changedByName ?? "Unknown"} · {new Date(v.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setVersionsOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
