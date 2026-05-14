import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { getAccessToken, silentRefresh } from "@/lib/auth";
import { Plus, Trash2, CheckCircle2, XCircle, RefreshCw, Copy, Globe } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

async function apiFetch(path: string, options?: RequestInit) {
  let token = getAccessToken();
  if (!token) token = await silentRefresh();
  const res = await fetch(`${BASE}api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options?.headers },
  });
  if (res.status === 401) {
    const fresh = await silentRefresh();
    if (fresh) {
      const retry = await fetch(`${BASE}api${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${fresh}`, ...options?.headers },
      });
      if (!retry.ok) {
        const err = await retry.json().catch(() => ({ error: retry.statusText }));
        throw new Error(err.error ?? "Request failed");
      }
      return retry.json();
    }
    throw new Error("Session expired — please log in again");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Request failed");
  }
  return res.json();
}

interface ShortDomain {
  id: number;
  domain: string;
  verificationToken: string;
  isVerified: boolean;
  verifiedAt: string | null;
  createdAt: string;
}

export default function ShortDomains() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [domainInput, setDomainInput] = useState("");
  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const [verifyResult, setVerifyResult] = useState<{ id: number; success: boolean; message?: string } | null>(null);

  const { data: domains = [], isLoading } = useQuery<ShortDomain[]>({
    queryKey: ["short-domains"],
    queryFn: () => apiFetch("/short-domains"),
  });

  const addMutation = useMutation({
    mutationFn: (domain: string) => apiFetch("/short-domains", { method: "POST", body: JSON.stringify({ domain }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["short-domains"] }); toast.success("Domain added"); setDialogOpen(false); setDomainInput(""); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/short-domains/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["short-domains"] }); toast.success("Domain removed"); },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleVerify(id: number) {
    setVerifyingId(id);
    setVerifyResult(null);
    try {
      const result = await apiFetch(`/short-domains/${id}/verify`, { method: "POST" });
      if (result.success) {
        qc.invalidateQueries({ queryKey: ["short-domains"] });
        toast.success("Domain verified successfully!");
      }
      setVerifyResult({ id, success: result.success, message: result.message });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setVerifyingId(null);
    }
  }

  function copyToken(token: string) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(token).then(() => {
        toast.success("Verification token copied");
      }).catch(() => fallbackCopy(token));
    } else {
      fallbackCopy(token);
    }
  }

  function fallbackCopy(text: string) {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.focus();
    el.select();
    try {
      document.execCommand("copy");
      toast.success("Verification token copied");
    } catch {
      toast.error("Copy failed — please select and copy the token manually");
    }
    document.body.removeChild(el);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Domain Registrations</h1>
          <p className="text-muted-foreground text-sm">Add and verify custom domains for your short URLs</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Add Domain
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How it works</CardTitle>
          <CardDescription>
            Add your custom domain, then create a DNS TXT record on your domain to verify ownership.
            Once verified, you can generate short URLs using your domain (e.g. <code className="bg-muted px-1 rounded text-xs">go.yourdomain.com/abc123</code>).
            Point your domain's A record to <strong>{window.location.hostname}</strong> so redirects work.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>DNS TXT Record Required</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>}
                {!isLoading && domains.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No custom domains yet.</TableCell></TableRow>}
                {domains.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-mono text-sm font-medium">{d.domain}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {d.isVerified
                        ? <Badge className="bg-green-500 hover:bg-green-600 gap-1"><CheckCircle2 className="h-3 w-3" />Verified</Badge>
                        : <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300"><XCircle className="h-3 w-3" />Unverified</Badge>}
                    </TableCell>
                    <TableCell>
                      {!d.isVerified && (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Add a TXT record to <code className="bg-muted px-1 rounded">{d.domain}</code> with value:</p>
                          <div className="flex items-center gap-1">
                            <code className="text-xs bg-muted px-2 py-1 rounded font-mono break-all">{d.verificationToken}</code>
                            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => copyToken(d.verificationToken)}>
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                          {verifyResult?.id === d.id && !verifyResult.success && (
                            <p className="text-xs text-destructive">{verifyResult.message}</p>
                          )}
                        </div>
                      )}
                      {d.isVerified && <span className="text-xs text-muted-foreground">Verified {d.verifiedAt ? new Date(d.verifiedAt).toLocaleDateString() : ""}</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {!d.isVerified && (
                          <Button variant="outline" size="sm" disabled={verifyingId === d.id} onClick={() => handleVerify(d.id)}>
                            <RefreshCw className={`h-3 w-3 mr-1 ${verifyingId === d.id ? "animate-spin" : ""}`} />
                            Verify
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => { if (confirm("Remove this domain?")) deleteMutation.mutate(d.id); }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Custom Domain</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Domain Name</Label>
              <Input placeholder="go.yourdomain.com" value={domainInput} onChange={e => setDomainInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (domainInput.trim()) addMutation.mutate(domainInput.trim()); }}} />
              <p className="text-xs text-muted-foreground">Enter just the domain without https:// or trailing slash.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => addMutation.mutate(domainInput.trim())} disabled={!domainInput.trim() || addMutation.isPending}>Add Domain</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
