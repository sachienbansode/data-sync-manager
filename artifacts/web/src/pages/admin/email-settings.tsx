import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { getAccessToken } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Mail, Send, Server, ShieldCheck, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const smtpSchema = z.object({
  host: z.string().min(1, "SMTP host is required"),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().min(1, "Username is required"),
  password: z.string().optional(),
  fromName: z.string().min(1, "From name is required"),
  fromEmail: z.string().email("Must be a valid email").or(z.literal("")),
  enabled: z.boolean(),
});
type SmtpForm = z.infer<typeof smtpSchema>;

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

export default function EmailSettings() {
  const queryClient = useQueryClient();
  const [testEmail, setTestEmail] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  const handlePortChange = (e: React.ChangeEvent<HTMLInputElement>, fieldOnChange: (v: number) => void) => {
    const port = parseInt(e.target.value, 10);
    fieldOnChange(port);
    if (port === 465) form.setValue("secure", true);
    else if (port === 587 || port === 25) form.setValue("secure", false);
  };

  const { data: cfg, isLoading } = useQuery({
    queryKey: ["smtp-settings"],
    queryFn: () => apiFetch("/admin/smtp-settings"),
  });

  const form = useForm<SmtpForm>({
    resolver: zodResolver(smtpSchema),
    values: cfg ? {
      host: cfg.host ?? "smtp.gmail.com",
      port: cfg.port ?? 587,
      secure: cfg.secure ?? false,
      username: cfg.username ?? "",
      password: "",
      fromName: cfg.fromName ?? "Ashika Platform",
      fromEmail: cfg.fromEmail ?? "",
      enabled: cfg.enabled ?? false,
    } : undefined,
  });

  const saveMutation = useMutation({
    mutationFn: (data: SmtpForm) => apiFetch("/admin/smtp-settings", {
      method: "PUT",
      body: JSON.stringify({ ...data, password: passwordChanged ? data.password : undefined }),
    }),
    onSuccess: () => {
      toast.success("SMTP settings saved successfully");
      queryClient.invalidateQueries({ queryKey: ["smtp-settings"] });
      setPasswordChanged(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleTest = async () => {
    setIsTesting(true);
    try {
      const result = await apiFetch("/admin/smtp-settings/test", {
        method: "POST",
        body: JSON.stringify({ to: testEmail || undefined }),
      });
      toast.success(result.message ?? "Test email sent!");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setIsTesting(false);
    }
  };

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
        <h1 className="text-3xl font-bold tracking-tight">Email Settings</h1>
        <p className="text-muted-foreground mt-2">Configure Google SMTP for email notifications, reports, and OTP delivery.</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((d) => saveMutation.mutate(d))} className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Server className="h-5 w-5 text-primary" />
                <CardTitle>SMTP Server Configuration</CardTitle>
              </div>
              <CardDescription>Configure your Google Workspace SMTP relay settings.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="enabled" render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div>
                    <FormLabel className="text-base">Enable Email</FormLabel>
                    <FormDescription>Allow the platform to send emails via SMTP.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )} />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <FormField control={form.control} name="host" render={({ field }) => (
                    <FormItem>
                      <FormLabel>SMTP Host</FormLabel>
                      <FormControl><Input placeholder="smtp.gmail.com" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="port" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Port</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="587"
                        {...field}
                        onChange={(e) => handlePortChange(e, field.onChange)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="secure" render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-3">
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div>
                    <FormLabel>Use SSL/TLS (port 465)</FormLabel>
                    <FormDescription>Leave off for STARTTLS (port 587).</FormDescription>
                  </div>
                </FormItem>
              )} />

              <Separator />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="username" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gmail Address / Username</FormLabel>
                    <FormControl><Input placeholder="you@gmail.com" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="password" render={({ field }) => (
                  <FormItem>
                    <FormLabel>App Password {cfg?.passwordSet && !passwordChanged && <span className="text-xs text-muted-foreground font-normal">(set — leave blank to keep)</span>}</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder={cfg?.passwordSet && !passwordChanged ? "••••••••••••••••" : "Google App Password"}
                        {...field}
                        onChange={(e) => { field.onChange(e); setPasswordChanged(true); }}
                      />
                    </FormControl>
                    <FormDescription>Use a Google App Password, not your regular Gmail password.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <Separator />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="fromName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>From Name</FormLabel>
                    <FormControl><Input placeholder="Ashika Platform" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="fromEmail" render={({ field }) => (
                  <FormItem>
                    <FormLabel>From Email <span className="text-xs text-muted-foreground font-normal">(optional, defaults to username)</span></FormLabel>
                    <FormControl><Input placeholder="noreply@ashikagroup.com" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Settings
            </Button>
          </div>
        </form>
      </Form>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
            <CardTitle>Test Email</CardTitle>
          </div>
          <CardDescription>Send a test email to verify your SMTP configuration is working.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="email"
                placeholder="Recipient email (defaults to your account)"
                className="pl-9"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
              />
            </div>
            <Button variant="outline" onClick={handleTest} disabled={isTesting}>
              {isTesting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Send Test
            </Button>
          </div>
          <div className="mt-4 p-3 bg-muted rounded-md">
            <div className="flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 text-primary mt-0.5" />
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">Google App Password Setup</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Go to your Google Account → Security</li>
                  <li>Enable 2-Step Verification if not already enabled</li>
                  <li>Search for "App passwords" and create one for "Mail"</li>
                  <li>Use the generated 16-character password above</li>
                </ol>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
