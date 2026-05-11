import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, Save, ArrowRight, Shuffle } from "lucide-react";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";

interface FieldMapping {
  id?: number;
  backofficeField: string;
  tradingField: string;
  transformType: "string" | "number" | "date-format";
  transformParams: string | null;
  sortOrder: number;
}

const EMPTY_ROW = (): FieldMapping => ({
  backofficeField: "", tradingField: "", transformType: "string", transformParams: null, sortOrder: 0,
});

const apiBase = `${import.meta.env.BASE_URL}api`;

export default function FieldMappings() {
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/workflow/field-mappings`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to load mappings");
      setMappings(await res.json());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load field mappings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function addRow() {
    setMappings(prev => [...prev, { ...EMPTY_ROW(), sortOrder: prev.length }]);
  }

  function removeRow(idx: number) {
    setMappings(prev => prev.filter((_, i) => i !== idx).map((m, i) => ({ ...m, sortOrder: i })));
  }

  function updateRow(idx: number, patch: Partial<FieldMapping>) {
    setMappings(prev => prev.map((m, i) => i === idx ? { ...m, ...patch } : m));
  }

  async function save() {
    const invalid = mappings.find(m => !m.backofficeField.trim() || !m.tradingField.trim());
    if (invalid) { toast.error("All rows must have both BackOffice and Trading field names"); return; }
    setSaving(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/workflow/field-mappings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mappings: mappings.map((m, i) => ({ ...m, sortOrder: i })) }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Save failed"); }
      const updated = await res.json();
      setMappings(updated);
      toast.success("Field mappings saved");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Field Mappings</h1>
            <p className="text-muted-foreground mt-1">Map BackOffice field names to Trading application columns and configure transformations</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={addRow}>
              <Plus className="h-4 w-4 mr-2" /> Add Row
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Mappings
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Shuffle className="h-5 w-5" /> Column Mapping Rules</CardTitle>
            <CardDescription>
              These rules are applied during transformation. Rows are output in the order listed.
              Columns not in this mapping are excluded from the Trading CSV.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-[1fr_auto_1fr_auto_auto_auto] gap-2 items-center text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">
                  <span>BackOffice Field</span>
                  <span />
                  <span>Trading Field</span>
                  <span>Transform</span>
                  <span>Params</span>
                  <span />
                </div>
                {mappings.length === 0 && (
                  <div className="text-center py-10 text-muted-foreground">
                    <Shuffle className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p>No field mappings configured. Add rows to define the column mapping.</p>
                  </div>
                )}
                {mappings.map((m, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_auto_1fr_auto_auto_auto] gap-2 items-center">
                    <Input
                      value={m.backofficeField}
                      onChange={e => updateRow(idx, { backofficeField: e.target.value })}
                      placeholder="source_field"
                      className="font-mono text-sm"
                    />
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                      value={m.tradingField}
                      onChange={e => updateRow(idx, { tradingField: e.target.value })}
                      placeholder="TARGET_FIELD"
                      className="font-mono text-sm"
                    />
                    <Select value={m.transformType} onValueChange={v => updateRow(idx, { transformType: v as FieldMapping["transformType"], transformParams: null })}>
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="string">String</SelectItem>
                        <SelectItem value="number">Number</SelectItem>
                        <SelectItem value="date-format">Date Format</SelectItem>
                      </SelectContent>
                    </Select>
                    {m.transformType === "date-format" ? (
                      <Select value={m.transformParams ?? "DD/MM/YYYY"} onValueChange={v => updateRow(idx, { transformParams: v })}>
                        <SelectTrigger className="w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                          <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="w-36" />
                    )}
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => removeRow(idx)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {mappings.length > 0 && (
                  <div className="pt-3 border-t">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">{mappings.length} field mapping{mappings.length !== 1 ? "s" : ""} configured</span>
                      <Button variant="outline" size="sm" onClick={addRow}>
                        <Plus className="h-3 w-3 mr-1" /> Add Row
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Transform Types</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <Label className="text-xs font-semibold">String</Label>
                <p className="text-muted-foreground text-xs mt-1">Copies the value as-is with no conversion.</p>
              </div>
              <div>
                <Label className="text-xs font-semibold">Number</Label>
                <p className="text-muted-foreground text-xs mt-1">Parses as float, removes commas. Invalid values pass through unchanged.</p>
              </div>
              <div>
                <Label className="text-xs font-semibold">Date Format</Label>
                <p className="text-muted-foreground text-xs mt-1">Reformats a date string into the selected output format.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
  );
}
