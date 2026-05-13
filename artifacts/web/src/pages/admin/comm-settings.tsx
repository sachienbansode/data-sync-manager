import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";
import { Save, CheckCircle, AlertCircle, Mail, Key, Server } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

async function apiFetch(path: string, options?: RequestInit) {
  const token = getAccessToken();
  const res = await fetch(`${BASE}api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options?.headers },
  });
  if (!res.ok) { const e = await res.json().catch(() => ({ error: res.statusText })); throw new Error(e.error ?? "Request failed"); }
  return res.json();
}

interface CommSettings {
  apiKeySet: boolean; apiKeyPrefix: string | null;
  apiUrl: string | null; senderEmail: string | null; senderName: string | null;
  maxAttachmentSizeMb: number; maxRecipientsPerBatch: number;
  webhookSecretSet: boolean; isEnabled: boolean; updatedAt: string;
}

export default function CommSettings() {
  const qc = useQueryClient();
  const [form, setForm] = useState<{
    apiKey: string; apiUrl: string; senderEmail: string; senderName: string;
    maxAttachmentSizeMb: string; maxRecipientsPerBatch: string;
    webhookSecret: string; isEnabled: boolean;
  } | null>(null);

  const { data: settings, isLoading } = useQuery<CommSettings>({
    queryKey: ["comm-settings"],
    queryFn: () => apiFetch("/admin/comm-settings"),
  });

  useEffect(() => {
    if (settings && !form) {
      setForm({
        apiKey: "", apiUrl: settings.apiUrl ?? "https://emailapi.netcorecloud.net/v5.1/mail/send",
        senderEmail: settings.senderEmail ?? "", senderName: settings.senderName ?? "",
        maxAttachmentSizeMb: String(settings.maxAttachmentSizeMb),
        maxRecipientsPerBatch: String(settings.maxRecipientsPerBatch),
        webhookSecret: "", isEnabled: settings.isEnabled,
      });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) => apiFetch("/admin/comm-settings", { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["comm-settings"] }); toast.success("Settings saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !form) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const displayForm = form ?? {
    apiKey: "", apiUrl: settings?.apiUrl ?? "", senderEmail: settings?.senderEmail ?? "",
    senderName: settings?.senderName ?? "", maxAttachmentSizeMb: String(settings?.maxAttachmentSizeMb ?? 10),
    maxRecipientsPerBatch: String(settings?.maxRecipientsPerBatch ?? 50), webhookSecret: "", isEnabled: settings?.isEnabled ?? false,
  };

  const webhookUrl = `${window.location.origin}${BASE}api/webhooks/netcore`;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Bulk Email Settings</h1>
        <p className="text-sm text-muted-foreground">Configure Netcore Cloud API for bulk email sending</p>
      </div>

      {/* Status banner */}
      <Card className={settings?.isEnabled && settings?.apiKeySet ? "border-green-500/30 bg-green-500/5" : "border-orange-500/30 bg-orange-500/5"}>
        <CardContent className="flex items-center gap-3 py-4">
          {settings?.isEnabled && settings?.apiKeySet
            ? <><CheckCircle className="h-5 w-5 text-green-600" /><p className="text-sm text-green-700 dark:text-green-400">Netcore integration is <strong>active</strong>. Campaigns can be sent.</p></>
            : <><AlertCircle className="h-5 w-5 text-orange-500" /><p className="text-sm text-orange-700 dark:text-orange-400">{!settings?.apiKeySet ? "API key not set — campaigns cannot send." : "Integration is disabled — enable it to send campaigns."}</p></>}
        </CardContent>
      </Card>

      {/* API Key */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Key className="h-4 w-4" />API Authentication</CardTitle>
          <CardDescription>Your Netcore Cloud API key for authentication</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Netcore API Key {settings?.apiKeySet && <Badge variant="outline" className="ml-2 text-[10px] text-green-600 border-green-300">Set — prefix: {settings.apiKeyPrefix}</Badge>}</Label>
            <Input type="password" placeholder={settings?.apiKeySet ? "Enter new key to replace…" : "Paste your Netcore API key"} value={displayForm.apiKey} onChange={e => setForm(f => f ? { ...f, apiKey: e.target.value } : f)} />
            <p className="text-[11px] text-muted-foreground">Leave blank to keep the existing key.</p>
          </div>
          <div className="flex items-center gap-3 p-3 border rounded-lg">
            <div className="flex-1">
              <p className="text-sm font-medium">Enable Integration</p>
              <p className="text-xs text-muted-foreground">Toggle to activate or pause all bulk email sending</p>
            </div>
            <Switch checked={displayForm.isEnabled} onCheckedChange={v => setForm(f => f ? { ...f, isEnabled: v } : f)} />
          </div>
        </CardContent>
      </Card>

      {/* Sender & API config */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Mail className="h-4 w-4" />Sender & Endpoint</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Sender Name</Label>
              <Input placeholder="Ashika Group" value={displayForm.senderName} onChange={e => setForm(f => f ? { ...f, senderName: e.target.value } : f)} />
            </div>
            <div className="space-y-1">
              <Label>Sender Email</Label>
              <Input placeholder="noreply@ashikagroup.com" value={displayForm.senderEmail} onChange={e => setForm(f => f ? { ...f, senderEmail: e.target.value } : f)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>API Endpoint URL</Label>
            <Input value={displayForm.apiUrl} onChange={e => setForm(f => f ? { ...f, apiUrl: e.target.value } : f)} />
            <p className="text-[11px] text-muted-foreground">Default: https://emailapi.netcorecloud.net/v5.1/mail/send</p>
          </div>
        </CardContent>
      </Card>

      {/* Limits */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Server className="h-4 w-4" />Sending Limits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Max Attachment Size (MB)</Label>
              <Input type="number" min="1" max="25" value={displayForm.maxAttachmentSizeMb} onChange={e => setForm(f => f ? { ...f, maxAttachmentSizeMb: e.target.value } : f)} />
            </div>
            <div className="space-y-1">
              <Label>Recipients per Batch</Label>
              <Input type="number" min="1" max="200" value={displayForm.maxRecipientsPerBatch} onChange={e => setForm(f => f ? { ...f, maxRecipientsPerBatch: e.target.value } : f)} />
              <p className="text-[11px] text-muted-foreground">Max recipients per Netcore API call</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Webhook */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Delivery Webhooks</CardTitle>
          <CardDescription>Configure Netcore to post delivery events to this URL</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Webhook Receiver URL</Label>
            <div className="flex gap-2">
              <Input value={webhookUrl} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success("Copied"); }}>Copy</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Add this URL to your Netcore account's webhook settings. Events: delivered, bounced, opened, clicked, unsubscribed, spam.</p>
          </div>
          <div className="space-y-1">
            <Label>Webhook Secret {settings?.webhookSecretSet && <Badge variant="outline" className="ml-2 text-[10px] text-green-600 border-green-300">Set</Badge>}</Label>
            <Input type="password" placeholder={settings?.webhookSecretSet ? "Enter new secret to replace…" : "Optional shared secret for request validation"} value={displayForm.webhookSecret} onChange={e => setForm(f => f ? { ...f, webhookSecret: e.target.value } : f)} />
          </div>
        </CardContent>
      </Card>

      <Button onClick={() => saveMutation.mutate(displayForm)} disabled={saveMutation.isPending}>
        <Save className="h-4 w-4 mr-2" />{saveMutation.isPending ? "Saving…" : "Save Settings"}
      </Button>
    </div>
  );
}
