import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Download, ArrowRight, ChevronLeft, History, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";
import { useAuth } from "@/lib/auth";

interface DataJob {
  id: number;
  type: string;
  status: "pending" | "running" | "success" | "failed";
  triggeredByEmail: string | null;
  connectionName: string | null;
  recordCount: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface JobDetail {
  job: DataJob;
  preview: Array<{ rowIndex: number; rawData: Record<string, unknown> }>;
}

const apiBase = `${import.meta.env.BASE_URL}api`;

const STATUS_CONFIG: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
  success: { variant: "default", label: "Success" },
  running: { variant: "secondary", label: "Running" },
  failed: { variant: "destructive", label: "Failed" },
  pending: { variant: "outline", label: "Pending" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { variant: "outline" as const, label: status };
  return <Badge variant={cfg.variant} className="text-xs">{cfg.label}</Badge>;
}

export default function WorkflowJobs() {
  const { user } = useAuth();
  const canPush = ["Admin", "Manager"].includes(user?.roleName ?? "");

  const [jobs, setJobs] = useState<DataJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [pushing, setPushing] = useState<number | null>(null);
  const [detailJob, setDetailJob] = useState<JobDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/workflow/jobs?page=${page}&pageSize=${pageSize}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load jobs");
      const data = await res.json();
      setJobs(data.jobs);
      setTotal(data.total);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  async function openDetail(id: number) {
    setDetailLoading(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/workflow/jobs/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to load job");
      setDetailJob(await res.json());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load job details");
    } finally {
      setDetailLoading(false);
    }
  }

  async function downloadCsv(jobId: number) {
    setDownloading(jobId);
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/workflow/jobs/${jobId}/download`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Download failed"); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `trading-data-job-${jobId}.csv`; a.click();
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
        method: "POST", headers: { Authorization: `Bearer ${token}` },
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

  const totalPages = Math.ceil(total / pageSize);

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/workflow">
            <Button variant="ghost" size="sm"><ChevronLeft className="h-4 w-4 mr-1" /> Back</Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Job History</h1>
            <p className="text-muted-foreground mt-0.5">All data fetch and upload jobs with status and results</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" /> All Jobs</CardTitle>
            <CardDescription>{total} total job{total !== 1 ? "s" : ""}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : jobs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <History className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No jobs yet.</p>
              </div>
            ) : (
              <>
                <div className="divide-y">
                  {jobs.map(job => (
                    <div key={job.id} className="py-4 flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-1 cursor-pointer" onClick={() => openDetail(job.id)}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium hover:underline">Job #{job.id}</span>
                          <StatusBadge status={job.status} />
                          <span className="text-xs text-muted-foreground capitalize">{job.type.replace("_", " ")}</span>
                        </div>
                        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                          {job.connectionName && <span>Connection: {job.connectionName}</span>}
                          {job.triggeredByEmail && <span>By: {job.triggeredByEmail}</span>}
                          {job.recordCount != null && <span>{job.recordCount} records</span>}
                          <span>{new Date(job.createdAt).toLocaleString()}</span>
                        </div>
                        {job.errorMessage && (
                          <div className="flex items-start gap-1 text-xs text-destructive">
                            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                            <span className="line-clamp-2">{job.errorMessage}</span>
                          </div>
                        )}
                      </div>
                      {job.status === "success" && (
                        <div className="flex gap-2 shrink-0">
                          <Button variant="outline" size="sm" onClick={() => downloadCsv(job.id)} disabled={downloading === job.id}>
                            {downloading === job.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            <span className="ml-1 hidden sm:inline">Download</span>
                          </Button>
                          {canPush && (
                            <Button size="sm" onClick={() => pushToPath(job.id)} disabled={pushing === job.id}>
                              {pushing === job.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                              <span className="ml-1 hidden sm:inline">Push</span>
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-4 border-t">
                    <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                    <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!detailJob || detailLoading} onOpenChange={() => setDetailJob(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {detailLoading ? "Loading…" : `Job #${detailJob?.job.id} Details`}
            </DialogTitle>
            <DialogDescription>
              {detailJob && (
                <span className="flex items-center gap-2">
                  <StatusBadge status={detailJob.job.status} />
                  <span className="capitalize">{detailJob.job.type.replace("_", " ")}</span>
                  {detailJob.job.recordCount != null && <span>· {detailJob.job.recordCount} records</span>}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {detailLoading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>}
          {detailJob && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {detailJob.job.connectionName && (
                  <div><span className="text-muted-foreground">Connection: </span>{detailJob.job.connectionName}</div>
                )}
                {detailJob.job.triggeredByEmail && (
                  <div><span className="text-muted-foreground">Triggered by: </span>{detailJob.job.triggeredByEmail}</div>
                )}
                {detailJob.job.startedAt && (
                  <div><span className="text-muted-foreground">Started: </span>{new Date(detailJob.job.startedAt).toLocaleString()}</div>
                )}
                {detailJob.job.finishedAt && (
                  <div><span className="text-muted-foreground">Finished: </span>{new Date(detailJob.job.finishedAt).toLocaleString()}</div>
                )}
              </div>
              {detailJob.job.errorMessage && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <p className="font-medium mb-1">Error</p>
                  <p className="font-mono text-xs whitespace-pre-wrap">{detailJob.job.errorMessage}</p>
                </div>
              )}
              {detailJob.preview.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Data Preview (first {detailJob.preview.length} rows)</p>
                  <ScrollArea className="h-60 rounded-md border">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b bg-muted/40 sticky top-0">
                            {Object.keys(detailJob.preview[0].rawData).map(h => (
                              <th key={h} className="text-left px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {detailJob.preview.map(({ rowIndex, rawData }) => (
                            <tr key={rowIndex} className="border-b hover:bg-muted/20">
                              {Object.values(rawData).map((v, i) => (
                                <td key={i} className="px-3 py-1.5 whitespace-nowrap font-mono max-w-[150px] truncate">{String(v ?? "")}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </ScrollArea>
                </div>
              )}
              {detailJob.job.status === "success" && (
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => downloadCsv(detailJob.job.id)} disabled={downloading === detailJob.job.id}>
                    {downloading === detailJob.job.id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    Download CSV
                  </Button>
                  {canPush && (
                    <Button onClick={() => pushToPath(detailJob.job.id)} disabled={pushing === detailJob.job.id}>
                      {pushing === detailJob.job.id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                      Push to Path
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
