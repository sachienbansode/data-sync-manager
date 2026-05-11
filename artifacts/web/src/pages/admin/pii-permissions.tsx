import { useState, useEffect } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, Save, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";

interface Role { id: number; name: string; }
interface PermEntry { roleId: number; fieldType: string; canUnmask: boolean; }
interface Matrix { fieldTypes: string[]; roles: Role[]; permissions: PermEntry[]; }

const FIELD_LABELS: Record<string, string> = {
  phone: "Phone Number",
  national_id: "National ID / Aadhaar",
  bank_account: "Bank Account",
  pan_number: "PAN Number",
  email_counterparty: "Counterparty Email",
  address: "Home Address",
};

export default function PiiPermissions() {
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [localPerms, setLocalPerms] = useState<Map<string, boolean>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const apiBase = `${import.meta.env.BASE_URL}api`;

  async function load() {
    setLoading(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/pii/field-permissions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load permissions");
      const data: Matrix = await res.json();
      setMatrix(data);
      const map = new Map<string, boolean>();
      data.permissions.forEach(p => map.set(`${p.roleId}:${p.fieldType}`, p.canUnmask));
      setLocalPerms(map);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function toggle(roleId: number, fieldType: string) {
    const key = `${roleId}:${fieldType}`;
    setLocalPerms(prev => {
      const next = new Map(prev);
      next.set(key, !prev.get(key));
      return next;
    });
  }

  async function save() {
    if (!matrix) return;
    setSaving(true);
    const permissions: PermEntry[] = [];
    for (const role of matrix.roles) {
      for (const ft of matrix.fieldTypes) {
        permissions.push({ roleId: role.id, fieldType: ft, canUnmask: localPerms.get(`${role.id}:${ft}`) ?? false });
      }
    }
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/pii/field-permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ permissions }),
      });
      if (!res.ok) throw new Error("Failed to save permissions");
      toast.success("PII permissions saved successfully");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">PII Field Permissions</h1>
            <p className="text-muted-foreground mt-1">
              Control which roles can unmask (reveal) each PII field type.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={save} disabled={saving || loading}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Changes
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Unmask Permissions Matrix
            </CardTitle>
            <CardDescription>
              Toggle the switches to grant or revoke a role's ability to reveal masked PII values. Changes take effect immediately after saving.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : matrix ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 pr-6 font-semibold text-muted-foreground w-48">PII Field</th>
                      {matrix.roles.map(role => (
                        <th key={role.id} className="text-center py-3 px-4 font-semibold">
                          <Badge variant="secondary">{role.name}</Badge>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.fieldTypes.map((ft, i) => (
                      <tr key={ft} className={i % 2 === 0 ? "bg-muted/30" : ""}>
                        <td className="py-3 pr-6 font-medium">
                          {FIELD_LABELS[ft] ?? ft}
                        </td>
                        {matrix.roles.map(role => {
                          const canUnmask = localPerms.get(`${role.id}:${ft}`) ?? false;
                          return (
                            <td key={role.id} className="text-center py-3 px-4">
                              <div className="flex justify-center">
                                <Switch
                                  checked={canUnmask}
                                  onCheckedChange={() => toggle(role.id, ft)}
                                  aria-label={`Allow ${role.name} to reveal ${ft}`}
                                />
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-8">No data available.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base">What does unmasking permission mean?</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              All PII fields are stored encrypted in the database using AES-256-GCM and displayed as <span className="font-mono tracking-widest">••••••••</span> in the interface.
            </p>
            <p>
              A user with "unmask" permission for a given field will see an <strong>eye icon</strong> next to the masked value. Clicking it sends a server-side decryption request — the plaintext is never stored in the frontend.
            </p>
            <p>
              Every reveal action is recorded in the Audit Log with the user's identity, the field revealed, and the target record.
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
