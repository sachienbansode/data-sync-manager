import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Loader2, Plus, Pencil, Trash2, GitBranch, ArrowRight, Database, Cloud,
  FolderOpen, Server, CheckCircle, Play, PauseCircle, Settings2,
  CalendarClock, History, XCircle, ChevronDown, ChevronUp, User, Info, Shuffle,
} from "lucide-react";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";
import cronstrue from "cronstrue";
import { formatDate as fmtIsoDate, formatDateTime as fmtIsoDateTime } from "@/lib/date";

type PipelineStatus = "active" | "inactive";

interface Pipeline {
  id: number;
  name: string;
  description: string | null;
  sourceObjectId: number | null;
  destObjectId: number | null;
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
  notifyOnSuccess: string | null;
  notifyOnFailure: string | null;
  loadType: string | null;
  preSqlCommand: string | null;
  postSqlCommand: string | null;
  conflictColumns: string | null;
  watermarkColumn: string | null;
  lastWatermarkValue: string | null;
  createdAt: string;
}

interface DbConnection {
  id: number;
  name: string;
  type: string;
  dbEngine: string;
  schemaName: string | null;
}

interface ConnectionObject {
  id: number;
  connectionId: number;
  name: string;
  objectType: string;
  objectValue: string;
  description: string | null;
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

const LOAD_TYPE_OPTIONS = [
  { value: "full_load",    label: "Full Load",    hint: "Truncates / replaces destination before each run" },
  { value: "incremental",  label: "Incremental",  hint: "Appends or upserts rows — destination is not cleared" },
] as const;
type LoadType = "full_load" | "incremental";

function splitToScripts(sql: string | null | undefined): string[] {
  if (!sql?.trim()) return [""];
  const parts = sql.split(";").map(s => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [""];
}

const EMPTY_FORM = {
  name: "", description: "",
  sourceObjectId: "__none__",
  destObjectId: "__none__",
  loadType: "full_load" as LoadType,
  preSqlScripts: [""] as string[],
  postSqlScripts: [""] as string[],
  conflictColumns: "",
  watermarkColumn: "",
  scheduleEnabled: false, scheduleCron: "",
  notifyOnSuccess: "",
  notifyOnFailure: "",
};

const apiBase = `${import.meta.env.BASE_URL}api`;

export default function Workflow() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [connections, setConnections] = useState<DbConnection[]>([]);
  const [dataObjects, setDataObjects] = useState<ConnectionObject[]>([]);
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
  const [historyStatusFilter, setHistoryStatusFilter] = useState("all");
  const [historyPage, setHistoryPage] = useState(1);
  const HISTORY_PAGE_SIZE = 10;
  const [, setLocation] = useLocation();

  const token = getAccessToken();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const hdrs = { Authorization: `Bearer ${token}` };
      const [pRes, cRes, oRes] = await Promise.all([
        fetch(`${apiBase}/admin/pipelines`, { headers: hdrs }),
        fetch(`${apiBase}/admin/db-connections`, { headers: hdrs }),
        fetch(`${apiBase}/admin/connection-objects`, { headers: hdrs }),
      ]);
      if (!pRes.ok) throw new Error("Failed to load pipelines");
      if (!cRes.ok) throw new Error("Failed to load connections");
      setPipelines(await pRes.json());
      setConnections(await cRes.json());
      if (oRes.ok) setDataObjects(await oRes.json());
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
      sourceObjectId: p.sourceObjectId ? String(p.sourceObjectId) : "__none__",
      destObjectId: p.destObjectId ? String(p.destObjectId) : "__none__",
      loadType: (p.loadType as LoadType) ?? "full_load",
      preSqlScripts: splitToScripts(p.preSqlCommand),
      postSqlScripts: splitToScripts(p.postSqlCommand),
      conflictColumns: p.conflictColumns ?? "",
      watermarkColumn: p.watermarkColumn ?? "",
      scheduleEnabled: p.scheduleEnabled, scheduleCron: p.scheduleCron ?? "",
      notifyOnSuccess: p.notifyOnSuccess ?? "",
      notifyOnFailure: p.notifyOnFailure ?? "",
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
    if (form.scheduleEnabled && !form.scheduleCron.trim()) {
      toast.error("Cron expression required when schedule is enabled"); return;
    }

    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        sourceObjectId: form.sourceObjectId !== "__none__" ? parseInt(form.sourceObjectId) : null,
        destObjectId: form.destObjectId !== "__none__" ? parseInt(form.destObjectId) : null,
        loadType: form.loadType,
        preSqlCommand: form.preSqlScripts.filter(s => s.trim()).join(";\n").trim() || undefined,
        postSqlCommand: form.postSqlScripts.filter(s => s.trim()).join(";\n").trim() || undefined,
        conflictColumns: form.conflictColumns.trim() || undefined,
        watermarkColumn: form.watermarkColumn.trim() || undefined,
        scheduleEnabled: form.scheduleEnabled,
        scheduleCron: form.scheduleCron.trim() || undefined,
        notifyOnSuccess: form.notifyOnSuccess.trim() || undefined,
        notifyOnFailure: form.notifyOnFailure.trim() || undefined,
      };
      const url = editId ? `${apiBase}/admin/pipelines/${editId}` : `${apiBase}/admin/pipelines`;
      const res = await fetch(url, {
        method: editId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Save failed"); }
      const saved = await res.json();
      if (!editId) {
        toast.success("Pipeline created — configure field mappings now", {
          description: "Define which source columns map to destination columns.",
          action: { label: "Configure Mappings →", onClick: () => setLocation(`/workflow/${saved.id}/mappings`) },
          duration: 10000,
        });
      } else {
        toast.success("Pipeline updated");
      }
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

  const filteredHistoryJobs = historyJobs.filter(j =>
    historyStatusFilter === "all" || j.status === historyStatusFilter
  );
  const historyTotalPages = Math.max(1, Math.ceil(filteredHistoryJobs.length / HISTORY_PAGE_SIZE));
  const pagedHistoryJobs = filteredHistoryJobs.slice(
    (historyPage - 1) * HISTORY_PAGE_SIZE,
    historyPage * HISTORY_PAGE_SIZE
  );

  async function openHistory(p: Pipeline) {
    setHistoryPipeline(p);
    setHistoryJobs([]);
    setHistoryStatusFilter("all");
    setHistoryPage(1);
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

  function objById(id: number | null): ConnectionObject | undefined {
    if (!id) return undefined;
    return dataObjects.find(o => o.id === id);
  }

  function connById(id: number | null): DbConnection | undefined {
    if (!id) return undefined;
    return connections.find(c => c.id === id);
  }

  function objectLabel(obj: ConnectionObject): string {
    const conn = connById(obj.connectionId);
    return conn ? `${conn.name} · ${obj.name}` : obj.name;
  }

  function objectConnEngine(obj: ConnectionObject): string {
    return connById(obj.connectionId)?.dbEngine ?? "postgresql";
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Pipelines</h1>
            <p className="text-muted-foreground mt-1">
              Build pipelines from Data Objects (Step 2) — pick a source object and a destination object, then run or schedule.
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
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Data Objects</p>
            <p className="text-2xl font-bold mt-0.5">{loading ? "—" : dataObjects.length}</p>
          </CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><GitBranch className="h-5 w-5" /> Pipelines</CardTitle>
            <CardDescription>
              Each pipeline moves data from a source Data Object to a destination Data Object, with optional field-level mapping.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : pipelines.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <GitBranch className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No pipelines yet</p>
                <p className="text-sm mt-1">
                  {dataObjects.length === 0
                    ? "First add Data Objects (Step 2), then create a pipeline here."
                    : "Create your first pipeline to start moving data between systems."
                  }
                </p>
                <Button className="mt-4" onClick={openAdd}><Plus className="h-4 w-4 mr-2" />New Pipeline</Button>
              </div>
            ) : (
              <div className="divide-y">
                {pipelines.map((p) => {
                  const srcObj = objById(p.sourceObjectId);
                  const dstObj = objById(p.destObjectId);
                  const srcEngine = srcObj ? objectConnEngine(srcObj) : (connById(p.sourceConnectionId)?.dbEngine ?? "");
                  const dstEngine = dstObj ? objectConnEngine(dstObj) : (connById(p.destConnectionId)?.dbEngine ?? "");
                  const SrcIcon = ENGINE_ICON[srcEngine] ?? Database;
                  const DstIcon = ENGINE_ICON[dstEngine] ?? Database;

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
                            {srcObj
                              ? <span className="font-medium">{objectLabel(srcObj)}</span>
                              : p.sourceConnectionId
                                ? <span className="font-medium">{connById(p.sourceConnectionId)?.name ?? "Unknown"}{p.sourceTable ? ` · ${p.sourceTable}` : ""}</span>
                                : <span className="text-muted-foreground italic">No source</span>
                            }
                          </div>
                          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted/50 border text-xs">
                            <DstIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            {dstObj
                              ? <span className="font-medium">{objectLabel(dstObj)}</span>
                              : p.destConnectionId
                                ? <span className="font-medium">{connById(p.destConnectionId)?.name ?? "Unknown"}{p.destTarget ? ` · ${p.destTarget}` : ""}</span>
                                : <span className="text-muted-foreground italic">No destination</span>
                            }
                          </div>
                        </div>

                        <p className="text-xs text-muted-foreground">
                          Created {fmtIsoDate(p.createdAt)}
                          {p.scheduleLastRunAt && ` · Last run ${fmtIsoDateTime(p.scheduleLastRunAt)}`}
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
              Select a source and destination Data Object, then configure an optional schedule.
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

            {/* SOURCE OBJECT */}
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" /> Source Object
              </p>
              {dataObjects.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No Data Objects defined yet. <Link href="/admin/data-objects" className="text-primary underline underline-offset-2">Add some in Step 2</Link> first.
                </p>
              ) : (
                <div className="space-y-1">
                  <Label>Source Data Object</Label>
                  <Select
                    value={form.sourceObjectId}
                    onValueChange={v => setForm(f => ({ ...f, sourceObjectId: v }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Select source object…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— None —</SelectItem>
                      {dataObjects.map(o => (
                        <SelectItem key={o.id} value={String(o.id)}>
                          {objectLabel(o)}
                          <span className="text-muted-foreground text-xs ml-1">({o.objectType})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.sourceObjectId !== "__none__" && (() => {
                    const obj = dataObjects.find(o => o.id === parseInt(form.sourceObjectId));
                    if (!obj) return null;
                    return (
                      <p className="text-xs text-muted-foreground font-mono truncate">
                        {obj.objectType === "query" ? obj.objectValue.slice(0, 80) + (obj.objectValue.length > 80 ? "…" : "") : obj.objectValue}
                      </p>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* DESTINATION OBJECT */}
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" /> Destination Object
              </p>
              {dataObjects.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No Data Objects defined yet. <Link href="/admin/data-objects" className="text-primary underline underline-offset-2">Add some in Step 2</Link> first.
                </p>
              ) : (
                <div className="space-y-1">
                  <Label>Destination Data Object</Label>
                  <Select
                    value={form.destObjectId}
                    onValueChange={v => setForm(f => ({ ...f, destObjectId: v }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Select destination object…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— None —</SelectItem>
                      {dataObjects.map(o => (
                        <SelectItem key={o.id} value={String(o.id)}>
                          {objectLabel(o)}
                          <span className="text-muted-foreground text-xs ml-1">({o.objectType})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.destObjectId !== "__none__" && (() => {
                    const obj = dataObjects.find(o => o.id === parseInt(form.destObjectId));
                    if (!obj) return null;
                    return (
                      <p className="text-xs text-muted-foreground font-mono truncate">{obj.objectValue}</p>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* LOAD TYPE */}
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-semibold flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-muted-foreground" /> Load Strategy
              </p>
              <div className="space-y-1">
                <Label>Load Type</Label>
                <Select value={form.loadType} onValueChange={v => setForm(f => ({ ...f, loadType: v as LoadType }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOAD_TYPE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <span className="font-medium">{opt.label}</span>
                        <span className="text-muted-foreground text-xs ml-2 hidden sm:inline">— {opt.hint}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {form.loadType === "full_load"
                    ? "Full Load: destination is truncated (or replaced) before each run. All rows from source are inserted fresh."
                    : "Incremental: only new or changed rows are added — destination rows are not deleted before the run."}
                </p>
              </div>

              {/* Pre-Load SQL — multiple script blocks */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Pre-Load SQL <span className="text-xs text-muted-foreground font-normal">(optional — runs on destination before data transfer)</span></Label>
                  <Button
                    type="button" variant="ghost" size="sm"
                    className="h-6 text-xs gap-1 px-2"
                    onClick={() => setForm(f => ({ ...f, preSqlScripts: [...f.preSqlScripts, ""] }))}
                  >
                    <Plus className="h-3 w-3" /> Add Script
                  </Button>
                </div>
                {form.preSqlScripts.map((script, idx) => (
                  <div key={idx} className="flex gap-1.5 items-start">
                    <div className="flex-1 space-y-0.5">
                      {form.preSqlScripts.length > 1 && (
                        <p className="text-[10px] text-muted-foreground font-mono pl-1">Script {idx + 1}</p>
                      )}
                      <Textarea
                        value={script}
                        onChange={e => setForm(f => {
                          const arr = [...f.preSqlScripts];
                          arr[idx] = e.target.value;
                          return { ...f, preSqlScripts: arr };
                        })}
                        placeholder={idx === 0 && form.loadType === "full_load" ? "TRUNCATE TABLE target_table" : "DELETE FROM target_table WHERE updated_at < NOW() - INTERVAL '90 days'"}
                        className="font-mono text-xs resize-none"
                        rows={3}
                      />
                    </div>
                    {form.preSqlScripts.length > 1 && (
                      <Button
                        type="button" variant="ghost" size="icon"
                        className="h-7 w-7 shrink-0 mt-5 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setForm(f => ({ ...f, preSqlScripts: f.preSqlScripts.filter((_, i) => i !== idx) }))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">Each script is one SQL statement. No write operations will be performed on the source connection.</p>
              </div>

              {/* Post-Load SQL — multiple script blocks */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Post-Load SQL <span className="text-xs text-muted-foreground font-normal">(optional — runs on destination after data transfer)</span></Label>
                  <Button
                    type="button" variant="ghost" size="sm"
                    className="h-6 text-xs gap-1 px-2"
                    onClick={() => setForm(f => ({ ...f, postSqlScripts: [...f.postSqlScripts, ""] }))}
                  >
                    <Plus className="h-3 w-3" /> Add Script
                  </Button>
                </div>
                {form.postSqlScripts.map((script, idx) => (
                  <div key={idx} className="flex gap-1.5 items-start">
                    <div className="flex-1 space-y-0.5">
                      {form.postSqlScripts.length > 1 && (
                        <p className="text-[10px] text-muted-foreground font-mono pl-1">Script {idx + 1}</p>
                      )}
                      <Textarea
                        value={script}
                        onChange={e => setForm(f => {
                          const arr = [...f.postSqlScripts];
                          arr[idx] = e.target.value;
                          return { ...f, postSqlScripts: arr };
                        })}
                        placeholder={idx === 0 ? "ANALYZE target_table" : "UPDATE load_log SET status = 'done', loaded_at = NOW() WHERE pipeline_id = 1"}
                        className="font-mono text-xs resize-none"
                        rows={3}
                      />
                    </div>
                    {form.postSqlScripts.length > 1 && (
                      <Button
                        type="button" variant="ghost" size="icon"
                        className="h-7 w-7 shrink-0 mt-5 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setForm(f => ({ ...f, postSqlScripts: f.postSqlScripts.filter((_, i) => i !== idx) }))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">Each script runs after the data transfer completes.</p>
              </div>

              {form.loadType === "incremental" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1">
                    <Label>Conflict Columns <span className="text-xs text-muted-foreground font-normal">(upsert key)</span></Label>
                    <Input
                      value={form.conflictColumns}
                      onChange={e => setForm(f => ({ ...f, conflictColumns: e.target.value }))}
                      placeholder="id  or  user_id, date"
                      className="font-mono text-xs"
                    />
                    <p className="text-xs text-muted-foreground">Comma-separated destination column(s) used for ON CONFLICT DO UPDATE. Leave empty to plain-append.</p>
                  </div>
                  <div className="space-y-1">
                    <Label>Watermark Column <span className="text-xs text-muted-foreground font-normal">(incremental tracking)</span></Label>
                    <Input
                      value={form.watermarkColumn}
                      onChange={e => setForm(f => ({ ...f, watermarkColumn: e.target.value }))}
                      placeholder="updated_at  or  id"
                      className="font-mono text-xs"
                    />
                    <p className="text-xs text-muted-foreground">Column used to track the last loaded value. Max value is saved after each run.</p>
                  </div>
                </div>
              )}
            </div>

            {/* NOTIFICATIONS */}
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-semibold flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" /> Notifications <span className="text-xs text-muted-foreground font-normal">(optional)</span>
              </p>
              <div className="space-y-1">
                <Label>Notify on Success</Label>
                <Input
                  type="email"
                  value={form.notifyOnSuccess}
                  onChange={e => setForm(f => ({ ...f, notifyOnSuccess: e.target.value }))}
                  placeholder="alerts@example.com"
                />
                <p className="text-xs text-muted-foreground">Email to receive a confirmation when the pipeline runs successfully.</p>
              </div>
              <div className="space-y-1">
                <Label>Notify on Failure</Label>
                <Input
                  type="email"
                  value={form.notifyOnFailure}
                  onChange={e => setForm(f => ({ ...f, notifyOnFailure: e.target.value }))}
                  placeholder="oncall@example.com"
                />
                <p className="text-xs text-muted-foreground">Email to receive a detailed error report when the pipeline fails.</p>
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

          {!editId && (
            <div className="flex items-start gap-2 rounded-lg border bg-blue-50 dark:bg-blue-950/30 px-4 py-3 text-xs text-blue-700 dark:text-blue-300">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                After saving, click <strong>Mappings</strong> <Shuffle className="h-3 w-3 inline" /> on the pipeline row to define which source columns map to which destination columns and configure any transforms.
              </span>
            </div>
          )}

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
      <Dialog open={!!historyPipeline} onOpenChange={() => { setHistoryPipeline(null); setHistoryStatusFilter("all"); setHistoryPage(1); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Run History — {historyPipeline?.name}</DialogTitle>
            <DialogDescription>Last 50 pipeline executions.</DialogDescription>
          </DialogHeader>

          {/* Filter bar */}
          {!historyLoading && historyJobs.length > 0 && (
            <div className="flex items-center gap-2">
              <Select value={historyStatusFilter} onValueChange={v => { setHistoryStatusFilter(v); setHistoryPage(1); }}>
                <SelectTrigger className="w-36 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground ml-auto">
                {filteredHistoryJobs.length} run{filteredHistoryJobs.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}

          {historyLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : historyJobs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No runs yet.</p>
          ) : filteredHistoryJobs.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">No runs match the selected filter.</p>
          ) : (
            <>
              <div className="divide-y text-sm">
                {pagedHistoryJobs.map(j => (
                  <div key={j.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        {j.status === "success" && <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />}
                        {j.status === "failed"  && <XCircle   className="h-4 w-4 text-destructive shrink-0" />}
                        {j.status === "running" && <Loader2   className="h-4 w-4 animate-spin text-blue-600 shrink-0" />}
                        {j.status === "pending" && <History   className="h-4 w-4 text-muted-foreground shrink-0" />}
                        <span className="font-medium capitalize">{j.status}</span>
                        {j.triggeredBySchedule
                          ? <span className="flex items-center gap-1 text-xs font-medium text-blue-600"><CalendarClock className="h-3 w-3" /> Scheduled</span>
                          : <span className="flex items-center gap-1 text-xs text-muted-foreground"><User className="h-3 w-3" /> Manual</span>
                        }
                      </div>
                      {j.recordCount !== null && (
                        <p className="text-muted-foreground text-xs">{j.recordCount.toLocaleString()} row{j.recordCount !== 1 ? "s" : ""} transferred</p>
                      )}
                      {j.errorMessage && (
                        <p className="text-destructive text-xs font-mono break-all">{j.errorMessage}</p>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground text-right shrink-0">
                      <p>{fmtIsoDateTime(j.startedAt ?? j.createdAt)}</p>
                      {j.startedAt && j.finishedAt && (
                        <p>{Math.round((new Date(j.finishedAt).getTime() - new Date(j.startedAt).getTime()) / 1000)}s</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {historyTotalPages > 1 && (
                <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground border-t">
                  <span>Page {historyPage} of {historyTotalPages}</span>
                  <div className="flex gap-1">
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={historyPage === 1} onClick={() => setHistoryPage(p => p - 1)}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={historyPage === historyTotalPages} onClick={() => setHistoryPage(p => p + 1)}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
