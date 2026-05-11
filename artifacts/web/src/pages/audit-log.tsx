import { useState } from "react";
import { useGetAuditLog } from "@workspace/api-client-react";
import { format } from "date-fns";
import { getAccessToken } from "@/lib/auth";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Filter, Globe, CalendarDays, Download, Loader2, Search, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getGetAuditLogQueryKey } from "@workspace/api-client-react";

// ─── Action registry ──────────────────────────────────────────────────────────
type ActionMeta = { label: string; variant: "default" | "secondary" | "destructive" | "outline"; group: string };

const ACTION_REGISTRY: Record<string, ActionMeta> = {
  // Auth
  LOGIN_SUCCESS:             { label: "Login",               variant: "default",     group: "Auth" },
  LOGIN_FAILED:              { label: "Login Failed",        variant: "destructive", group: "Auth" },
  LOGOUT:                    { label: "Logout",              variant: "outline",     group: "Auth" },
  EMAIL_OTP_SENT:            { label: "OTP Sent",            variant: "secondary",   group: "Auth" },
  EMAIL_OTP_LOGIN:           { label: "OTP Login",           variant: "default",     group: "Auth" },
  EMAIL_OTP_FAILED:          { label: "OTP Failed",          variant: "destructive", group: "Auth" },
  MFA_ENABLED:               { label: "MFA Enabled",         variant: "default",     group: "Auth" },
  MFA_DISABLED:              { label: "MFA Disabled",        variant: "outline",     group: "Auth" },
  MFA_RESET:                 { label: "MFA Reset",           variant: "outline",     group: "Auth" },
  PASSWORD_CHANGED:          { label: "Password Changed",    variant: "secondary",   group: "Auth" },
  // Users & Roles
  USER_CREATED:              { label: "User Created",        variant: "secondary",   group: "Users" },
  USER_UPDATED:              { label: "User Updated",        variant: "secondary",   group: "Users" },
  USER_DELETED:              { label: "User Deleted",        variant: "destructive", group: "Users" },
  STATUS_CHANGED:            { label: "Status Changed",      variant: "outline",     group: "Users" },
  ROLE_CHANGED:              { label: "Role Changed",        variant: "outline",     group: "Users" },
  ROLE_PERMISSIONS_UPDATED:  { label: "Permissions Updated", variant: "secondary",   group: "Users" },
  // PII
  PII_REVEAL:                { label: "PII Reveal",          variant: "destructive", group: "PII" },
  PII_RECORD_CREATED:        { label: "PII Record Created",  variant: "secondary",   group: "PII" },
  PII_RECORD_DELETED:        { label: "PII Record Deleted",  variant: "destructive", group: "PII" },
  PII_KEY_ROTATED:           { label: "PII Key Rotated",     variant: "outline",     group: "PII" },
  PII_PERMISSIONS_UPDATED:   { label: "PII Perms Updated",   variant: "secondary",   group: "PII" },
  PII_BULK_IMPORT:           { label: "PII Bulk Import",     variant: "secondary",   group: "PII" },
  // System / Settings
  SMTP_SETTINGS_UPDATED:     { label: "SMTP Updated",        variant: "secondary",   group: "System" },
  APP_SETTINGS_UPDATED:      { label: "App Settings",        variant: "secondary",   group: "System" },
  APP_LOGO_UPDATED:          { label: "Logo Updated",        variant: "secondary",   group: "System" },
  AUDIT_LOG_EXPORTED:        { label: "Log Exported",        variant: "outline",     group: "System" },
};

const GROUPS = ["Auth", "Users", "PII", "System"] as const;

const PII_ACTIONS = Object.entries(ACTION_REGISTRY)
  .filter(([, m]) => m.group === "PII")
  .map(([k]) => k);

export default function AuditLog() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [userSearch, setUserSearch] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const effectiveAction = actionFilter !== "all" ? actionFilter : undefined;

  const queryParams = {
    page,
    pageSize: 50,
    action: effectiveAction,
  };

  const { data, isLoading } = useGetAuditLog(queryParams, {
    query: { queryKey: getGetAuditLogQueryKey(queryParams) },
  });

  const filteredEntries = (data?.entries ?? []).filter(e => {
    if (userSearch && !e.userEmail?.toLowerCase().includes(userSearch.toLowerCase())) return false;
    if (groupFilter !== "all") {
      const meta = ACTION_REGISTRY[e.action];
      if (!meta || meta.group !== groupFilter) return false;
    }
    return true;
  });

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const token = getAccessToken();
      const params = new URLSearchParams({ page: "1", pageSize: "10000" });
      if (effectiveAction) params.set("action", effectiveAction);
      const resp = await fetch(`${import.meta.env.BASE_URL}api/dashboard/audit-log?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error("Export failed");
      const result = await resp.json();
      const entries: {
        id: number; userEmail?: string | null; action: string; ipAddress?: string | null;
        details?: string | null; createdAt: string; resourceType?: string | null;
        resourceId?: string | null; fieldName?: string | null;
      }[] = result.entries;

      const header = "ID,Timestamp,User Email,Action,Resource Type,Resource ID,Field,IP Address,Details\n";
      const rows = entries.map(e => [
        e.id,
        format(new Date(e.createdAt), "yyyy-MM-dd HH:mm:ss"),
        `"${e.userEmail ?? "System"}"`,
        e.action,
        e.resourceType ?? "",
        e.resourceId ?? "",
        e.fieldName ?? "",
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
        body: JSON.stringify({ filter: effectiveAction ?? "all", count: entries.length }),
      }).catch(() => {});

      toast.success(`Exported ${entries.length} records`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  const isPiiRow = (action: string) => PII_ACTIONS.includes(action);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
          <p className="text-muted-foreground mt-2">
            Immutable record of all security, administrative, data, and PII access events.
          </p>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={isExporting}>
          {isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          Export CSV
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
              {/* Group filter */}
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
                <Select
                  value={groupFilter}
                  onValueChange={(v) => { setGroupFilter(v); setActionFilter("all"); setPage(1); }}
                >
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="All Groups" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Groups</SelectItem>
                    {GROUPS.map(g => (
                      <SelectItem key={g} value={g}>{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Action filter */}
              <Select
                value={actionFilter}
                onValueChange={(v) => { setActionFilter(v); setPage(1); }}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All Actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  {GROUPS.filter(g => groupFilter === "all" || g === groupFilter).map(g => (
                    <SelectGroup key={g}>
                      <SelectLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1">
                        {g}
                      </SelectLabel>
                      {Object.entries(ACTION_REGISTRY)
                        .filter(([, m]) => m.group === g)
                        .map(([action, m]) => (
                          <SelectItem key={action} value={action}>
                            <span className="text-xs">{m.label}</span>
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>

              {/* User search */}
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
            <div className="text-sm text-muted-foreground shrink-0">
              {data ? `Showing ${filteredEntries.length} of ${data.total} records` : "Loading..."}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead className="w-[160px]">Action</TableHead>
                <TableHead className="w-[100px]">Resource</TableHead>
                <TableHead className="w-[80px]">Record</TableHead>
                <TableHead className="w-[100px]">Field</TableHead>
                <TableHead className="w-[110px]">IP Address</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(10).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    {[140, 150, 160, 100, 80, 100, 110, 200].map((w, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" style={{ maxWidth: w }} /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No audit records found matching the selected criteria.
                  </TableCell>
                </TableRow>
              ) : (
                filteredEntries.map((entry) => {
                  const meta = ACTION_REGISTRY[entry.action];
                  const pii = isPiiRow(entry.action);
                  const resourceType = (entry as Record<string, unknown>).resourceType as string | null | undefined;
                  const resourceId = (entry as Record<string, unknown>).resourceId as string | null | undefined;
                  const fieldName = (entry as Record<string, unknown>).fieldName as string | null | undefined;
                  return (
                    <TableRow key={entry.id} className={pii ? "bg-amber-50/40 dark:bg-amber-950/10" : undefined}>
                      <TableCell className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <CalendarDays className="h-3 w-3 shrink-0" />
                          {format(new Date(entry.createdAt), "MMM d, yyyy")}
                        </div>
                        <div className="pl-4">{format(new Date(entry.createdAt), "HH:mm:ss")}</div>
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {entry.userEmail ?? <span className="text-muted-foreground italic">System</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={meta?.variant ?? "outline"} className="text-xs font-mono gap-1">
                          {pii && <ShieldAlert className="h-2.5 w-2.5" />}
                          {meta?.label ?? entry.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {resourceType ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {resourceId ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {fieldName ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {entry.ipAddress ? (
                          <div className="flex items-center gap-1">
                            <Globe className="h-3 w-3" />{entry.ipAddress}
                          </div>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[220px] truncate">
                        {entry.details || "—"}
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
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * data.pageSize >= data.total}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
