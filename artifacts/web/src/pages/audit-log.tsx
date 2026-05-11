import { useState } from "react";
import { useGetAuditLog } from "@workspace/api-client-react";
import { format } from "date-fns";

import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Filter, Terminal, Globe, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AuditLog() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<string>("all");
  
  const queryParams = {
    page,
    pageSize: 50,
    action: actionFilter !== "all" ? actionFilter : undefined,
  };

  const { data, isLoading } = useGetAuditLog(queryParams);

  const commonActions = [
    "user_login",
    "user_logout",
    "user_created",
    "user_updated",
    "mfa_enabled",
    "mfa_disabled",
    "role_permissions_updated"
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
        <p className="text-muted-foreground mt-2">Immutable record of security and administrative events.</p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-2 max-w-md w-full">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={actionFilter} onValueChange={(val) => { setActionFilter(val); setPage(1); }}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All Actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  {commonActions.map(action => (
                    <SelectItem key={action} value={action}>
                      <span className="font-mono text-xs">{action}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="text-sm text-muted-foreground">
              {data ? `Showing ${data.entries.length} of ${data.total} records` : "Loading records..."}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(10).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : data?.entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No audit records found matching criteria.
                  </TableCell>
                </TableRow>
              ) : (
                data?.entries.map((entry) => (
                  <TableRow key={entry.id} className="font-mono text-xs">
                    <TableCell className="text-muted-foreground flex items-center">
                      <CalendarDays className="h-3 w-3 mr-2" />
                      {format(new Date(entry.createdAt), 'MMM d, yyyy HH:mm:ss')}
                    </TableCell>
                    <TableCell className="font-sans font-medium text-sm">
                      {entry.userEmail || "System"}
                    </TableCell>
                    <TableCell>
                      <span className="px-2 py-1 bg-muted rounded-md text-foreground">
                        {entry.action}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground flex items-center">
                      {entry.ipAddress ? (
                        <><Globe className="h-3 w-3 mr-1" /> {entry.ipAddress}</>
                      ) : "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground truncate max-w-[300px]">
                      {entry.details || "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          
          {data && data.total > data.pageSize && (
            <div className="p-4 border-t flex justify-end gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setPage(p => p + 1)}
                disabled={page * data.pageSize >= data.total}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
