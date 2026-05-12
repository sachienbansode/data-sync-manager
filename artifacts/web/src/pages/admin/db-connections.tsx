import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Pencil, Trash2, CheckCircle, XCircle, Wifi, Database, Clock, CalendarClock, Timer, AlertTriangle, History, Play, Server, Cloud, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";
import cronstrue from "cronstrue";
import { CronExpressionParser } from "cron-parser";

type DbEngine = "postgresql" | "mysql" | "mssql" | "oracle" | "s3" | "sftp" | "csv";
type ConnectionType = "backoffice" | "trading";

interface DataJob {
  id: number;
  type: string;
  status: "pending" | "running" | "success" | "failed";
  triggeredBySchedule: boolean;
  connectionId: number | null;
  connectionName: string | null;
  recordCount: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface DbConnection {
  id: number;
  name: string;
  type: ConnectionType;
  dbEngine: DbEngine;
  host: string | null;
  port: number | null;
  dbName: string | null;
  schemaName: string | null;
  extraParams: Record<string, string> | null;
  outputFilePath: string | null;
  fetchQuery: string | null;
  scheduleEnabled: boolean;
  scheduleCron: string | null;
  scheduleLastRunAt: string | null;
  scheduleNextRunAt: string | null;
  scheduleConsecutiveFailures: number;
  lastTestedAt: string | null;
  lastTestSuccess: boolean | null;
  createdAt: string;
}

const ENGINE_META: Record<DbEngine, { label: string; icon: React.ComponentType<{ className?: string }>; defaultPort: number | null; isFile: boolean; isCloud: boolean }> = {
  postgresql: { label: "PostgreSQL", icon: Database, defaultPort: 5432, isFile: false, isCloud: false },
  mysql:      { label: "MySQL",      icon: Database, defaultPort: 3306, isFile: false, isCloud: false },
  mssql:      { label: "MS SQL Server", icon: Server,   defaultPort: 1433, isFile: false, isCloud: false },
  oracle:     { label: "Oracle DB",  icon: Server,   defaultPort: 1521, isFile: false, isCloud: false },
  s3:         { label: "Amazon S3",  icon: Cloud,    defaultPort: null, isFile: true,  isCloud: true  },
  sftp:       { label: "SFTP",       icon: FolderOpen, defaultPort: 22, isFile: true,  isCloud: false },
  csv:        { label: "CSV / File", icon: FolderOpen, defaultPort: null, isFile: true,  isCloud: false },
};

const EMPTY_FORM = {
  name: "", type: "backoffice" as ConnectionType,
  dbEngine: "postgresql" as DbEngine,
  host: "", port: "5432", dbName: "", schemaName: "public",
  username: "", password: "",
  // S3 extras
  bucket: "", region: "", s3Prefix: "", accessKeyId: "", secretAccessKey: "",
  // SFTP extras
  remotePath: "", privateKey: "",
  // CSV
  filePath: "",
  outputFilePath: "", fetchQuery: "",
  scheduleCron: "", scheduleEnabled: false,
};

const CRON_PRESETS = [
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Daily at 2 AM", value: "0 2 * * *" },
  { label: "Daily at 6 AM", value: "0 6 * * *" },
  { label: "Weekly (Mon 8 AM)", value: "0 8 * * 1" },
  { label: "Custom", value: "" },
];

function formatCronHuman(expr: string): string {
  try {
    return cronstrue.toString(expr, { throwExceptionOnParseError: true });
  } catch {
    const preset = CRON_PRESETS.find((p) => p.value === expr && p.value !== "");
    return preset ? preset.label : expr;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString();
}

function computeNextRunFromCron(cronExpr: string): Date | null {
  try {
    return CronExpressionParser.parse(cronExpr).next().toDate();
  } catch {
    return null;
  }
}

function formatCountdown(targetDate: Date): string {
  const diffMs = targetDate.getTime() - Date.now();
  if (diffMs <= 0) return "any moment now";
  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `in ${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  if (minutes > 0) return `in ${minutes}m ${seconds}s`;
  return `in ${seconds}s`;
}

function NextRunCountdown({ scheduleNextRunAt, scheduleCron, scheduleEnabled }: {
  scheduleNextRunAt: string | null;
  scheduleCron: string | null;
  scheduleEnabled: boolean;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!scheduleEnabled || !scheduleCron) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [scheduleEnabled, scheduleCron]);

  if (!scheduleEnabled || !scheduleCron) return null;

  let nextDate: Date | null = scheduleNextRunAt ? new Date(scheduleNextRunAt) : null;
  if (!nextDate || nextDate.getTime() <= Date.now()) {
    nextDate = computeNextRunFromCron(scheduleCron);
  }
  if (!nextDate) return null;

  return (
    <span className="flex items-center gap-1 text-xs text-blue-600 font-medium">
      <Timer className="h-3 w-3" />
      Next run: {formatCountdown(nextDate)}
    </span>
  );
}

function engineBadgeColor(engine: DbEngine) {
  const map: Record<DbEngine, string> = {
    postgresql: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    mysql:      "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    mssql:      "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
    oracle:     "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    s3:         "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    sftp:       "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
    csv:        "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  };
  return map[engine] ?? "bg-muted text-muted-foreground";
}

function connectionSummary(c: DbConnection): string {
  const e = c.dbEngine;
  if (e === "s3") {
    const bucket = c.extraParams?.bucket ?? "?";
    const region = c.extraParams?.region ?? "";
    return `s3://${bucket}${region ? ` (${region})` : ""}`;
  }
  if (e === "sftp") {
    return `sftp://${c.host ?? "?"}:${c.port ?? 22}${c.extraParams?.remotePath ?? ""}`;
  }
  if (e === "csv") {
    return c.extraParams?.filePath ?? c.outputFilePath ?? "—";
  }
  return `${c.host ?? "?"}:${c.port ?? "?"}/${c.dbName ?? "?"}`;
}

const apiBase = `${import.meta.env.BASE_URL}api`;

export default function DbConnections() {
  const [connections, setConnections] = useState<DbConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [togglingSchedule, setTogglingSchedule] = useState<number | null>(null);
  const [runningNow, setRunningNow] = useState<number | null>(null);
  const [cronPreset, setCronPreset] = useState<string>("");
  const [historyConnection, setHistoryConnection] = useState<DbConnection | null>(null);
  const [historyJobs, setHistoryJobs] = useState<DataJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const meta = ENGINE_META[form.dbEngine];
  const isDbEngine = !meta.isFile;
  const isS3 = form.dbEngine === "s3";
  const isSftp = form.dbEngine === "sftp";
  const isCsv = form.dbEngine === "csv";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/admin/db-connections`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to load connections");
      setConnections(await res.json());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load connections");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setCronPreset("");
    setDialogOpen(true);
  }

  function openEdit(c: DbConnection) {
    setEditId(c.id);
    const ep = c.extraParams ?? {};
    setForm({
      name: c.name, type: c.type, dbEngine: c.dbEngine,
      host: c.host ?? "", port: String(c.port ?? ""),
      dbName: c.dbName ?? "", schemaName: c.schemaName ?? "public",
      username: "", password: "",
      bucket: ep.bucket ?? "", region: ep.region ?? "", s3Prefix: ep.s3Prefix ?? "",
      accessKeyId: "", secretAccessKey: "",
      remotePath: ep.remotePath ?? "", privateKey: "",
      filePath: ep.filePath ?? "",
      outputFilePath: c.outputFilePath ?? "", fetchQuery: c.fetchQuery ?? "",
      scheduleCron: c.scheduleCron ?? "", scheduleEnabled: c.scheduleEnabled,
    });
    const preset = CRON_PRESETS.find((p) => p.value === c.scheduleCron && p.value !== "");
    setCronPreset(preset ? preset.value : (c.scheduleCron ? "custom" : ""));
    setDialogOpen(true);
  }

  function handleEngineChange(engine: DbEngine) {
    const m = ENGINE_META[engine];
    setForm(f => ({
      ...f,
      dbEngine: engine,
      port: m.defaultPort !== null ? String(m.defaultPort) : "",
      scheduleEnabled: false, scheduleCron: "",
    }));
    setCronPreset("");
  }

  async function save() {
    if (!form.name) { toast.error("Connection name is required"); return; }

    if (isDbEngine) {
      if (!form.host || !form.dbName) { toast.error("Host and database name are required"); return; }
      if (!editId && (!form.username || !form.password)) {
        toast.error("Username and password are required for new connections");
        return;
      }
    }
    if (isS3) {
      if (!form.bucket) { toast.error("S3 bucket is required"); return; }
      if (!editId && (!form.accessKeyId || !form.secretAccessKey)) {
        toast.error("Access key and secret are required for new S3 connections");
        return;
      }
    }
    if (isSftp) {
      if (!form.host) { toast.error("SFTP host is required"); return; }
      if (!editId && !form.password && !form.privateKey) {
        toast.error("Password or private key is required for new SFTP connections");
        return;
      }
    }
    if (form.scheduleEnabled && !form.scheduleCron.trim()) {
      toast.error("A cron expression is required to enable scheduling");
      return;
    }

    setSaving(true);
    try {
      const token = getAccessToken();

      const extraParams: Record<string, string> = {};
      if (isS3) {
        if (form.bucket) extraParams.bucket = form.bucket;
        if (form.region) extraParams.region = form.region;
        if (form.s3Prefix) extraParams.s3Prefix = form.s3Prefix;
      }
      if (isSftp) {
        if (form.remotePath) extraParams.remotePath = form.remotePath;
      }
      if (isCsv) {
        if (form.filePath) extraParams.filePath = form.filePath;
      }

      const body: Record<string, unknown> = {
        name: form.name, type: form.type, dbEngine: form.dbEngine,
        extraParams: Object.keys(extraParams).length > 0 ? extraParams : undefined,
        outputFilePath: form.outputFilePath || undefined,
        fetchQuery: form.fetchQuery.trim() || undefined,
        scheduleCron: form.scheduleCron.trim() || undefined,
        scheduleEnabled: form.scheduleEnabled,
      };

      if (isDbEngine || isSftp) {
        if (form.host) body.host = form.host;
        if (form.port) body.port = parseInt(form.port) || undefined;
      }
      if (isDbEngine) {
        if (form.dbName) body.dbName = form.dbName;
        if (form.schemaName) body.schemaName = form.schemaName || "public";
        if (form.username) body.username = form.username;
        if (form.password) body.password = form.password;
      }
      if (isS3) {
        if (form.accessKeyId) body.username = form.accessKeyId;
        if (form.secretAccessKey) body.password = form.secretAccessKey;
      }
      if (isSftp) {
        if (form.username) body.username = form.username;
        if (form.password) body.password = form.password;
        if (form.privateKey) { extraParams.privateKey = form.privateKey; body.extraParams = extraParams; }
      }

      const url = editId ? `${apiBase}/admin/db-connections/${editId}` : `${apiBase}/admin/db-connections`;
      const method = editId ? "PUT" : "POST";
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Save failed"); }
      toast.success(editId ? "Connection updated" : "Connection created");
      setDialogOpen(false);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection(id: number) {
    setTesting(id);
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/admin/db-connections/${id}/test`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) toast.success("Connection successful");
      else toast.error(`Connection failed: ${data.error}`);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(null);
    }
  }

  async function toggleSchedule(c: DbConnection) {
    setTogglingSchedule(c.id);
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/admin/db-connections/${c.id}/schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: !c.scheduleEnabled }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed to toggle schedule"); }
      toast.success(c.scheduleEnabled ? "Schedule disabled" : "Schedule enabled");
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to toggle schedule");
    } finally {
      setTogglingSchedule(null);
    }
  }

  async function deleteConnection() {
    if (!deleteId) return;
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/admin/db-connections/${deleteId}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 204) throw new Error("Delete failed");
      toast.success("Connection deleted");
      setDeleteId(null);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function runNow(c: DbConnection) {
    setRunningNow(c.id);
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/admin/db-connections/${c.id}/run`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Run failed");
      const result = data.fetchResult as { success: boolean; recordCount?: number; error?: string } | undefined;
      if (result?.success) {
        const rows = result.recordCount ?? 0;
        toast.success(`Fetch completed — ${rows.toLocaleString()} row${rows !== 1 ? "s" : ""} fetched`);
      } else {
        toast.error(`Fetch failed: ${result?.error ?? "Unknown error"}`);
      }
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunningNow(null);
    }
  }

  async function openHistory(c: DbConnection) {
    setHistoryConnection(c);
    setHistoryJobs([]);
    setHistoryLoading(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/admin/db-connections/${c.id}/jobs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load job history");
      setHistoryJobs(await res.json());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load job history");
    } finally {
      setHistoryLoading(false);
    }
  }

  function handleCronPresetChange(value: string) {
    setCronPreset(value);
    if (value && value !== "custom") {
      setForm(f => ({ ...f, scheduleCron: value }));
    } else if (value === "custom") {
      setForm(f => ({ ...f, scheduleCron: "" }));
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Connection Manager</h1>
            <p className="text-muted-foreground mt-1">
              Manage encrypted connections — databases, cloud storage, SFTP, and file sources
            </p>
          </div>
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4 mr-2" /> Add Connection
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Database className="h-5 w-5" /> Connections</CardTitle>
            <CardDescription>Credentials are encrypted at rest. Supports PostgreSQL, MySQL, MS SQL, Oracle, S3, SFTP, and CSV.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : connections.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Database className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No connections configured yet.</p>
              </div>
            ) : (
              <div className="divide-y">
                {connections.map((c) => {
                  const eng = ENGINE_META[c.dbEngine] ?? ENGINE_META.postgresql;
                  const EngIcon = eng.icon;
                  return (
                    <div key={c.id} className="py-4 flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <EngIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium">{c.name}</span>
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${engineBadgeColor(c.dbEngine)}`}>
                            {eng.label}
                          </span>
                          <Badge variant={c.type === "backoffice" ? "default" : "secondary"} className="text-xs">
                            {c.type === "backoffice" ? "BackOffice" : "Trading"}
                          </Badge>
                          {c.lastTestedAt && (
                            c.lastTestSuccess
                              ? <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle className="h-3 w-3" /> Tested</span>
                              : <span className="flex items-center gap-1 text-xs text-destructive"><XCircle className="h-3 w-3" /> Failed</span>
                          )}
                          {c.type === "backoffice" && c.scheduleCron && (
                            <span className={`flex items-center gap-1 text-xs ${c.scheduleEnabled ? "text-blue-600" : "text-muted-foreground"}`}>
                              <CalendarClock className="h-3 w-3" />
                              {c.scheduleEnabled ? "Scheduled" : "Schedule off"} · {formatCronHuman(c.scheduleCron)}
                            </span>
                          )}
                          {c.type === "backoffice" && c.scheduleConsecutiveFailures > 0 && (
                            <span className="flex items-center gap-1 text-xs text-destructive font-medium">
                              <AlertTriangle className="h-3 w-3" />
                              {c.scheduleConsecutiveFailures} failure{c.scheduleConsecutiveFailures !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground font-mono">
                          {connectionSummary(c)}
                          {c.schemaName && c.schemaName !== "public" && !ENGINE_META[c.dbEngine].isFile && (
                            <span className="ml-2 text-xs font-sans">(schema: {c.schemaName})</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {!ENGINE_META[c.dbEngine].isFile ? (
                            <>Username: <span className="font-mono">••••••••</span> &nbsp;·&nbsp; Password: <span className="font-mono">••••••••</span></>
                          ) : c.dbEngine === "s3" ? (
                            <>Access Key: <span className="font-mono">••••••••</span></>
                          ) : null}
                          {c.outputFilePath && <span className="ml-3">Output: <span className="font-mono">{c.outputFilePath}</span></span>}
                        </div>
                        {c.type === "backoffice" && c.scheduleCron && (
                          <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Last run: {formatDate(c.scheduleLastRunAt)}</span>
                            <NextRunCountdown
                              scheduleNextRunAt={c.scheduleNextRunAt}
                              scheduleCron={c.scheduleCron}
                              scheduleEnabled={c.scheduleEnabled}
                            />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                        {c.type === "backoffice" && c.scheduleCron && (
                          <>
                            <div className="flex items-center gap-1.5" title={c.scheduleEnabled ? "Disable schedule" : "Enable schedule"}>
                              {togglingSchedule === c.id ? (
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                              ) : (
                                <Switch
                                  checked={c.scheduleEnabled}
                                  onCheckedChange={() => toggleSchedule(c)}
                                  aria-label={c.scheduleEnabled ? "Disable schedule" : "Enable schedule"}
                                />
                              )}
                            </div>
                            <Button variant="outline" size="sm" onClick={() => runNow(c)} disabled={runningNow === c.id} title="Run scheduled fetch now">
                              {runningNow === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                              <span className="ml-1 hidden sm:inline">Run now</span>
                            </Button>
                          </>
                        )}
                        {c.type === "backoffice" && (
                          <Button variant="outline" size="sm" onClick={() => openHistory(c)} title="View scheduled run history">
                            <History className="h-4 w-4" />
                            <span className="ml-1 hidden sm:inline">History</span>
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => testConnection(c.id)} disabled={testing === c.id}>
                          {testing === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                          <span className="ml-1 hidden sm:inline">Test</span>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteId(c.id)}>
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

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Connection" : "Add Connection"}</DialogTitle>
            <DialogDescription>Configure connection details. Credentials are stored encrypted.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Name + Type */}
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1">
                <Label>Connection Name</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Production BackOffice DB" />
              </div>
              <div className="space-y-1">
                <Label>Role</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as ConnectionType, scheduleEnabled: false, scheduleCron: "" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="backoffice">BackOffice (Source)</SelectItem>
                    <SelectItem value="trading">Trading (Destination)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Engine / Type</Label>
                <Select value={form.dbEngine} onValueChange={v => handleEngineChange(v as DbEngine)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(ENGINE_META) as [DbEngine, typeof ENGINE_META[DbEngine]][]).map(([key, m]) => (
                      <SelectItem key={key} value={key}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* DB-type fields */}
            {isDbEngine && (
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1">
                  <Label>Host</Label>
                  <Input value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} placeholder="db.example.com" />
                </div>
                <div className="space-y-1">
                  <Label>Port</Label>
                  <Input type="number" value={form.port} onChange={e => setForm(f => ({ ...f, port: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Database Name</Label>
                  <Input value={form.dbName} onChange={e => setForm(f => ({ ...f, dbName: e.target.value }))} placeholder="mydb" />
                </div>
                <div className="space-y-1">
                  <Label>Schema</Label>
                  <Input value={form.schemaName} onChange={e => setForm(f => ({ ...f, schemaName: e.target.value }))} placeholder="public" />
                </div>
                <div className="space-y-1">
                  <Label>Username {editId && <span className="text-xs text-muted-foreground">(blank = keep)</span>}</Label>
                  <Input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder={editId ? "••••••••" : "db_user"} autoComplete="off" />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Password {editId && <span className="text-xs text-muted-foreground">(blank = keep)</span>}</Label>
                  <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} autoComplete="new-password" />
                </div>
              </div>
            )}

            {/* S3 fields */}
            {isS3 && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Bucket</Label>
                  <Input value={form.bucket} onChange={e => setForm(f => ({ ...f, bucket: e.target.value }))} placeholder="my-s3-bucket" />
                </div>
                <div className="space-y-1">
                  <Label>Region</Label>
                  <Input value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))} placeholder="ap-south-1" />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Prefix / Path <span className="text-xs text-muted-foreground">(optional)</span></Label>
                  <Input value={form.s3Prefix} onChange={e => setForm(f => ({ ...f, s3Prefix: e.target.value }))} placeholder="data/incoming/" />
                </div>
                <div className="space-y-1">
                  <Label>Access Key ID {editId && <span className="text-xs text-muted-foreground">(blank = keep)</span>}</Label>
                  <Input value={form.accessKeyId} onChange={e => setForm(f => ({ ...f, accessKeyId: e.target.value }))} autoComplete="off" />
                </div>
                <div className="space-y-1">
                  <Label>Secret Access Key {editId && <span className="text-xs text-muted-foreground">(blank = keep)</span>}</Label>
                  <Input type="password" value={form.secretAccessKey} onChange={e => setForm(f => ({ ...f, secretAccessKey: e.target.value }))} autoComplete="new-password" />
                </div>
              </div>
            )}

            {/* SFTP fields */}
            {isSftp && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Host</Label>
                  <Input value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} placeholder="sftp.example.com" />
                </div>
                <div className="space-y-1">
                  <Label>Port</Label>
                  <Input type="number" value={form.port} onChange={e => setForm(f => ({ ...f, port: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Username</Label>
                  <Input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} autoComplete="off" />
                </div>
                <div className="space-y-1">
                  <Label>Password {editId && <span className="text-xs text-muted-foreground">(blank = keep)</span>}</Label>
                  <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} autoComplete="new-password" />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Remote Path <span className="text-xs text-muted-foreground">(optional)</span></Label>
                  <Input value={form.remotePath} onChange={e => setForm(f => ({ ...f, remotePath: e.target.value }))} placeholder="/data/incoming" />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Private Key <span className="text-xs text-muted-foreground">(PEM, optional — leave blank to use password)</span></Label>
                  <textarea
                    className="w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-xs font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                    value={form.privateKey}
                    onChange={e => setForm(f => ({ ...f, privateKey: e.target.value }))}
                    placeholder="-----BEGIN RSA PRIVATE KEY-----"
                    spellCheck={false}
                  />
                </div>
              </div>
            )}

            {/* CSV fields */}
            {isCsv && (
              <div className="space-y-1">
                <Label>File Path</Label>
                <Input value={form.filePath} onChange={e => setForm(f => ({ ...f, filePath: e.target.value }))} placeholder="/data/files/input.csv" />
              </div>
            )}

            {/* Output path (all types) */}
            <div className="space-y-1">
              <Label>Output File Path <span className="text-xs text-muted-foreground">(optional — for CSV push)</span></Label>
              <Input value={form.outputFilePath} onChange={e => setForm(f => ({ ...f, outputFilePath: e.target.value }))} placeholder="/data/output/result.csv" />
            </div>

            {/* Fetch query + schedule for backoffice DB connections */}
            {form.type === "backoffice" && isDbEngine && (
              <>
                <div className="space-y-1">
                  <Label>Fetch Query <span className="text-xs text-muted-foreground">(optional — SELECT only)</span></Label>
                  <textarea
                    className="w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                    value={form.fetchQuery}
                    onChange={e => setForm(f => ({ ...f, fetchQuery: e.target.value }))}
                    placeholder={`SELECT * FROM "public"."table" LIMIT 1000`}
                    spellCheck={false}
                  />
                  <p className="text-xs text-muted-foreground">Read-only SELECT executed during scheduled fetch.</p>
                </div>

                <div className="border-t pt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">Automatic Schedule</span>
                  </div>
                  <div className="space-y-1">
                    <Label>Schedule Preset</Label>
                    <Select value={cronPreset} onValueChange={handleCronPresetChange}>
                      <SelectTrigger><SelectValue placeholder="Select a schedule…" /></SelectTrigger>
                      <SelectContent>
                        {CRON_PRESETS.map((p) => (
                          <SelectItem key={p.label} value={p.value || "custom"}>{p.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {(cronPreset === "custom" || (cronPreset === "" && form.scheduleCron)) && (
                    <div className="space-y-1">
                      <Label>Cron Expression</Label>
                      <Input value={form.scheduleCron} onChange={e => setForm(f => ({ ...f, scheduleCron: e.target.value }))} placeholder="0 2 * * *" className="font-mono" />
                      <p className="text-xs text-muted-foreground">Standard 5-field cron: minute hour day month weekday</p>
                    </div>
                  )}
                  {form.scheduleCron.trim() && (
                    <>
                      <p className="text-xs text-muted-foreground italic">
                        {(() => { try { return cronstrue.toString(form.scheduleCron); } catch { return null; } })()}
                      </p>
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-sm">Enable Schedule</Label>
                          <p className="text-xs text-muted-foreground">Automatically fetch data on the schedule above</p>
                        </div>
                        <Switch checked={form.scheduleEnabled} onCheckedChange={v => setForm(f => ({ ...f, scheduleEnabled: v }))} />
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editId ? "Save Changes" : "Create Connection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Connection</DialogTitle>
            <DialogDescription>This will permanently delete the connection and cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={deleteConnection}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History Dialog */}
      <Dialog open={!!historyConnection} onOpenChange={(open) => { if (!open) setHistoryConnection(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" /> Scheduled Run History
            </DialogTitle>
            <DialogDescription>{historyConnection?.name} — last 50 scheduled runs</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0">
            {historyLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : historyJobs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <History className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No scheduled runs recorded yet.</p>
              </div>
            ) : (
              <div className="divide-y text-sm">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-1 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <span>Started</span><span className="text-right">Status</span><span className="text-right">Rows</span><span className="text-right">Duration</span>
                </div>
                {historyJobs.map((job) => {
                  const durationMs = job.startedAt && job.finishedAt ? new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime() : null;
                  const durationStr = durationMs !== null ? (durationMs >= 60000 ? `${Math.floor(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s` : `${(durationMs / 1000).toFixed(1)}s`) : "—";
                  return (
                    <div key={job.id} className="py-3 px-1 space-y-1">
                      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 items-center">
                        <span className="text-muted-foreground font-mono text-xs">{job.startedAt ? formatDate(job.startedAt) : formatDate(job.createdAt)}</span>
                        <span>
                          {job.status === "success" && <span className="flex items-center gap-1 text-green-600 font-medium"><CheckCircle className="h-3.5 w-3.5" /> Success</span>}
                          {job.status === "failed" && <span className="flex items-center gap-1 text-destructive font-medium"><XCircle className="h-3.5 w-3.5" /> Failed</span>}
                          {(job.status === "pending" || job.status === "running") && <span className="flex items-center gap-1 text-blue-600 font-medium"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {job.status}</span>}
                        </span>
                        <span className="text-right font-mono text-xs text-muted-foreground">{job.recordCount !== null ? job.recordCount.toLocaleString() : "—"}</span>
                        <span className="text-right font-mono text-xs text-muted-foreground">{durationStr}</span>
                      </div>
                      {job.errorMessage && <p className="text-xs text-destructive bg-destructive/5 rounded px-2 py-1 font-mono break-all">{job.errorMessage}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter className="pt-2 border-t">
            <Button variant="outline" onClick={() => setHistoryConnection(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
