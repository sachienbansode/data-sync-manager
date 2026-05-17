import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";
import {
  Plus, Copy, Trash2, BarChart2, ExternalLink, Globe, Monitor,
  Smartphone, Chrome, Edit, Download, Search, ChevronLeft, ChevronRight,
  QrCode, Key, Eye, EyeOff, Activity, User, Clock, Code, Loader2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL;
const PAGE_SIZE = 10;

/* ─── Helpers ─── */
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
  const csv = [headers.join(","), ...rows.map(r => headers.map(h => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ─── Types ─── */
interface ShortDomain { id: number; domain: string; isVerified: boolean; }

interface ShortUrl {
  id: number; shortCode: string; originalUrl: string;
  title: string | null; description: string | null;
  domainId: number | null; domainName: string | null;
  startDate: string | null; endDate: string | null;
  isActive: boolean; createdAt: string; updatedAt: string;
  clickCount: number; creatorName: string | null;
}

interface AnalyticsData {
  url: ShortUrl & { creatorName: string | null };
  clicks: Array<{ id: number; clickedAt: string; ipAddress: string; browser: string; os: string; deviceType: string; country: string; city: string; referer: string | null }>;
  auditLog: Array<{ id: number; action: string; details: string | null; userEmail: string | null; createdAt: string }>;
  stats: {
    total: number;
    byBrowser: Array<{ name: string | null; count: number }>;
    byOs: Array<{ name: string | null; count: number }>;
    byDevice: Array<{ name: string | null; count: number }>;
    byCountry: Array<{ name: string | null; count: number }>;
    byDay: Array<{ day: string; count: number }>;
  };
}

interface ApiKey {
  id: number; name: string; keyPrefix: string;
  isActive: boolean; lastUsedAt: string | null;
  expiresAt: string | null; createdAt: string;
}

/* ─── Sub-components ─── */
function StatBar({ items, icon: Icon }: { items: Array<{ name: string | null; count: number }>; icon: React.ComponentType<{ className?: string }> }) {
  const total = items.reduce((s, i) => s + i.count, 0) || 1;
  return (
    <div className="space-y-2">
      {items.length === 0 && <p className="text-xs text-muted-foreground">No data yet</p>}
      {items.map(item => (
        <div key={item.name} className="flex items-center gap-2 text-sm">
          <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="w-28 truncate text-muted-foreground">{item.name ?? "Unknown"}</span>
          <div className="flex-1 bg-muted rounded-full h-2"><div className="bg-primary h-2 rounded-full" style={{ width: `${(item.count / total) * 100}%` }} /></div>
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
      <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
      <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= total} onClick={() => onChange(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
    </div>
  );
}

/* ─── Main Page ─── */
export default function UrlShortener() {
  const qc = useQueryClient();

  // Link state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [analyticsId, setAnalyticsId] = useState<number | null>(null);
  const [editRow, setEditRow] = useState<ShortUrl | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [analyticsPage, setAnalyticsPage] = useState(1);
  const [form, setForm] = useState({ originalUrl: "", title: "", description: "", startDate: "", endDate: "", isActive: true, customCode: "", domainId: "" });

  // QR state
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrLabel, setQrLabel] = useState("");
  const [qrTarget, setQrTarget] = useState("");

  // API key state
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [keyForm, setKeyForm] = useState({ name: "", expiresAt: "" });
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  /* Queries */
  const { data: urls = [], isLoading } = useQuery<ShortUrl[]>({ queryKey: ["short-urls"], queryFn: () => apiFetch("/short-urls") });
  const { data: domains = [] } = useQuery<ShortDomain[]>({ queryKey: ["short-domains"], queryFn: () => apiFetch("/short-domains") });
  const { data: analytics, isLoading: analyticsLoading, isError: analyticsError } = useQuery<AnalyticsData>({ queryKey: ["short-url-analytics", analyticsId], queryFn: () => apiFetch(`/short-urls/${analyticsId}/analytics`), enabled: analyticsId !== null });
  const { data: apiKeys = [], isLoading: keysLoading } = useQuery<ApiKey[]>({ queryKey: ["api-keys"], queryFn: () => apiFetch("/api-keys") });

  const verifiedDomains = domains.filter(d => d.isVerified);

  /* Mutations — links */
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

  /* Mutations — API keys */
  const createKeyMutation = useMutation({
    mutationFn: (data: typeof keyForm) => apiFetch("/api-keys", { method: "POST", body: JSON.stringify({ name: data.name, expiresAt: data.expiresAt || null }) }),
    onSuccess: (res: ApiKey & { key: string }) => {
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      setRevealedKey(res.key);
      setKeyDialogOpen(false);
      setKeyForm({ name: "", expiresAt: "" });
      toast.success("API key generated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteKeyMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["api-keys"] }); toast.success("Key revoked"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggleKeyMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api-keys/${id}/toggle`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  /* Helpers */
  function resetDialog() { setDialogOpen(false); setEditRow(null); setForm({ originalUrl: "", title: "", description: "", startDate: "", endDate: "", isActive: true, customCode: "", domainId: "" }); }

  function openEdit(row: ShortUrl) {
    setEditRow(row);
    setForm({ originalUrl: row.originalUrl, title: row.title ?? "", description: row.description ?? "", startDate: row.startDate ? row.startDate.slice(0, 10) : "", endDate: row.endDate ? row.endDate.slice(0, 10) : "", isActive: row.isActive, customCode: "", domainId: row.domainId ? String(row.domainId) : "" });
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

  function clipboardCopy(text: string, message = "Copied to clipboard") {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => toast.success(message)).catch(() => fallbackCopy(text, message));
    } else {
      fallbackCopy(text, message);
    }
  }

  function fallbackCopy(text: string, message = "Copied to clipboard") {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.focus();
    el.select();
    try { document.execCommand("copy"); toast.success(message); }
    catch { toast.error("Copy failed — please select and copy manually"); }
    document.body.removeChild(el);
  }

  function copyUrl(row: ShortUrl) { clipboardCopy(getShortUrl(row), "Copied to clipboard"); }

  function formatDate(d: string | null) {
    if (!d) return "—";
    const datePart = (typeof d === "string" ? d : new Date(d).toISOString()).slice(0, 10);
    const [y, m, day] = datePart.split("-").map(Number);
    return new Date(y, m - 1, day).toLocaleDateString();
  }

  function getStatus(row: ShortUrl) {
    if (!row.isActive) return "Inactive";
    if (row.endDate && new Date(row.endDate) < new Date()) return "Expired";
    if (row.startDate && new Date(row.startDate) > new Date()) return "Scheduled";
    return "Active";
  }

  async function openQr(row: ShortUrl) {
    const url = getShortUrl(row);
    try {
      const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 2, color: { dark: "#000000", light: "#ffffff" } });
      setQrDataUrl(dataUrl); setQrLabel(row.title ?? row.shortCode); setQrTarget(url);
      setQrOpen(true);
    } catch { toast.error("Failed to generate QR code"); }
  }

  function downloadQr() {
    const a = document.createElement("a"); a.href = qrDataUrl; a.download = `qr-${qrLabel}.png`; a.click();
  }

  /* Filter + paginate */
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return urls.filter(r => {
      const matchesSearch = !q || r.title?.toLowerCase().includes(q) || r.originalUrl.toLowerCase().includes(q) || r.shortCode.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q);
      const status = getStatus(r);
      const matchesStatus = statusFilter === "all" || status.toLowerCase() === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [urls, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const analyticsTotalPages = analytics ? Math.max(1, Math.ceil(analytics.clicks.length / PAGE_SIZE)) : 1;
  const analyticsPaged = analytics?.clicks.slice((analyticsPage - 1) * PAGE_SIZE, analyticsPage * PAGE_SIZE) ?? [];

  function downloadUrlsCsv() {
    downloadCSV(filtered.map(row => ({
      Title: row.title ?? "", Description: row.description ?? "",
      "Short URL": getShortUrl(row), Domain: row.domainName ?? "App Domain",
      "Original URL": row.originalUrl, Status: getStatus(row),
      "Start Date": formatDate(row.startDate), "End Date": formatDate(row.endDate),
      Clicks: row.clickCount, "Created By": row.creatorName ?? "", "Created At": new Date(row.createdAt).toLocaleDateString(),
    })), "short-urls.csv");
  }

  function downloadAnalyticsCsv() {
    if (!analytics) return;
    downloadCSV(analytics.clicks.map(c => ({
      Time: new Date(c.clickedAt).toLocaleString(), "IP Address": c.ipAddress ?? "",
      Country: c.country ?? "", City: c.city ?? "", Browser: c.browser ?? "",
      OS: c.os ?? "", Device: c.deviceType ?? "", Referer: c.referer ?? "",
    })), `analytics-${analytics?.url.shortCode}.csv`);
  }

  const apiBaseUrl = `${window.location.origin}${BASE}api/v1`;

  return (
    <div className="p-6 space-y-6">
      <Tabs defaultValue="links">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">URL Shortener</h1>
            <p className="text-muted-foreground text-sm">Create and track short links with analytics</p>
          </div>
          <TabsList>
            <TabsTrigger value="links" className="gap-2"><Globe className="h-4 w-4" />Links</TabsTrigger>
            <TabsTrigger value="apikeys" className="gap-2"><Key className="h-4 w-4" />API Keys</TabsTrigger>
          </TabsList>
        </div>

        {/* ── LINKS TAB ── */}
        <TabsContent value="links" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 mr-2" />New Short URL</Button>
          </div>

          {/* Analytics view */}
          {analyticsId !== null && analyticsLoading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm">Loading analytics…</p>
            </div>
          ) : analyticsId !== null && analyticsError ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
              <p className="text-sm text-destructive">Failed to load analytics. Please try again.</p>
              <Button variant="outline" size="sm" onClick={() => { setAnalyticsId(null); setAnalyticsPage(1); }}>← Back to list</Button>
            </div>
          ) : analyticsId !== null && analytics ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={() => { setAnalyticsId(null); setAnalyticsPage(1); }}>← Back to list</Button>
                  <h2 className="font-semibold">{analytics.url.title ?? analytics.url.shortCode} — Analytics</h2>
                  <Badge variant="secondary">{analytics.stats.total} clicks</Badge>
                </div>
                <Button variant="outline" size="sm" onClick={downloadAnalyticsCsv}><Download className="h-4 w-4 mr-2" />Export CSV</Button>
              </div>

              {/* Creator / audit info */}
              {analytics.url.creatorName && (
                <div className="flex items-center gap-4 text-sm text-muted-foreground bg-muted/40 rounded-lg px-4 py-2">
                  <span className="flex items-center gap-1.5"><User className="h-3.5 w-3.5" /> Created by <strong className="text-foreground">{analytics.url.creatorName}</strong></span>
                  <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {new Date(analytics.url.createdAt).toLocaleString()}</span>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[{ label: "Total Clicks", value: analytics.stats.total }, { label: "Countries", value: analytics.stats.byCountry.length }, { label: "Browsers", value: analytics.stats.byBrowser.length }, { label: "Devices", value: analytics.stats.byDevice.length }].map(s => (
                  <Card key={s.label}><CardHeader className="pb-1 pt-4 px-4"><CardTitle className="text-xs text-muted-foreground font-normal">{s.label}</CardTitle></CardHeader><CardContent className="px-4 pb-4"><p className="text-3xl font-bold">{s.value}</p></CardContent></Card>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card><CardHeader><CardTitle className="text-sm">Browsers</CardTitle></CardHeader><CardContent><StatBar items={analytics.stats.byBrowser} icon={Chrome} /></CardContent></Card>
                <Card><CardHeader><CardTitle className="text-sm">Operating Systems</CardTitle></CardHeader><CardContent><StatBar items={analytics.stats.byOs} icon={Monitor} /></CardContent></Card>
                <Card><CardHeader><CardTitle className="text-sm">Device Types</CardTitle></CardHeader><CardContent><StatBar items={analytics.stats.byDevice} icon={Smartphone} /></CardContent></Card>
                <Card><CardHeader><CardTitle className="text-sm">Countries</CardTitle></CardHeader><CardContent><StatBar items={analytics.stats.byCountry} icon={Globe} /></CardContent></Card>
              </div>

              {/* Click Log */}
              <Card>
                <CardHeader><CardTitle className="text-sm">Click Log</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>IP</TableHead><TableHead>Location</TableHead><TableHead>Browser</TableHead><TableHead>OS</TableHead><TableHead>Device</TableHead><TableHead>Referer</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {analyticsPaged.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No clicks yet</TableCell></TableRow>}
                        {analyticsPaged.map(c => (
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

              {/* Audit log for this URL */}
              {analytics.auditLog.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" />Audit Log</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader><TableRow><TableHead>Action</TableHead><TableHead>Details</TableHead><TableHead>By</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {analytics.auditLog.map(log => (
                          <TableRow key={log.id}>
                            <TableCell><Badge variant="outline" className="text-[10px] font-mono">{log.action.replace("SHORT_URL_", "")}</Badge></TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">{log.details ?? "—"}</TableCell>
                            <TableCell className="text-xs">{log.userEmail ?? "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            /* URL List */
            <Card>
              <div className="flex items-center gap-2 p-4 border-b flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search by title, URL, code, or description…" className="pl-9" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
                </div>
                <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={downloadUrlsCsv}><Download className="h-4 w-4 mr-2" />Export CSV</Button>
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
                      {isLoading && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
                      {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{search || statusFilter !== "all" ? "No results found." : "No short URLs yet. Create one to get started."}</TableCell></TableRow>}
                      {paged.map(row => {
                        const status = getStatus(row);
                        const shortLink = getShortUrl(row);
                        return (
                          <TableRow key={row.id}>
                            <TableCell className="max-w-[220px]">
                              <div className="font-medium text-sm truncate">{row.title ?? row.shortCode}</div>
                              <div className="flex items-center gap-1 mt-0.5">
                                <span className="text-xs text-primary font-mono truncate max-w-[170px]">{shortLink}</span>
                                <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => copyUrl(row)}><Copy className="h-3 w-3" /></Button>
                              </div>
                              {row.description && <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[200px]">{row.description}</p>}
                              {row.creatorName && <p className="text-[10px] text-muted-foreground/70 mt-0.5 flex items-center gap-1"><User className="h-2.5 w-2.5" />{row.creatorName}</p>}
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
                                <Button variant="ghost" size="icon" className="h-8 w-8" title="QR Code" onClick={() => openQr(row)}><QrCode className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8" title="Analytics" onClick={() => { setAnalyticsId(row.id); setAnalyticsPage(1); }}><BarChart2 className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => openEdit(row)}><Edit className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Delete" onClick={() => { if (confirm("Delete this short URL?")) deleteMutation.mutate(row.id); }}><Trash2 className="h-4 w-4" /></Button>
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
        </TabsContent>

        {/* ── API KEYS TAB ── */}
        <TabsContent value="apikeys" className="space-y-6 mt-4">
          {/* Revealed key banner */}
          {revealedKey && (
            <Card className="border-green-500/40 bg-green-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-green-700 dark:text-green-400 flex items-center gap-2"><Key className="h-4 w-4" />Your new API key — copy it now, it won't be shown again</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-sm bg-muted px-3 py-2 rounded-md break-all">{revealedKey}</code>
                  <Button size="sm" variant="outline" onClick={() => clipboardCopy(revealedKey, "Key copied")}><Copy className="h-4 w-4" /></Button>
                </div>
                <Button size="sm" variant="ghost" className="mt-2 text-xs" onClick={() => setRevealedKey(null)}>Dismiss</Button>
              </CardContent>
            </Card>
          )}

          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">API Keys</h2>
              <p className="text-sm text-muted-foreground">Generate keys to access the URL Shortener REST API from external applications.</p>
            </div>
            <Button onClick={() => setKeyDialogOpen(true)}><Plus className="h-4 w-4 mr-2" />Generate Key</Button>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Key Prefix</TableHead><TableHead>Created</TableHead><TableHead>Last Used</TableHead><TableHead>Expires</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {keysLoading && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>}
                  {!keysLoading && apiKeys.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No API keys yet. Generate one to get started.</TableCell></TableRow>}
                  {apiKeys.map(k => (
                    <TableRow key={k.id}>
                      <TableCell className="font-medium">{k.name}</TableCell>
                      <TableCell><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{k.keyPrefix}…</code></TableCell>
                      <TableCell className="text-xs">{new Date(k.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell className="text-xs">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "Never"}</TableCell>
                      <TableCell className="text-xs">{k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : "Never"}</TableCell>
                      <TableCell>
                        {k.isActive ? <Badge className="bg-green-500 hover:bg-green-600">Active</Badge> : <Badge variant="secondary">Disabled</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" title={k.isActive ? "Disable" : "Enable"} onClick={() => toggleKeyMutation.mutate(k.id)}>
                            {k.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Revoke" onClick={() => { if (confirm("Revoke this API key? It will stop working immediately.")) deleteKeyMutation.mutate(k.id); }}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* REST API Reference */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Code className="h-4 w-4" />REST API Reference</CardTitle>
              <CardDescription>
                Base URL: <code className="bg-muted px-1 rounded text-xs">{apiBaseUrl}</code> &nbsp;·&nbsp;
                Authentication: <code className="bg-muted px-1 rounded text-xs">Authorization: Bearer YOUR_API_KEY</code>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { method: "GET", path: "/urls", desc: "List all your short URLs", example: `curl -H "Authorization: Bearer YOUR_KEY" ${apiBaseUrl}/urls` },
                { method: "POST", path: "/urls", desc: "Create a short URL", example: `curl -X POST -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" \\\n  -d '{"originalUrl":"https://example.com","title":"My Link"}' \\\n  ${apiBaseUrl}/urls` },
                { method: "GET", path: "/urls/:code", desc: "Get URL info by short code", example: `curl -H "Authorization: Bearer YOUR_KEY" ${apiBaseUrl}/urls/abc1234` },
                { method: "GET", path: "/urls/:code/stats", desc: "Get click count for a short URL", example: `curl -H "Authorization: Bearer YOUR_KEY" ${apiBaseUrl}/urls/abc1234/stats` },
                { method: "DELETE", path: "/urls/:code", desc: "Delete a short URL (owner only)", example: `curl -X DELETE -H "Authorization: Bearer YOUR_KEY" ${apiBaseUrl}/urls/abc1234` },
              ].map(e => (
                <div key={e.path} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-[10px] font-mono ${e.method === "GET" ? "text-blue-600 border-blue-300" : e.method === "POST" ? "text-green-600 border-green-300" : "text-red-600 border-red-300"}`}>{e.method}</Badge>
                    <code className="text-xs font-mono text-foreground">/v1{e.path}</code>
                    <span className="text-xs text-muted-foreground">— {e.desc}</span>
                  </div>
                  <div className="relative">
                    <pre className="bg-muted text-xs rounded-md px-4 py-2.5 overflow-x-auto font-mono">{e.example}</pre>
                    <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6 opacity-60 hover:opacity-100" onClick={() => clipboardCopy(e.example, "Copied")}><Copy className="h-3 w-3" /></Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Create / Edit dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={o => { if (!o) resetDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editRow ? "Edit Short URL" : "Create Short URL"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Original URL *</Label>
              <Input placeholder="https://example.com/very/long/url" value={form.originalUrl} onChange={e => setForm(f => ({ ...f, originalUrl: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Title (optional)</Label>
                <Input placeholder="My Campaign Link" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Short Domain</Label>
                <Select value={form.domainId || "__app__"} onValueChange={v => setForm(f => ({ ...f, domainId: v === "__app__" ? "" : v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__app__">App Domain</SelectItem>
                    {verifiedDomains.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.domain}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Description (optional)</Label>
              <Textarea placeholder="What is this link for? Add any tags or notes…" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            {!editRow && (
              <div className="space-y-1">
                <Label>Custom code (optional)</Label>
                <Input placeholder="e.g. summer24 (leave blank to auto-generate)" value={form.customCode} onChange={e => setForm(f => ({ ...f, customCode: e.target.value }))} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Start Date</Label><Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></div>
              <div className="space-y-1"><Label>End Date</Label><Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></div>
            </div>
            <div className="flex items-center gap-3"><Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} /><Label>Active</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetDialog}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>{editRow ? "Save Changes" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── QR Code dialog ── */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><QrCode className="h-4 w-4" />QR Code — {qrLabel}</DialogTitle></DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            {qrDataUrl && <img src={qrDataUrl} alt="QR Code" className="w-64 h-64 rounded-lg border shadow-sm" />}
            <p className="text-xs text-muted-foreground text-center break-all">{qrTarget}</p>
          </div>
          <DialogFooter className="flex-row gap-2 sm:gap-2">
            <Button variant="outline" className="flex-1" onClick={() => clipboardCopy(qrTarget, "URL copied")}><Copy className="h-4 w-4 mr-2" />Copy URL</Button>
            <Button className="flex-1" onClick={downloadQr}><Download className="h-4 w-4 mr-2" />Download PNG</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Generate API Key dialog ── */}
      <Dialog open={keyDialogOpen} onOpenChange={setKeyDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Generate API Key</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Key Name *</Label>
              <Input placeholder="e.g. Production App, GitHub Action…" value={keyForm.name} onChange={e => setKeyForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Expiry Date (optional)</Label>
              <Input type="date" value={keyForm.expiresAt} onChange={e => setKeyForm(f => ({ ...f, expiresAt: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Leave blank for a non-expiring key.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKeyDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => createKeyMutation.mutate(keyForm)} disabled={!keyForm.name.trim() || createKeyMutation.isPending}>Generate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
