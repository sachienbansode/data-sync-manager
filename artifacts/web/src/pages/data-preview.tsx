import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";
import { Loader2, Download, Database, Table2, Search, Eye } from "lucide-react";
import { Layout } from "@/components/layout";

const BASE = import.meta.env.BASE_URL;
const PAGE_SIZE = 20;

async function apiFetch(path: string, options?: RequestInit) {
  const token = getAccessToken();
  const res = await fetch(`${BASE}api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Request failed");
  }
  return res.json();
}

interface DbConnection {
  id: number;
  name: string;
  dbEngine: string;
}

interface ConnectionObject {
  id: number;
  name: string;
  connectionId: number;
  connectionName: string;
  connectionEngine: string;
  objectType: string;
  objectValue: string;
  description: string | null;
}

interface PreviewResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

function downloadCSV(columns: string[], rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) { toast.info("No data to export"); return; }
  const csv = [
    columns.join(","),
    ...rows.map(r => columns.map(c => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ENGINE_COLOR: Record<string, string> = {
  postgresql: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  mysql: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  mssql: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  oracle: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

export default function DataPreview() {
  const [connId, setConnId] = useState<string>("__all__");
  const [objId, setObjId] = useState<string>("");
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const { data: connections = [], isLoading: connsLoading } = useQuery<DbConnection[]>({
    queryKey: ["connections-preview"],
    queryFn: () => apiFetch("/admin/db-connections"),
  });

  const { data: allObjects = [], isLoading: objsLoading } = useQuery<ConnectionObject[]>({
    queryKey: ["objects-preview"],
    queryFn: () => apiFetch("/admin/connection-objects"),
  });

  const objects = useMemo(
    () => connId !== "__all__" ? allObjects.filter(o => String(o.connectionId) === connId) : allObjects,
    [allObjects, connId],
  );

  const selectedObj = allObjects.find(o => String(o.id) === objId);

  async function runPreview() {
    if (!objId) { toast.error("Select a data object first"); return; }
    setLoading(true);
    setResult(null);
    setPage(1);
    try {
      const data = await apiFetch("/admin/data-preview", {
        method: "POST",
        body: JSON.stringify({ objectId: parseInt(objId) }),
      });
      setResult(data);
      if (data.rowCount === 0) toast.info("Query returned no rows");
      else toast.success(`Loaded ${data.rowCount} row${data.rowCount !== 1 ? "s" : ""} (max 50)`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  }

  const pagedRows = result ? result.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : [];
  const totalPages = result ? Math.max(1, Math.ceil(result.rows.length / PAGE_SIZE)) : 1;

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Data Preview</h1>
          <p className="text-muted-foreground mt-1">Browse up to 50 rows from any data object across your connected databases.</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" />
              Select Data Object
            </CardTitle>
            <CardDescription>Choose a connection and data object, then click Preview to fetch rows.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <Select
                  value={connId}
                  onValueChange={v => { setConnId(v); setObjId(""); setResult(null); }}
                  disabled={connsLoading}
                >
                  <SelectTrigger>
                    <Database className="h-4 w-4 mr-2 text-muted-foreground shrink-0" />
                    <SelectValue placeholder={connsLoading ? "Loading…" : "Filter by connection…"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All connections</SelectItem>
                    {connections.map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                        <span className="text-muted-foreground text-xs ml-1">({c.dbEngine})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-[2]">
                <Select
                  value={objId}
                  onValueChange={v => { setObjId(v); setResult(null); setPage(1); }}
                  disabled={objsLoading || objects.length === 0}
                >
                  <SelectTrigger>
                    <Table2 className="h-4 w-4 mr-2 text-muted-foreground shrink-0" />
                    <SelectValue placeholder={
                      objsLoading ? "Loading objects…"
                        : objects.length === 0 ? "No data objects available"
                        : "Select data object…"
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {objects.map(o => (
                      <SelectItem key={o.id} value={String(o.id)}>
                        <span className="font-medium">{o.name}</span>
                        <span className="text-muted-foreground text-xs ml-1">
                          — {o.connectionName} ({o.objectType})
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={runPreview} disabled={!objId || loading} className="shrink-0 gap-2">
                {loading
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Search className="h-4 w-4" />}
                {loading ? "Loading…" : "Preview"}
              </Button>
            </div>

            {selectedObj && (
              <div className="px-3 py-2 rounded-md bg-muted font-mono text-xs text-muted-foreground truncate">
                {selectedObj.objectValue}
              </div>
            )}
          </CardContent>
        </Card>

        {result && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CardTitle className="text-base truncate">{selectedObj?.name ?? "Results"}</CardTitle>
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {result.rowCount} row{result.rowCount !== 1 ? "s" : ""}
                  </Badge>
                  {selectedObj && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${ENGINE_COLOR[selectedObj.connectionEngine] ?? "bg-muted text-muted-foreground"}`}>
                      {selectedObj.connectionEngine}
                    </span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadCSV(result.columns, result.rows, `${selectedObj?.name ?? "preview"}.csv`)}
                  className="gap-2 shrink-0"
                >
                  <Download className="h-4 w-4" />
                  Export CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {result.rows.length === 0 ? (
                <div className="p-10 text-center text-muted-foreground text-sm">Query returned no rows.</div>
              ) : (
                <>
                  <div className="overflow-auto max-h-[500px]">
                    <Table>
                      <TableHeader className="sticky top-0 bg-card z-10">
                        <TableRow>
                          {result.columns.map(col => (
                            <TableHead key={col} className="whitespace-nowrap text-xs font-semibold py-2">{col}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedRows.map((row, ri) => (
                          <TableRow key={ri}>
                            {result.columns.map(col => (
                              <TableCell key={col} className="text-xs whitespace-nowrap max-w-[220px] truncate py-1.5">
                                {row[col] === null || row[col] === undefined
                                  ? <span className="text-muted-foreground italic">null</span>
                                  : String(row[col])}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
                      <span>Rows {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, result.rows.length)} of {result.rows.length}</span>
                      <div className="flex gap-1.5">
                        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                        <span className="flex items-center px-2 text-xs">Page {page} of {totalPages}</span>
                        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {!result && !loading && (
          <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
            <Table2 className="h-12 w-12 mb-4 opacity-20" />
            <p className="font-medium text-base">No preview loaded</p>
            <p className="text-sm mt-1">Select a data object above and click Preview to see rows.</p>
          </div>
        )}
      </div>
    </Layout>
  );
}
