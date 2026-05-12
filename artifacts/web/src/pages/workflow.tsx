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
  CalendarClock, History, XCircle, Table2, ChevronDown, ChevronUp,
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
  sourceTable: string | null;
  sourceQuery: string | null;
  destTarget: string | null;
  status: PipelineStatus;
  scheduleEnabled: boolean;
  scheduleCron: string | null;
  scheduleLastRunAt: string | null;
  scheduleNextRunAt: string | null;
  createdAt: string;
}

interface DbConnection {
  id: number;
  name: string;
  type: string;
  dbEngine: string;
  schemaName: string | null;
}

interface RunJob {
  id: number;
  status: "pending" | "running" | "success" | "failed";
  triggeredByEmail: string | null;
  triggeredBySchedule: boolean;
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
  { label: "Every hour",           value: "0 * * * *"   },
  { label: "Every 6 hours",        value: "0 */6 * * *" },
  { label: "Daily at midnight",    value: "0 0 * * *"   },
  { label: "Daily at 2 AM",        value: "0 2 * * *"   },
  { label: "Daily at 6 AM",        value: "0 6 * * *"   },
  { label: "Weekly (Mon 8 AM)",    value: "0 8 * * 1"   },
  { label: "Custom",               value: "__custom__"  },
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
  sourceTable: "__none__",
  sourceQuery: "",
  useCustomQuery: false,
  destTarget: "",
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

  // Table listing
  const [srcTables, setSrcTables] = useState<string[]>([]);
  const [srcTablesLoading, setSrcTablesLoading] = useState(false);

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

  // Fetch table list when source connection changes
  async function loadSourceTables(connectionId: string) {
    if (connectionId === "__none__") { setSrcTables([]); return; }
    setSrcTablesLoading(true);
    try {
      const res = await fetch(`${apiBase}/admin/db-connections/${connectionId}/tables`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load tables");
      const data = await res.json();
      setSrcTables(data.tables ?? []);
    } catch {
      setSrcTables([]);
    } finally {
      setSrcTablesLoading(false);
    }
  }

  function openAdd() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setCronPreset("");
    setSrcTables([]);
    setDialogOpen(true);
  }

  function openEdit(p: Pipeline) {
    setEditId(p.id);
    const hasCustomQuery = !!p.sourceQuery && !p.sourceTable;
    setForm({
      name: p.name, description: p.description ?? "",
      sourceConnectionId: p.sourceConnectionId ? String(p.sourceConnectionId) : "__none__",
      destConnectionId: p.destConnectionId ? String(p.destConnectionId) : "__none__",
      sourceTable: p.sourceTable ?? "__none__",
      sourceQuery: p.sourceQuery ?? "",
      useCustomQuery: hasCustomQuery,
      destTarget: p.destTarget ?? "",
      scheduleEnabled: p.scheduleEnabled, scheduleCron: p.scheduleCron ?? "",
    });
    const preset = CRON_PRESETS.find(pr => pr.value === p.scheduleCron && pr.value !== "__custom__");
    setCronPreset(preset ? preset.value : (p.scheduleCron ? "__custom__" : ""));
    setSrcTables([]);
    if (p.sourceConnectionId) {
      loadSourceTables(String(p.sourceConnectionId));
    }
    setDialogOpen(true);
  }

  function handleSourceConnectionChange(value: string) {
    setForm(f => ({ ...f, sourceConnectionId: value, sourceTable: "__none__", sourceQuery: "" }));
    setSrcTables([]);
    loadSourceTables(value);
  }

  function handleCronPreset(value: string) {
    setCronPreset(value);
    if (value && value !== "__custom__") setForm(f => ({ ...f, scheduleCron: value }));
    else if (value === "__custom__") setForm(f => ({ ...f, scheduleCron: "" }));
  }

  async function save() {
    if (!form.name.trim()) { toast.error("Pipeline name is required"); return; }
    if (form.scheduleEnabled && !form.scheduleCron.trim()) {
      toast.error("Cron expression required when schedule is enabled"); return;
    }
    if (!form.useCustomQuery && form.sourceTable === "__none__" && form.sourceConnectionId !== "__none__") {
      toast.error("Select a source table or write a custom query"); return;
    }

    setSaving(true);
    try {
      const effectiveSourceTable = !form.useCustomQuery && form.sourceTable !== "__none__" ? form.sourceTable : null;
      const effectiveSourceQuery = form.useCustomQuery ? form.sourceQuery.trim() || null : null;

      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        sourceConnectionId: form.sourceConnectionId !== "__none__" ? parseInt(form.sourceConnectionId) : null,
        destConnectionId: form.destConnectionId !== "__none__" ? parseInt(form.destConnectionId) : null,
        sourceTable: effectiveSourceTable || undefined,
        sourceQuery: effectiveSourceQuery || undefined,
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

  const srcConn = form.sourceConnectionId !== "__none__"
    ? connections.find(c => c.id === parseInt(form.sourceConnectionId))
    : undefined;
  const isFileSource = srcConn && ["s3", "sftp", "csv"].includes(srcConn.dbEngine);

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Data Workflow</h1>
            <p className="text-muted-foreground mt-1">
              Build pipelines: pick a source app → table, destination app → table, then run or schedule.
            </p>
          </div>
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4 mr-2" /> New Pipeline
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Card><CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Pipelines</p>
            <p className="text-2xl font-bold mt-0.5">{loading ? "—" : pipelines.length}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Active</p>
            <p className="text-2xl font-bold mt-0.5 text-green-600">{loading ? "—" : pipelines.filter(p => p.status === "active").length}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Connections</p>
            <p className="text-2xl font-bold mt-0.5">{loading ? "—" : connections.length}</p>
          </CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><GitBranch className="h-5 w-5" /> Pipelines</CardTitle>
            <CardDescription>
              Each pipeline moves data from a source table to a destination table, with optional field-level mapping.
            </CardDescription>
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

                        {/* Source → Dest flow */}
                        <div className="flex items-center gap-2 text-sm flex-wrap">
                          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted/50 border text-xs">
                            <SrcIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            {src ? <span className="font-medium">{src.name}</span> : <span className="text-muted-foreground italic">No source</span>}
                            {(p.sourceTable || p.sourceQuery) && (
                              <span className="text-muted-foreground">
                                {p.sourceTable
                                  ? <>· <Table2 className="h-3 w-3 inline" /> <span className="font-mono">{p.sourceTable}</span></>
                                  : <span className="italic">custom query</span>
                                }
                              </span>
                            )}
                          </div>
                          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted/50 border text-xs">
                            <DstIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            {dst ? <span className="font-medium">{dst.name}</span> : <span className="text-muted-foreground italic">No destination</span>}
                            {p.destTarget && (
                              <span className="text-muted-foreground">· <span className="font-mono">{p.destTarget}</span></span>
                            )}
                          </div>
                        </div>

                        <p className="text-xs text-muted-foreground">
                          Created {new Date(p.createdAt).toLocaleDateString()}
                          {p.scheduleLastRunAt && ` · Last run ${formatDate(p.scheduleLastRunAt)}`}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                        <Button
                          variant="default" size="sm"
                          onClick={() => runPipeline(p)}
                          disabled={runningId === p.id}
                        >
                          {runningId === p.id
                            ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Running…</>
                            : <><Play className="h-4 w-4 mr-1" />Run</>
                          }
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openHistory(p)}>
                          <History className="h-4 w-4" />
                          <span className="ml-1 hidden sm:inline">History</span>
                        </Button>
                        <Button
                          variant="outline" size="sm"
                          onClick={() => toggleStatus(p)}
                          disabled={togglingId === p.id}
                        >
                          {togglingId === p.id
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : p.status === "active"
                              ? <PauseCircle className="h-4 w-4" />
                              : <CheckCircle className="h-4 w-4" />
                          }
                        </Button>
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
            <DialogDescription>
              Choose a source application and table, then a destination application and table.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Basic info */}
            <div className="space-y-1">
              <Label>Pipeline Name *</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. BackOffice → Trading Sync"
              />
            </div>
            <div className="space-y-1">
              <Label>Description <span className="text-xs text-muted-foreground">(optional)</span></Label>
              <Input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="What does this pipeline do?"
              />
            </div>

            {/* SOURCE */}
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" /> Source
              </p>

              <div className="space-y-1">
                <Label>Source Application (Connection)</Label>
                <Select
                  value={form.sourceConnectionId}
                  onValueChange={handleSourceConnectionChange}
                >
                  <SelectTrigger><SelectValue placeholder="Select source application…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {connections.map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name} <span className="text-muted-foreground text-xs">({ENGINE_LABEL[c.dbEngine] ?? c.dbEngine})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {form.sourceConnectionId !== "__none__" && !isFileSource && (
                <>
                  {/* Toggle custom query */}
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={form.useCustomQuery}
                      onCheckedChange={v => setForm(f => ({ ...f, useCustomQuery: v, sourceTable: "__none__", sourceQuery: "" }))}
                    />
                    <Label className="cursor-pointer text-sm font-normal">Use custom SQL query instead of selecting a table</Label>
                  </div>

                  {!form.useCustomQuery ? (
                    <div className="space-y-1">
                      <Label className="flex items-center gap-1.5">
                        <Table2 className="h-3.5 w-3.5" /> Source Table
                        {srcTablesLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                      </Label>
                      <Select
                        value={form.sourceTable}
                        onValueChange={v => setForm(f => ({ ...f, sourceTable: v }))}
                        disabled={srcTablesLoading}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={srcTablesLoading ? "Loading tables…" : "Select a table…"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— Select table —</SelectItem>
                          {srcTables.map(t => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                          {!srcTablesLoading && srcTables.length === 0 && (
                            <SelectItem value="__none__" disabled>No tables found — check connection</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">Fetches all rows: SELECT * FROM [schema].[table]</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Label>Custom SELECT Query</Label>
                      <textarea
                        className="w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                        value={form.sourceQuery}
                        onChange={e => setForm(f => ({ ...f, sourceQuery: e.target.value }))}
                        placeholder={`SELECT col1, col2 FROM "${srcConn?.schemaName ?? "public"}".table_name WHERE condition`}
                        spellCheck={false}
                      />
                      <p className="text-xs text-muted-foreground">Only SELECT statements are permitted.</p>
                    </div>
                  )}
                </>
              )}

              {isFileSource && (
                <p className="text-xs text-muted-foreground italic">File/cloud sources are fetched as-is using the configured path.</p>
              )}
            </div>

            {/* DESTINATION */}
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" /> Destination
              </p>

              <div className="space-y-1">
                <Label>Destination Application (Connection)</Label>
                <Select
                  value={form.destConnectionId}
                  onValueChange={v => setForm(f => ({ ...f, destConnectionId: v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Select destination application…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {connections.map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name} <span className="text-muted-foreground text-xs">({ENGINE_LABEL[c.dbEngine] ?? c.dbEngine})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Destination Table *</Label>
                <Input
                  value={form.destTarget}
                  onChange={e => setForm(f => ({ ...f, destTarget: e.target.value }))}
                  placeholder="public.target_table"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  The table to INSERT rows into. Format: <span className="font-mono">schema.table</span> or just <span className="font-mono">table</span>.
                </p>
              </div>
            </div>

            {/* SCHEDULE */}
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-semibold flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-muted-foreground" /> Schedule <span className="text-xs text-muted-foreground font-normal">(optional)</span>
              </p>

              <Select value={cronPreset} onValueChange={handleCronPreset}>
                <SelectTrigger><SelectValue placeholder="No schedule — run manually" /></SelectTrigger>
                <SelectContent>
                  {CRON_PRESETS.map(p => (
                    <SelectItem key={p.label} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {(cronPreset === "__custom__" || (cronPreset === "" && form.scheduleCron)) && (
                <div className="space-y-1">
                  <Label>Custom Cron Expression</Label>
                  <Input
                    value={form.scheduleCron}
                    onChange={e => setForm(f => ({ ...f, scheduleCron: e.target.value }))}
                    placeholder="0 2 * * *"
                    className="font-mono"
                  />
                  {form.scheduleCron && (() => {
                    try { return <p className="text-xs text-muted-foreground">{cronstrue.toString(form.scheduleCron)}</p>; }
                    catch { return <p className="text-xs text-destructive">Invalid cron expression</p>; }
                  })()}
                </div>
              )}

              {cronPreset && cronPreset !== "__custom__" && (
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.scheduleEnabled}
                    onCheckedChange={v => setForm(f => ({ ...f, scheduleEnabled: v }))}
                  />
                  <Label className="cursor-pointer text-sm font-normal">
                    {form.scheduleEnabled ? "Schedule enabled — will run automatically" : "Schedule configured but disabled"}
                  </Label>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editId ? "Update Pipeline" : "Create Pipeline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Pipeline</DialogTitle>
            <DialogDescription>This will permanently delete the pipeline and all its run history. Cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={deletePipeline}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Run history dialog */}
      <Dialog open={!!historyPipeline} onOpenChange={() => setHistoryPipeline(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Run History — {historyPipeline?.name}</DialogTitle>
            <DialogDescription>Last 50 pipeline executions.</DialogDescription>
          </DialogHeader>
          {historyLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : historyJobs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No runs yet.</p>
          ) : (
            <div className="divide-y text-sm">
              {historyJobs.map(j => (
                <div key={j.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      {j.status === "success" && <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />}
                      {j.status === "failed"  && <XCircle   className="h-4 w-4 text-destructive shrink-0" />}
                      {j.status === "running" && <Loader2   className="h-4 w-4 animate-spin text-blue-600 shrink-0" />}
                      {j.status === "pending" && <History   className="h-4 w-4 text-muted-foreground shrink-0" />}
                      <span className="font-medium capitalize">{j.status}</span>
                      {j.triggeredBySchedule
                        ? <Badge variant="outline" className="text-xs">Scheduled</Badge>
                        : <Badge variant="outline" className="text-xs">Manual</Badge>
                      }
                    </div>
                    {j.recordCount !== null && (
                      <p className="text-muted-foreground text-xs">{j.recordCount.toLocaleString()} row{j.recordCount !== 1 ? "s" : ""} transferred</p>
                    )}
                    {j.errorMessage && (
                      <p className="text-destructive text-xs font-mono">{j.errorMessage}</p>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground text-right shrink-0">
                    <p>{formatDate(j.startedAt ?? j.createdAt)}</p>
                    {j.startedAt && j.finishedAt && (
                      <p>{Math.round((new Date(j.finishedAt).getTime() - new Date(j.startedAt).getTime()) / 1000)}s</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
