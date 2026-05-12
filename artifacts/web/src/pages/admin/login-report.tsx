import { useState } from "react";
import { getAccessToken } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { LogIn, AlertTriangle, TrendingUp, Search, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { formatDateTime } from "@/lib/date";

const BASE = import.meta.env.BASE_URL;

async function apiFetch(path: string, token: string | null) {
  const resp = await fetch(`${BASE}api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) throw new Error("Request failed");
  return resp.json();
}

type DayStat = { date: string; successes: number; failures: number };
type LogEntry = {
  id: number;
  userEmail: string | null;
  action: string;
  ipAddress: string | null;
  details: string | null;
  createdAt: string;
};
type LoginReportData = {
  entries: LogEntry[];
  total: number;
  page: number;
  pageSize: number;
  dailyStats: DayStat[];
};

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  LOGIN_SUCCESS: { label: "Success", color: "bg-green-500/10 text-green-600 border-green-500/20" },
  LOGIN_FAILED: { label: "Failed", color: "bg-red-500/10 text-red-600 border-red-500/20" },
  LOGIN_MFA_REQUIRED: { label: "MFA Required", color: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  MFA_VERIFIED: { label: "MFA Verified", color: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  M365_LOGIN: { label: "M365 SSO", color: "bg-purple-500/10 text-purple-600 border-purple-500/20" },
};

function escapeCsv(val: unknown): string {
  return `"${String(val ?? "").replace(/"/g, '""')}"`;
}

export default function LoginReport() {
  const token = getAccessToken();
  const [email, setEmail] = useState("");
  const [action, setAction] = useState("all");
  const [page, setPage] = useState(1);
  const [emailInput, setEmailInput] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);

  const { data, isLoading } = useQuery<LoginReportData>({
    queryKey: ["login-report", email, action, page, fromDate, toDate],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "10" });
      if (email) params.set("email", email);
      if (action !== "all") params.set("action", action);
      if (fromDate) params.set("from", new Date(fromDate).toISOString());
      if (toDate) {
        const to = new Date(toDate);
        to.setHours(23, 59, 59, 999);
        params.set("to", to.toISOString());
      }
      return apiFetch(`/admin/login-report?${params}`, token);
    },
  });

  const totalPages = data ? Math.ceil(data.total / 10) : 1;

  const handleSearch = () => {
    setEmail(emailInput);
    setPage(1);
  };

  const handleDateChange = () => {
    setPage(1);
  };

  const handleDownloadCsv = async () => {
    setIsDownloading(true);
    try {
      const params = new URLSearchParams({ page: "1", pageSize: "9999" });
      if (email) params.set("email", email);
      if (action !== "all") params.set("action", action);
      if (fromDate) params.set("from", new Date(fromDate).toISOString());
      if (toDate) {
        const to = new Date(toDate);
        to.setHours(23, 59, 59, 999);
        params.set("to", to.toISOString());
      }
      const result: LoginReportData = await apiFetch(`/admin/login-report?${params}`, token);
      const headers = ["ID", "Email", "Action", "IP Address", "Time"];
      const rows = result.entries.map(e => [
        e.id,
        e.userEmail ?? "",
        e.action,
        e.ipAddress ?? "",
        formatDateTime(e.createdAt),
      ]);
      const csv = [headers, ...rows].map(r => r.map(escapeCsv).join(",")).join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `login-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // silent
    } finally {
      setIsDownloading(false);
    }
  };

  // Fill missing days in the chart
  const chartData: DayStat[] = [];
  if (data?.dailyStats) {
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const found = data.dailyStats.find(s => s.date === key);
      chartData.push({ date: key.slice(5), successes: found?.successes ?? 0, failures: found?.failures ?? 0 });
    }
  }

  // Summary stats
  const totalSuccess = data?.dailyStats.reduce((s, d) => s + d.successes, 0) ?? 0;
  const totalFailed = data?.dailyStats.reduce((s, d) => s + d.failures, 0) ?? 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Login Report</h1>
        <p className="text-muted-foreground mt-2">Authentication activity across the platform.</p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Successful Logins (30d)</CardTitle>
            <LogIn className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{isLoading ? "–" : totalSuccess}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Failed Logins (30d)</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{isLoading ? "–" : totalFailed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Events</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? "–" : (data?.total ?? 0)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Activity chart */}
      <Card>
        <CardHeader>
          <CardTitle>Login Activity (Last 30 Days)</CardTitle>
          <CardDescription>Daily breakdown of successes and failures</CardDescription>
        </CardHeader>
        <CardContent className="h-52">
          {isLoading ? (
            <Skeleton className="w-full h-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 0, right: 8, left: -20, bottom: 0 }} barSize={8}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", fontSize: 12 }}
                  itemStyle={{ color: "hsl(var(--foreground))" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="successes" name="Successes" fill="hsl(var(--chart-2))" radius={[2, 2, 0, 0]} />
                <Bar dataKey="failures" name="Failures" fill="hsl(var(--destructive))" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Filters + table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Events</CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownloadCsv}
              disabled={isDownloading || isLoading}
              className="gap-2"
            >
              <Download className="h-3.5 w-3.5" />
              {isDownloading ? "Preparing…" : "Download CSV"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search + action filter row */}
          <div className="flex gap-2 flex-wrap">
            <div className="flex gap-2 flex-1 min-w-[200px]">
              <Input
                placeholder="Filter by email…"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1"
              />
              <Button size="icon" variant="outline" onClick={handleSearch}><Search className="h-4 w-4" /></Button>
            </div>
            <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="LOGIN_SUCCESS">Login Success</SelectItem>
                <SelectItem value="LOGIN_FAILED">Login Failed</SelectItem>
                <SelectItem value="LOGIN_MFA_REQUIRED">MFA Required</SelectItem>
                <SelectItem value="MFA_VERIFIED">MFA Verified</SelectItem>
                <SelectItem value="M365_LOGIN">M365 SSO</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Date range filter row */}
          <div className="flex gap-3 flex-wrap items-end">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">From date</Label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); handleDateChange(); }}
                className="w-40 h-8 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">To date</Label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => { setToDate(e.target.value); handleDateChange(); }}
                className="w-40 h-8 text-sm"
              />
            </div>
            {(fromDate || toDate) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs"
                onClick={() => { setFromDate(""); setToDate(""); setPage(1); }}
              >
                Clear dates
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-2">{Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : (
            <>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Email</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Action</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden md:table-cell">IP Address</th>
                      <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.entries.length === 0 ? (
                      <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">No events found</td></tr>
                    ) : (
                      data?.entries.map((entry) => {
                        const meta = ACTION_LABELS[entry.action] ?? { label: entry.action, color: "bg-muted text-muted-foreground" };
                        return (
                          <tr key={entry.id} className="border-t hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-2.5 font-mono text-xs">{entry.userEmail ?? "–"}</td>
                            <td className="px-4 py-2.5">
                              <Badge variant="outline" className={`text-[10px] px-1.5 ${meta.color}`}>{meta.label}</Badge>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell font-mono">{entry.ipAddress ?? "–"}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground text-right whitespace-nowrap">
                              {formatDateTime(entry.createdAt)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-muted-foreground">
                  Page {page} of {totalPages} · {data?.total ?? 0} total events
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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
