import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Pencil, Trash2, CheckCircle, XCircle, Wifi, Database } from "lucide-react";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";

interface DbConnection {
  id: number;
  name: string;
  type: "backoffice" | "trading";
  host: string;
  port: number;
  dbName: string;
  schemaName: string;
  outputFilePath: string | null;
  fetchQuery: string | null;
  lastTestedAt: string | null;
  lastTestSuccess: boolean | null;
  createdAt: string;
}

const EMPTY_FORM = {
  name: "", type: "backoffice" as "backoffice" | "trading",
  host: "", port: "5432", dbName: "", schemaName: "public",
  username: "", password: "", outputFilePath: "", fetchQuery: "",
};

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
    setDialogOpen(true);
  }

  function openEdit(c: DbConnection) {
    setEditId(c.id);
    setForm({
      name: c.name, type: c.type, host: c.host, port: String(c.port),
      dbName: c.dbName, schemaName: c.schemaName, username: "", password: "",
      outputFilePath: c.outputFilePath ?? "", fetchQuery: c.fetchQuery ?? "",
    });
    setDialogOpen(true);
  }

  async function save() {
    if (!form.name || !form.host || !form.dbName) {
      toast.error("Name, host, and database name are required");
      return;
    }
    if (!editId && (!form.username || !form.password)) {
      toast.error("Username and password are required for new connections");
      return;
    }
    setSaving(true);
    try {
      const token = getAccessToken();
      const body: Record<string, unknown> = {
        name: form.name, type: form.type, host: form.host, port: parseInt(form.port) || 5432,
        dbName: form.dbName, schemaName: form.schemaName || "public",
        outputFilePath: form.outputFilePath || undefined,
        fetchQuery: form.fetchQuery.trim() || undefined,
      };
      if (form.username) body.username = form.username;
      if (form.password) body.password = form.password;

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
            <h1 className="text-2xl font-bold tracking-tight">DB Connection Manager</h1>
            <p className="text-muted-foreground mt-1">Manage encrypted database connections for BackOffice and Trading systems</p>
          </div>
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4 mr-2" /> Add Connection
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Database className="h-5 w-5" /> Connections</CardTitle>
            <CardDescription>Credentials are encrypted at rest. Only host, database, and schema are shown in plain text.</CardDescription>
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
                {connections.map((c) => (
                  <div key={c.id} className="py-4 flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c.name}</span>
                        <Badge variant={c.type === "backoffice" ? "default" : "secondary"} className="text-xs">
                          {c.type === "backoffice" ? "BackOffice" : "Trading"}
                        </Badge>
                        {c.lastTestedAt && (
                          c.lastTestSuccess
                            ? <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle className="h-3 w-3" /> Tested</span>
                            : <span className="flex items-center gap-1 text-xs text-destructive"><XCircle className="h-3 w-3" /> Failed</span>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        <span className="font-mono">{c.host}:{c.port}/{c.dbName}</span>
                        {c.schemaName !== "public" && <span className="ml-2 text-xs">(schema: {c.schemaName})</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Username: <span className="font-mono">••••••••</span> &nbsp;·&nbsp; Password: <span className="font-mono">••••••••</span>
                        {c.outputFilePath && <span className="ml-3">Output: <span className="font-mono">{c.outputFilePath}</span></span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
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
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Connection" : "Add Connection"}</DialogTitle>
            <DialogDescription>Configure database connection details. Credentials are stored encrypted.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1">
                <Label>Connection Name</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. BackOffice Production" />
              </div>
              <div className="space-y-1">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as "backoffice" | "trading" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="backoffice">BackOffice</SelectItem>
                    <SelectItem value="trading">Trading</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Port</Label>
                <Input type="number" value={form.port} onChange={e => setForm(f => ({ ...f, port: e.target.value }))} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Host</Label>
                <Input value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} placeholder="db.example.com" />
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
                <Label>Username {editId && <span className="text-xs text-muted-foreground">(leave blank to keep current)</span>}</Label>
                <Input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder={editId ? "••••••••" : "db_user"} autoComplete="off" />
              </div>
              <div className="space-y-1">
                <Label>Password {editId && <span className="text-xs text-muted-foreground">(leave blank to keep current)</span>}</Label>
                <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={editId ? "••••••••" : "••••••••"} autoComplete="new-password" />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Output File Path <span className="text-xs text-muted-foreground">(optional — for CSV push)</span></Label>
                <Input value={form.outputFilePath} onChange={e => setForm(f => ({ ...f, outputFilePath: e.target.value }))} placeholder="/data/output/trading-data.csv" />
              </div>
              {form.type === "backoffice" && (
                <div className="col-span-2 space-y-1">
                  <Label>
                    Fetch Query <span className="text-xs text-muted-foreground">(optional — SELECT only)</span>
                  </Label>
                  <textarea
                    className="w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                    value={form.fetchQuery}
                    onChange={e => setForm(f => ({ ...f, fetchQuery: e.target.value }))}
                    placeholder={`SELECT * FROM "public"."backoffice_data" LIMIT 1000`}
                    spellCheck={false}
                  />
                  <p className="text-xs text-muted-foreground">
                    Read-only SELECT statement executed when fetching data from this connection. Must not contain INSERT, UPDATE, DELETE, or DDL.
                  </p>
                </div>
              )}
            </div>
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

      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Connection</DialogTitle>
            <DialogDescription>This will permanently delete the connection. This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={deleteConnection}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
