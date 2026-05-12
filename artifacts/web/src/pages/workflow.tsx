import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Loader2, Plus, Pencil, Trash2, GitBranch, ArrowRight, Database, Cloud,
  FolderOpen, Server, CheckCircle, Play, PauseCircle, Settings2,
  CalendarClock, History, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";
import cronstrue from "cronstrue";

type PipelineStatus = "active" | "inactive";

interface Pipeline {
  id: number;
  name: string;
  description: string | null;
  sourceConnectionId: number | null;
  destConnectionId: number | null;
  sourceQuery: string | null;
  destTarget: string | null;
  status: PipelineStatus;
  scheduleEnabled: boolean;
  scheduleCron: string | null;
  scheduleLastRunAt: string | null;
  createdAt: string;
}

interface DbConnection {
  id: number;
  name: string;
  type: string;
  dbEngine: string;
}

interface RunJob {
  id: number;
  status: "pending" | "running" | "success" | "failed";
  triggeredByEmail: string | null;
  recordCount: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

const ENGINE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  postgresql: Database, mysql: Database, mssql: Server, oracle: Server,
  s3: Cloud, sftp: FolderOpen, csv: FolderOpen,
};

const ENGINE_LABEL: Record<string, string> = {
  postgresql: "PostgreSQL", mysql: "MySQL", mssql: "MS SQL",
  oracle: "Oracle", s3: "S3", sftp: "SFTP", csv: "CSV",
};

const CRON_PRESETS = [
  { label: "Every hour",      value: "0 * * * *" },
  { label: "Every 6 hours",   value: "0 */6 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Daily at 2 AM",   value: "0 2 * * *" },
  { label: "Daily at 6 AM",   value: "0 6 * * *" },
  { label: "Weekly (Mon 8 AM)", value: "0 8 * * 1" },
  { label: "Custom",          value: "__custom__" },
];

function formatCron(expr: string): string {
  try { return cronstrue.toString(expr, { throwExceptionOnParseError: true }); }
  catch { return expr; }
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString();
}

const EMPTY_FORM = {
  name: "", description: "",
  sourceConnectionId: "__none__",
  destConnectionId: "__none__",
  sourceQuery: "", destTarget: "",
  scheduleEnabled: false, scheduleCron: "",
};

const apiBase = `${import.meta.env.BASE_URL}api`;

export default function Workflow() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [connections, setConnections] = useState<DbConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [cronPreset, setCronPreset] = useState("");
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [historyPipeline, setHistoryPipeline] = useState<Pipeline | null>(null);
  const [historyJobs, setHistoryJobs] = useState<RunJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const token = getAccessToken();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const hdrs = { Authorization: `Bearer ${token}` };
      const [pRes, cRes] = await Promise.all([
        fetch(`${apiBase}/admin/pipelines`, { headers: hdrs }),
        fetch(`${apiBase}/admin/db-connections`, { headers: hdrs }),
      ]);
      if (!pRes.ok) throw new Error("Failed to load pipelines");
      if (!cRes.ok) throw new Error("Failed to load connections");
      setPipelines(await pRes.json());
      setConnections(await cRes.json());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setCronPreset("");
    setDialogOpen(true);
  }

  function openEdit(p: Pipeline) {
    setEditId(p.id);
    setForm({
      name: p.name, description: p.description ?? "",
      sourceConnectionId: p.sourceConnectionId ? String(p.sourceConnectionId) : "__none__",
      destConnectionId: p.destConnectionId ? String(p.destConnectionId) : "__none__",
      sourceQuery: p.sourceQuery ?? "", destTarget: p.destTarget ?? "",
      scheduleEnabled: p.scheduleEnabled, scheduleCron: p.scheduleCron ?? "",
    });
    const preset = CRON_PRESETS.find(pr => pr.value === p.scheduleCron && pr.value !== "__custom__");
    setCronPreset(preset ? preset.value : (p.scheduleCron ? "__custom__" : ""));
    setDialogOpen(true);
  }

  function handleCronPreset(value: string) {
    setCronPreset(value);
    if (value && value !== "__custom__") setForm(f => ({ ...f, scheduleCron: value }));
    else if (value === "__custom__") setForm(f => ({ ...f, scheduleCron: "" }));
  }

  async function save() {
    if (!form.name.trim()) { toast.error("Pipeline name is required"); return; }
    if (form.scheduleEnabled && !form.scheduleCron.trim()) { toast.error("Cron expression required when schedule is enabled"); return; }

    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        sourceConnectionId: form.sourceConnectionId !== "__none__" ? parseInt(form.sourceConnectionId) : null,
        destConnectionId: form.destConnectionId !== "__none__" ? parseInt(form.destConnectionId) : null,
        sourceQuery: form.sourceQuery.trim() || undefined,
        destTarget: form.destTarget.trim() || undefined,
        scheduleEnabled: form.scheduleEnabled,
        scheduleCron: form.scheduleCron.trim() || undefined,
      };
      const url = editId ? `${apiBase}/admin/pipelines/${editId}` : `${apiBase}/admin/pipelines`;
      const res = await fetch(url, {
        method: editId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Save failed"); }
      toast.success(editId ? "Pipeline updated" : "Pipeline created");
      setDialogOpen(false);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deletePipeline() {
    if (!deleteId) return;
    try {
      const res = await fetch(`${apiBase}/admin/pipelines/${deleteId}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 204) throw new Error("Delete failed");
      toast.success("Pipeline deleted");
      setDeleteId(null);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function toggleStatus(p: Pipeline) {
    setTogglingId(p.id);
    try {
      const res = await fetch(`${apiBase}/admin/pipelines/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: p.status === "active" ? "inactive" : "active" }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed"); }
      toast.success(p.status === "active" ? "Pipeline paused" : "Pipeline activated");
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to toggle status");
    } finally {
      setTogglingId(null);
    }
  }

  async function runPipeline(p: Pipeline) {
    if (!p.sourceConnectionId || !p.destConnectionId) {
      toast.error("Configure a source and destination connection before running");
      return;
    }
    setRunningId(p.id);
    try {
      const res = await fetch(`${apiBase}/admin/pipelines/${p.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        const n = data.recordCount ?? 0;
        toast.success(`"${p.name}" completed — ${n.toLocaleString()} row${n !== 1 ? "s" : ""} transferred`);
      } else {
        toast.error(`Run failed: ${data.error}`);
      }
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunningId(null);
    }
  }

  async function openHistory(p: Pipeline) {
    setHistoryPipeline(p);
    setHistoryJobs([]);
    setHistoryLoading(true);
    try {
      const res = await fetch(`${apiBase}/admin/pipelines/${p.id}/runs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load run history");
      setHistoryJobs(await res.json());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setHistoryLoading(false);
    }
  }

  function connById(id: number | null): DbConnection | undefined {
    if (!id) return undefined;
    return connections.find(c => c.id === id);
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Data Workflow</h1>
            <p className="text-muted-foreground mt-1">
              Build flexible pipelines from any source to any destination with field-level mapping
            </p>
          </div>
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4 mr-2" /> New Pipeline
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Pipelines</p>
              <p className="text-2xl font-bold mt-0.5">{loading ? "—" : pipelines.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Active</p>
              <p className="text-2xl font-bold mt-0.5 text-green-600">{loading ? "—" : pipelines.filter(p => p.status === "active").length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Connections</p>
              <p className="text-2xl font-bold mt-0.5">{loading ? "—" : connections.length}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><GitBranch className="h-5 w-5" /> Pipelines</CardTitle>
            <CardDescription>Each pipeline fetches from a source, applies field mappings, and inserts into a destination. Click Run to execute immediately.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : pipelines.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <GitBranch className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No pipelines yet</p>
                <p className="text-sm mt-1">Create your first pipeline to start moving data between systems.</p>
                <Button className="mt-4" onClick={openAdd}><Plus className="h-4 w-4 mr-2" />New Pipeline</Button>
              </div>
            ) : (
              <div className="divide-y">
                {pipelines.map((p) => {
                  const src = connById(p.sourceConnectionId);
                  const dst = connById(p.destConnectionId);
                  const SrcIcon = src ? (ENGINE_ICON[src.dbEngine] ?? Database) : Database;
                  const DstIcon = dst ? (ENGINE_ICON[dst.dbEngine] ?? Database) : Database;

                  return (
                    <div key={p.id} className="py-4 flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-1.5 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{p.name}</span>
                          <Badge variant={p.status === "active" ? "default" : "secondary"} className="text-xs">
                            {p.status === "active"
                              ? <><CheckCircle className="h-3 w-3 mr-1" />Active</>
                              : <><PauseCircle className="h-3 w-3 mr-1" />Inactive</>
                            }
                          </Badge>
                          {p.scheduleEnabled && p.scheduleCron && (
                            <span className="flex items-center gap-1 text-xs text-blue-600">
                              <CalendarClock className="h-3 w-3" /> {formatCron(p.scheduleCron)}
                            </span>
                          )}
                        </div>
                        {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}

                        <div className="flex items-center gap-2 text-sm flex-wrap">
                          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted/50 border text-xs">
                            <SrcIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            {src ? <span className="font-medium">{src.name}</span> : <span className="text-muted-foreground italic">No source</span>}
                            {src && <span className="text-muted-foreground">({ENGINE_LABEL[src.dbEngine] ?? src.dbEngine})</span>}
                          </div>
                          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted/50 border text-xs">
                            <DstIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            {dst ? <span className="font-medium">{dst.name}</span> : <span className="text-muted-foreground italic">No destination</span>}
                            {dst && <span className="text-muted-foreground">({ENGINE_LABEL[dst.dbEngine] ?? dst.dbEngine})</span>}
                          </div>
                          {p.destTarget && <span className="text-xs text-muted-foreground">→ <span className="font-mono">{p.destTarget}</span></span>}
                        </div>

                        <p className="text-xs text-muted-foreground">
                          Created {new Date(p.createdAt).toLocaleDateString()}
                          {p.scheduleLastRunAt && ` · Last run ${formatDate(p.scheduleLastRunAt)}`}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                        {/* Run Now */}
                        <Button
                          variant="default" size="sm"
                          onClick={() => runPipeline(p)}
                          disabled={runningId === p.id}
                          title="Run pipeline now"
                        >
                          {runningId === p.id
                            ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Running…</>
                            : <><Play className="h-4 w-4 mr-1" />Run</>
                          }
                        </Button>

                        {/* History */}
                        <Button variant="outline" size="sm" onClick={() => openHistory(p)} title="Run history">
                          <History className="h-4 w-4" />
                          <span className="ml-1 hidden sm:inline">History</span>
                        </Button>

                        {/* Active / Pause toggle */}
                        <Button
                          variant="outline" size="sm"
                          onClick={() => toggleStatus(p)}
                          disabled={togglingId === p.id}
                          title={p.status === "active" ? "Pause pipeline" : "Activate pipeline"}
                        >
                          {togglingId === p.id
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : p.status === "active"
                              ? <PauseCircle className="h-4 w-4" />
                              : <CheckCircle className="h-4 w-4" />
                          }
                        </Button>

                        {/* Mappings */}
                        <Link href={`/workflow/${p.id}/mappings`}>
                          <Button variant="outline" size="sm" title="Configure field mappings">
                            <Settings2 className="h-4 w-4" />
                            <span className="ml-1 hidden sm:inline">Mappings</span>
                          </Button>
                        </Link>

                        <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteId(p.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Pipeline" : "New Pipeline"}</DialogTitle>
            <DialogDescription>Configure the source, destination, query, and schedule for this data flow.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Pipeline Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. BackOffice → Trading Sync" />
            </div>
            <div className="space-y-1">
              <Label>Description <span className="text-xs text-muted-foreground">(optional)</span></Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What does this pipeline do?" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Source Connection</Label>
                <Select value={form.sourceConnectionId} onValueChange={v => setForm(f => ({ ...f, sourceConnectionId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select source…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {connections.map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name} ({ENGINE_LABEL[c.dbEngine] ?? c.dbEngine})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Destination Connection</Label>
                <Select value={form.destConnectionId} onValueChange={v => setForm(f => ({ ...f, destConnectionId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select destination…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {connections.map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name} ({ENGINE_LABEL[c.dbEngine] ?? c.dbEngine})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Source Query <span className="text-xs text-muted-foreground">(SELECT only)</span></Label>
              <textarea
                className="w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                value={form.sourceQuery}
                onChange={e => setForm(f => ({ ...f, sourceQuery: e.target.value }))}
                placeholder="SELECT col1, col2, col3 FROM source_table WHERE active = true"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">If blank, defaults to SELECT * FROM the source schema. Only SELECT is allowed.</p>
            </div>

            <div className="space-y-1">
              <Label>Destination Table *</Label>
              <Input
                value={form.destTarget}
                onChange={e => setForm(f => ({ ...f, destTarget: e.target.value }))}
                placeholder="public.target_table or schema.table_name"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">The table to INSERT rows into on the destination. Required to run the pipeline.</p>
            </div>

            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-sm">Schedule <span className="text-xs text-muted-foreground font-normal">(optional)</span></span>
              </div>
              <Select value={cronPreset} onValueChange={handleCronPreset}>
                <SelectTrigger><SelectValue placeholder="No schedule — run manually" /></SelectTrigger>
                <SelectContent>
                  {CRON_PRESETS.map(p => (
                    <SelectItem key={p.label} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(cronPreset === "__custom__" || (cronPreset === "" && form.scheduleCron)) && (
                <Input value={form.scheduleCron} onChange={e => setForm(f => ({ ...f, scheduleCron: e.target.value }))} placeholder="0 2 * * *" className="font-mono" />
              )}
              {form.scheduleCron.trim() && (
                <>
                  <p className="text-xs text-muted-foreground italic">
                    {(() => { try { return cronstrue.toString(form.scheduleCron); } catch { return null; } })()}
                  </p>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Enable Schedule</Label>
                      <p className="text-xs text-muted-foreground">Automatically run on the above schedule</p>
                    </div>
                    <Switch checked={form.scheduleEnabled} onCheckedChange={v => setForm(f => ({ ...f, scheduleEnabled: v }))} />
                  </div>
                </>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editId ? "Save Changes" : "Create Pipeline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Pipeline</DialogTitle>
            <DialogDescription>This will permanently delete the pipeline and all its field mappings. Cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={deletePipeline}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Run History Dialog */}
      <Dialog open={!!historyPipeline} onOpenChange={open => { if (!open) setHistoryPipeline(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Run History</DialogTitle>
            <DialogDescription>{historyPipeline?.name} — last 50 runs</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0">
            {historyLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : historyJobs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <History className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No runs yet. Click Run on the pipeline to execute it.</p>
              </div>
            ) : (
              <div className="divide-y text-sm">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-1 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <span>Started</span>
                  <span className="text-right">Status</span>
                  <span className="text-right">Rows</span>
                  <span className="text-right">Duration</span>
                </div>
                {historyJobs.map(job => {
                  const durationMs = job.startedAt && job.finishedAt
                    ? new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime() : null;
                  const durationStr = durationMs !== null
                    ? durationMs >= 60000 ? `${Math.floor(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s` : `${(durationMs / 1000).toFixed(1)}s`
                    : "—";
                  return (
                    <div key={job.id} className="py-3 px-1 space-y-1">
                      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 items-center">
                        <span className="text-muted-foreground font-mono text-xs">
                          {job.startedAt ? formatDate(job.startedAt) : formatDate(job.createdAt)}
                          {job.triggeredByEmail && <span className="ml-2 font-sans">by {job.triggeredByEmail}</span>}
                        </span>
                        <span>
                          {job.status === "success" && <span className="flex items-center gap-1 text-green-600 font-medium"><CheckCircle className="h-3.5 w-3.5" /> Success</span>}
                          {job.status === "failed" && <span className="flex items-center gap-1 text-destructive font-medium"><XCircle className="h-3.5 w-3.5" /> Failed</span>}
                          {(job.status === "pending" || job.status === "running") && <span className="flex items-center gap-1 text-blue-600 font-medium"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {job.status}</span>}
                        </span>
                        <span className="text-right font-mono text-xs text-muted-foreground">
                          {job.recordCount !== null ? job.recordCount.toLocaleString() : "—"}
                        </span>
                        <span className="text-right font-mono text-xs text-muted-foreground">{durationStr}</span>
                      </div>
                      {job.errorMessage && (
                        <p className="text-xs text-destructive bg-destructive/5 rounded px-2 py-1 font-mono break-all">
                          {job.errorMessage}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter className="pt-2 border-t">
            <Button variant="outline" onClick={() => setHistoryPipeline(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
