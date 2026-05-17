import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";
import { Loader2, Download, Database, Play, ShieldAlert, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";

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

interface DbConnection { id: number; name: string; dbEngine: string; }

interface PreviewResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  totalCount: number | null;
  piiColumns: string[];
  piiMaskingEnabled: boolean;
}

const ENGINE_COLOR: Record<string, string> = {
  postgresql: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  mysql:      "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  mssql:      "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  oracle:     "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

function buildSheetData(columns: string[], rows: Record<string, unknown>[]) {
  return [columns, ...rows.map(r => columns.map(c => r[c] ?? ""))];
}

function downloadCSV(columns: string[], rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) { toast.info("No data to export"); return; }
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = [
    columns.map(escape).join(","),
    ...rows.map(r => columns.map(c => escape(String(r[c] ?? ""))).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadXLSX(columns: string[], rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) { toast.info("No data to export"); return; }
  const ws = XLSX.utils.aoa_to_sheet(buildSheetData(columns, rows));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  XLSX.writeFile(wb, filename);
}

export default function DataPreview() {
  const [connId, setConnId]     = useState<string>("");
  const [query, setQuery]       = useState<string>("");
  const [result, setResult]     = useState<PreviewResult | null>(null);
  const [loading, setLoading]   = useState(false);
  const [page, setPage]         = useState(1);
  const [connName, setConnName] = useState<string>("");

  const { data: connections = [], isLoading: connsLoading } = useQuery<DbConnection[]>({
    queryKey: ["connections-preview"],
    queryFn: () => apiFetch("/admin/db-connections"),
  });

  const selectedConn = connections.find(c => String(c.id) === connId);

  async function runPreview() {
    if (!connId)        { toast.error("Select a connection first"); return; }
    if (!query.trim())  { toast.error("Enter a SQL query first"); return; }
    setLoading(true);
    setResult(null);
    setPage(1);
    try {
      const data: PreviewResult = await apiFetch("/admin/data-preview", {
        method: "POST",
        body: JSON.stringify({ connectionId: parseInt(connId), query: query.trim() }),
      });
      setResult(data);
      if (data.rowCount === 0) toast.info("Query returned no rows");
      else {
        const total = data.totalCount != null ? ` of ${data.totalCount.toLocaleString()} total` : "";
        toast.success(`Loaded ${data.rowCount} row${data.rowCount !== 1 ? "s" : ""}${total}`);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runPreview(); }
  }

  const pagedRows  = result ? result.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : [];
  const totalPages = result ? Math.max(1, Math.ceil(result.rows.length / PAGE_SIZE)) : 1;
  const piiSet     = new Set(result?.piiColumns ?? []);
  const baseName   = `${connName || "preview"}-${Date.now()}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Data Preview</h1>
        <p className="text-muted-foreground mt-1">
          Write a SQL query and preview up to 50 rows from any connected database.
          PII columns are automatically detected and masked.
        </p>
      </div>

      {/* Query card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            Query Editor
          </CardTitle>
          <CardDescription>Select a connection, write your SQL, then press Ctrl+Enter or click Run.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select
            value={connId}
            onValueChange={v => {
              setConnId(v);
              setConnName(connections.find(c => String(c.id) === v)?.name ?? "");
              setResult(null);
            }}
            disabled={connsLoading}
          >
            <SelectTrigger className="w-full sm:w-72">
              <Database className="h-4 w-4 mr-2 text-muted-foreground shrink-0" />
              <SelectValue placeholder={connsLoading ? "Loading connections…" : "Select connection…"} />
            </SelectTrigger>
            <SelectContent>
              {connections.map(c => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                  <span className="text-muted-foreground text-xs ml-1">({c.dbEngine})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Textarea
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={"SELECT * FROM schema.table_name\n-- Ctrl+Enter to run"}
            className="font-mono text-sm min-h-[120px] resize-y"
            spellCheck={false}
          />

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground">
              Results capped at 50 rows · PII columns masked with X · Ctrl+Enter to run
            </p>
            <Button onClick={runPreview} disabled={!connId || !query.trim() || loading} className="gap-2 shrink-0">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {loading ? "Running…" : "Run Query"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results card */}
      {result && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-2 border-b bg-card sticky top-0 z-20">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base">Results</CardTitle>

                {/* Loaded count */}
                <Badge variant="secondary" className="text-xs">
                  {result.rowCount} loaded
                </Badge>

                {/* Total count from DB */}
                {result.totalCount != null && (
                  <Badge variant="outline" className="text-xs">
                    {result.totalCount.toLocaleString()} total
                  </Badge>
                )}

                {selectedConn && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ENGINE_COLOR[selectedConn.dbEngine] ?? "bg-muted text-muted-foreground"}`}>
                    {selectedConn.dbEngine}
                  </span>
                )}

                {result.piiColumns.length > 0 && (
                  <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    {result.piiColumns.length} PII column{result.piiColumns.length !== 1 ? "s" : ""} masked
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline" size="sm"
                  onClick={() => downloadCSV(result.columns, result.rows, `${baseName}.csv`)}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  CSV
                </Button>
                <Button
                  variant="outline" size="sm"
                  onClick={() => downloadXLSX(result.columns, result.rows, `${baseName}.xlsx`)}
                  className="gap-2"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  XLSX
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {result.rows.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground text-sm">Query returned no rows.</div>
            ) : (
              <>
                {/* Table with its own scroll — sticky header works within this container */}
                <div className="overflow-auto max-h-[560px] border-b">
                  <Table>
                    <TableHeader>
                      <TableRow className="sticky top-0 z-10 bg-muted hover:bg-muted">
                        {result.columns.map(col => (
                          <TableHead key={col} className="whitespace-nowrap text-xs font-semibold py-2.5 border-b border-border">
                            <span className="flex items-center gap-1">
                              {col}
                              {piiSet.has(col) && <ShieldAlert className="h-3 w-3 text-amber-500 shrink-0" title="PII — masked" />}
                            </span>
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedRows.map((row, ri) => (
                        <TableRow
                          key={ri}
                          className={ri % 2 === 0 ? "bg-background" : "bg-muted/40"}
                        >
                          {result.columns.map(col => (
                            <TableCell
                              key={col}
                              className={`text-xs whitespace-nowrap max-w-[240px] truncate py-1.5 ${
                                piiSet.has(col) ? "text-amber-600 dark:text-amber-400 font-mono" : ""
                              }`}
                            >
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
                  <div className="flex items-center justify-between px-4 py-3 text-sm text-muted-foreground bg-card">
                    <span>
                      Rows {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, result.rows.length)} of {result.rows.length}
                      {result.totalCount != null && result.totalCount > result.rows.length
                        ? ` (${result.totalCount.toLocaleString()} in table)`
                        : ""}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                      <span className="px-2 text-xs">Page {page} of {totalPages}</span>
                      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!result && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <Play className="h-12 w-12 mb-4 opacity-20" />
          <p className="font-medium text-base">No results yet</p>
          <p className="text-sm mt-1">Select a connection, write a query, and click Run.</p>
        </div>
      )}
    </div>
  );
}
