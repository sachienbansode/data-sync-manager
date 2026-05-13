import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";
import {
  Plus, Copy, Trash2, BarChart2, ExternalLink, Globe, Monitor,
  Smartphone, Chrome, Edit, Download, Search, ChevronLeft, ChevronRight,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL;
const PAGE_SIZE = 10;

async function apiFetch(path: string, options?: RequestInit) {
  const token = getAccessToken();
  const res = await fetch(`${BASE}api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Request failed");
  }
  return res.json();
}

function downloadCSV(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) { toast.info("No data to export"); return; }
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map(r => headers.map(h => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface ShortDomain { id: number; domain: string; isVerified: boolean; }

interface ShortUrl {
  id: number; shortCode: string; originalUrl: string; title: string | null;
  domainId: number | null; domainName: string | null;
  startDate: string | null; endDate: string | null;
  isActive: boolean; createdAt: string; clickCount: number;
}

interface AnalyticsData {
  url: ShortUrl;
  clicks: Array<{ id: number; clickedAt: string; ipAddress: string; browser: string; os: string; deviceType: string; country: string; city: string; referer: string | null }>;
  stats: {
    total: number;
    byBrowser: Array<{ name: string | null; count: number }>;
    byOs: Array<{ name: string | null; count: number }>;
    byDevice: Array<{ name: string | null; count: number }>;
    byCountry: Array<{ name: string | null; count: number }>;
    byDay: Array<{ day: string; count: number }>;
  };
}

function StatBar({ items, icon: Icon }: { items: Array<{ name: string | null; count: number }>; icon: React.ComponentType<{ className?: string }> }) {
  const total = items.reduce((s, i) => s + i.count, 0) || 1;
  return (
    <div className="space-y-2">
      {items.length === 0 && <p className="text-xs text-muted-foreground">No data yet</p>}
      {items.map((item) => (
        <div key={item.name} className="flex items-center gap-2 text-sm">
          <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="w-28 truncate text-muted-foreground">{item.name ?? "Unknown"}</span>
          <div className="flex-1 bg-muted rounded-full h-2">
            <div className="bg-primary h-2 rounded-full" style={{ width: `${(item.count / total) * 100}%` }} />
          </div>
          <span className="w-8 text-right font-medium">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

function Pagination({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  if (total <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 px-4 py-3 border-t text-sm text-muted-foreground">
      <span>Page {page} of {total}</span>
      <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= total} onClick={() => onChange(page + 1)}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function UrlShortener() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [analyticsId, setAnalyticsId] = useState<number | null>(null);
  const [editRow, setEditRow] = useState<ShortUrl | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [analyticsPage, setAnalyticsPage] = useState(1);
  const [form, setForm] = useState({ originalUrl: "", title: "", startDate: "", endDate: "", isActive: true, customCode: "", domainId: "" });

  const { data: urls = [], isLoading } = useQuery<ShortUrl[]>({
    queryKey: ["short-urls"],
    queryFn: () => apiFetch("/short-urls"),
  });

  const { data: domains = [] } = useQuery<ShortDomain[]>({
    queryKey: ["short-domains"],
    queryFn: () => apiFetch("/short-domains"),
  });

  const { data: analytics } = useQuery<AnalyticsData>({
    queryKey: ["short-url-analytics", analyticsId],
    queryFn: () => apiFetch(`/short-urls/${analyticsId}/analytics`),
    enabled: analyticsId !== null,
  });

  const verifiedDomains = domains.filter(d => d.isVerified);

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => apiFetch("/short-urls", { method: "POST", body: JSON.stringify({ ...data, domainId: data.domainId || null }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["short-urls"] }); toast.success("Short URL created"); resetDialog(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: (data: typeof form & { id: number }) => apiFetch(`/short-urls/${data.id}`, { method: "PUT", body: JSON.stringify({ ...data, domainId: data.domainId || null }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["short-urls"] }); toast.success("Updated"); resetDialog(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/short-urls/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["short-urls"] }); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  function resetDialog() {
    setDialogOpen(false); setEditRow(null);
    setForm({ originalUrl: "", title: "", startDate: "", endDate: "", isActive: true, customCode: "", domainId: "" });
  }

  function openEdit(row: ShortUrl) {
    setEditRow(row);
    setForm({
      originalUrl: row.originalUrl, title: row.title ?? "",
      startDate: row.startDate ? row.startDate.slice(0, 10) : "",
      endDate: row.endDate ? row.endDate.slice(0, 10) : "",
      isActive: row.isActive, customCode: "",
      domainId: row.domainId ? String(row.domainId) : "",
    });
    setDialogOpen(true);
  }

  function handleSubmit() {
    if (!form.originalUrl.trim()) { toast.error("Original URL is required"); return; }
    if (editRow) updateMutation.mutate({ ...form, id: editRow.id });
    else createMutation.mutate(form);
  }

  function getShortUrl(row: ShortUrl) {
    if (row.domainId && row.domainName) return `https://${row.domainName}/${row.shortCode}`;
    return `${window.location.origin}/s/${row.shortCode}`;
  }

  function copyUrl(row: ShortUrl) {
    navigator.clipboard.writeText(getShortUrl(row));
    toast.success("Copied to clipboard");
  }

  function formatDate(d: string | null) {
    if (!d) return "—";
    return new Date(d).toLocaleDateString();
  }

  function getStatus(row: ShortUrl) {
    if (!row.isActive) return "Inactive";
    if (row.endDate && new Date(row.endDate) < new Date()) return "Expired";
    if (row.startDate && new Date(row.startDate) > new Date()) return "Scheduled";
    return "Active";
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return !q ? urls : urls.filter(r =>
      r.title?.toLowerCase().includes(q) ||
      r.originalUrl.toLowerCase().includes(q) ||
      r.shortCode.toLowerCase().includes(q)
    );
  }, [urls, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const analyticsTotalPages = analytics ? Math.max(1, Math.ceil(analytics.clicks.length / PAGE_SIZE)) : 1;
  const analyticsPaged = analytics?.clicks.slice((analyticsPage - 1) * PAGE_SIZE, analyticsPage * PAGE_SIZE) ?? [];

  function downloadUrlsCsv() {
    downloadCSV(filtered.map(row => ({
      Title: row.title ?? "",
      "Short URL": getShortUrl(row),
      Domain: row.domainName ?? "App Domain",
      "Original URL": row.originalUrl,
      Status: getStatus(row),
      "Start Date": formatDate(row.startDate),
      "End Date": formatDate(row.endDate),
      Clicks: row.clickCount,
      "Created At": new Date(row.createdAt).toLocaleDateString(),
    })), "short-urls.csv");
  }

  function downloadAnalyticsCsv() {
    if (!analytics) return;
    downloadCSV(analytics.clicks.map(c => ({
      Time: new Date(c.clickedAt).toLocaleString(),
      "IP Address": c.ipAddress ?? "",
      Country: c.country ?? "",
      City: c.city ?? "",
      Browser: c.browser ?? "",
      OS: c.os ?? "",
      Device: c.deviceType ?? "",
      Referer: c.referer ?? "",
    })), `analytics-${analytics.url.shortCode}.csv`);
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">URL Shortener</h1>
          <p className="text-muted-foreground text-sm">Create and track short links with analytics</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> New Short URL
        </Button>
      </div>

      {/* Analytics view */}
      {analyticsId !== null && analytics ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => { setAnalyticsId(null); setAnalyticsPage(1); }}>← Back to list</Button>
              <h2 className="font-semibold">{analytics.url.title ?? analytics.url.shortCode} — Analytics</h2>
              <Badge variant="secondary">{analytics.stats.total} clicks</Badge>
            </div>
            <Button variant="outline" size="sm" onClick={downloadAnalyticsCsv}>
              <Download className="h-4 w-4 mr-2" /> Export CSV
            </Button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total Clicks", value: analytics.stats.total },
              { label: "Countries", value: analytics.stats.byCountry.length },
              { label: "Browsers", value: analytics.stats.byBrowser.length },
              { label: "Devices", value: analytics.stats.byDevice.length },
            ].map(s => (
              <Card key={s.label}>
                <CardHeader className="pb-1 pt-4 px-4"><CardTitle className="text-xs text-muted-foreground font-normal">{s.label}</CardTitle></CardHeader>
                <CardContent className="px-4 pb-4"><p className="text-3xl font-bold">{s.value}</p></CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card><CardHeader><CardTitle className="text-sm">Browsers</CardTitle></CardHeader><CardContent><StatBar items={analytics.stats.byBrowser} icon={Chrome} /></CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm">Operating Systems</CardTitle></CardHeader><CardContent><StatBar items={analytics.stats.byOs} icon={Monitor} /></CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm">Device Types</CardTitle></CardHeader><CardContent><StatBar items={analytics.stats.byDevice} icon={Smartphone} /></CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm">Countries</CardTitle></CardHeader><CardContent><StatBar items={analytics.stats.byCountry} icon={Globe} /></CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-sm">Click Log</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Browser</TableHead>
                      <TableHead>OS</TableHead>
                      <TableHead>Device</TableHead>
                      <TableHead>Referer</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analyticsPaged.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No clicks yet</TableCell></TableRow>}
                    {analyticsPaged.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-xs whitespace-nowrap">{new Date(c.clickedAt).toLocaleString()}</TableCell>
                        <TableCell className="font-mono text-xs">{c.ipAddress ?? "—"}</TableCell>
                        <TableCell className="text-xs">{[c.city, c.country].filter(Boolean).join(", ") || "—"}</TableCell>
                        <TableCell className="text-xs">{c.browser ?? "—"}</TableCell>
                        <TableCell className="text-xs">{c.os ?? "—"}</TableCell>
                        <TableCell className="text-xs">{c.deviceType ?? "—"}</TableCell>
                        <TableCell className="text-xs max-w-[150px] truncate">{c.referer ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Pagination page={analyticsPage} total={analyticsTotalPages} onChange={setAnalyticsPage} />
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          {/* Search + download bar */}
          <div className="flex items-center gap-2 p-4 border-b">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by title, URL or code…"
                className="pl-9"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <Button variant="outline" size="sm" onClick={downloadUrlsCsv}>
              <Download className="h-4 w-4 mr-2" /> Export CSV
            </Button>
          </div>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title / Short URL</TableHead>
                    <TableHead>Original URL</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead className="text-center">Clicks</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>}
                  {!isLoading && filtered.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {search ? "No results found." : "No short URLs yet. Create one to get started."}
                    </TableCell></TableRow>
                  )}
                  {paged.map((row) => {
                    const status = getStatus(row);
                    const shortLink = getShortUrl(row);
                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className="font-medium text-sm">{row.title ?? row.shortCode}</div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-xs text-primary font-mono truncate max-w-[180px]">{shortLink}</span>
                            <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => copyUrl(row)}>
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                          {row.domainName && <span className="text-[10px] text-muted-foreground">{row.domainName}</span>}
                        </TableCell>
                        <TableCell className="max-w-[180px]">
                          <div className="flex items-center gap-1">
                            <span className="text-xs truncate text-muted-foreground">{row.originalUrl}</span>
                            <a href={row.originalUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" /></a>
                          </div>
                        </TableCell>
                        <TableCell>
                          {status === "Inactive" ? <Badge variant="secondary">Inactive</Badge>
                            : status === "Expired" ? <Badge variant="destructive">Expired</Badge>
                            : status === "Scheduled" ? <Badge variant="outline">Scheduled</Badge>
                            : <Badge className="bg-green-500 hover:bg-green-600">Active</Badge>}
                        </TableCell>
                        <TableCell className="text-xs">{formatDate(row.startDate)}</TableCell>
                        <TableCell className="text-xs">{formatDate(row.endDate)}</TableCell>
                        <TableCell className="text-center font-semibold">{row.clickCount}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Analytics" onClick={() => { setAnalyticsId(row.id); setAnalyticsPage(1); }}>
                              <BarChart2 className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => openEdit(row)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Delete" onClick={() => { if (confirm("Delete this short URL?")) deleteMutation.mutate(row.id); }}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <Pagination page={page} total={totalPages} onChange={setPage} />
          </CardContent>
        </Card>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) resetDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editRow ? "Edit Short URL" : "Create Short URL"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Original URL *</Label>
              <Input placeholder="https://example.com/very/long/url" value={form.originalUrl} onChange={e => setForm(f => ({ ...f, originalUrl: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Title (optional)</Label>
              <Input placeholder="My Campaign Link" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Short Domain</Label>
              <Select value={form.domainId || "__app__"} onValueChange={v => setForm(f => ({ ...f, domainId: v === "__app__" ? "" : v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="App Domain (default)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__app__">App Domain ({window.location.hostname})</SelectItem>
                  {verifiedDomains.map(d => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.domain}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {verifiedDomains.length === 0 && (
                <p className="text-xs text-muted-foreground">No custom domains yet. Add them in Admin → Short Domains.</p>
              )}
            </div>
            {!editRow && (
              <div className="space-y-1">
                <Label>Custom code (optional)</Label>
                <Input placeholder="e.g. summer24 (leave blank to auto-generate)" value={form.customCode} onChange={e => setForm(f => ({ ...f, customCode: e.target.value }))} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Start Date</Label>
                <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>End Date</Label>
                <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetDialog}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
              {editRow ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
