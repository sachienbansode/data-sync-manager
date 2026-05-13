import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";
import {
  Plus, Search, BarChart2, Trash2, Send, Clock, ChevronLeft, ChevronRight,
  Mail, Users, CheckCircle, XCircle, Ban, Paperclip, RefreshCw, Eye,
} from "lucide-react";

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

interface CommTemplate { id: number; name: string; subject: string; variables: string[]; }
interface Campaign {
  id: number; name: string; type: string; status: string; subject: string;
  totalRecipients: number; sentCount: number; failedCount: number;
  scheduledAt: string | null; completedAt: string | null;
  isRecurring: boolean; recurrenceType: string | null; hasAttachments: boolean;
  createdAt: string; creatorName: string | null;
  deliveredCount: number; openedCount: number; clickedCount: number;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700 border-gray-200",
    scheduled: "bg-blue-100 text-blue-700 border-blue-200",
    running: "bg-yellow-100 text-yellow-700 border-yellow-200",
    completed: "bg-green-100 text-green-700 border-green-200",
    failed: "bg-red-100 text-red-700 border-red-200",
    cancelled: "bg-orange-100 text-orange-700 border-orange-200",
  };
  return <Badge variant="outline" className={`capitalize text-xs ${map[status] ?? ""}`}>{status}</Badge>;
}

function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors ${i + 1 === step ? "border-primary bg-primary text-primary-foreground" : i + 1 < step ? "border-primary bg-primary/10 text-primary" : "border-muted bg-muted text-muted-foreground"}`}>
            {i + 1 < step ? "✓" : i + 1}
          </div>
          {i < total - 1 && <div className={`h-0.5 w-8 ${i + 1 < step ? "bg-primary" : "bg-muted"}`} />}
        </div>
      ))}
      <span className="ml-2 text-xs text-muted-foreground">Step {step} of {total}</span>
    </div>
  );
}

export default function Campaigns() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [csvResult, setCsvResult] = useState<{ imported: number; invalid: number; duplicates: number } | null>(null);
  const [attachments, setAttachments] = useState<Array<{ id: number; filename: string; fileSizeBytes: number; isInline: boolean }>>([]);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const csvRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: "", type: "static", templateId: "", subject: "", fromEmail: "", fromName: "",
    isRecurring: false, recurrenceType: "daily",
  });

  const { data: campaignData } = useQuery<{ data: Campaign[]; total: number; pages: number }>({
    queryKey: ["comm-campaigns", search, statusFilter, page],
    queryFn: () => apiFetch(`/comm/campaigns?page=${page}${search ? `&search=${encodeURIComponent(search)}` : ""}${statusFilter !== "all" ? `&status=${statusFilter}` : ""}`),
  });

  const { data: templates = [] } = useQuery<CommTemplate[]>({
    queryKey: ["comm-templates-light"],
    queryFn: () => apiFetch("/comm/templates"),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => apiFetch("/comm/campaigns", { method: "POST", body: JSON.stringify({ ...data, templateId: data.templateId || null, isRecurring: data.isRecurring, recurrenceType: data.isRecurring ? data.recurrenceType : null }) }),
    onSuccess: (res: Campaign) => { setCampaignId(res.id); setStep(2); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/comm/campaigns/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["comm-campaigns"] }); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/comm/campaigns/${id}/send`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["comm-campaigns"] }); toast.success("Campaign is sending!"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/comm/campaigns/${id}/cancel`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["comm-campaigns"] }); toast.success("Campaign cancelled"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const scheduleMutation = useMutation({
    mutationFn: ({ id, scheduledAt }: { id: number; scheduledAt: string }) =>
      apiFetch(`/comm/campaigns/${id}/schedule`, { method: "POST", body: JSON.stringify({ scheduledAt }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["comm-campaigns"] }); toast.success("Campaign scheduled"); finishWizard(); },
    onError: (e: Error) => toast.error(e.message),
  });

  function resetWizard() {
    setWizardOpen(false); setStep(1); setCampaignId(null); setCsvResult(null);
    setAttachments([]); setScheduleMode("now"); setScheduledAt("");
    setForm({ name: "", type: "static", templateId: "", subject: "", fromEmail: "", fromName: "", isRecurring: false, recurrenceType: "daily" });
  }

  function finishWizard() { resetWizard(); qc.invalidateQueries({ queryKey: ["comm-campaigns"] }); }

  async function uploadCSV(file: File) {
    if (!campaignId) return;
    const fd = new FormData(); fd.append("file", file);
    const token = getAccessToken();
    const res = await fetch(`${BASE}api/comm/campaigns/${campaignId}/recipients/csv`, {
      method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {},  body: fd,
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error ?? "Upload failed"); return; }
    setCsvResult(data);
    toast.success(`Imported ${data.imported} recipients`);
  }

  async function uploadAttachment(file: File, isInline = false) {
    if (!campaignId) return;
    const fd = new FormData(); fd.append("file", file); if (isInline) fd.append("isInline", "true");
    const token = getAccessToken();
    const res = await fetch(`${BASE}api/comm/campaigns/${campaignId}/attachments`, {
      method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd,
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error ?? "Upload failed"); return; }
    setAttachments(prev => [...prev, data]);
    toast.success(`Attachment added: ${file.name}`);
  }

  async function handleStep4() {
    if (!campaignId) return;
    if (scheduleMode === "now") {
      sendMutation.mutate(campaignId);
      finishWizard();
    } else {
      if (!scheduledAt) { toast.error("Select a date and time"); return; }
      scheduleMutation.mutate({ id: campaignId, scheduledAt });
    }
  }

  const campaigns = campaignData?.data ?? [];
  const totalPages = campaignData?.pages ?? 1;
  const total = campaignData?.total ?? 0;

  const templateOptions = templates.filter(t => (t as unknown as { isActive: boolean }).isActive !== false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Campaigns</h1>
          <p className="text-sm text-muted-foreground">Create and manage bulk email campaigns</p>
        </div>
        <Button onClick={() => setWizardOpen(true)}><Plus className="h-4 w-4 mr-2" />New Campaign</Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total", value: total, icon: Mail, color: "text-primary" },
          { label: "Running", value: campaigns.filter(c => c.status === "running").length, icon: RefreshCw, color: "text-yellow-600" },
          { label: "Completed", value: campaigns.filter(c => c.status === "completed").length, icon: CheckCircle, color: "text-green-600" },
          { label: "Scheduled", value: campaigns.filter(c => c.status === "scheduled").length, icon: Clock, color: "text-blue-600" },
        ].map(s => (
          <Card key={s.label}><CardContent className="flex items-center gap-3 py-4 px-4">
            <s.icon className={`h-8 w-8 ${s.color}`} />
            <div><p className="text-2xl font-bold">{s.value}</p><p className="text-xs text-muted-foreground">{s.label}</p></div>
          </CardContent></Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <div className="flex items-center gap-2 p-4 border-b flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search campaigns…" className="pl-9" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {["draft","scheduled","running","completed","failed","cancelled"].map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Campaign</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-center">Recipients</TableHead>
              <TableHead className="text-center">Sent</TableHead>
              <TableHead className="text-center">Opened</TableHead>
              <TableHead className="text-center">Clicked</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {campaigns.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">No campaigns yet. Create one to get started.</TableCell></TableRow>}
              {campaigns.map(c => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="font-medium text-sm flex items-center gap-1.5">
                      {c.name}
                      {c.hasAttachments && <Paperclip className="h-3 w-3 text-muted-foreground" />}
                      {c.isRecurring && <RefreshCw className="h-3 w-3 text-blue-500" />}
                    </div>
                    <p className="text-xs text-muted-foreground truncate max-w-[220px]">{c.subject}</p>
                    <Badge variant="outline" className="mt-0.5 text-[10px] px-1">{c.type}</Badge>
                  </TableCell>
                  <TableCell>{statusBadge(c.status)}</TableCell>
                  <TableCell className="text-center text-sm font-medium">{c.totalRecipients}</TableCell>
                  <TableCell className="text-center text-sm">{c.sentCount}</TableCell>
                  <TableCell className="text-center text-sm">{c.openedCount}</TableCell>
                  <TableCell className="text-center text-sm">{c.clickedCount}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {c.completedAt ? new Date(c.completedAt).toLocaleDateString()
                      : c.scheduledAt ? `Sched: ${new Date(c.scheduledAt).toLocaleString()}`
                      : new Date(c.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="Details">
                        <Link href={`/email-hub/campaigns/${c.id}`}><Eye className="h-4 w-4" /></Link>
                      </Button>
                      {c.status === "draft" && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600" title="Send Now" onClick={() => { if (confirm("Send this campaign now?")) sendMutation.mutate(c.id); }}>
                          <Send className="h-4 w-4" />
                        </Button>
                      )}
                      {c.status === "scheduled" && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-orange-600" title="Cancel" onClick={() => { if (confirm("Cancel this campaign?")) cancelMutation.mutate(c.id); }}>
                          <Ban className="h-4 w-4" />
                        </Button>
                      )}
                      {!["running"].includes(c.status) && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Delete" onClick={() => { if (confirm("Delete this campaign?")) deleteMutation.mutate(c.id); }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
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

      {/* ── Create Campaign Wizard ── */}
      <Dialog open={wizardOpen} onOpenChange={o => { if (!o) resetWizard(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Campaign</DialogTitle></DialogHeader>
          <StepIndicator step={step} total={4} />

          {/* Step 1: Setup */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1">
                  <Label>Campaign Name *</Label>
                  <Input placeholder="e.g. July Newsletter" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Email Type</Label>
                  <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="static">Static (same content for all)</SelectItem>
                      <SelectItem value="dynamic">Dynamic (personalized per recipient)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Template (optional)</Label>
                  <Select value={form.templateId || "__none__"} onValueChange={v => {
                    const id = v === "__none__" ? "" : v;
                    setForm(f => ({ ...f, templateId: id }));
                    if (id) { const t = templateOptions.find(t => String(t.id) === id); if (t) setForm(f => ({ ...f, templateId: id, subject: f.subject || t.subject })); }
                  }}>
                    <SelectTrigger><SelectValue placeholder="Select template…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No template</SelectItem>
                      {templateOptions.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Subject Line *</Label>
                  <Input placeholder="e.g. Important update for {{first_name}}" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>From Name</Label>
                  <Input placeholder="Ashika Group" value={form.fromName} onChange={e => setForm(f => ({ ...f, fromName: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>From Email</Label>
                  <Input placeholder="noreply@ashika.com" value={form.fromEmail} onChange={e => setForm(f => ({ ...f, fromEmail: e.target.value }))} />
                </div>
                <div className="col-span-2 flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="text-sm font-medium">Recurring Campaign</p>
                    <p className="text-xs text-muted-foreground">Automatically re-send on a schedule</p>
                  </div>
                  <Switch checked={form.isRecurring} onCheckedChange={v => setForm(f => ({ ...f, isRecurring: v }))} />
                </div>
                {form.isRecurring && (
                  <div className="col-span-2 space-y-1">
                    <Label>Recurrence</Label>
                    <Select value={form.recurrenceType} onValueChange={v => setForm(f => ({ ...f, recurrenceType: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={resetWizard}>Cancel</Button>
                <Button onClick={() => createMutation.mutate(form)} disabled={!form.name.trim() || !form.subject.trim() || createMutation.isPending}>
                  {createMutation.isPending ? "Creating…" : "Next: Recipients →"}
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Step 2: Recipients */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Upload a CSV file with at least an <code className="bg-muted px-1 rounded text-xs">email</code> column. Additional columns become variables (e.g. <code className="bg-muted px-1 rounded text-xs">first_name</code>, <code className="bg-muted px-1 rounded text-xs">account_no</code>).</p>
              <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-3">
                <Users className="h-8 w-8 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">CSV format: <code className="bg-muted px-1 rounded text-xs">email,first_name,account_no,…</code></p>
                <Button variant="outline" onClick={() => csvRef.current?.click()}>Choose CSV File</Button>
                <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadCSV(f); e.target.value = ""; }} />
              </div>
              {csvResult && (
                <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg p-4 space-y-1">
                  <p className="text-sm font-semibold text-green-700 dark:text-green-400">✓ Recipients loaded</p>
                  <p className="text-xs text-green-600 dark:text-green-500">Imported: <strong>{csvResult.imported}</strong> &nbsp;·&nbsp; Skipped (invalid): {csvResult.invalid} &nbsp;·&nbsp; Deduped: {csvResult.duplicates}</p>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
                <Button variant="outline" onClick={() => setStep(3)}>Skip (add later)</Button>
                <Button onClick={() => setStep(3)} disabled={!csvResult}>Next: Attachments →</Button>
              </DialogFooter>
            </div>
          )}

          {/* Step 3: Attachments */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Optionally attach files to this campaign. Inline images (CID) are embedded directly in the HTML.</p>
              <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-3">
                <Paperclip className="h-8 w-8 text-muted-foreground mx-auto" />
                <div className="flex gap-2 justify-center">
                  <Button variant="outline" size="sm" onClick={() => attachRef.current?.click()}>Attach File</Button>
                </div>
                <input ref={attachRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadAttachment(f); e.target.value = ""; }} />
              </div>
              {attachments.length > 0 && (
                <div className="space-y-2">
                  {attachments.map(a => (
                    <div key={a.id} className="flex items-center justify-between p-2 border rounded text-sm">
                      <span className="flex items-center gap-2"><Paperclip className="h-3.5 w-3.5 text-muted-foreground" />{a.filename}</span>
                      <span className="text-xs text-muted-foreground">{(a.fileSizeBytes / 1024).toFixed(1)} KB</span>
                    </div>
                  ))}
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setStep(2)}>← Back</Button>
                <Button variant="outline" onClick={() => setStep(4)}>Skip</Button>
                <Button onClick={() => setStep(4)}>Next: Schedule →</Button>
              </DialogFooter>
            </div>
          )}

          {/* Step 4: Schedule */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setScheduleMode("now")} className={`p-4 border-2 rounded-lg text-left transition-colors ${scheduleMode === "now" ? "border-primary bg-primary/5" : "border-muted hover:border-primary/50"}`}>
                  <Send className="h-5 w-5 mb-2 text-primary" />
                  <p className="font-medium text-sm">Send Now</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Start sending immediately</p>
                </button>
                <button onClick={() => setScheduleMode("later")} className={`p-4 border-2 rounded-lg text-left transition-colors ${scheduleMode === "later" ? "border-primary bg-primary/5" : "border-muted hover:border-primary/50"}`}>
                  <Clock className="h-5 w-5 mb-2 text-blue-500" />
                  <p className="font-medium text-sm">Schedule</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Pick a future date & time</p>
                </button>
              </div>
              {scheduleMode === "later" && (
                <div className="space-y-1">
                  <Label>Date & Time</Label>
                  <Input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} min={new Date().toISOString().slice(0, 16)} />
                </div>
              )}
              <div className="bg-muted/40 rounded-lg p-4 text-sm space-y-1">
                <p><strong>Campaign:</strong> {form.name}</p>
                <p><strong>Recipients:</strong> {csvResult?.imported ?? 0}</p>
                <p><strong>Type:</strong> {form.type} {form.isRecurring ? `· Recurring (${form.recurrenceType})` : ""}</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setStep(3)}>← Back</Button>
                <Button onClick={handleStep4} disabled={sendMutation.isPending || scheduleMutation.isPending}>
                  {scheduleMode === "now" ? "Send Campaign" : "Schedule Campaign"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
