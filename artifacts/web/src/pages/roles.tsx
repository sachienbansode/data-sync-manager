import { useState } from "react";
import { 
  useListRoles, 
  useGetRolePagePermissions,
  useUpdateRolePagePermissions
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Shield, ShieldAlert, Users, Save } from "lucide-react";
import { toast } from "sonner";
import { getGetRolePagePermissionsQueryKey } from "@workspace/api-client-react";


export default function Roles() {
  const queryClient = useQueryClient();
  const { data: roles, isLoading: isLoadingRoles } = useListRoles();
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);

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
    
    // Merge existing permissions with pending changes
    const updatedPermissions = permissions.map(p => ({
      pagePath: p.pagePath,
      canAccess: pendingChanges[p.pagePath] !== undefined ? pendingChanges[p.pagePath] : p.canAccess
    }));

    try {
      await updatePermissionsMutation.mutateAsync({
        id: selectedRoleId,
        data: { permissions: updatedPermissions }
      });
      
      queryClient.invalidateQueries({ queryKey: getGetRolePagePermissionsQueryKey(selectedRoleId) });
      setPendingChanges({});
      toast.success("Role permissions updated successfully");
    } catch (err) {
      toast.error("Failed to update permissions");
    }
  };

  const hasChanges = Object.keys(pendingChanges).length > 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Roles & Permissions</h1>
        <p className="text-muted-foreground mt-2">Manage access control matrices for all platform roles.</p>
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
                  Array(4).fill(0).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))
                ) : (
                  roles?.map((role) => (
                    <button
                      key={role.id}
                      onClick={() => handleRoleSelect(role.id)}
                      className={`w-full flex flex-col text-left px-4 py-3 rounded-lg border transition-all ${
                        selectedRoleId === role.id 
                          ? "bg-primary/5 border-primary/20 shadow-sm" 
                          : "bg-card border-border hover:bg-muted/50"
                      }`}
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
                    </button>
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
                Access Matrix
              </CardTitle>
              <CardDescription>
                {selectedRoleId 
                  ? `Configure page access for ${roles?.find(r => r.id === selectedRoleId)?.name}`
                  : "Select a role to configure permissions"
                }
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
                    <div className="space-y-1">
                      <Skeleton className="h-5 w-32" />
                      <Skeleton className="h-4 w-24" />
                    </div>
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
    </div>
  );
}
