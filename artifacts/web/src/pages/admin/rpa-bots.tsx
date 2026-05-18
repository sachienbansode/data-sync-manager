import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAccessToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Bot, Plus, Play, Trash2, Pencil, ChevronDown, ChevronUp,
  Loader2, CheckCircle2, XCircle, Clock, AlertTriangle,
  Terminal, Key, List, History, RotateCcw, EyeOff,
  CalendarClock, Image, ExternalLink, Mail, Settings,
} from "lucide-react";
import { toast } from "sonner";

// ── API helper ────────────────────────────────────────────────────────────────
async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = getAccessToken();
  const resp = await fetch(`${import.meta.env.BASE_URL}api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((opts.headers as Record<string, string>) ?? {}),
    },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((data as { error?: string }).error ?? "Request failed");
  return data;
}

// ── Types ─────────────────────────────────────────────────────────────────────
type BotType = "browser_automation" | "file_processing" | "web_scraping";
type RunStatus = "pending" | "running" | "success" | "failed";
type StepType = "navigate" | "fill" | "click" | "wait" | "extract" | "screenshot" | "select" | "key_press" | "scroll" | "hover";
type NotifyOn = "never" | "always" | "on_failure";

interface RpaBot {
  id: number;
  name: string;
  description: string | null;
  botType: BotType;
  isActive: boolean;
  notifyEmail: string | null;
  notifyOn: NotifyOn;
  createdAt: string;
  scheduleActive: boolean;
  scheduleCronExpr: string | null;
  scheduleLastRunAt: string | null;
  scheduleNextRunAt: string | null;
}

interface RpaBotStep {
  id: number;
  botId: number;
  stepOrder: number;
  stepType: StepType;
  config: Record<string, unknown>;
  description: string | null;
}

interface RpaBotCredential {
  id: number;
  botId: number;
  label: string;
  usernameSet: boolean;
  passwordSet: boolean;
  createdAt: string;
}

interface RpaBotSchedule {
  id: number;
  botId: number;
  cronExpr: string;
  isActive: boolean;
  lastRunAt: string | null;
  createdAt: string;
}

interface RpaBotRun {
  id: number;
  botId: number;
  status: RunStatus;
  triggeredByEmail: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  screenshotPath: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface LogLine {
  ts: string;
  level: string;
  message: string;
  done?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const BOT_TYPES: { value: BotType; label: string }[] = [
  { value: "browser_automation", label: "Browser Automation" },
  { value: "file_processing", label: "File Processing" },
  { value: "web_scraping", label: "Web Scraping" },
];

const STEP_TYPES: { value: StepType; label: string; hint: string }[] = [
  { value: "navigate",    label: "Navigate",      hint: '{ "url": "https://..." }' },
  { value: "fill",        label: "Fill Input",    hint: '{ "selector": "input[name=email]", "value": "..." }' },
  { value: "click",       label: "Click",         hint: '{ "selector": "button[type=submit]" }' },
  { value: "wait",        label: "Wait",          hint: '{ "selector": ".element", "ms": 2000 }' },
  { value: "extract",     label: "Extract Text",  hint: '{ "selector": "h1", "attribute": "textContent" }' },
  { value: "screenshot",  label: "Screenshot",    hint: '{ "full_page": true }' },
  { value: "select",      label: "Select Option", hint: '{ "selector": "select#type", "value": "admin" }' },
  { value: "key_press",   label: "Key Press",     hint: '{ "key": "Enter", "selector": "input" }' },
  { value: "scroll",      label: "Scroll",        hint: '{ "x": 0, "y": 500 }' },
  { value: "hover",       label: "Hover",         hint: '{ "selector": ".menu-item" }' },
];

const CRON_PRESETS = [
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Every hour",       value: "0 * * * *" },
  { label: "Every day at midnight", value: "0 0 * * *" },
  { label: "Every day at 8am", value: "0 8 * * *" },
  { label: "Every Monday at 9am", value: "0 9 * * 1" },
  { label: "Custom…",          value: "" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusBadge(status: RunStatus) {
  switch (status) {
    case "success":  return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"><CheckCircle2 className="h-3 w-3 mr-1" />Success</Badge>;
    case "failed":   return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"><XCircle className="h-3 w-3 mr-1" />Failed</Badge>;
    case "running":  return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Running</Badge>;
    default:         return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
  }
}

function botTypeBadge(type: BotType) {
  const map: Record<BotType, string> = {
    browser_automation: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    file_processing: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    web_scraping: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
  };
  const labels: Record<BotType, string> = {
    browser_automation: "Browser",
    file_processing: "File",
    web_scraping: "Scraping",
  };
  return <Badge className={map[type]}>{labels[type]}</Badge>;
}

function duration(run: RpaBotRun): string {
  if (!run.startedAt || !run.finishedAt) return "—";
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function logLevelColor(level: string) {
  switch (level) {
    case "error": return "text-red-400";
    case "warn":  return "text-yellow-400";
    case "debug": return "text-gray-500";
    default:      return "text-green-400";
  }
}

function screenshotUrl(runId: number) {
  return `${import.meta.env.BASE_URL}api/rpa/runs/${runId}/screenshot`;
}

// ── New Bot Dialog ────────────────────────────────────────────────────────────
const NOTIFY_ON_OPTIONS: { value: NotifyOn; label: string }[] = [
  { value: "never",      label: "Never" },
  { value: "always",     label: "Always (success + failure)" },
  { value: "on_failure", label: "On failure only" },
];

function NewBotDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (bot: RpaBot) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [botType, setBotType] = useState<BotType>("browser_automation");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notifyOn, setNotifyOn] = useState<NotifyOn>("never");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const bot = await apiFetch("/rpa/bots", {
        method: "POST",
        body: JSON.stringify({
          name, description, botType,
          notifyEmail: notifyEmail.trim() || null,
          notifyOn,
        }),
      });
      toast.success("Bot created");
      onCreated(bot as RpaBot);
      setName(""); setDescription(""); setBotType("browser_automation");
      setNotifyEmail(""); setNotifyOn("never");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create bot");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bot className="h-5 w-5" />New Bot</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input placeholder="My Automation Bot" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea placeholder="What does this bot do?" value={description} onChange={e => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>Bot Type</Label>
            <Select value={botType} onValueChange={v => setBotType(v as BotType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BOT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Separator />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />Email Notifications</p>
          <div className="space-y-1.5">
            <Label>Notify Email <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input type="email" placeholder="ops@example.com" value={notifyEmail} onChange={e => setNotifyEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Send notification</Label>
            <Select value={notifyOn} onValueChange={v => setNotifyOn(v as NotifyOn)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {NOTIFY_ON_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create Bot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Step Editor Dialog ────────────────────────────────────────────────────────
function StepDialog({ open, onClose, botId, step, onSaved }: {
  open: boolean; onClose: () => void; botId: number;
  step?: RpaBotStep; onSaved: () => void;
}) {
  const isEdit = !!step;
  const [stepType, setStepType] = useState<StepType>(step?.stepType ?? "navigate");
  const [configStr, setConfigStr] = useState(step ? JSON.stringify(step.config, null, 2) : "{}");
  const [description, setDescription] = useState(step?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [jsonError, setJsonError] = useState("");
  const hint = STEP_TYPES.find(s => s.value === stepType)?.hint ?? "{}";

  useEffect(() => {
    if (open && !step) { setStepType("navigate"); setConfigStr("{}"); setDescription(""); }
    else if (open && step) { setStepType(step.stepType); setConfigStr(JSON.stringify(step.config, null, 2)); setDescription(step.description ?? ""); }
  }, [open, step]);

  const validate = () => { try { JSON.parse(configStr); setJsonError(""); return true; } catch { setJsonError("Invalid JSON"); return false; } };

  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const config = JSON.parse(configStr);
      if (isEdit && step) {
        await apiFetch(`/rpa/steps/${step.id}`, { method: "PATCH", body: JSON.stringify({ stepType, config, description }) });
      } else {
        await apiFetch(`/rpa/bots/${botId}/steps`, { method: "POST", body: JSON.stringify({ stepType, config, description }) });
      }
      toast.success(isEdit ? "Step updated" : "Step added");
      onSaved(); onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? "Edit Step" : "Add Step"}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Step Type</Label>
            <Select value={stepType} onValueChange={v => setStepType(v as StepType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STEP_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Config (JSON)</Label>
              <button className="text-xs text-primary hover:underline" onClick={() => setConfigStr(hint)}>Use template</button>
            </div>
            <Textarea value={configStr} onChange={e => { setConfigStr(e.target.value); setJsonError(""); }} rows={6} className="font-mono text-xs" />
            {jsonError && <p className="text-xs text-red-500">{jsonError}</p>}
            <p className="text-xs text-muted-foreground">Example: <code className="bg-muted px-1 rounded">{hint}</code></p>
          </div>
          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input placeholder="What does this step do?" value={description} onChange={e => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{isEdit ? "Update" : "Add Step"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Add Credential Dialog ─────────────────────────────────────────────────────
function CredentialDialog({ open, onClose, botId, onSaved }: { open: boolean; onClose: () => void; botId: number; onSaved: () => void }) {
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!label.trim() || !username.trim() || !password.trim()) { toast.error("All fields required"); return; }
    setSaving(true);
    try {
      await apiFetch(`/rpa/bots/${botId}/credentials`, { method: "POST", body: JSON.stringify({ label, username, password }) });
      toast.success("Credential saved (encrypted)");
      setLabel(""); setUsername(""); setPassword("");
      onSaved(); onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Key className="h-5 w-5" />Add Credential</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">Credentials are encrypted with AES-256-GCM before storing.</p>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input placeholder='e.g. "admin" — referenced in step config as cred_label' value={label} onChange={e => setLabel(e.target.value)} />
          </div>
          <div className="space-y-1.5"><Label>Username / Email</Label><Input value={username} onChange={e => setUsername(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Password</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save Encrypted</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Screenshot Modal ──────────────────────────────────────────────────────────
function ScreenshotModal({ runId, onClose }: { runId: number; onClose: () => void }) {
  const url = `${screenshotUrl(runId)}?t=${Date.now()}`;
  const token = getAccessToken();
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (!r.ok) throw new Error("Not found"); return r.blob(); })
      .then(blob => setSrc(URL.createObjectURL(blob)))
      .catch(() => setError(true));
  }, [runId]);

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Image className="h-5 w-5" />Run #{runId} Screenshot</DialogTitle></DialogHeader>
        <div className="flex items-center justify-center min-h-40">
          {!src && !error && <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />}
          {error && <p className="text-muted-foreground">Screenshot not available</p>}
          {src && <img src={src} alt={`Run ${runId} screenshot`} className="max-w-full rounded border" />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Log Viewer ────────────────────────────────────────────────────────────────
function LogViewer({ run }: { run: RpaBotRun }) {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [showScreenshot, setShowScreenshot] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const startStream = async () => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLogs([]);
    setStreaming(true);
    const token = getAccessToken();
    try {
      const resp = await fetch(`${import.meta.env.BASE_URL}api/rpa/runs/${run.id}/stream`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: abortRef.current.signal,
      });
      if (!resp.body) { setStreaming(false); return; }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim();
          if (!line || line.startsWith(":")) continue;
          try {
            const obj = JSON.parse(line) as LogLine;
            if (obj.done) { setStreaming(false); return; }
            setLogs(prev => [...prev, obj]);
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") console.error(e);
    } finally { setStreaming(false); }
  };

  useEffect(() => { startStream(); return () => abortRef.current?.abort(); }, [run.id]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Terminal className="h-4 w-4" />
          <span>Run #{run.id}</span>
          {streaming && <><Loader2 className="h-3 w-3 animate-spin" /><span className="text-blue-500">Live</span></>}
        </div>
        <div className="flex gap-2">
          {run.screenshotPath && (
            <Button variant="outline" size="sm" onClick={() => setShowScreenshot(true)}>
              <Image className="h-3 w-3 mr-1" />Screenshot
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={startStream}><RotateCcw className="h-3 w-3 mr-1" />Reload</Button>
        </div>
      </div>
      <div className="bg-zinc-950 text-zinc-100 rounded-md font-mono text-xs p-3 h-64 overflow-y-auto">
        {logs.length === 0 && !streaming && <p className="text-zinc-500 italic">No logs yet. Click Reload if the run completed.</p>}
        {logs.map((log, i) => (
          <div key={i} className="flex gap-2 leading-5">
            <span className="text-zinc-600 shrink-0">{new Date(log.ts).toLocaleTimeString()}</span>
            <span className={`shrink-0 uppercase ${logLevelColor(log.level)}`}>[{log.level}]</span>
            <span className="break-all">{log.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {showScreenshot && <ScreenshotModal runId={run.id} onClose={() => setShowScreenshot(false)} />}
    </div>
  );
}

// ── Steps Tab ─────────────────────────────────────────────────────────────────
function StepsTab({ bot }: { bot: RpaBot }) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editStep, setEditStep] = useState<RpaBotStep | undefined>();
  const [showBulkEdit, setShowBulkEdit] = useState(false);

  const { data: steps = [], isLoading } = useQuery<RpaBotStep[]>({
    queryKey: ["rpa-steps", bot.id],
    queryFn: () => apiFetch(`/rpa/bots/${bot.id}/steps`),
  });

  const deleteStep = useMutation({
    mutationFn: (id: number) => apiFetch(`/rpa/steps/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Step deleted"); qc.invalidateQueries({ queryKey: ["rpa-steps", bot.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const moveStep = useMutation({
    mutationFn: (reordered: { id: number; stepOrder: number }[]) =>
      apiFetch(`/rpa/bots/${bot.id}/steps/reorder`, { method: "PUT", body: JSON.stringify(reordered) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rpa-steps", bot.id] }),
  });

  const swap = (i: number, j: number) => {
    const copy = [...steps];
    const reordered = copy.map((s, idx) => {
      if (idx === i) return { id: s.id, stepOrder: copy[j]!.stepOrder };
      if (idx === j) return { id: s.id, stepOrder: copy[i]!.stepOrder };
      return { id: s.id, stepOrder: s.stepOrder };
    });
    moveStep.mutate(reordered);
  };

  const refresh = () => qc.invalidateQueries({ queryKey: ["rpa-steps", bot.id] });

  if (isLoading) return <div className="flex items-center justify-center h-40"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{steps.length} step{steps.length !== 1 ? "s" : ""}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowBulkEdit(true)}>
            <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit All
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-1" />Add Step
          </Button>
        </div>
      </div>

      {steps.length === 0 ? (
        <div className="border-2 border-dashed rounded-lg p-8 text-center text-muted-foreground">
          <List className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p>No steps yet. Add your first step or use "Edit All" to paste a full JSON step list.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {steps.map((step, i) => (
            <div key={step.id} className="flex items-start gap-2 p-3 border rounded-lg bg-card hover:bg-muted/30 transition-colors group">
              <div className="text-muted-foreground text-xs w-5 pt-0.5 shrink-0 text-right font-mono">{i + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="font-mono text-xs shrink-0">{step.stepType}</Badge>
                  {step.description && <span className="text-sm font-medium truncate">{step.description}</span>}
                </div>
                {step.config && Object.keys(step.config as Record<string, unknown>).length > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                    {Object.entries(step.config as Record<string, unknown>).map(([k, v]) => {
                      const display = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
                      return (
                        <span key={k} className="text-[11px] font-mono text-muted-foreground inline-flex items-baseline gap-0.5 max-w-full">
                          <span className="text-foreground/40 shrink-0">{k}</span>
                          <span className="text-foreground/25 shrink-0">=</span>
                          <span className="text-foreground/60 truncate max-w-[220px]">{display}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon" className="h-6 w-6" disabled={i === 0} onClick={() => swap(i, i - 1)}>
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" disabled={i === steps.length - 1} onClick={() => swap(i, i + 1)}>
                  <ChevronDown className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditStep(step)}>
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => {
                  if (confirm("Delete this step?")) deleteStep.mutate(step.id);
                }}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <StepDialog open={showAdd} onClose={() => setShowAdd(false)} botId={bot.id} onSaved={refresh} />
      <StepDialog open={!!editStep} onClose={() => setEditStep(undefined)} botId={bot.id} step={editStep} onSaved={() => { refresh(); setEditStep(undefined); }} />
      <BulkEditStepsDialog open={showBulkEdit} onClose={() => setShowBulkEdit(false)} bot={bot} currentSteps={steps} onSaved={refresh} />
    </div>
  );
}

// ── Schedule Tab ──────────────────────────────────────────────────────────────
function ScheduleTab({ bot }: { bot: RpaBot }) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [cronExpr, setCronExpr] = useState("0 8 * * *");
  const [preset, setPreset] = useState("0 8 * * *");
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editCron, setEditCron] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const { data: schedules = [], isLoading } = useQuery<RpaBotSchedule[]>({
    queryKey: ["rpa-schedules", bot.id],
    queryFn: () => apiFetch(`/rpa/bots/${bot.id}/schedules`),
  });

  const invalidateSchedules = () => {
    qc.invalidateQueries({ queryKey: ["rpa-schedules", bot.id] });
    qc.invalidateQueries({ queryKey: ["rpa-bots"] });
  };

  const deleteSchedule = useMutation({
    mutationFn: (id: number) => apiFetch(`/rpa/bots/${bot.id}/schedules/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Schedule removed"); invalidateSchedules(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleSchedule = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiFetch(`/rpa/bots/${bot.id}/schedules/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
    onSuccess: () => invalidateSchedules(),
    onError: (e: Error) => toast.error(e.message),
  });

  const addSchedule = async () => {
    if (!cronExpr.trim()) { toast.error("Cron expression required"); return; }
    setSaving(true);
    try {
      await apiFetch(`/rpa/bots/${bot.id}/schedules`, { method: "POST", body: JSON.stringify({ cronExpr, isActive: true }) });
      toast.success("Schedule created");
      invalidateSchedules();
      setShowAdd(false);
      setCronExpr("0 8 * * *");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  };

  const saveEdit = async (id: number) => {
    if (!editCron.trim()) { toast.error("Cron expression required"); return; }
    setEditSaving(true);
    try {
      await apiFetch(`/rpa/bots/${bot.id}/schedules/${id}`, { method: "PATCH", body: JSON.stringify({ cronExpr: editCron }) });
      toast.success("Schedule updated");
      invalidateSchedules();
      setEditId(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setEditSaving(false); }
  };

  if (isLoading) return <div className="flex items-center justify-center h-40"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{schedules.length} schedule{schedules.length !== 1 ? "s" : ""}</p>
        <Button size="sm" onClick={() => setShowAdd(p => !p)}><Plus className="h-4 w-4 mr-1" />Add Schedule</Button>
      </div>

      {showAdd && (
        <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
          <p className="text-sm font-medium">New Schedule</p>
          <div className="space-y-1.5">
            <Label>Preset</Label>
            <Select value={preset} onValueChange={v => { setPreset(v); if (v) setCronExpr(v); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CRON_PRESETS.map(p => <SelectItem key={p.label} value={p.value || p.label}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Cron Expression</Label>
            <Input className="font-mono" value={cronExpr} onChange={e => setCronExpr(e.target.value)} placeholder="*/15 * * * *" />
            <p className="text-xs text-muted-foreground">Format: minute hour day-of-month month day-of-week. <a href="https://crontab.guru" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">crontab.guru <ExternalLink className="h-3 w-3" /></a></p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={addSchedule} disabled={saving}>{saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Create</Button>
            <Button size="sm" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {schedules.length === 0 && !showAdd ? (
        <div className="border-2 border-dashed rounded-lg p-8 text-center text-muted-foreground">
          <CalendarClock className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p>No schedules yet. Add a cron schedule to run this bot automatically.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {schedules.map(schedule => (
            <div key={schedule.id} className="border rounded-lg bg-card overflow-hidden">
              {editId === schedule.id ? (
                <div className="p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Edit cron expression</p>
                  <Input
                    className="font-mono text-sm"
                    value={editCron}
                    onChange={e => setEditCron(e.target.value)}
                    placeholder="*/15 * * * *"
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">
                    Format: minute hour day month weekday — <a href="https://crontab.guru" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">crontab.guru <ExternalLink className="h-2.5 w-2.5" /></a>
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => saveEdit(schedule.id)} disabled={editSaving}>
                      {editSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3">
                  <CalendarClock className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-mono font-medium text-sm">{schedule.cronExpr}</p>
                    <p className="text-xs text-muted-foreground">
                      {schedule.isActive ? "Active" : "Paused"} · Last run: {fmt(schedule.lastRunAt)} · Created {fmt(schedule.createdAt)}
                    </p>
                  </div>
                  <Switch
                    checked={schedule.isActive}
                    onCheckedChange={v => toggleSchedule.mutate({ id: schedule.id, isActive: v })}
                  />
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => { setEditId(schedule.id); setEditCron(schedule.cronExpr); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive shrink-0" onClick={() => deleteSchedule.mutate(schedule.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Credentials Tab ───────────────────────────────────────────────────────────
function CredentialsTab({ bot }: { bot: RpaBot }) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const { data: creds = [], isLoading } = useQuery<RpaBotCredential[]>({
    queryKey: ["rpa-creds", bot.id],
    queryFn: () => apiFetch(`/rpa/bots/${bot.id}/credentials`),
  });

  const deleteCred = useMutation({
    mutationFn: (id: number) => apiFetch(`/rpa/credentials/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Credential removed"); qc.invalidateQueries({ queryKey: ["rpa-creds", bot.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="flex items-center justify-center h-40"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{creds.length} credential{creds.length !== 1 ? "s" : ""} stored</p>
        <Button size="sm" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4 mr-1" />Add Credential</Button>
      </div>
      {creds.length === 0 ? (
        <div className="border-2 border-dashed rounded-lg p-8 text-center text-muted-foreground">
          <Key className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p>No credentials stored. Add login credentials for the bot to use.</p>
          <p className="text-xs mt-1">Reference them in step config via <code className="bg-muted px-1 rounded">cred_label</code> and <code className="bg-muted px-1 rounded">cred_field</code>.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {creds.map(cred => (
            <div key={cred.id} className="flex items-center gap-3 p-3 border rounded-lg bg-card">
              <Key className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="font-mono font-medium text-sm">{cred.label}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <EyeOff className="h-3 w-3" />
                  Username {cred.usernameSet ? "set" : "—"} · Password {cred.passwordSet ? "set" : "—"} · Added {fmt(cred.createdAt)}
                </p>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => deleteCred.mutate(cred.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <CredentialDialog open={showAdd} onClose={() => setShowAdd(false)} botId={bot.id} onSaved={() => qc.invalidateQueries({ queryKey: ["rpa-creds", bot.id] })} />
    </div>
  );
}

// ── Runs Tab ──────────────────────────────────────────────────────────────────
function RunsTab({ bot }: { bot: RpaBot }) {
  const qc = useQueryClient();
  const [activeRun, setActiveRun] = useState<RpaBotRun | null>(null);
  const [running, setRunning] = useState(false);

  const { data: runs = [], isLoading, refetch } = useQuery<RpaBotRun[]>({
    queryKey: ["rpa-runs", bot.id],
    queryFn: () => apiFetch(`/rpa/bots/${bot.id}/runs`),
    refetchInterval: (query) => {
      const data = query.state.data as RpaBotRun[] | undefined;
      return data?.some(r => r.status === "running" || r.status === "pending") ? 3000 : false;
    },
  });

  const triggerRun = async () => {
    setRunning(true);
    try {
      const run = await apiFetch(`/rpa/bots/${bot.id}/run`, { method: "POST" }) as RpaBotRun;
      toast.success("Bot run started");
      qc.invalidateQueries({ queryKey: ["rpa-runs", bot.id] });
      setActiveRun(run);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start run");
    } finally { setRunning(false); }
  };

  if (isLoading) return <div className="flex items-center justify-center h-40"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{runs.length} run{runs.length !== 1 ? "s" : ""} in history</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}><RotateCcw className="h-4 w-4 mr-1" />Refresh</Button>
          <Button size="sm" onClick={triggerRun} disabled={running || !bot.isActive}>
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}Run Now
          </Button>
        </div>
      </div>

      {activeRun && (
        <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Active: Run #{activeRun.id}</span>
            {statusBadge(runs.find(r => r.id === activeRun.id)?.status ?? activeRun.status)}
          </div>
          <LogViewer run={runs.find(r => r.id === activeRun.id) ?? activeRun} />
        </div>
      )}

      {runs.length === 0 ? (
        <div className="border-2 border-dashed rounded-lg p-8 text-center text-muted-foreground">
          <History className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p>No runs yet. Click "Run Now" to execute this bot.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {runs.map(run => (
            <div key={run.id}
              className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors hover:bg-muted/50 ${activeRun?.id === run.id ? "bg-muted/40 border-primary/30" : ""}`}
              onClick={() => setActiveRun(run)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {statusBadge(run.status)}
                  <span className="text-xs text-muted-foreground">#{run.id}</span>
                  {run.triggeredByEmail && <span className="text-xs text-muted-foreground">by {run.triggeredByEmail}</span>}
                  {run.screenshotPath && (
                    <Badge variant="outline" className="text-xs flex items-center gap-1">
                      <Image className="h-3 w-3" />screenshot
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {fmt(run.startedAt)} · {duration(run)}
                  {run.errorMessage && <span className="text-red-500 ml-2 truncate">{run.errorMessage}</span>}
                </p>
              </div>
              <Terminal className="h-4 w-4 text-muted-foreground shrink-0" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Bulk Edit Steps Dialog ─────────────────────────────────────────────────────
function BulkEditStepsDialog({ open, onClose, bot, currentSteps, onSaved }: {
  open: boolean; onClose: () => void; bot: RpaBot;
  currentSteps: RpaBotStep[]; onSaved: () => void;
}) {
  const template = currentSteps.map(s => ({ stepType: s.stepType, description: s.description ?? "", config: s.config }));
  const [json, setJson] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setJson(JSON.stringify(template, null, 2)); setJsonError(""); }
  }, [open, currentSteps.length]);

  const validate = (): { stepType: string; description: string; config: Record<string, unknown> }[] | null => {
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) { setJsonError("Must be a JSON array"); return null; }
      for (const s of parsed) {
        if (!s.stepType) { setJsonError('Each step needs a "stepType" field'); return null; }
      }
      setJsonError("");
      return parsed;
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "Invalid JSON");
      return null;
    }
  };

  const save = async () => {
    const steps = validate();
    if (!steps) return;
    setSaving(true);
    try {
      await apiFetch(`/rpa/bots/${bot.id}/steps`, {
        method: "PUT",
        body: JSON.stringify(steps.map(s => ({
          stepType: s.stepType,
          description: s.description || undefined,
          config: s.config ?? {},
        }))),
      });
      toast.success(`${steps.length} step${steps.length !== 1 ? "s" : ""} saved`);
      onSaved(); onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed to save steps"); }
    finally { setSaving(false); }
  };

  const SCHEMA_HINT = `[
  { "stepType": "navigate", "description": "Open login page", "config": { "url": "https://..." } },
  { "stepType": "fill",     "description": "Enter email",    "config": { "selector": "input[name=email]", "value": "user@example.com" } },
  { "stepType": "click",    "description": "Submit",         "config": { "selector": "button[type=submit]" } }
]`;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <List className="h-5 w-5" />Edit All Steps — {bot.name}
          </DialogTitle>
          <p className="text-sm text-muted-foreground pt-1">
            Edit the full step list as JSON. Each item needs <code className="bg-muted px-1 rounded text-xs">stepType</code>,
            optional <code className="bg-muted px-1 rounded text-xs">description</code>, and <code className="bg-muted px-1 rounded text-xs">config</code>.
            Saving will replace all existing steps atomically.
          </p>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Steps JSON Array</Label>
            <button className="text-xs text-primary hover:underline" onClick={() => { setJson(SCHEMA_HINT); setJsonError(""); }}>
              Load example
            </button>
          </div>
          <Textarea
            value={json}
            onChange={e => { setJson(e.target.value); setJsonError(""); }}
            className="font-mono text-xs min-h-[360px]"
            spellCheck={false}
          />
          {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
          <p className="text-xs text-muted-foreground">
            Valid stepType values: <code className="bg-muted px-1 rounded">navigate fill click wait extract screenshot select key_press scroll hover</code>
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save All Steps
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Bot Detail Panel ───────────────────────────────────────────────────────────
function BotDetail({ bot, onUpdated, onDeleted }: { bot: RpaBot; onUpdated: (b: RpaBot) => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(bot.name);
  const [editDesc, setEditDesc] = useState(bot.description ?? "");
  const [editNotifyEmail, setEditNotifyEmail] = useState(bot.notifyEmail ?? "");
  const [editNotifyOn, setEditNotifyOn] = useState<NotifyOn>(bot.notifyOn ?? "never");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("steps");

  const openEdit = () => {
    setEditName(bot.name);
    setEditDesc(bot.description ?? "");
    setEditNotifyEmail(bot.notifyEmail ?? "");
    setEditNotifyOn(bot.notifyOn ?? "never");
    setEditing(true);
  };

  const toggleActive = useMutation({
    mutationFn: () => apiFetch(`/rpa/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !bot.isActive }) }),
    onSuccess: (data) => { toast.success(bot.isActive ? "Bot deactivated" : "Bot activated"); onUpdated(data as RpaBot); qc.invalidateQueries({ queryKey: ["rpa-bots"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteBot = useMutation({
    mutationFn: () => apiFetch(`/rpa/bots/${bot.id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Bot deleted"); qc.invalidateQueries({ queryKey: ["rpa-bots"] }); onDeleted(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveEdit = async () => {
    if (!editName.trim()) { toast.error("Name required"); return; }
    setSaving(true);
    try {
      const updated = await apiFetch(`/rpa/bots/${bot.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName,
          description: editDesc,
          notifyEmail: editNotifyEmail.trim() || null,
          notifyOn: editNotifyOn,
        }),
      });
      onUpdated(updated as RpaBot); qc.invalidateQueries({ queryKey: ["rpa-bots"] }); setEditing(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3 shrink-0">
        {editing ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Name</Label>
              <Input value={editName} onChange={e => setEditName(e.target.value)} className="font-semibold" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Description</Label>
              <Textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={2} placeholder="What does this bot do?" />
            </div>
            <Separator />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />Email Notifications
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Notify Email</Label>
                <Input type="email" placeholder="ops@example.com" value={editNotifyEmail} onChange={e => setEditNotifyEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Send When</Label>
                <Select value={editNotifyOn} onValueChange={v => setEditNotifyOn(v as NotifyOn)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {NOTIFY_ON_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={saveEdit} disabled={saving}>{saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Save</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-lg truncate">{bot.name}</CardTitle>
              {bot.description && <CardDescription className="mt-1 line-clamp-2">{bot.description}</CardDescription>}
              <div className="flex items-center gap-2 mt-2">
                {botTypeBadge(bot.botType)}
                <Badge variant={bot.isActive ? "default" : "secondary"}>{bot.isActive ? "Active" : "Inactive"}</Badge>
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={openEdit}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleActive.mutate()} disabled={toggleActive.isPending}>
                {bot.isActive ? <AlertTriangle className="h-4 w-4 text-yellow-500" /> : <CheckCircle2 className="h-4 w-4 text-green-500" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => {
                if (confirm(`Delete "${bot.name}"? This removes all steps, runs, and logs.`)) deleteBot.mutate();
              }}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardHeader>
      <Separator />
      <CardContent className="flex-1 overflow-hidden pt-4">
        <Tabs value={tab} onValueChange={setTab} className="h-full flex flex-col">
          <TabsList className="w-full shrink-0 grid grid-cols-4">
            <TabsTrigger value="steps"><List className="h-3.5 w-3.5 mr-1" />Steps</TabsTrigger>
            <TabsTrigger value="runs"><Play className="h-3.5 w-3.5 mr-1" />Runs</TabsTrigger>
            <TabsTrigger value="schedule"><CalendarClock className="h-3.5 w-3.5 mr-1" />Schedule</TabsTrigger>
            <TabsTrigger value="credentials"><Key className="h-3.5 w-3.5 mr-1" />Creds</TabsTrigger>
          </TabsList>
          <ScrollArea className="flex-1 mt-3 pr-1">
            <div className="pr-2">
              <TabsContent value="steps"       className="mt-0"><StepsTab bot={bot} /></TabsContent>
              <TabsContent value="runs"        className="mt-0"><RunsTab bot={bot} /></TabsContent>
              <TabsContent value="schedule"    className="mt-0"><ScheduleTab bot={bot} /></TabsContent>
              <TabsContent value="credentials" className="mt-0"><CredentialsTab bot={bot} /></TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ── RPA Settings Dialog ───────────────────────────────────────────────────────
function RpaSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [intervalSec, setIntervalSec] = useState<number | "">(60);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiFetch("/admin/rpa-settings")
      .then((d: unknown) => setIntervalSec((d as { rpaNotifyIntervalSec: number }).rpaNotifyIntervalSec))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  const save = async () => {
    const val = Number(intervalSec);
    if (!Number.isInteger(val) || val < 10 || val > 3600) {
      toast.error("Interval must be between 10 and 3600 seconds");
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/admin/rpa-settings", {
        method: "PUT",
        body: JSON.stringify({ rpaNotifyIntervalSec: val }),
      });
      toast.success(`Notifier interval updated to ${val}s — takes effect on next cycle`);
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  };

  const PRESETS = [
    { label: "10 s (debug)",  value: 10 },
    { label: "30 s",           value: 30 },
    { label: "60 s (default)", value: 60 },
    { label: "5 min",          value: 300 },
    { label: "15 min",         value: 900 },
    { label: "30 min",         value: 1800 },
    { label: "1 hour",         value: 3600 },
  ];

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />RPA Settings
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Notification Poll Interval</Label>
              <p className="text-xs text-muted-foreground">
                How often the background notifier checks for completed runs and sends emails.
                Changes take effect after the current cycle finishes — no restart needed.
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Quick presets</Label>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setIntervalSec(p.value)}
                    className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                      Number(intervalSec) === p.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Custom (seconds)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={10}
                  max={3600}
                  value={intervalSec}
                  onChange={e => setIntervalSec(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-28 font-mono"
                />
                <span className="text-sm text-muted-foreground">
                  {intervalSec ? `= ${Number(intervalSec) >= 60
                    ? `${Math.floor(Number(intervalSec) / 60)}m ${Number(intervalSec) % 60 > 0 ? `${Number(intervalSec) % 60}s` : ""}`.trim()
                    : `${intervalSec}s`}` : ""}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Minimum: 10s · Maximum: 3600s (1 hour)</p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function RpaBotsPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedBot, setSelectedBot] = useState<RpaBot | null>(null);

  const { data: bots = [], isLoading } = useQuery<RpaBot[]>({
    queryKey: ["rpa-bots"],
    queryFn: () => apiFetch("/rpa/bots"),
  });

  const [seeding, setSeeding] = useState(false);
  const seedBots = async () => {
    setSeeding(true);
    try {
      const resp = await apiFetch("/rpa/seed", { method: "POST" });
      if ((resp as { message?: string }).message?.includes("skipping")) {
        toast.info("Bots already exist — seed skipped");
      } else {
        toast.success("Reference bot seeded with 15 steps");
        qc.invalidateQueries({ queryKey: ["rpa-bots"] });
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Seed failed"); }
    finally { setSeeding(false); }
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 h-full">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-8 w-8 text-primary" />RPA Bots
          </h1>
          <p className="text-muted-foreground mt-1">Automate repetitive browser tasks with configurable bots powered by Playwright.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setShowSettings(true)}>
            <Settings className="h-4 w-4 mr-1" />Settings
          </Button>
          <Button variant="outline" size="sm" onClick={seedBots} disabled={seeding}>
            {seeding ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}Seed Demo Bot
          </Button>
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4 mr-2" />New Bot
          </Button>
        </div>
      </div>

      {bots.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Bot className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold mb-1">No bots yet</h3>
            <p className="text-muted-foreground mb-4 max-w-sm">
              Create your first bot or seed the demo "Data Preview Automation" bot to explore the feature.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={seedBots} disabled={seeding}>{seeding && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Seed Demo Bot</Button>
              <Button onClick={() => setShowNew(true)}><Plus className="h-4 w-4 mr-2" />Create Bot</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">{bots.length} Bot{bots.length !== 1 ? "s" : ""}</p>
            {bots.map(bot => (
              <button key={bot.id} onClick={() => setSelectedBot(bot)}
                className={`w-full text-left p-3 border rounded-lg transition-colors hover:bg-muted/50 ${selectedBot?.id === bot.id ? "border-primary bg-primary/5" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <Bot className={`h-4 w-4 mt-0.5 shrink-0 ${bot.isActive ? "text-primary" : "text-muted-foreground"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{bot.name}</p>
                    {bot.description && <p className="text-xs text-muted-foreground truncate mt-0.5">{bot.description}</p>}
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {botTypeBadge(bot.botType)}
                      {!bot.isActive && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                      {bot.scheduleActive && (
                        <Badge className="bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400 text-xs flex items-center gap-0.5">
                          <CalendarClock className="h-2.5 w-2.5" />{bot.scheduleCronExpr}
                        </Badge>
                      )}
                    </div>
                    {bot.scheduleActive && (
                      <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                        {bot.scheduleNextRunAt && (
                          <p className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" />Next: {fmt(bot.scheduleNextRunAt)}</p>
                        )}
                        {bot.scheduleLastRunAt && (
                          <p className="flex items-center gap-1"><History className="h-2.5 w-2.5" />Last: {fmt(bot.scheduleLastRunAt)}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="lg:col-span-2">
            {selectedBot ? (
              <BotDetail bot={selectedBot} onUpdated={updated => setSelectedBot(updated)} onDeleted={() => setSelectedBot(null)} />
            ) : (
              <div className="border-2 border-dashed rounded-lg h-48 flex items-center justify-center text-muted-foreground">
                Select a bot to view details and run it.
              </div>
            )}
          </div>
        </div>
      )}

      <NewBotDialog open={showNew} onClose={() => setShowNew(false)} onCreated={bot => { qc.invalidateQueries({ queryKey: ["rpa-bots"] }); setSelectedBot(bot); }} />
      <RpaSettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
