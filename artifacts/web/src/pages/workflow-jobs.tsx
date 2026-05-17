import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, Download, ArrowRight, ChevronLeft, History,
  AlertCircle, CalendarClock, User, Filter, X, Search,
} from "lucide-react";
import { formatDateTime } from "@/lib/date";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";
import { useAuth } from "@/lib/auth";

interface DataJob {
  id: number;
  type: string;
  status: "pending" | "running" | "success" | "failed";
  triggeredByEmail: string | null;
  triggeredBySchedule: boolean;
  connectionId: number | null;
  connectionName: string | null;
  pipelineId: number | null;
  recordCount: number | null;
  sourceRecordCount: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface BackOfficeConnection {
  id: number;
  name: string;
  host: string;
  dbName: string;
}

interface JobDetail {
  job: DataJob;
  preview: Array<{ rowIndex: number; rawData: Record<string, unknown> }>;
}

interface Filters {
  status: string;
  type: string;
  trigger: string;
  search: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: Filters = {
  status: "",
  type: "",
  trigger: "",
  search: "",
  dateFrom: "",
  dateTo: "",
};

const apiBase = `${import.meta.env.BASE_URL}api`;

const STATUS_CONFIG: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string; color: string }> = {
  success: { variant: "default", label: "Success", color: "text-emerald-600" },
  running: { variant: "secondary", label: "Running", color: "text-blue-600" },
  failed:  { variant: "destructive", label: "Failed", color: "text-red-600" },
  pending: { variant: "outline", label: "Pending", color: "text-muted-foreground" },
};

const TYPE_LABELS: Record<string, string> = {
  pipeline:   "Pipeline",
  fetch:      "Fetch",
  upload_csv: "CSV Upload",
  push:       "Push",
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { variant: "outline" as const, label: status, color: "" };
  return <Badge variant={cfg.variant} className="text-xs">{cfg.label}</Badge>;
}

function formatDuration(startedAt: string | null, finishedAt: string | null): string | null {
  if (!startedAt || !finishedAt) return null;
  const secs = Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function buildJobsUrl(page: number, pageSize: number, filters: Filters): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (filters.status)   params.set("status", filters.status);
  if (filters.type)     params.set("type", filters.type);
  if (filters.trigger)  params.set("trigger", filters.trigger);
  if (filters.search)   params.set("search", filters.search);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo)   params.set("dateTo", filters.dateTo);
  return `${apiBase}/workflow/jobs?${params}`;
}

function countActiveFilters(f: Filters): number {
  return [f.status, f.type, f.trigger, f.search, f.dateFrom, f.dateTo].filter(Boolean).length;
}

export default function WorkflowJobs() {
  const { user } = useAuth();
  const canFetch = ["Admin", "Manager", "Analyst"].includes(user?.roleName ?? "");
  const canPush  = ["Admin", "Manager"].includes(user?.roleName ?? "");

  const [jobs, setJobs]         = useState<DataJob[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [loading, setLoading]   = useState(true);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [pushing, setPushing]   = useState<number | null>(null);
  const [detailJob, setDetailJob]   = useState<JobDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [filters, setFilters]       = useState<Filters>(EMPTY_FILTERS);
  const [pendingFilters, setPending] = useState<Filters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [connections, setConnections] = useState<BackOfficeConnection[]>([]);
  const [pushDialogJob, setPushDialogJob] = useState<DataJob | null>(null);
  const [pushConnectionId, setPushConnectionId] = useState<string>("");

  const pageSize = 20;

  const load = useCallback(async (p: number, f: Filters) => {
    setLoading(true);
    try {
      const token = getAccessToken();
      const res = await fetch(buildJobsUrl(p, pageSize, f), {
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
  }, []);

  useEffect(() => { load(page, filters); }, [load, page, filters]);

  useEffect(() => {
    if (!canPush) return;
    (async () => {
      try {
        const token = getAccessToken();
        const res = await fetch(`${apiBase}/workflow/connections`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) setConnections(await res.json());
      } catch { /* ignore */ }
    })();
  }, [canPush]);

  function applyFilters() {
    setFilters(pendingFilters);
    setPage(1);
  }

  function clearFilters() {
    setPending(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }

  function handleSearchChange(val: string) {
    const next = { ...pendingFilters, search: val };
    setPending(next);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setFilters(next);
      setPage(1);
    }, 400);
  }

  function handlePushClick(job: DataJob) {
    if (job.connectionId) {
      executePush(job.id, null);
    } else {
      setPushConnectionId(connections[0] ? String(connections[0].id) : "");
      setPushDialogJob(job);
    }
  }

  async function executePush(jobId: number, overrideConnectionId: number | null) {
    setPushing(jobId);
    try {
      const token = getAccessToken();
      const body: Record<string, unknown> = {};
      if (overrideConnectionId) body.connectionId = overrideConnectionId;
      const res = await fetch(`${apiBase}/workflow/jobs/${jobId}/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Push failed");
      toast.success(`File written to ${data.path}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Push failed");
    } finally {
      setPushing(null);
      setPushDialogJob(null);
    }
  }

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

  const totalPages    = Math.ceil(total / pageSize);
  const activeFilters = countActiveFilters(filters);

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/pipe">
            <Button variant="ghost" size="sm"><ChevronLeft className="h-4 w-4 mr-1" /> Back</Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Job History</h1>
            <p className="text-muted-foreground mt-0.5">All data fetch, upload and pipeline jobs</p>
          </div>
        </div>

        {/* Filter bar */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap items-end gap-3">
              {/* Search */}
              <div className="flex-1 min-w-[180px] max-w-xs">
                <Label className="text-xs text-muted-foreground mb-1 block">Search</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8 h-9 text-sm"
                    placeholder="Connection, email…"
                    value={pendingFilters.search}
                    onChange={(e) => handleSearchChange(e.target.value)}
                  />
                </div>
              </div>

              {/* Status */}
              <div className="min-w-[130px]">
                <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
                <Select value={pendingFilters.status || "_all"} onValueChange={(v) => setPending(f => ({ ...f, status: v === "_all" ? "" : v }))}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">All statuses</SelectItem>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="running">Running</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Type */}
              <div className="min-w-[130px]">
                <Label className="text-xs text-muted-foreground mb-1 block">Type</Label>
                <Select value={pendingFilters.type || "_all"} onValueChange={(v) => setPending(f => ({ ...f, type: v === "_all" ? "" : v }))}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">All types</SelectItem>
                    <SelectItem value="pipeline">Pipeline</SelectItem>
                    <SelectItem value="fetch">Fetch</SelectItem>
                    <SelectItem value="upload_csv">CSV Upload</SelectItem>
                    <SelectItem value="push">Push</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Trigger */}
              <div className="min-w-[130px]">
                <Label className="text-xs text-muted-foreground mb-1 block">Trigger</Label>
                <Select value={pendingFilters.trigger || "_all"} onValueChange={(v) => setPending(f => ({ ...f, trigger: v === "_all" ? "" : v }))}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="All triggers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">All triggers</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Date From */}
              <div className="min-w-[140px]">
                <Label className="text-xs text-muted-foreground mb-1 block">From</Label>
                <Input
                  type="date"
                  className="h-9 text-sm"
                  value={pendingFilters.dateFrom}
                  onChange={(e) => setPending(f => ({ ...f, dateFrom: e.target.value }))}
                />
              </div>

              {/* Date To */}
              <div className="min-w-[140px]">
                <Label className="text-xs text-muted-foreground mb-1 block">To</Label>
                <Input
                  type="date"
                  className="h-9 text-sm"
                  value={pendingFilters.dateTo}
                  onChange={(e) => setPending(f => ({ ...f, dateTo: e.target.value }))}
                />
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 self-end">
                <Button size="sm" className="h-9 gap-1.5" onClick={applyFilters}>
                  <Filter className="h-3.5 w-3.5" /> Apply
                </Button>
                {activeFilters > 0 && (
                  <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={clearFilters}>
                    <X className="h-3.5 w-3.5" /> Clear{activeFilters > 0 ? ` (${activeFilters})` : ""}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Jobs list */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" /> All Jobs
            </CardTitle>
            <CardDescription>
              {loading ? "Loading…" : `${total} job${total !== 1 ? "s" : ""}${activeFilters > 0 ? " (filtered)" : ""}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : jobs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <History className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>{activeFilters > 0 ? "No jobs match the selected filters." : "No jobs yet."}</p>
                {activeFilters > 0 && (
                  <Button variant="link" className="mt-2" onClick={clearFilters}>Clear filters</Button>
                )}
              </div>
            ) : (
              <>
                <div className="divide-y">
                  {jobs.map(job => {
                    const duration = formatDuration(job.startedAt, job.finishedAt);
                    return (
                      <div key={job.id} className="py-4 flex items-start justify-between gap-4">
                        <div className="min-w-0 space-y-1 cursor-pointer flex-1" onClick={() => openDetail(job.id)}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium hover:underline">Job #{job.id}</span>
                            <StatusBadge status={job.status} />
                            <Badge variant="outline" className="text-xs capitalize">
                              {TYPE_LABELS[job.type] ?? job.type}
                            </Badge>
                            {job.triggeredBySchedule ? (
                              <span className="flex items-center gap-1 text-xs text-blue-600 font-medium">
                                <CalendarClock className="h-3 w-3" /> Scheduled
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <User className="h-3 w-3" /> Manual
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                            {job.connectionName && <span>Connection: {job.connectionName}</span>}
                            {job.pipelineId && <span>Pipeline #{job.pipelineId}</span>}
                            {job.triggeredByEmail && <span>By: {job.triggeredByEmail}</span>}
                            {job.sourceRecordCount != null && <span>Src: {job.sourceRecordCount.toLocaleString()} rows</span>}
                            {job.recordCount != null && <span>Dst: {job.recordCount.toLocaleString()} rows</span>}
                            {duration && <span>Duration: {duration}</span>}
                            <span>{formatDateTime(job.createdAt)}</span>
                          </div>
                          {job.errorMessage && (
                            <div className="flex items-start gap-1 text-xs text-destructive">
                              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                              <span className="line-clamp-2">{job.errorMessage}</span>
                            </div>
                          )}
                        </div>
                        {job.status === "success" && (canFetch || canPush) && (
                          <div className="flex gap-2 shrink-0">
                            {canFetch && (
                              <Button variant="outline" size="sm" onClick={() => downloadCsv(job.id)} disabled={downloading === job.id}>
                                {downloading === job.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                <span className="ml-1 hidden sm:inline">Download</span>
                              </Button>
                            )}
                            {canPush && (
                              <Button size="sm" onClick={() => handlePushClick(job)} disabled={pushing === job.id}>
                                {pushing === job.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                                <span className="ml-1 hidden sm:inline">Push</span>
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
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

      {/* Job detail dialog */}
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
                  <span className="capitalize">{TYPE_LABELS[detailJob.job.type] ?? detailJob.job.type}</span>
                  {detailJob.job.sourceRecordCount != null && <span>· {detailJob.job.sourceRecordCount.toLocaleString()} src rows</span>}
                  {detailJob.job.recordCount != null && <span>· {detailJob.job.recordCount.toLocaleString()} dst rows</span>}
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
                {detailJob.job.pipelineId && (
                  <div><span className="text-muted-foreground">Pipeline ID: </span>{detailJob.job.pipelineId}</div>
                )}
                <div>
                  <span className="text-muted-foreground">Trigger: </span>
                  {detailJob.job.triggeredBySchedule
                    ? <span className="text-blue-600 font-medium">Scheduled</span>
                    : detailJob.job.triggeredByEmail ?? "Manual"
                  }
                </div>
                {detailJob.job.startedAt && (
                  <div><span className="text-muted-foreground">Started: </span>{formatDateTime(detailJob.job.startedAt)}</div>
                )}
                {detailJob.job.finishedAt && (
                  <div><span className="text-muted-foreground">Finished: </span>{formatDateTime(detailJob.job.finishedAt)}</div>
                )}
                {formatDuration(detailJob.job.startedAt, detailJob.job.finishedAt) && (
                  <div><span className="text-muted-foreground">Duration: </span>{formatDuration(detailJob.job.startedAt, detailJob.job.finishedAt)}</div>
                )}
                {detailJob.job.sourceRecordCount != null && (
                  <div><span className="text-muted-foreground">Source rows: </span>{detailJob.job.sourceRecordCount.toLocaleString()}</div>
                )}
                {detailJob.job.recordCount != null && (
                  <div><span className="text-muted-foreground">Transferred rows: </span>{detailJob.job.recordCount.toLocaleString()}</div>
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
              {detailJob.job.status === "success" && (canFetch || canPush) && (
                <div className="flex gap-2 justify-end">
                  {canFetch && (
                    <Button variant="outline" onClick={() => downloadCsv(detailJob.job.id)} disabled={downloading === detailJob.job.id}>
                      {downloading === detailJob.job.id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                      Download CSV
                    </Button>
                  )}
                  {canPush && (
                    <Button onClick={() => handlePushClick(detailJob.job)} disabled={pushing === detailJob.job.id}>
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

      {/* Push target connection picker */}
      <Dialog open={!!pushDialogJob} onOpenChange={() => setPushDialogJob(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select Push Destination</DialogTitle>
            <DialogDescription>
              Job #{pushDialogJob?.id} was created from a file upload and has no associated connection.
              Choose a BackOffice connection to write the output file to.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {connections.length === 0 ? (
              <p className="text-sm text-muted-foreground">No BackOffice connections available.</p>
            ) : (
              <Select value={pushConnectionId} onValueChange={setPushConnectionId}>
                <SelectTrigger><SelectValue placeholder="Select a connection…" /></SelectTrigger>
                <SelectContent>
                  {connections.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name} — {c.host}/{c.dbName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPushDialogJob(null)}>Cancel</Button>
            <Button
              disabled={!pushConnectionId || !pushDialogJob || pushing === pushDialogJob?.id}
              onClick={() => pushDialogJob && executePush(pushDialogJob.id, parseInt(pushConnectionId))}
            >
              {pushing === pushDialogJob?.id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-2" />}
              Push
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
