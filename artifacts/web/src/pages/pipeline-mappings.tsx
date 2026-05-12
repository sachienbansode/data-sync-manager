import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, ArrowLeft, ArrowRight, GripVertical, Save } from "lucide-react";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";

type TransformType = "passthrough" | "string" | "number" | "date-format" | "boolean";

interface FieldMapping {
  id?: number;
  sourceField: string;
  destField: string;
  transformType: TransformType;
  transformParams: string;
  sortOrder: number;
}

interface Pipeline {
  id: number;
  name: string;
  sourceConnectionId: number | null;
  destConnectionId: number | null;
}

const TRANSFORM_OPTIONS: { value: TransformType; label: string; hint: string }[] = [
  { value: "passthrough", label: "Passthrough", hint: "Copy value as-is" },
  { value: "string",      label: "To String",   hint: "Convert value to string" },
  { value: "number",      label: "To Number",   hint: "Parse as float/integer" },
  { value: "date-format", label: "Date Format",  hint: "Reformat date (e.g. YYYY-MM-DD)" },
  { value: "boolean",     label: "To Boolean",  hint: "truthy/falsy conversion" },
];

const apiBase = `${import.meta.env.BASE_URL}api`;

function emptyRow(order: number): FieldMapping {
  return { sourceField: "", destField: "", transformType: "passthrough", transformParams: "", sortOrder: order };
}

export default function PipelineMappings() {
  const params = useParams<{ id: string }>();
  const pipelineId = parseInt(params.id ?? "0");

  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [mappings, setMappings] = useState<FieldMapping[]>([emptyRow(0)]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const token = getAccessToken();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const hdrs = { Authorization: `Bearer ${token}` };
      const [pRes, mRes] = await Promise.all([
        fetch(`${apiBase}/admin/pipelines/${pipelineId}`, { headers: hdrs }),
        fetch(`${apiBase}/admin/pipelines/${pipelineId}/mappings`, { headers: hdrs }),
      ]);
      if (!pRes.ok) throw new Error("Pipeline not found");
      const pData = await pRes.json();
      const mData = mRes.ok ? await mRes.json() : [];
      setPipeline(pData);
      setMappings(
        mData.length > 0
          ? mData.map((m: FieldMapping) => ({ ...m, transformParams: m.transformParams ?? "" }))
          : [emptyRow(0)]
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [pipelineId, token]);

  useEffect(() => { load(); }, [load]);

  function addRow() {
    setMappings(m => [...m, emptyRow(m.length)]);
  }

  function removeRow(idx: number) {
    setMappings(m => m.filter((_, i) => i !== idx).map((r, i) => ({ ...r, sortOrder: i })));
  }

  function updateRow(idx: number, patch: Partial<FieldMapping>) {
    setMappings(m => m.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  async function save() {
    const valid = mappings.filter(m => m.sourceField.trim() && m.destField.trim());
    if (valid.length === 0 && mappings.some(m => m.sourceField || m.destField)) {
      toast.error("Fill in both source and destination fields for each mapping");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/admin/pipelines/${pipelineId}/mappings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          mappings: valid.map((m, i) => ({
            sourceField: m.sourceField.trim(),
            destField: m.destField.trim(),
            transformType: m.transformType,
            transformParams: m.transformParams.trim() || undefined,
            sortOrder: i,
          })),
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Save failed"); }
      toast.success(`${valid.length} field mapping${valid.length !== 1 ? "s" : ""} saved`);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!pipeline) {
    return (
      <div className="text-center py-24 text-muted-foreground">
        <p>Pipeline not found.</p>
        <Link href="/workflow"><Button variant="outline" className="mt-4"><ArrowLeft className="h-4 w-4 mr-2" />Back to Workflows</Button></Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/workflow">
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Field Mappings</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Pipeline: <span className="font-medium text-foreground">{pipeline.name}</span>
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Source → Destination Field Mapping</CardTitle>
          <CardDescription>
            Map each source field to its corresponding destination field. Optionally apply a transformation.
            Blank rows are ignored on save.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {/* Header row */}
            <div className="grid grid-cols-[24px_1fr_32px_1fr_140px_120px_32px] gap-2 items-center px-1 pb-1 border-b">
              <span />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Source Field</span>
              <span />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Destination Field</span>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Transform</span>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Params</span>
              <span />
            </div>

            {mappings.map((row, idx) => (
              <div key={idx} className="grid grid-cols-[24px_1fr_32px_1fr_140px_120px_32px] gap-2 items-center">
                <GripVertical className="h-4 w-4 text-muted-foreground/40 cursor-grab" />
                <Input
                  value={row.sourceField}
                  onChange={e => updateRow(idx, { sourceField: e.target.value })}
                  placeholder="source_field"
                  className="font-mono text-sm h-8"
                />
                <ArrowRight className="h-4 w-4 text-muted-foreground mx-auto" />
                <Input
                  value={row.destField}
                  onChange={e => updateRow(idx, { destField: e.target.value })}
                  placeholder="dest_field"
                  className="font-mono text-sm h-8"
                />
                <Select
                  value={row.transformType}
                  onValueChange={v => updateRow(idx, { transformType: v as TransformType, transformParams: "" })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRANSFORM_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <span>{opt.label}</span>
                        <span className="ml-2 text-muted-foreground text-xs hidden sm:inline">— {opt.hint}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={row.transformParams}
                  onChange={e => updateRow(idx, { transformParams: e.target.value })}
                  placeholder={row.transformType === "date-format" ? "YYYY-MM-DD" : "—"}
                  className="font-mono text-sm h-8"
                  disabled={row.transformType === "passthrough" || row.transformType === "string" || row.transformType === "boolean" || row.transformType === "number"}
                />
                <Button
                  variant="ghost" size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => removeRow(idx)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}

            <div className="flex items-center gap-3 pt-2">
              <Button variant="outline" size="sm" onClick={addRow}>
                <Plus className="h-4 w-4 mr-1" /> Add Row
              </Button>
              <span className="text-xs text-muted-foreground">
                {mappings.filter(m => m.sourceField.trim() && m.destField.trim()).length} active mapping{mappings.filter(m => m.sourceField.trim() && m.destField.trim()).length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick reference */}
      <Card className="bg-muted/30">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm">Transform Reference</CardTitle>
        </CardHeader>
        <CardContent className="py-2 px-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-xs text-muted-foreground">
            {TRANSFORM_OPTIONS.map(opt => (
              <div key={opt.value} className="flex items-start gap-2">
                <span className="font-mono font-medium text-foreground w-24 shrink-0">{opt.label}</span>
                <span>{opt.hint}</span>
              </div>
            ))}
            <div className="flex items-start gap-2 sm:col-span-2">
              <span className="font-mono font-medium text-foreground w-24 shrink-0">date-format</span>
              <span>Use Params to specify the output format, e.g. <code className="font-mono bg-muted px-1 rounded">YYYY-MM-DD</code> or <code className="font-mono bg-muted px-1 rounded">DD/MM/YYYY HH:mm</code></span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Link href="/workflow"><Button variant="outline">Cancel</Button></Link>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save Mappings
        </Button>
      </div>
    </div>
  );
}
