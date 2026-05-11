import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, Upload, RefreshCw, Database, FileText, ArrowRight, History } from "lucide-react";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";
import { useAuth } from "@/lib/auth";

interface DbConnection {
  id: number;
  name: string;
  type: "backoffice" | "trading";
  host: string;
  dbName: string;
}

interface DataJob {
  id: number;
  type: string;
  status: string;
  connectionName: string | null;
  recordCount: number | null;
  errorMessage: string | null;
  createdAt: string;
}

const apiBase = `${import.meta.env.BASE_URL}api`;

export default function Workflow() {
  const { user } = useAuth();
  const roleName = user?.roleName ?? "";
  const canFetch = ["Admin", "Manager", "Analyst"].includes(roleName);
  const canPush = ["Admin", "Manager"].includes(roleName);

  const [connections, setConnections] = useState<DbConnection[]>([]);
  const [selectedConnection, setSelectedConnection] = useState<string>("");
  const [fetching, setFetching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [pushing, setPushing] = useState<number | null>(null);

  const [previewHeaders, setPreviewHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [lastJobId, setLastJobId] = useState<number | null>(null);
  const [recentJobs, setRecentJobs] = useState<DataJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);

  const fileRef = useRef<HTMLInputElement>(null);

  const loadConnections = useCallback(async () => {
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/admin/db-connections`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const all: DbConnection[] = await res.json();
      setConnections(all.filter(c => c.type === "backoffice"));
    } catch { /* ignore */ }
  }, []);

  const loadRecentJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/workflow/jobs?pageSize=5`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      setRecentJobs(data.jobs);
    } catch { /* ignore */ } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConnections();
    loadRecentJobs();
  }, [loadConnections, loadRecentJobs]);

  async function fetchFromBackoffice() {
    if (!selectedConnection) { toast.error("Select a BackOffice connection first"); return; }
    setFetching(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/workflow/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ connectionId: parseInt(selectedConnection) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fetch failed");
      setLastJobId(data.jobId);
      const rows = data.preview as Record<string, unknown>[];
      if (rows.length > 0) {
        setPreviewHeaders(Object.keys(rows[0]));
        setPreviewRows(rows);
      }
      toast.success(`Fetched ${data.recordCount} records (job #${data.jobId})`);
      loadRecentJobs();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      setFetching(false);
    }
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const token = getAccessToken();
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${apiBase}/workflow/upload-csv`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setLastJobId(data.jobId);
      setPreviewHeaders(data.headers);
      setPreviewRows(data.preview);
      toast.success(`Uploaded ${data.recordCount} records (job #${data.jobId})`);
      loadRecentJobs();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function downloadCsv(jobId: number) {
    setDownloading(jobId);
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/workflow/jobs/${jobId}/download`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Download failed"); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trading-data-job-${jobId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(null);
    }
  }

  async function pushToPath(jobId: number) {
    setPushing(jobId);
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/workflow/jobs/${jobId}/push`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Push failed");
      toast.success(`File written to ${data.path}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Push failed");
    } finally {
      setPushing(null);
    }
  }

  function statusBadge(status: string) {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      success: "default", running: "secondary", failed: "destructive", pending: "outline",
    };
    return <Badge variant={variants[status] ?? "outline"} className="text-xs capitalize">{status}</Badge>;
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Data Workflow</h1>
            <p className="text-muted-foreground mt-1">Fetch BackOffice data, upload CSV, transform to Trading format, and export</p>
          </div>
          <Link href="/workflow/jobs">
            <Button variant="outline">
              <History className="h-4 w-4 mr-2" /> Job History
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {canFetch && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Database className="h-5 w-5" /> Fetch from BackOffice</CardTitle>
                <CardDescription>Select a BackOffice DB connection and retrieve the latest records</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Select value={selectedConnection} onValueChange={setSelectedConnection}>
                    <SelectTrigger>
                      <SelectValue placeholder={connections.length === 0 ? "No BackOffice connections configured" : "Select a connection…"} />
                    </SelectTrigger>
                    <SelectContent>
                      {connections.map(c => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name} <span className="text-muted-foreground text-xs ml-1">({c.host}/{c.dbName})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button className="w-full" onClick={fetchFromBackoffice} disabled={fetching || !selectedConnection}>
                  {fetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Fetch Data
                </Button>
                {connections.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center">
                    <Link href="/admin/db-connections" className="underline">Configure a BackOffice connection</Link> first
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {canFetch && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5" /> Upload Pipe-Delimited CSV</CardTitle>
                <CardDescription>Upload a .csv file with pipe (|) delimiters from BackOffice export</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => fileRef.current?.click()}
                >
                  <FileText className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Click to select a pipe-delimited CSV file</p>
                  <p className="text-xs text-muted-foreground mt-1">Max 50 MB · Must use | as delimiter</p>
                </div>
                <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleCsvUpload} />
                <Button className="w-full" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                  {uploading ? "Uploading…" : "Select & Upload CSV"}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {previewRows.length > 0 && lastJobId && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Data Preview — Job #{lastJobId}</CardTitle>
                  <CardDescription>Showing up to 20 rows of raw data. Use Download to get the transformed Trading CSV.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => downloadCsv(lastJobId)} disabled={downloading === lastJobId}>
                    {downloading === lastJobId ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    Download CSV
                  </Button>
                  {canPush && (
                    <Button onClick={() => pushToPath(lastJobId)} disabled={pushing === lastJobId}>
                      {pushing === lastJobId ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                      Push to Path
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      {previewHeaders.map(h => <th key={h} className="text-left px-3 py-2 font-semibold text-muted-foreground whitespace-nowrap">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-b hover:bg-muted/20">
                        {previewHeaders.map(h => (
                          <td key={h} className="px-3 py-1.5 whitespace-nowrap font-mono max-w-[200px] truncate">
                            {String(row[h] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Recent Jobs</CardTitle>
              <Link href="/workflow/jobs">
                <Button variant="ghost" size="sm">View All <ArrowRight className="h-3 w-3 ml-1" /></Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {jobsLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : recentJobs.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-6">No jobs yet. Fetch data or upload a CSV to get started.</p>
            ) : (
              <div className="divide-y">
                {recentJobs.map(job => (
                  <div key={job.id} className="flex items-center justify-between py-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Job #{job.id}</span>
                        {statusBadge(job.status)}
                        <span className="text-xs text-muted-foreground capitalize">{job.type.replace("_", " ")}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {job.connectionName && <span>{job.connectionName} · </span>}
                        {job.recordCount != null && <span>{job.recordCount} records · </span>}
                        {new Date(job.createdAt).toLocaleString()}
                      </p>
                      {job.errorMessage && <p className="text-xs text-destructive">{job.errorMessage}</p>}
                    </div>
                    {job.status === "success" && (
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => downloadCsv(job.id)} disabled={downloading === job.id}>
                          {downloading === job.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
