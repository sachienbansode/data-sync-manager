import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { getAccessToken } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Building2, ImageIcon, Loader2, ShieldAlert, Upload, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const settingsSchema = z.object({
  appName: z.string().min(1, "Application name is required").max(80),
});
type SettingsForm = z.infer<typeof settingsSchema>;

async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = getAccessToken();
  const resp = await fetch(`${import.meta.env.BASE_URL}api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...((opts.headers as Record<string, string>) ?? {}) },
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export default function AppSettings() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const { data: cfg, isLoading } = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => apiFetch("/admin/app-settings"),
  });

  const piiToggleMutation = useMutation({
    mutationFn: (enabled: boolean) => apiFetch("/admin/pii-preview-settings", {
      method: "PUT",
      body: JSON.stringify({ piiPreviewEnabled: enabled }),
    }),
    onSuccess: (result) => {
      toast.success(`PII masking ${result.piiPreviewEnabled ? "enabled" : "disabled"} in Data Preview`);
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    values: cfg ? { appName: cfg.appName } : undefined,
  });

  const saveMutation = useMutation({
    mutationFn: (data: SettingsForm) => apiFetch("/admin/app-settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
    onSuccess: (result) => {
      toast.success("Application name updated");
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      queryClient.setQueryData(["app-settings"], (old: Record<string, unknown>) => ({ ...old, appName: result.appName }));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2 MB");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files are allowed");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setPreviewUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
    setIsUploading(true);
    try {
      const token = getAccessToken();
      const formData = new FormData();
      formData.append("logo", file);
      const resp = await fetch(`${import.meta.env.BASE_URL}api/admin/app-settings/logo`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Upload failed");
      toast.success("Logo uploaded successfully");
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
      setPreviewUrl(null);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const logoSrc = previewUrl ?? (cfg?.hasLogo ? `${import.meta.env.BASE_URL}api/admin/app-settings/logo?t=${Date.now()}` : null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Application Settings</h1>
        <p className="text-muted-foreground mt-2">Customize the application name and branding logo.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <CardTitle>Application Name</CardTitle>
          </div>
          <CardDescription>Set the name displayed in the sidebar, login page, and emails.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((d) => saveMutation.mutate(d))} className="flex gap-3 items-end">
              <FormField control={form.control} name="appName" render={({ field }) => (
                <FormItem className="flex-1">
                  <FormLabel>Application Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Ashika Platform" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Name
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-primary" />
            <CardTitle>Data Preview — PII Protection</CardTitle>
          </div>
          <CardDescription>
            When enabled, sensitive columns (phone, email, PAN, bank account, etc.) are automatically detected and partially masked in the Data Preview. Masking also applies to CSV exports.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label className="text-base font-medium">Mask PII in Data Preview</Label>
              <p className="text-sm text-muted-foreground">
                {cfg?.piiPreviewEnabled
                  ? "PII columns are being masked — users see partial values only."
                  : "PII columns are visible — users see full raw values."}
              </p>
            </div>
            <Switch
              checked={cfg?.piiPreviewEnabled ?? true}
              disabled={piiToggleMutation.isPending || isLoading}
              onCheckedChange={(checked) => piiToggleMutation.mutate(checked)}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div className="rounded-md bg-muted px-3 py-2"><span className="font-medium">Phone</span> — 987•••••••</div>
            <div className="rounded-md bg-muted px-3 py-2"><span className="font-medium">Email</span> — jo••••@gmail.com</div>
            <div className="rounded-md bg-muted px-3 py-2"><span className="font-medium">PAN</span> — ABCPF••••K</div>
            <div className="rounded-md bg-muted px-3 py-2"><span className="font-medium">Bank / National ID</span> — ••••1234</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-primary" />
            <CardTitle>Application Logo</CardTitle>
          </div>
          <CardDescription>Upload a logo image (PNG, JPG, SVG — max 2 MB). It will appear in the sidebar and login page.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-6">
            <div className="h-24 w-24 rounded-xl border-2 border-dashed border-border flex items-center justify-center bg-muted overflow-hidden shrink-0">
              {logoSrc ? (
                <img src={logoSrc} alt="App logo" className="h-full w-full object-contain p-1" />
              ) : (
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogoChange}
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading...</>
                ) : (
                  <><Upload className="h-4 w-4 mr-2" />Upload Logo</>
                )}
              </Button>
              {logoSrc && !previewUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setPreviewUrl(null)}
                >
                  <X className="h-4 w-4 mr-1" />Remove preview
                </Button>
              )}
              <p className="text-xs text-muted-foreground">Recommended: square image, at least 128×128 px.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
