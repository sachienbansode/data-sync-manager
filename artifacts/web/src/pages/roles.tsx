import { useState } from "react";
import {
  useListRoles,
  useGetRolePagePermissions,
  useUpdateRolePagePermissions,
  getGetRolePagePermissionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { getAccessToken } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Shield, ShieldAlert, Users, Save, Plus, Pencil, Trash2, Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";

const BASE = import.meta.env.BASE_URL;

async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = getAccessToken();
  const resp = await fetch(`${BASE}api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((opts.headers as Record<string, string>) ?? {}),
    },
  });
  if (resp.status === 204) return null;
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

const roleFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(60),
  description: z.string().max(200).default(""),
  mfaRequired: z.boolean().default(false),
});
type RoleForm = z.infer<typeof roleFormSchema>;

type RoleItem = {
  id: number;
  name: string;
  description: string;
  mfaRequired: boolean;
  userCount: number;
};

function RoleDialog({
  open,
  onOpenChange,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing?: RoleItem;
  onSaved: () => void;
}) {
  const form = useForm<RoleForm>({
    resolver: zodResolver(roleFormSchema),
    values: existing
      ? { name: existing.name, description: existing.description, mfaRequired: existing.mfaRequired }
      : { name: "", description: "", mfaRequired: false },
  });

  const mutation = useMutation({
    mutationFn: (data: RoleForm) =>
      existing
        ? apiFetch(`/roles/${existing.id}`, { method: "PUT", body: JSON.stringify(data) })
        : apiFetch("/roles", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      toast.success(existing ? "Role updated" : "Role created");
      onSaved();
      onOpenChange(false);
      form.reset();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Role" : "Create Role"}</DialogTitle>
          <DialogDescription>
            {existing
              ? "Update the role name, description, and MFA requirement."
              : "Create a new role. You can configure page permissions after creation."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4 pt-2">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Role Name</FormLabel>
                <FormControl><Input placeholder="e.g. Manager" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description <span className="text-muted-foreground font-normal text-xs">(optional)</span></FormLabel>
                <FormControl><Input placeholder="Brief description of this role" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="mfaRequired" render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                <div>
                  <FormLabel className="flex items-center gap-2">
                    <Lock className="h-4 w-4 text-primary" />
                    Require MFA
                  </FormLabel>
                  <FormDescription className="text-xs mt-1">
                    Users in this role must enroll in two-factor authentication.
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )} />
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {existing ? "Save Changes" : "Create Role"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function Roles() {
  const queryClient = useQueryClient();
  const { data: roles, isLoading: isLoadingRoles } = useListRoles();
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editRole, setEditRole] = useState<RoleItem | null>(null);
  const [deleteRole, setDeleteRole] = useState<RoleItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: permissions, isLoading: isLoadingPermissions } = useGetRolePagePermissions(
    selectedRoleId!,
    { query: { queryKey: getGetRolePagePermissionsQueryKey(selectedRoleId!), enabled: !!selectedRoleId } }
  );

  const updatePermissionsMutation = useUpdateRolePagePermissions();
  const [pendingChanges, setPendingChanges] = useState<Record<string, boolean>>({});

  const handleRoleSelect = (id: number) => {
    if (id !== selectedRoleId) {
      setSelectedRoleId(id);
      setPendingChanges({});
    }
  };

  const handlePermissionToggle = (pagePath: string, canAccess: boolean) => {
    setPendingChanges(prev => ({ ...prev, [pagePath]: canAccess }));
  };

  const handleSave = async () => {
    if (!selectedRoleId || !permissions) return;
    const updatedPermissions = permissions.map(p => ({
      pagePath: p.pagePath,
      canAccess: pendingChanges[p.pagePath] !== undefined ? pendingChanges[p.pagePath] : p.canAccess,
    }));
    try {
      await updatePermissionsMutation.mutateAsync({ id: selectedRoleId, data: { permissions: updatedPermissions } });
      queryClient.invalidateQueries({ queryKey: getGetRolePagePermissionsQueryKey(selectedRoleId) });
      setPendingChanges({});
      toast.success("Role permissions updated");
    } catch {
      toast.error("Failed to update permissions");
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteRole) return;
    setIsDeleting(true);
    try {
      await apiFetch(`/roles/${deleteRole.id}`, { method: "DELETE" });
      toast.success(`Role "${deleteRole.name}" deleted`);
      if (selectedRoleId === deleteRole.id) setSelectedRoleId(null);
      queryClient.invalidateQueries({ queryKey: ["listRoles"] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setIsDeleting(false);
      setDeleteRole(null);
    }
  };

  const handleRoleSaved = () => {
    queryClient.invalidateQueries({ queryKey: ["listRoles"] });
  };

  const hasChanges = Object.keys(pendingChanges).length > 0;
  const selectedRole = roles?.find(r => r.id === selectedRoleId) as RoleItem | undefined;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Roles & Permissions</h1>
          <p className="text-muted-foreground mt-2">Create roles, set MFA requirements, and manage page access.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Role
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1 h-[600px] flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center text-lg">
              <Shield className="h-5 w-5 mr-2 text-primary" />
              Roles
            </CardTitle>
            <CardDescription>Select a role to view or edit permissions.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 p-0">
            <ScrollArea className="h-full px-4 pb-4">
              <div className="space-y-2">
                {isLoadingRoles ? (
                  Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
                ) : (
                  (roles as RoleItem[] | undefined)?.map((role) => (
                    <div
                      key={role.id}
                      className={`rounded-lg border transition-all ${
                        selectedRoleId === role.id
                          ? "bg-primary/5 border-primary/20 shadow-sm"
                          : "bg-card border-border hover:bg-muted/50"
                      }`}
                    >
                      <button
                        onClick={() => handleRoleSelect(role.id)}
                        className="w-full flex flex-col text-left px-4 py-3"
                      >
                        <div className="flex items-center justify-between w-full mb-1">
                          <span className={`font-semibold text-sm ${selectedRoleId === role.id ? "text-primary" : ""}`}>
                            {role.name}
                          </span>
                          <div className="flex items-center text-xs text-muted-foreground">
                            <Users className="h-3 w-3 mr-1" />
                            {role.userCount}
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground line-clamp-1">{role.description}</span>
                        {role.mfaRequired && (
                          <Badge variant="outline" className="mt-2 w-fit text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/20 gap-1">
                            <Lock className="h-2.5 w-2.5" />MFA Required
                          </Badge>
                        )}
                      </button>
                      <div className="flex items-center gap-1 px-3 pb-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setEditRole(role)}
                        >
                          <Pencil className="h-3 w-3 mr-1" />Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteRole(role)}
                          disabled={role.userCount > 0}
                          title={role.userCount > 0 ? "Reassign users first" : undefined}
                        >
                          <Trash2 className="h-3 w-3 mr-1" />Delete
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="md:col-span-2 h-[600px] flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
            <div>
              <CardTitle className="flex items-center text-lg">
                <ShieldAlert className="h-5 w-5 mr-2 text-primary" />
                Page Access
              </CardTitle>
              <CardDescription>
                {selectedRole
                  ? `Configure page access for "${selectedRole.name}"`
                  : "Select a role to configure permissions"}
              </CardDescription>
            </div>
            {selectedRoleId && (
              <Button
                onClick={handleSave}
                disabled={!hasChanges || updatePermissionsMutation.isPending}
                size="sm"
              >
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex-1 p-0 relative">
            {!selectedRoleId ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
                <Shield className="h-12 w-12 mb-4 opacity-20" />
                <p>Select a role from the sidebar to view and manage its permissions.</p>
              </div>
            ) : isLoadingPermissions ? (
              <div className="p-6 space-y-4">
                {Array(5).fill(0).map((_, i) => (
                  <div key={i} className="flex items-center justify-between p-4 border rounded-lg">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-6 w-10 rounded-full" />
                  </div>
                ))}
              </div>
            ) : (
              <ScrollArea className="h-full p-6">
                <div className="space-y-3">
                  {permissions?.map((permission) => {
                    const isChecked = pendingChanges[permission.pagePath] !== undefined
                      ? pendingChanges[permission.pagePath]
                      : permission.canAccess;
                    const isChanged = pendingChanges[permission.pagePath] !== undefined;
                    return (
                      <div
                        key={permission.id}
                        className={`flex items-center justify-between p-4 border rounded-lg transition-colors ${
                          isChanged ? "bg-muted/30 border-primary/30" : "bg-card"
                        }`}
                      >
                        <div>
                          <p className="font-medium text-sm">{permission.pageName}</p>
                          <p className="text-xs text-muted-foreground font-mono mt-1">{permission.pagePath}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          {isChanged && <span className="text-[10px] uppercase font-bold text-primary mr-2">Modified</span>}
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={(checked) => handlePermissionToggle(permission.pagePath, checked as boolean)}
                            className="h-5 w-5"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <RoleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={handleRoleSaved}
      />
      {editRole && (
        <RoleDialog
          open={!!editRole}
          onOpenChange={(v) => !v && setEditRole(null)}
          existing={editRole}
          onSaved={handleRoleSaved}
        />
      )}

      <AlertDialog open={!!deleteRole} onOpenChange={(v) => !v && setDeleteRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role "{deleteRole?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the role and all its page permission settings.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete Role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
