import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";
import { Plus, Copy, Trash2, BarChart2, ExternalLink, Globe, Monitor, Smartphone, Chrome, Edit } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

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

interface ShortUrl {
  id: number;
  shortCode: string;
  originalUrl: string;
  title: string | null;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  createdAt: string;
  clickCount: number;
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

function getBaseUrl() {
  return window.location.origin;
}

export default function UrlShortener() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [analyticsId, setAnalyticsId] = useState<number | null>(null);
  const [editRow, setEditRow] = useState<ShortUrl | null>(null);
  const [form, setForm] = useState({ originalUrl: "", title: "", startDate: "", endDate: "", isActive: true, customCode: "" });

  const { data: urls = [], isLoading } = useQuery<ShortUrl[]>({
    queryKey: ["short-urls"],
    queryFn: () => apiFetch("/short-urls"),
  });

  const { data: analytics } = useQuery<AnalyticsData>({
    queryKey: ["short-url-analytics", analyticsId],
    queryFn: () => apiFetch(`/short-urls/${analyticsId}/analytics`),
    enabled: analyticsId !== null,
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => apiFetch("/short-urls", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["short-urls"] }); toast.success("Short URL created"); resetDialog(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: (data: typeof form & { id: number }) => apiFetch(`/short-urls/${data.id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["short-urls"] }); toast.success("Updated"); resetDialog(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/short-urls/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["short-urls"] }); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  function resetDialog() { setDialogOpen(false); setEditRow(null); setForm({ originalUrl: "", title: "", startDate: "", endDate: "", isActive: true, customCode: "" }); }

  function openEdit(row: ShortUrl) {
    setEditRow(row);
    setForm({
      originalUrl: row.originalUrl,
      title: row.title ?? "",
      startDate: row.startDate ? row.startDate.slice(0, 10) : "",
      endDate: row.endDate ? row.endDate.slice(0, 10) : "",
      isActive: row.isActive,
      customCode: "",
    });
    setDialogOpen(true);
  }

  function handleSubmit() {
    if (!form.originalUrl.trim()) { toast.error("Original URL is required"); return; }
    if (editRow) updateMutation.mutate({ ...form, id: editRow.id });
    else createMutation.mutate(form);
  }

  function copyUrl(code: string) {
    navigator.clipboard.writeText(`${getBaseUrl()}/s/${code}`);
    toast.success("Copied to clipboard");
  }

  function formatDate(d: string | null) {
    if (!d) return "—";
    return new Date(d).toLocaleDateString();
  }

  function isExpired(row: ShortUrl) {
    if (!row.endDate) return false;
    return new Date(row.endDate) < new Date();
  }

  function isNotStarted(row: ShortUrl) {
    if (!row.startDate) return false;
    return new Date(row.startDate) > new Date();
  }

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">URL Shortener</h1>
            <p className="text-muted-foreground text-sm">Create and track short links with analytics</p>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Short URL
          </Button>
        </div>

        {analyticsId !== null && analytics ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => setAnalyticsId(null)}>Back to list</Button>
              <h2 className="font-semibold">{analytics.url.title ?? analytics.url.shortCode} — Analytics</h2>
              <Badge variant="secondary">{analytics.stats.total} clicks</Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Clicks</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">{analytics.stats.total}</p></CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Countries</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">{analytics.stats.byCountry.length}</p></CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Browsers</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">{analytics.stats.byBrowser.length}</p></CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Devices</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">{analytics.stats.byDevice.length}</p></CardContent></Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">Browsers</CardTitle></CardHeader>
                <CardContent><StatBar items={analytics.stats.byBrowser} icon={Chrome} /></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Operating Systems</CardTitle></CardHeader>
                <CardContent><StatBar items={analytics.stats.byOs} icon={Monitor} /></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Device Types</CardTitle></CardHeader>
                <CardContent><StatBar items={analytics.stats.byDevice} icon={Smartphone} /></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Countries</CardTitle></CardHeader>
                <CardContent><StatBar items={analytics.stats.byCountry} icon={Globe} /></CardContent>
              </Card>
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
                      {analytics.clicks.length === 0 && (
                        <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No clicks yet</TableCell></TableRow>
                      )}
                      {analytics.clicks.map((c) => (
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
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card>
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
                    {isLoading && (
                      <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                    )}
                    {!isLoading && urls.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No short URLs yet. Create one to get started.</TableCell></TableRow>
                    )}
                    {urls.map((row) => {
                      const expired = isExpired(row);
                      const notStarted = isNotStarted(row);
                      const shortLink = `${getBaseUrl()}/s/${row.shortCode}`;
                      return (
                        <TableRow key={row.id}>
                          <TableCell>
                            <div className="font-medium text-sm">{row.title ?? row.shortCode}</div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="text-xs text-primary font-mono">{shortLink}</span>
                              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => copyUrl(row.shortCode)}>
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[200px]">
                            <div className="flex items-center gap-1">
                              <span className="text-xs truncate text-muted-foreground">{row.originalUrl}</span>
                              <a href={row.originalUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" /></a>
                            </div>
                          </TableCell>
                          <TableCell>
                            {!row.isActive ? <Badge variant="secondary">Inactive</Badge>
                              : expired ? <Badge variant="destructive">Expired</Badge>
                              : notStarted ? <Badge variant="outline">Scheduled</Badge>
                              : <Badge className="bg-green-500 hover:bg-green-600">Active</Badge>}
                          </TableCell>
                          <TableCell className="text-xs">{formatDate(row.startDate)}</TableCell>
                          <TableCell className="text-xs">{formatDate(row.endDate)}</TableCell>
                          <TableCell className="text-center font-semibold">{row.clickCount}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setAnalyticsId(row.id)}>
                                <BarChart2 className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}>
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => { if (confirm("Delete this short URL?")) deleteMutation.mutate(row.id); }}>
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
            </CardContent>
          </Card>
        )}

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
    </Layout>
  );
}
