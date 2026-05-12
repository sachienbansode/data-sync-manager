import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Plus, Pencil, Trash2, Table2, Code2, Database, Eye, Network, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";

const apiBase = `${import.meta.env.BASE_URL}api`;

async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = getAccessToken();
  const resp = await fetch(`${apiBase}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((opts.headers as Record<string, string>) ?? {}),
    },
  });
  if (resp.status === 204) return null;
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

interface ConnectionObject {
  id: number;
  name: string;
  connectionId: number;
  connectionName: string;
  connectionEngine: string;
  objectType: "table" | "query";
  objectValue: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DbConnection {
  id: number;
  name: string;
  dbEngine: string;
  type: string;
}

interface PreviewResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number | null;
}

const ENGINE_COLOR: Record<string, string> = {
  postgresql: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  mysql:      "bg-orange-500/10 text-orange-600 border-orange-500/20",
  mssql:      "bg-purple-500/10 text-purple-600 border-purple-500/20",
  oracle:     "bg-red-500/10 text-red-600 border-red-500/20",
};

const EMPTY_FORM = { name: "", connectionId: "", objectType: "table" as "table" | "query", objectValue: "", description: "" };

const PAGE_SIZE = 10;

export default function DataObjects() {
  const [objects, setObjects] = useState<ConnectionObject[]>([]);
  const [connections, setConnections] = useState<DbConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterConn, setFilterConn] = useState("all");
  const [filterType, setFilterType] = useState<"all" | "table" | "query">("all");
  const [page, setPage] = useState(1);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deleteId, setDeleteId] = useState<number | null>(null);

  const [previewObj, setPreviewObj] = useState<ConnectionObject | null>(null);
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [objs, conns] = await Promise.all([
        apiFetch("/admin/connection-objects"),
        apiFetch("/admin/db-connections"),
      ]);
      setObjects(objs ?? []);
      setConnections(conns ?? []);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = objects.filter(o => {
    if (filterConn !== "all" && String(o.connectionId) !== filterConn) return false;
    if (filterType !== "all" && o.objectType !== filterType) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [filterConn, filterType]);

  function openAdd() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(obj: ConnectionObject) {
    setEditId(obj.id);
    setForm({
      name: obj.name,
      connectionId: String(obj.connectionId),
      objectType: obj.objectType,
      objectValue: obj.objectValue,
      description: obj.description ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    if (!form.connectionId) { toast.error("Connection is required"); return; }
    if (!form.objectValue.trim()) { toast.error(`${form.objectType === "table" ? "Table name" : "SQL query"} is required`); return; }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        connectionId: parseInt(form.connectionId),
        objectType: form.objectType,
        objectValue: form.objectValue.trim(),
        description: form.description.trim() || null,
      };
      if (editId) {
        await apiFetch(`/admin/connection-objects/${editId}`, { method: "PUT", body: JSON.stringify(body) });
        toast.success("Object updated");
      } else {
        await apiFetch("/admin/connection-objects", { method: "POST", body: JSON.stringify(body) });
        toast.success("Object created");
      }
      setDialogOpen(false);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await apiFetch(`/admin/connection-objects/${deleteId}`, { method: "DELETE" });
      toast.success("Object deleted");
      setDeleteId(null);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function openPreview(obj: ConnectionObject) {
    setPreviewObj(obj);
    setPreviewData(null);
    setPreviewLoading(true);
    try {
      const result = await apiFetch(`/admin/connection-objects/${obj.id}/preview?limit=10`, { method: "POST" });
      setPreviewData(result);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
      setPreviewObj(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  const dbOnlyConns = connections.filter(c => ["postgresql", "mysql", "mssql", "oracle"].includes(c.dbEngine));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Data Objects</h1>
          <p className="text-muted-foreground mt-2">
            Step 2 of the Data Pipeline. Define named data sources and destinations tied to a connection.
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="h-4 w-4 mr-2" />
          New Object
        </Button>
      </div>

      {/* Step guidance */}
      <div className="flex items-start gap-3 p-4 rounded-lg border bg-muted/30 text-sm">
        <div className="shrink-0 mt-0.5">
          <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">2</div>
        </div>
        <div>
          <p className="font-medium">Data Objects connect a source of data to a connection.</p>
          <p className="text-muted-foreground mt-0.5">
            Each object targets either a <strong>table/view</strong> (simple name) or a custom <strong>SQL query</strong>.
            Objects are then used in Step 3 (Pipelines) to define data flows.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex gap-2 flex-1 flex-wrap">
              <Select value={filterConn} onValueChange={setFilterConn}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="All connections" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All connections</SelectItem>
                  {connections.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterType} onValueChange={(v) => setFilterType(v as typeof filterType)}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="table">Table / View</SelectItem>
                  <SelectItem value="query">SQL Query</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground shrink-0">{filtered.length} object{filtered.length !== 1 ? "s" : ""}</p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : paged.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Table2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">{objects.length === 0 ? "No data objects yet" : "No objects match the filter"}</p>
              {objects.length === 0 && (
                <p className="text-sm mt-1 max-w-xs mx-auto">
                  Create objects to define which tables or queries your pipelines will read from or write to.
                </p>
              )}
              {objects.length === 0 && <Button className="mt-4" onClick={openAdd}><Plus className="h-4 w-4 mr-2" />New Object</Button>}
            </div>
          ) : (
            <>
              <div className="divide-y">
                {paged.map(obj => (
                  <div key={obj.id} className="flex items-start justify-between px-4 py-3 hover:bg-muted/30 transition-colors gap-4">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{obj.name}</span>
                        <Badge variant="outline" className="text-[10px] gap-1">
                          {obj.objectType === "table" ? <Table2 className="h-2.5 w-2.5" /> : <Code2 className="h-2.5 w-2.5" />}
                          {obj.objectType === "table" ? "Table" : "Query"}
                        </Badge>
                        <Badge variant="outline" className={`text-[10px] ${ENGINE_COLOR[obj.connectionEngine] ?? ""}`}>
                          <Network className="h-2.5 w-2.5 mr-1" />{obj.connectionName}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono truncate max-w-lg">
                        {obj.objectType === "query"
                          ? obj.objectValue.slice(0, 80) + (obj.objectValue.length > 80 ? "…" : "")
                          : obj.objectValue
                        }
                      </p>
                      {obj.description && <p className="text-xs text-muted-foreground">{obj.description}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {dbOnlyConns.some(c => c.id === obj.connectionId) && (
                        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs gap-1" onClick={() => openPreview(obj)}>
                          <Eye className="h-3 w-3" />Preview
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => openEdit(obj)}>
                        <Pencil className="h-3 w-3 mr-1" />Edit
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        className="h-8 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteId(obj.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-xs text-muted-foreground">
                    Page {page} of {totalPages} · {filtered.length} total
                  </p>
                  <div className="flex gap-1">
                    <Button size="icon" variant="outline" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="outline" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Data Object" : "New Data Object"}</DialogTitle>
            <DialogDescription>
              Define a named data source or destination tied to a connection.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Name</Label>
              <Input
                placeholder="e.g. Clients Table, Daily Orders Query"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="mt-1"
              />
            </div>

            <div>
              <Label>Connection</Label>
              <Select value={form.connectionId} onValueChange={v => setForm(f => ({ ...f, connectionId: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select connection…" />
                </SelectTrigger>
                <SelectContent>
                  {connections.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name} <span className="text-muted-foreground text-xs ml-1">({c.dbEngine})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Type</Label>
              <Tabs
                value={form.objectType}
                onValueChange={v => setForm(f => ({ ...f, objectType: v as "table" | "query", objectValue: "" }))}
                className="mt-1"
              >
                <TabsList className="w-full">
                  <TabsTrigger value="table" className="flex-1 gap-2">
                    <Table2 className="h-3.5 w-3.5" />Table / View
                  </TabsTrigger>
                  <TabsTrigger value="query" className="flex-1 gap-2">
                    <Code2 className="h-3.5 w-3.5" />SQL Query
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {form.objectType === "table" ? (
              <div>
                <Label>Table / View Name</Label>
                <Input
                  placeholder="e.g. clients, orders, public.transactions"
                  value={form.objectValue}
                  onChange={e => setForm(f => ({ ...f, objectValue: e.target.value }))}
                  className="mt-1 font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  A SELECT * will be issued against this table. Include schema prefix if needed (e.g. schema.table).
                </p>
              </div>
            ) : (
              <div>
                <Label>SQL Query</Label>
                <Textarea
                  placeholder={"SELECT id, name, created_at\nFROM clients\nWHERE active = true"}
                  value={form.objectValue}
                  onChange={e => setForm(f => ({ ...f, objectValue: e.target.value }))}
                  className="mt-1 font-mono text-xs min-h-[120px]"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Write a full SELECT statement. This will be wrapped and limited during preview.
                </p>
              </div>
            )}

            <div>
              <Label>Description <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <Input
                placeholder="Brief description of this data object"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter className="pt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editId ? "Save Changes" : "Create Object"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this data object?</AlertDialogTitle>
            <AlertDialogDescription>
              Any pipelines using this object as source or destination will lose the reference. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Preview Dialog */}
      <Dialog open={!!previewObj} onOpenChange={(v) => !v && setPreviewObj(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Preview: {previewObj?.name}
            </DialogTitle>
            <DialogDescription>
              First 10 rows from{" "}
              <span className="font-mono text-xs">
                {previewObj?.objectType === "table" ? previewObj?.objectValue : "custom query"}
              </span>
              {" "}on <strong>{previewObj?.connectionName}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            {previewLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Fetching preview…</span>
              </div>
            ) : previewData ? (
              <>
                <p className="text-xs text-muted-foreground mb-3">
                  {previewData.columns.length} columns · {previewData.rowCount ?? previewData.rows.length} rows returned
                </p>
                <div className="overflow-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        {previewData.columns.map(col => (
                          <th key={col} className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap border-r last:border-r-0">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.rows.map((row, i) => (
                        <tr key={i} className="border-t hover:bg-muted/20">
                          {previewData.columns.map(col => (
                            <td key={col} className="px-3 py-1.5 font-mono max-w-[200px] truncate border-r last:border-r-0" title={String(row[col] ?? "")}>
                              {row[col] === null ? <span className="text-muted-foreground italic">NULL</span> : String(row[col])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
          <DialogFooter>
            {previewObj && (
              <Button variant="outline" size="sm" onClick={() => openPreview(previewObj)} disabled={previewLoading}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh
              </Button>
            )}
            <Button variant="outline" onClick={() => setPreviewObj(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
