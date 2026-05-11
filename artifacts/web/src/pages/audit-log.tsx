import { useState } from "react";
import { useGetAuditLog } from "@workspace/api-client-react";
import { format } from "date-fns";
import { getAccessToken } from "@/lib/auth";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Filter, Globe, CalendarDays, Download, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getGetAuditLogQueryKey } from "@workspace/api-client-react";

const ACTION_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  LOGIN_SUCCESS:            { label: "Login",              variant: "default" },
  LOGIN_FAILED:             { label: "Login Failed",       variant: "destructive" },
  LOGOUT:                   { label: "Logout",             variant: "outline" },
  EMAIL_OTP_SENT:           { label: "OTP Sent",           variant: "secondary" },
  EMAIL_OTP_LOGIN:          { label: "OTP Login",          variant: "default" },
  EMAIL_OTP_FAILED:         { label: "OTP Failed",         variant: "destructive" },
  USER_CREATED:             { label: "User Created",       variant: "secondary" },
  USER_UPDATED:             { label: "User Updated",       variant: "secondary" },
  USER_DELETED:             { label: "User Deleted",       variant: "destructive" },
  STATUS_CHANGED:           { label: "Status Changed",     variant: "outline" },
  ROLE_CHANGED:             { label: "Role Changed",       variant: "outline" },
  MFA_ENABLED:              { label: "MFA Enabled",        variant: "default" },
  MFA_DISABLED:             { label: "MFA Disabled",       variant: "outline" },
  MFA_RESET:                { label: "MFA Reset",          variant: "outline" },
  PASSWORD_CHANGED:         { label: "Password Changed",   variant: "secondary" },
  ROLE_PERMISSIONS_UPDATED: { label: "Permissions Updated",variant: "secondary" },
  SMTP_SETTINGS_UPDATED:    { label: "SMTP Updated",       variant: "secondary" },
  APP_SETTINGS_UPDATED:     { label: "App Settings",       variant: "secondary" },
  APP_LOGO_UPDATED:         { label: "Logo Updated",       variant: "secondary" },
  AUDIT_LOG_EXPORTED:       { label: "Log Exported",       variant: "outline" },
};

const ALL_ACTIONS = Object.keys(ACTION_LABELS);

export default function AuditLog() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [userSearch, setUserSearch] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const queryParams = {
    page,
    pageSize: 50,
    action: actionFilter !== "all" ? actionFilter : undefined,
  };

  const { data, isLoading } = useGetAuditLog(queryParams, {
    query: { queryKey: getGetAuditLogQueryKey(queryParams) },
  });

  const filteredEntries = userSearch
    ? (data?.entries ?? []).filter(e =>
        e.userEmail?.toLowerCase().includes(userSearch.toLowerCase())
      )
    : (data?.entries ?? []);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const token = getAccessToken();
      const params = new URLSearchParams({ page: "1", pageSize: "10000" });
      if (actionFilter !== "all") params.set("action", actionFilter);
      const resp = await fetch(`${import.meta.env.BASE_URL}api/dashboard/audit-log?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error("Export failed");
      const result = await resp.json();
      const entries: { id: number; userEmail?: string | null; action: string; ipAddress?: string | null; details?: string | null; createdAt: string }[] = result.entries;

      const header = "ID,Timestamp,User Email,Action,IP Address,Details\n";
      const rows = entries.map(e => [
        e.id,
        format(new Date(e.createdAt), "yyyy-MM-dd HH:mm:ss"),
        `"${e.userEmail ?? "System"}"`,
        e.action,
        e.ipAddress ?? "",
        `"${(e.details ?? "").replace(/"/g, '""')}"`,
      ].join(",")).join("\n");

      const csv = header + rows;
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-log-${format(new Date(), "yyyy-MM-dd")}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      await fetch(`${import.meta.env.BASE_URL}api/dashboard/audit-log/export-record`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ filter: actionFilter, count: entries.length }),
      }).catch(() => {});

      toast.success(`Exported ${entries.length} records`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
          <p className="text-muted-foreground mt-2">Immutable record of all security, administrative, and data events.</p>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={isExporting}>
          {isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          Export CSV
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select value={actionFilter} onValueChange={(val) => { setActionFilter(val); setPage(1); }}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="All Actions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Actions</SelectItem>
                    {ALL_ACTIONS.map(action => (
                      <SelectItem key={action} value={action}>
                        <span className="text-xs">{ACTION_LABELS[action]?.label ?? action}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter by user..."
                  className="pl-9 w-[200px]"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              {data ? `Showing ${filteredEntries.length} of ${data.total} records` : "Loading..."}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead className="w-[120px]">IP Address</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(10).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    {[140, 150, 100, 100, 200].map((w, j) => (
                      <TableCell key={j}><Skeleton className={`h-4 w-${w === 200 ? 'full' : w}`} /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No audit records found matching criteria.
                  </TableCell>
                </TableRow>
              ) : (
                filteredEntries.map((entry) => {
                  const meta = ACTION_LABELS[entry.action];
                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <CalendarDays className="h-3 w-3 shrink-0" />
                          {format(new Date(entry.createdAt), 'MMM d, yyyy')}
                        </div>
                        <div className="pl-4">{format(new Date(entry.createdAt), 'HH:mm:ss')}</div>
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {entry.userEmail ?? <span className="text-muted-foreground italic">System</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={meta?.variant ?? "outline"} className="text-xs font-mono">
                          {meta?.label ?? entry.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {entry.ipAddress ? (
                          <div className="flex items-center gap-1">
                            <Globe className="h-3 w-3" />{entry.ipAddress}
                          </div>
                        ) : "-"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">
                        {entry.details || "-"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          {data && data.total > data.pageSize && (
            <div className="p-4 border-t flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Page {page}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
                <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * data.pageSize >= data.total}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
