import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Loader2, Plus, Pencil, Trash2, Search, ChevronLeft, ChevronRight,
  GitBranch, KeyRound, Eye, EyeOff, Copy, CheckCircle2,
} from "lucide-react";
import { getAccessToken } from "@/lib/auth";
import { formatDate } from "@/lib/date";
import { useAuth } from "@/lib/auth";

const MIGRATION_STATUSES = ["Migrated", "Pending", "Planned"] as const;
type MigrationStatus = typeof MIGRATION_STATUSES[number];

interface BranchMigration {
  branchcode: string;
  branchname: string | null;
  defaultcode: string | null;
  email: string | null;
  address1: string | null;
  ccity: string | null;
  npincode: string | null;
  migrationStatus: MigrationStatus;
  migrationDate: string | null;
  createdBy: string;
  createdDatetime: string;
  updatedBy: string;
  updatedDatetime: string;
}

interface ApiKey {
  id: number;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

const formSchema = z.object({
  branchcode:      z.string().min(1, "Branch code is required").max(30),
  branchname:      z.string().max(200).optional().nullable(),
  defaultcode:     z.string().max(20).optional().nullable(),
  email:           z.string().email("Invalid email").max(200).optional().nullable().or(z.literal("")),
  address1:        z.string().max(500).optional().nullable(),
  ccity:           z.string().max(100).optional().nullable(),
  npincode:        z.string().max(20).optional().nullable(),
  migrationStatus: z.enum(MIGRATION_STATUSES),
  migrationDate:   z.string().optional().nullable(),
});

type FormValues = z.infer<typeof formSchema>;

const STATUS_COLORS: Record<MigrationStatus, string> = {
  Migrated: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  Pending:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  Planned:  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};

async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = await getAccessToken();
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export default function BranchMigration() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.roleName === "Admin";

  const [search, setSearch]     = useState("");
  const [status, setStatus]     = useState<string>("all");
  const [page, setPage]         = useState(1);
  const PAGE_SIZE               = 15;

  const [dialogOpen, setDialogOpen]         = useState(false);
  const [editRow, setEditRow]               = useState<BranchMigration | null>(null);
  const [deleteRow, setDeleteRow]           = useState<BranchMigration | null>(null);

  const [showKeys, setShowKeys]   = useState(false);
  const [copiedId, setCopiedId]   = useState<number | null>(null);

  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
    ...(search ? { search } : {}),
    ...(status !== "all" ? { status } : {}),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["branch-migration", search, status, page],
    queryFn:  () => apiFetch(`/api/admin/branch-migration?${params}`),
  });

  const { data: apiKeysData, isLoading: keysLoading } = useQuery<{ data: ApiKey[] }>({
    queryKey: ["api-keys"],
    queryFn:  () => apiFetch("/api/api-keys"),
    enabled:  showKeys,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      branchcode: "", branchname: "", defaultcode: "", email: "",
      address1: "", ccity: "", npincode: "",
      migrationStatus: "Pending", migrationDate: "",
    },
  });

  function openCreate() {
    setEditRow(null);
    form.reset({
      branchcode: "", branchname: "", defaultcode: "", email: "",
      address1: "", ccity: "", npincode: "",
      migrationStatus: "Pending", migrationDate: "",
    });
    setDialogOpen(true);
  }

  function openEdit(row: BranchMigration) {
    setEditRow(row);
    form.reset({
      branchcode:      row.branchcode,
      branchname:      row.branchname ?? "",
      defaultcode:     row.defaultcode ?? "",
      email:           row.email ?? "",
      address1:        row.address1 ?? "",
      ccity:           row.ccity ?? "",
      npincode:        row.npincode ?? "",
      migrationStatus: row.migrationStatus,
      migrationDate:   row.migrationDate ?? "",
    });
    setDialogOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = { ...values, email: values.email || null, migrationDate: values.migrationDate || null };
      if (editRow) {
        return apiFetch(`/api/admin/branch-migration/${encodeURIComponent(editRow.branchcode)}`, {
          method: "PUT", body: JSON.stringify(payload),
        });
      }
      return apiFetch("/api/admin/branch-migration", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: () => {
      toast.success(editRow ? "Branch updated." : "Branch created.");
      qc.invalidateQueries({ queryKey: ["branch-migration"] });
      setDialogOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (branchcode: string) =>
      apiFetch(`/api/admin/branch-migration/${encodeURIComponent(branchcode)}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Branch deleted.");
      qc.invalidateQueries({ queryKey: ["branch-migration"] });
      setDeleteRow(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows: BranchMigration[]  = data?.data ?? [];
  const total: number            = data?.total ?? 0;
  const totalPages               = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function handleSearchChange(v: string) { setSearch(v); setPage(1); }
  function handleStatusChange(v: string) { setStatus(v); setPage(1); }

  async function copyPrefix(key: ApiKey) {
    await navigator.clipboard.writeText(key.keyPrefix + "...");
    setCopiedId(key.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <GitBranch className="h-6 w-6 text-primary" />
            Branch Migration
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track and manage branch migration status to the Data Warehouse.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Add Branch
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search branch code, name, city…"
                className="pl-9"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
            </div>
            <Select value={status} onValueChange={handleStatusChange}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {MIGRATION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Branches
            {total > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">({total} total)</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Branch Code</TableHead>
                  <TableHead>Branch Name</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Migration Status</TableHead>
                  <TableHead>Migration Date</TableHead>
                  <TableHead>Updated By</TableHead>
                  {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: isAdmin ? 8 : 7 }).map((__, j) => (
                        <TableCell key={j}><div className="h-4 bg-muted rounded animate-pulse w-24" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isAdmin ? 8 : 7} className="text-center py-10 text-muted-foreground">
                      No branches found.
                    </TableCell>
                  </TableRow>
                ) : rows.map((row) => (
                  <TableRow key={row.branchcode}>
                    <TableCell className="font-mono font-medium">{row.branchcode}</TableCell>
                    <TableCell>{row.branchname ?? "—"}</TableCell>
                    <TableCell>{row.ccity ?? "—"}</TableCell>
                    <TableCell className="max-w-[160px] truncate">{row.email ?? "—"}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLORS[row.migrationStatus]}>
                        {row.migrationStatus}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.migrationDate ? formatDate(row.migrationDate) : "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{row.updatedBy}</TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(row)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteRow(row)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* API Keys section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" />
                External API Access
              </CardTitle>
              <CardDescription className="mt-1">
                API keys used by integration partners to query branch migration status via{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">GET /api/v1/branch-migration?branchcode=…</code>
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowKeys(v => !v)}>
              {showKeys ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
              {showKeys ? "Hide Keys" : "View API Keys"}
            </Button>
          </div>
        </CardHeader>

        {showKeys && (
          <CardContent>
            {keysLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading API keys…
              </div>
            ) : !apiKeysData?.data?.length ? (
              <div className="text-sm text-muted-foreground">
                No API keys found. Generate one from the{" "}
                <a href="/links" className="underline">URL Shortener / API Keys</a> page.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Key Prefix</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Used</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apiKeysData.data.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="font-medium">{k.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-muted px-2 py-1 rounded font-mono">{k.keyPrefix}…</code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => copyPrefix(k)}
                          >
                            {copiedId === k.id
                              ? <CheckCircle2 className="h-3 w-3 text-green-500" />
                              : <Copy className="h-3 w-3" />}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={k.isActive
                          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                          : "bg-muted text-muted-foreground"}>
                          {k.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {k.lastUsedAt ? formatDate(k.lastUsedAt) : "Never"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {k.expiresAt ? formatDate(k.expiresAt) : "No expiry"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(k.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="text-xs text-muted-foreground mt-3">
              Full key values are never displayed after generation. Manage keys in the{" "}
              <a href="/links" className="underline">API Keys</a> section.
            </p>
          </CardContent>
        )}
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editRow ? "Edit Branch" : "Add Branch"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="branchcode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Branch Code *</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} disabled={!!editRow} placeholder="BR001" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="defaultcode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default Code</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} placeholder="Optional" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="branchname"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Branch Name</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} placeholder="Full branch name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} type="email" placeholder="branch@example.com" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="address1"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} placeholder="Street address" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="ccity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} placeholder="City" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="npincode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>PIN Code</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} placeholder="000000" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="migrationStatus"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Migration Status *</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {MIGRATION_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="migrationDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Migration Date</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} type="date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {editRow ? "Save Changes" : "Create Branch"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteRow} onOpenChange={(o) => { if (!o) setDeleteRow(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Branch</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete branch{" "}
              <strong>{deleteRow?.branchcode}</strong>
              {deleteRow?.branchname ? ` (${deleteRow.branchname})` : ""}?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteRow && deleteMutation.mutate(deleteRow.branchcode)}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
