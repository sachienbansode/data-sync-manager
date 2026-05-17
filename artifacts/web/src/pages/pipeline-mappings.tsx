import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Loader2, Plus, Trash2, ArrowLeft, ArrowRight, GripVertical, Save,
  ChevronsUpDown, Check, Wand2, RefreshCw, AlertTriangle,
} from "lucide-react";
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
  sourceObjectId: number | null;
  destObjectId: number | null;
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

// ── FieldCombobox: searchable dropdown for a column list ──────────────────────
interface FieldComboboxProps {
  value: string;
  onChange: (v: string) => void;
  columns: string[];
  placeholder: string;
  loading?: boolean;
}
function FieldCombobox({ value, onChange, columns, placeholder, loading }: FieldComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = columns.filter(c => c.toLowerCase().includes(search.toLowerCase()));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-8 w-full justify-between font-mono text-xs px-2 truncate"
          disabled={loading}
        >
          <span className="truncate">{value || <span className="text-muted-foreground font-sans">{placeholder}</span>}</span>
          {loading
            ? <Loader2 className="h-3 w-3 ml-1 shrink-0 animate-spin" />
            : <ChevronsUpDown className="h-3 w-3 ml-1 shrink-0 opacity-50" />
          }
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search fields…"
            value={search}
            onValueChange={setSearch}
            className="h-8 text-xs"
          />
          <CommandList>
            <CommandEmpty>
              {columns.length === 0
                ? <span className="text-xs text-muted-foreground px-2">No columns loaded</span>
                : <span className="text-xs text-muted-foreground px-2">No match — type to use as custom value</span>
              }
            </CommandEmpty>
            {/* Allow typing a custom value not in the list */}
            {search && !columns.includes(search) && (
              <CommandGroup heading="Custom">
                <CommandItem
                  value={search}
                  onSelect={() => { onChange(search); setOpen(false); setSearch(""); }}
                  className="font-mono text-xs"
                >
                  <Check className={`h-3 w-3 mr-2 ${value === search ? "opacity-100" : "opacity-0"}`} />
                  {search}
                </CommandItem>
              </CommandGroup>
            )}
            {filtered.length > 0 && (
              <CommandGroup heading="Columns">
                {filtered.map(col => (
                  <CommandItem
                    key={col}
                    value={col}
                    onSelect={() => { onChange(col); setOpen(false); setSearch(""); }}
                    className="font-mono text-xs"
                  >
                    <Check className={`h-3 w-3 mr-2 ${value === col ? "opacity-100" : "opacity-0"}`} />
                    {col}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function PipelineMappings() {
  const params = useParams<{ id: string }>();
  const pipelineId = parseInt(params.id ?? "0");

  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [mappings, setMappings] = useState<FieldMapping[]>([emptyRow(0)]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [srcCols, setSrcCols] = useState<string[]>([]);
  const [dstCols, setDstCols] = useState<string[]>([]);
  const [srcLoading, setSrcLoading] = useState(false);
  const [dstLoading, setDstLoading] = useState(false);
  const [srcError, setSrcError] = useState<string | null>(null);
  const [dstError, setDstError] = useState<string | null>(null);

  const autoPopulatedRef = useRef(false);

  const token = getAccessToken();
  const hdrs = { Authorization: `Bearer ${token}` };

  const fetchColumns = useCallback(async () => {
    setSrcLoading(true);
    setSrcError(null);
    try {
      const r = await fetch(`${apiBase}/admin/pipelines/${pipelineId}/source-columns`, { headers: hdrs });
      if (r.ok) {
        const data = await r.json();
        setSrcCols(data.columns ?? []);
      } else {
        const e = await r.json();
        setSrcError(e.error ?? "Could not load source columns");
      }
    } catch {
      setSrcError("Network error loading source columns");
    } finally {
      setSrcLoading(false);
    }

    setDstLoading(true);
    setDstError(null);
    try {
      const r = await fetch(`${apiBase}/admin/pipelines/${pipelineId}/dest-columns`, { headers: hdrs });
      if (r.ok) {
        const data = await r.json();
        setDstCols(data.columns ?? []);
      } else {
        const e = await r.json();
        setDstError(e.error ?? "Could not load destination columns");
      }
    } catch {
      setDstError("Network error loading destination columns");
    } finally {
      setDstLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId, token]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId, token]);

  useEffect(() => { load(); fetchColumns(); }, [load, fetchColumns]);

  // Auto-populate source rows once columns load (only when no existing mappings)
  useEffect(() => {
    if (autoPopulatedRef.current) return;
    if (srcCols.length === 0) return;
    if (loading) return;

    const hasData = mappings.some(m => m.sourceField.trim() || m.destField.trim());
    if (!hasData) {
      autoPopulatedRef.current = true;
      setMappings(srcCols.map((col, i) => ({ ...emptyRow(i), sourceField: col })));
      toast.info(`${srcCols.length} source fields loaded — map each to a destination column`);
    }
  }, [srcCols, loading, mappings]);

  function addRow() {
    setMappings(m => [...m, emptyRow(m.length)]);
  }

  function removeRow(idx: number) {
    setMappings(m => m.filter((_, i) => i !== idx).map((r, i) => ({ ...r, sortOrder: i })));
  }

  function updateRow(idx: number, patch: Partial<FieldMapping>) {
    setMappings(m => m.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  function autoPopulate() {
    if (srcCols.length === 0) { toast.error("Source columns not loaded yet"); return; }
    autoPopulatedRef.current = true;
    setMappings(srcCols.map((col, i) => ({ ...emptyRow(i), sourceField: col })));
    toast.success(`${srcCols.length} source fields populated`);
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
        <Link href="/pipe"><Button variant="outline" className="mt-4"><ArrowLeft className="h-4 w-4 mr-2" />Back to Workflows</Button></Link>
      </div>
    );
  }

  const activeCount = mappings.filter(m => m.sourceField.trim() && m.destField.trim()).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/pipe">
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Field Mappings</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Pipeline: <span className="font-medium text-foreground">{pipeline.name}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchColumns} disabled={srcLoading || dstLoading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${srcLoading || dstLoading ? "animate-spin" : ""}`} />
          Reload Columns
        </Button>
      </div>

      {/* Column load status bar */}
      <div className="flex flex-wrap gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Source:</span>
          {srcLoading
            ? <><Loader2 className="h-3 w-3 animate-spin" /><span className="text-muted-foreground">Loading…</span></>
            : srcError
              ? <><AlertTriangle className="h-3 w-3 text-amber-500" /><span className="text-amber-600">{srcError}</span></>
              : <Badge variant="secondary" className="text-[10px] font-mono">{srcCols.length} columns</Badge>
          }
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Destination:</span>
          {dstLoading
            ? <><Loader2 className="h-3 w-3 animate-spin" /><span className="text-muted-foreground">Loading…</span></>
            : dstError
              ? <><AlertTriangle className="h-3 w-3 text-amber-500" /><span className="text-amber-600">{dstError}</span></>
              : <Badge variant="secondary" className="text-[10px] font-mono">{dstCols.length} columns</Badge>
          }
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Source → Destination Field Mapping</CardTitle>
              <CardDescription className="mt-1">
                Select source and destination fields from dropdowns. Type to search or enter a custom column name. Optionally apply a transformation.
              </CardDescription>
            </div>
            <Button
              variant="outline" size="sm"
              onClick={autoPopulate}
              disabled={srcLoading || srcCols.length === 0}
              title="Create one row per source column"
            >
              <Wand2 className="h-3.5 w-3.5 mr-1.5" />
              Auto-populate
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {/* Header row */}
            <div className="grid grid-cols-[20px_1fr_28px_1fr_130px_110px_28px] gap-2 items-center px-1 pb-1 border-b">
              <span />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Source Field</span>
              <span />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Destination Field</span>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Transform</span>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Params</span>
              <span />
            </div>

            {mappings.map((row, idx) => (
              <div key={idx} className="grid grid-cols-[20px_1fr_28px_1fr_130px_110px_28px] gap-2 items-center">
                <GripVertical className="h-4 w-4 text-muted-foreground/40 cursor-grab" />
                <FieldCombobox
                  value={row.sourceField}
                  onChange={v => updateRow(idx, { sourceField: v })}
                  columns={srcCols}
                  placeholder="Source field…"
                  loading={srcLoading}
                />
                <ArrowRight className="h-4 w-4 text-muted-foreground mx-auto" />
                <FieldCombobox
                  value={row.destField}
                  onChange={v => updateRow(idx, { destField: v })}
                  columns={dstCols}
                  placeholder="Dest field…"
                  loading={dstLoading}
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
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={row.transformParams}
                  onChange={e => updateRow(idx, { transformParams: e.target.value })}
                  placeholder={row.transformType === "date-format" ? "YYYY-MM-DD" : "—"}
                  className="font-mono text-sm h-8"
                  disabled={row.transformType !== "date-format"}
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
                {activeCount} active mapping{activeCount !== 1 ? "s" : ""}
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
        <Link href="/pipe"><Button variant="outline">Cancel</Button></Link>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save Mappings
        </Button>
      </div>
    </div>
  );
}
