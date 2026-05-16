import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Pencil, Trash2, CheckCircle, XCircle, Wifi, Database, Server, Cloud, FolderOpen, History, CalendarClock, User, ShieldCheck, Search, ChevronLeft, ChevronRight, Copy, CheckCircle2, AlertCircle, Info, Minus, Lock, PenLine } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { formatDate, formatDateTime } from "@/lib/date";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";

type DbEngine = "postgresql" | "mysql" | "mssql" | "oracle" | "s3" | "sftp" | "csv";

type AppType = { id: number; name: string; slug: string };

interface DbConnection {
  id: number;
  name: string;
  type: string;
  dbEngine: DbEngine;
  host: string | null;
  port: number | null;
  dbName: string | null;
  schemaName: string | null;
  extraParams: Record<string, string> | null;
  fetchQuery: string | null;
  outputFilePath: string | null;
  allowWrites: boolean;
  lastTestedAt: string | null;
  lastTestSuccess: boolean | null;
  createdAt: string;
}

const ENGINE_META: Record<DbEngine, { label: string; icon: React.ComponentType<{ className?: string }>; defaultPort: number | null; isFile: boolean }> = {
  postgresql: { label: "PostgreSQL",    icon: Database,    defaultPort: 5432, isFile: false },
  mysql:      { label: "MySQL",         icon: Database,    defaultPort: 3306, isFile: false },
  mssql:      { label: "MS SQL Server", icon: Server,      defaultPort: 1433, isFile: false },
  oracle:     { label: "Oracle DB",     icon: Server,      defaultPort: 1521, isFile: false },
  s3:         { label: "Amazon S3",     icon: Cloud,       defaultPort: null, isFile: true  },
  sftp:       { label: "SFTP",          icon: FolderOpen,  defaultPort: 22,   isFile: true  },
  csv:        { label: "CSV / File",    icon: FolderOpen,  defaultPort: null, isFile: true  },
};

const EMPTY_FORM = {
  name: "", type: "",
  dbEngine: "postgresql" as DbEngine,
  host: "", port: "5432", dbName: "", schemaName: "public",
  username: "", password: "",
  ssl: false,
  allowWrites: false,
  // S3
  bucket: "", region: "", s3Prefix: "", accessKeyId: "", secretAccessKey: "",
  // SFTP
  remotePath: "", privateKey: "",
  // CSV
  filePath: "",
  // BackOffice workflow fields
  fetchQuery: "",
  outputFilePath: "",
};

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
  if (c.dbEngine === "s3") {
    const bucket = c.extraParams?.bucket ?? "?";
    const region = c.extraParams?.region ?? "";
    return `s3://${bucket}${region ? ` (${region})` : ""}`;
  }
  if (c.dbEngine === "sftp") return `sftp://${c.host ?? "?"}:${c.port ?? 22}${c.extraParams?.remotePath ?? ""}`;
  if (c.dbEngine === "csv") return c.extraParams?.filePath ?? "—";
  return `${c.host ?? "?"}:${c.port ?? "?"}/${c.dbName ?? "?"}`;
}

interface RunJob {
  id: number;
  type: string;
  status: "pending" | "running" | "success" | "failed";
  triggeredByEmail: string | null;
  triggeredBySchedule: boolean;
  recordCount: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

type TestStepStatus = "success" | "fail" | "info" | "skip";
interface TestStep { name: string; status: TestStepStatus; detail: string; }
interface TestResult { connName: string; success: boolean; steps: TestStep[]; error: string | null; message: string | null; }

const apiBase = `${import.meta.env.BASE_URL}api`;

export default function DbConnections() {
  const [connections, setConnections] = useState<DbConnection[]>([]);
  const [appTypes, setAppTypes] = useState<AppType[]>([]);
  const [awsRegions, setAwsRegions] = useState<{ code: string; name: string; regionGroup: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [historyConn, setHistoryConn] = useState<DbConnection | null>(null);
  const [historyJobs, setHistoryJobs] = useState<RunJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testConnName, setTestConnName] = useState("");

  const [search, setSearch] = useState("");
  const [engineFilter, setEngineFilter] = useState("__all__");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  useEffect(() => { setPage(1); }, [search, engineFilter]);

  const filteredConnections = useMemo(() => {
    const q = search.trim().toLowerCase();
    return connections.filter(c => {
      if (engineFilter !== "__all__" && c.dbEngine !== engineFilter) return false;
      if (q && !c.name.toLowerCase().includes(q) && !(c.host ?? "").toLowerCase().includes(q) && !(c.dbName ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [connections, search, engineFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredConnections.length / PAGE_SIZE));
  const pagedConnections = filteredConnections.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const meta = ENGINE_META[form.dbEngine];
  const isDbEngine = !meta.isFile;
  const isS3 = form.dbEngine === "s3";
  const isSftp = form.dbEngine === "sftp";
  const isCsv = form.dbEngine === "csv";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = getAccessToken();
      const [cRes, tRes, rRes] = await Promise.all([
        fetch(`${apiBase}/admin/db-connections`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiBase}/admin/application-types/active`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiBase}/admin/aws-regions`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (!cRes.ok) throw new Error("Failed to load connections");
      setConnections(await cRes.json());
      if (tRes.ok) setAppTypes(await tRes.json());
      if (rRes.ok) setAwsRegions(await rRes.json());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load connections");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditId(null);
    setForm({ ...EMPTY_FORM, type: appTypes[0]?.slug ?? "" });
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
      ssl: ep.ssl === "true",
      allowWrites: c.allowWrites ?? false,
      bucket: ep.bucket ?? "", region: ep.region ?? "", s3Prefix: ep.s3Prefix ?? "",
      accessKeyId: "", secretAccessKey: "",
      remotePath: ep.remotePath ?? "", privateKey: "",
      filePath: ep.filePath ?? "",
      fetchQuery: c.fetchQuery ?? "",
      outputFilePath: c.outputFilePath ?? "",
    });
    setDialogOpen(true);
  }

  function handleEngineChange(engine: DbEngine) {
    const m = ENGINE_META[engine];
    setForm(f => ({ ...f, dbEngine: engine, port: m.defaultPort !== null ? String(m.defaultPort) : "" }));
  }

  async function save(thenTest = false) {
    if (!form.name) { toast.error("Connection name is required"); return; }
    if (isDbEngine) {
      if (!form.host || !form.dbName) { toast.error("Host and database name are required"); return; }
      if (!editId && (!form.username || !form.password)) {
        toast.error("Username and password are required for new connections");
        return;
      }
    }
    if (isS3 && !form.bucket) { toast.error("S3 bucket is required"); return; }
    if (isS3 && !form.region) { toast.error("S3 region is required"); return; }
    if (isSftp && !form.host) { toast.error("SFTP host is required"); return; }

    setSaving(true);
    try {
      const token = getAccessToken();
      const extraParams: Record<string, string> = {};
      if (isDbEngine && form.ssl) extraParams.ssl = "true";
      if (isS3) {
        if (form.bucket)   extraParams.bucket   = form.bucket;
        if (form.region)   extraParams.region   = form.region;
        if (form.s3Prefix) extraParams.s3Prefix = form.s3Prefix;
      }
      if (isSftp)  { if (form.remotePath) extraParams.remotePath = form.remotePath; }
      if (isCsv)   { if (form.filePath)   extraParams.filePath   = form.filePath;   }

      const body: Record<string, unknown> = {
        name: form.name, type: form.type, dbEngine: form.dbEngine,
        extraParams: Object.keys(extraParams).length > 0 ? extraParams : undefined,
        allowWrites: form.allowWrites,
      };
      if (isDbEngine || isSftp) {
        if (form.host) body.host = form.host;
        if (form.port) body.port = parseInt(form.port);
      }
      if (isDbEngine) {
        if (form.dbName)    body.dbName    = form.dbName;
        if (form.schemaName) body.schemaName = form.schemaName || "public";
        if (form.username)  body.username  = form.username;
        if (form.password)  body.password  = form.password;
      }
      if (isS3) {
        if (form.accessKeyId)     body.username = form.accessKeyId;
        if (form.secretAccessKey) body.password = form.secretAccessKey;
      }
      if (isSftp) {
        if (form.username)  body.username = form.username;
        if (form.password)  body.password = form.password;
        if (form.privateKey) { extraParams.privateKey = form.privateKey; body.extraParams = extraParams; }
      }
      if (form.type === "backoffice") {
        body.fetchQuery = form.fetchQuery.trim() || null;
        body.outputFilePath = form.outputFilePath.trim() || null;
      }

      const url    = editId ? `${apiBase}/admin/db-connections/${editId}` : `${apiBase}/admin/db-connections`;
      const method = editId ? "PUT" : "POST";
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Save failed"); }
      const saved = await res.json();
      const savedId: number = saved.id;
      toast.success(editId ? "Connection updated" : "Connection created");
      if (thenTest && !meta.isFile) {
        setEditId(savedId);
        load();
        await testConnection(savedId);
      } else {
        setDialogOpen(false);
        load();
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection(id: number) {
    setTesting(id);
    const conn = connections.find(c => c.id === id);
    const name = conn?.name ?? "Connection";
    setTestConnName(name);
    setTestResult(null);
    setTestDialogOpen(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/admin/db-connections/${id}/test`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setTestResult({
        connName: name,
        success: data.success,
        steps: data.steps ?? [],
        error: data.error ?? null,
        message: data.message ?? null,
      });
      load();
    } catch (err: unknown) {
      setTestResult({
        connName: name,
        success: false,
        steps: [],
        error: err instanceof Error ? err.message : "Test request failed",
        message: null,
      });
    } finally {
      setTesting(null);
    }
  }

  async function openHistory(c: DbConnection) {
    setHistoryConn(c);
    setHistoryJobs([]);
    setHistoryLoading(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/admin/db-connections/${c.id}/runs`, {
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

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Connection Manager</h1>
            <p className="text-muted-foreground mt-1">
              Register database and file connections. One connection can power multiple pipelines across different tables.
            </p>
          </div>
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4 mr-2" /> Add Connection
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Database className="h-5 w-5" /> Connections</CardTitle>
            <CardDescription>
              Credentials are encrypted at rest. Supports PostgreSQL, MySQL, MS SQL, Oracle, S3, SFTP, and CSV.
              A single connection can be used as the source or destination for any number of pipelines.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Search + filter bar */}
            {!loading && connections.length > 0 && (
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by name, host, or database…"
                    className="pl-8"
                  />
                </div>
                <Select value={engineFilter} onValueChange={setEngineFilter}>
                  <SelectTrigger className="w-full sm:w-44">
                    <SelectValue placeholder="All engines" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All engines</SelectItem>
                    {(Object.keys(ENGINE_META) as (keyof typeof ENGINE_META)[]).map(e => (
                      <SelectItem key={e} value={e}>{ENGINE_META[e].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : connections.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Database className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No connections yet</p>
                <p className="text-sm mt-1">Add your first connection to start building data pipelines.</p>
                <Button className="mt-4" onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Add Connection</Button>
              </div>
            ) : filteredConnections.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No connections match your search.</p>
              </div>
            ) : (
              <>
              <div className="divide-y">
                {pagedConnections.map((c) => {
                  const eng = ENGINE_META[c.dbEngine] ?? ENGINE_META.postgresql;
                  const EngIcon = eng.icon;
                  return (
                    <div key={c.id} className="py-4 flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-1 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <EngIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium">{c.name}</span>
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${engineBadgeColor(c.dbEngine)}`}>
                            {eng.label}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {appTypes.find(t => t.slug === c.type)?.name ?? c.type}
                          </Badge>
                          {c.allowWrites
                            ? <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"><PenLine className="h-3 w-3" /> Read+Write</span>
                            : <span className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" /> Read Only</span>}
                          {c.lastTestedAt && (
                            c.lastTestSuccess
                              ? <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle className="h-3 w-3" /> Connected</span>
                              : <span className="flex items-center gap-1 text-xs text-destructive"><XCircle className="h-3 w-3" /> Failed</span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground font-mono">
                          {connectionSummary(c)}
                          {c.schemaName && c.schemaName !== "public" && !eng.isFile && (
                            <span className="ml-2 text-xs font-sans">(schema: {c.schemaName})</span>
                          )}
                        </div>
                        {!eng.isFile && (
                          <p className="text-xs text-muted-foreground">
                            Username: <span className="font-mono">••••••••</span> &nbsp;·&nbsp; Password: <span className="font-mono">••••••••</span>
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Added {formatDate(c.createdAt)}
                          {c.lastTestedAt && ` · Last tested ${formatDateTime(c.lastTestedAt)}`}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {(!eng.isFile || c.dbEngine === "s3") && (
                          <Button variant="outline" size="sm" onClick={() => testConnection(c.id)} disabled={testing === c.id}>
                            {testing === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                            <span className="ml-1 hidden sm:inline">Test</span>
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => openHistory(c)}>
                          <History className="h-4 w-4" />
                          <span className="ml-1 hidden sm:inline">History</span>
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

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2 text-sm text-muted-foreground">
                  <span>
                    Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredConnections.length)} of {filteredConnections.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="px-2 tabular-nums">{page} / {totalPages}</span>
                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Connection" : "New Connection"}</DialogTitle>
            <DialogDescription>
              Register a database or file source. This connection can then be used by multiple pipelines.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Connection Name *</Label>
                <Input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. BackOffice DB"
                />
              </div>
              <div className="space-y-1">
                <Label>Application Type</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select type…" /></SelectTrigger>
                  <SelectContent>
                    {appTypes.map(t => (
                      <SelectItem key={t.slug} value={t.slug}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Database / Storage Engine</Label>
              <Select value={form.dbEngine} onValueChange={v => handleEngineChange(v as DbEngine)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ENGINE_META) as DbEngine[]).map(e => (
                    <SelectItem key={e} value={e}>{ENGINE_META[e].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Database connection fields */}
            {isDbEngine && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1">
                    <Label>Host *</Label>
                    <Input value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} placeholder="db.example.com" />
                  </div>
                  <div className="space-y-1">
                    <Label>Port</Label>
                    <Input value={form.port} onChange={e => setForm(f => ({ ...f, port: e.target.value }))} placeholder="5432" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Database Name *</Label>
                    <Input value={form.dbName} onChange={e => setForm(f => ({ ...f, dbName: e.target.value }))} placeholder="mydb" />
                  </div>
                  <div className="space-y-1">
                    <Label>Schema</Label>
                    <Input value={form.schemaName} onChange={e => setForm(f => ({ ...f, schemaName: e.target.value }))} placeholder="public" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Username {editId && <span className="text-xs text-muted-foreground font-normal">(leave blank to keep)</span>}</Label>
                    <Input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder={editId ? "••••••••" : "db_user"} autoComplete="off" />
                  </div>
                  <div className="space-y-1">
                    <Label>Password {editId && <span className="text-xs text-muted-foreground font-normal">(leave blank to keep)</span>}</Label>
                    <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={editId ? "••••••••" : "••••••••"} autoComplete="off" />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Use SSL / TLS</p>
                      <p className="text-xs text-muted-foreground">Enable for cloud databases (AWS RDS, Azure, Neon, Supabase, etc.)</p>
                    </div>
                  </div>
                  <Switch checked={form.ssl} onCheckedChange={v => setForm(f => ({ ...f, ssl: v }))} />
                </div>
              </>
            )}

            {/* S3 fields */}
            {isS3 && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Bucket *</Label>
                    <Input value={form.bucket} onChange={e => setForm(f => ({ ...f, bucket: e.target.value }))} placeholder="my-bucket" />
                  </div>
                  <div className="space-y-1">
                    <Label>Region *</Label>
                    <Select value={form.region} onValueChange={v => setForm(f => ({ ...f, region: v }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select AWS region…" />
                      </SelectTrigger>
                      <SelectContent className="max-h-64">
                        {awsRegions.map(r => (
                          <SelectItem key={r.code} value={r.code}>
                            <span className="font-mono text-xs">{r.code}</span>
                            <span className="text-muted-foreground ml-2 text-xs">{r.name}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Prefix / Path</Label>
                  <Input value={form.s3Prefix} onChange={e => setForm(f => ({ ...f, s3Prefix: e.target.value }))} placeholder="data/exports/" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Access Key ID {editId && <span className="text-xs text-muted-foreground font-normal">(leave blank to keep)</span>}</Label>
                    <Input value={form.accessKeyId} onChange={e => setForm(f => ({ ...f, accessKeyId: e.target.value }))} placeholder={editId ? "••••••••" : "AKIA..."} />
                  </div>
                  <div className="space-y-1">
                    <Label>Secret Access Key {editId && <span className="text-xs text-muted-foreground font-normal">(leave blank to keep)</span>}</Label>
                    <Input type="password" value={form.secretAccessKey} onChange={e => setForm(f => ({ ...f, secretAccessKey: e.target.value }))} placeholder={editId ? "••••••••" : "••••••••"} />
                  </div>
                </div>
              </>
            )}

            {/* SFTP fields */}
            {isSftp && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1">
                    <Label>SFTP Host *</Label>
                    <Input value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} placeholder="sftp.example.com" />
                  </div>
                  <div className="space-y-1">
                    <Label>Port</Label>
                    <Input value={form.port} onChange={e => setForm(f => ({ ...f, port: e.target.value }))} placeholder="22" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Remote Path</Label>
                  <Input value={form.remotePath} onChange={e => setForm(f => ({ ...f, remotePath: e.target.value }))} placeholder="/data/exports" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Username</Label>
                    <Input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Password {editId && <span className="text-xs text-muted-foreground font-normal">(leave blank to keep)</span>}</Label>
                    <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                  </div>
                </div>
              </>
            )}

            {/* CSV / File fields */}
            {isCsv && (
              <div className="space-y-1">
                <Label>File Path</Label>
                <Input value={form.filePath} onChange={e => setForm(f => ({ ...f, filePath: e.target.value }))} placeholder="/mnt/data/export.csv" />
              </div>
            )}

            {/* Allow Writes toggle — shown for all connection types */}
            <div className="flex items-center justify-between rounded-lg border px-4 py-3">
              <div className="flex items-center gap-2">
                {form.allowWrites
                  ? <PenLine className="h-4 w-4 text-amber-500" />
                  : <Lock className="h-4 w-4 text-muted-foreground" />}
                <div>
                  <p className="text-sm font-medium">Allow Data Writes (DML)</p>
                  <p className="text-xs text-muted-foreground">
                    {form.allowWrites
                      ? "Connection can execute INSERT, UPDATE, DELETE, TRUNCATE and ALTER statements."
                      : "Read-only — only SELECT queries are permitted on this connection."}
                  </p>
                </div>
              </div>
              <Switch checked={form.allowWrites} onCheckedChange={v => setForm(f => ({ ...f, allowWrites: v }))} />
            </div>

            {/* BackOffice workflow fields */}
            {form.type === "backoffice" && (
              <div className="rounded-lg border border-dashed p-4 space-y-3 bg-muted/30">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">BackOffice Workflow</p>
                <div className="space-y-1">
                  <Label>
                    Fetch Query <span className="text-xs text-muted-foreground font-normal">(optional — SELECT only)</span>
                  </Label>
                  <Textarea
                    value={form.fetchQuery}
                    onChange={e => setForm(f => ({ ...f, fetchQuery: e.target.value }))}
                    placeholder={`SELECT * FROM "public"."backoffice_data" LIMIT 1000`}
                    rows={3}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">Used by Data Workflow fetch. Must be a SELECT statement.</p>
                </div>
                <div className="space-y-1">
                  <Label>
                    Output File Path <span className="text-xs text-muted-foreground font-normal">(optional — for push)</span>
                  </Label>
                  <Input
                    value={form.outputFilePath}
                    onChange={e => setForm(f => ({ ...f, outputFilePath: e.target.value }))}
                    placeholder="/mnt/trading/output.csv"
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">Local path where transformed CSV is written during push.</p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <div className="flex gap-2 flex-1">
              {editId && !meta.isFile && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => testConnection(editId)}
                  disabled={testing === editId || saving}
                  className="gap-1.5"
                >
                  {testing === editId
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Wifi className="h-4 w-4" />}
                  Test Connection
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              {!editId && !meta.isFile && (
                <Button variant="outline" onClick={() => save(true)} disabled={saving} className="gap-1.5">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                  Save & Test
                </Button>
              )}
              <Button onClick={() => save(false)} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editId ? "Update" : "Create"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Connection</DialogTitle>
            <DialogDescription>
              This will permanently delete the connection. Any pipelines using it will lose their source or destination.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={deleteConnection}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Result dialog */}
      <Dialog open={testDialogOpen} onOpenChange={v => { if (!v) { setTestDialogOpen(false); setTestResult(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {!testResult
                ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                : testResult.success
                  ? <CheckCircle2 className="h-5 w-5 text-green-600" />
                  : <XCircle className="h-5 w-5 text-destructive" />}
              Connection Test — {testConnName}
            </DialogTitle>
            <DialogDescription>
              {!testResult
                ? "Running connectivity checks, please wait…"
                : testResult.success
                  ? "All checks passed successfully."
                  : "One or more checks failed. See details below."}
            </DialogDescription>
          </DialogHeader>

          {/* Loading state */}
          {!testResult && (
            <div className="space-y-3 py-2">
              {["Decrypting credentials", "Checking TCP connectivity", "Authenticating", "Running query test"].map((s, i) => (
                <div key={i} className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  <span>{s}…</span>
                </div>
              ))}
            </div>
          )}

          {/* Steps */}
          {testResult && testResult.steps.length > 0 && (
            <div className="space-y-2 py-1">
              {testResult.steps.map((step, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <div className="mt-0.5 shrink-0">
                    {step.status === "success" && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                    {step.status === "fail"    && <AlertCircle  className="h-4 w-4 text-destructive" />}
                    {step.status === "info"    && <Info         className="h-4 w-4 text-blue-500" />}
                    {step.status === "skip"    && <Minus        className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <div className="min-w-0">
                    <p className={`font-medium leading-tight ${
                      step.status === "fail" ? "text-destructive" :
                      step.status === "info" ? "text-blue-700 dark:text-blue-400" :
                      step.status === "skip" ? "text-muted-foreground" : ""
                    }`}>{step.name}</p>
                    <p className="text-muted-foreground text-xs mt-0.5 leading-relaxed">{step.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Copyable error box */}
          {testResult && !testResult.success && testResult.error && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Full Error</p>
                <Button
                  variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1"
                  onClick={() => { navigator.clipboard.writeText(testResult.error ?? ""); toast.success("Error copied to clipboard"); }}
                >
                  <Copy className="h-3 w-3" /> Copy
                </Button>
              </div>
              <textarea
                readOnly
                value={testResult.error}
                rows={4}
                className="w-full resize-none rounded-md border bg-muted/50 px-3 py-2 text-xs font-mono text-destructive leading-relaxed focus:outline-none"
              />
              <p className="text-xs text-muted-foreground">Copy this error and share it for further diagnosis.</p>
            </div>
          )}

          {testResult?.success && testResult.message && (
            <p className="text-sm text-green-700 dark:text-green-400 font-medium">{testResult.message}</p>
          )}

          <DialogFooter>
            <Button onClick={() => { setTestDialogOpen(false); setTestResult(null); }} disabled={!testResult}>
              {!testResult ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Testing…</> : "Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Run history dialog */}
      <Dialog open={!!historyConn} onOpenChange={() => setHistoryConn(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4" /> Run History — {historyConn?.name}
            </DialogTitle>
            <DialogDescription>Last 50 data jobs for this connection.</DialogDescription>
          </DialogHeader>
          {historyLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : historyJobs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No runs yet for this connection.</p>
          ) : (
            <div className="divide-y text-sm">
              {historyJobs.map(j => (
                <div key={j.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      {j.status === "success" && <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />}
                      {j.status === "failed"  && <XCircle    className="h-4 w-4 text-destructive shrink-0" />}
                      {j.status === "running" && <Loader2    className="h-4 w-4 animate-spin text-blue-600 shrink-0" />}
                      {j.status === "pending" && <History    className="h-4 w-4 text-muted-foreground shrink-0" />}
                      <span className="font-medium capitalize">{j.status}</span>
                      <span className="text-xs text-muted-foreground capitalize">{j.type.replace("_", " ")}</span>
                      {j.triggeredBySchedule
                        ? <span className="flex items-center gap-1 text-xs font-medium text-blue-600"><CalendarClock className="h-3 w-3" /> Scheduled</span>
                        : <span className="flex items-center gap-1 text-xs text-muted-foreground"><User className="h-3 w-3" /> Manual</span>
                      }
                    </div>
                    {j.recordCount !== null && (
                      <p className="text-muted-foreground text-xs">{j.recordCount.toLocaleString()} row{j.recordCount !== 1 ? "s" : ""}</p>
                    )}
                    {j.triggeredByEmail && (
                      <p className="text-xs text-muted-foreground">By: {j.triggeredByEmail}</p>
                    )}
                    {j.errorMessage && (
                      <p className="text-destructive text-xs font-mono line-clamp-2">{j.errorMessage}</p>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground text-right shrink-0">
                    <p>{formatDateTime(j.startedAt ?? j.createdAt)}</p>
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
