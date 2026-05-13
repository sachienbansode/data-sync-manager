import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";
import {
  ChevronLeft, ChevronRight, Mail, Users, CheckCircle, XCircle,
  MousePointerClick, Eye, Ban, RefreshCw, Send, Paperclip, User, Clock,
} from "lucide-react";

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

interface CampaignDetail {
  id: number; name: string; type: string; status: string; subject: string;
  fromEmail: string | null; fromName: string | null; templateId: number | null;
  totalRecipients: number; sentCount: number; failedCount: number;
  hasAttachments: boolean; scheduledAt: string | null; startedAt: string | null;
  completedAt: string | null; isRecurring: boolean; recurrenceType: string | null;
  createdAt: string; creatorName: string | null;
  deliveredCount: number; openedCount: number; clickedCount: number;
  bouncedCount: number; unsubscribedCount: number; spamCount: number;
  attachments: Array<{ id: number; filename: string; fileSizeBytes: number; isInline: boolean; cid: string | null }>;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700", scheduled: "bg-blue-100 text-blue-700",
    running: "bg-yellow-100 text-yellow-700", completed: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700", cancelled: "bg-orange-100 text-orange-700",
  };
  return <Badge variant="outline" className={`capitalize text-xs ${map[status] ?? ""}`}>{status}</Badge>;
}

function StatCard({ icon: Icon, label, value, color }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; color: string }) {
  return (
    <Card><CardContent className="flex items-center gap-3 py-4 px-4">
      <Icon className={`h-7 w-7 ${color}`} />
      <div><p className="text-2xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>
    </CardContent></Card>
  );
}

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const campaignId = Number(id);
  const qc = useQueryClient();
  const [recipientPage, setRecipientPage] = useState(1);
  const [eventPage, setEventPage] = useState(1);
  const [activeTab, setActiveTab] = useState<"recipients" | "events">("recipients");
  const [recipientStatus, setRecipientStatus] = useState("all");

  const { data: campaign, isLoading } = useQuery<CampaignDetail>({
    queryKey: ["comm-campaign", campaignId],
    queryFn: () => apiFetch(`/comm/campaigns/${campaignId}`),
    refetchInterval: campaign?.status === "running" ? 5000 : false,
  });

  const { data: recipientData } = useQuery({
    queryKey: ["comm-recipients", campaignId, recipientPage],
    queryFn: () => apiFetch(`/comm/campaigns/${campaignId}/recipients?page=${recipientPage}`),
  });

  const { data: eventData } = useQuery({
    queryKey: ["comm-events", campaignId, eventPage],
    queryFn: () => apiFetch(`/comm/campaigns/${campaignId}/events?page=${eventPage}`),
  });

  const sendMutation = useMutation({
    mutationFn: () => apiFetch(`/comm/campaigns/${campaignId}/send`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["comm-campaign", campaignId] }); toast.success("Campaign is sending!"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: () => apiFetch(`/comm/campaigns/${campaignId}/cancel`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["comm-campaign", campaignId] }); toast.success("Cancelled"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteAttMutation = useMutation({
    mutationFn: (aid: number) => apiFetch(`/comm/campaigns/${campaignId}/attachments/${aid}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["comm-campaign", campaignId] }); toast.success("Attachment removed"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !campaign) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const recipients: Array<{ id: number; email: string; status: string; sentAt: string | null; errorMessage: string | null; variables: Record<string, string> | null }> = recipientData?.data ?? [];
  const events: Array<{ id: number; email: string; eventType: string; netcoreMessageId: string | null; eventAt: string }> = eventData?.data ?? [];

  const filteredRecipients = recipientStatus === "all" ? recipients : recipients.filter(r => r.status === recipientStatus);

  const deliveryRate = campaign.sentCount > 0 ? Math.round((campaign.deliveredCount / campaign.sentCount) * 100) : 0;
  const openRate = campaign.deliveredCount > 0 ? Math.round((campaign.openedCount / campaign.deliveredCount) * 100) : 0;
  const clickRate = campaign.openedCount > 0 ? Math.round((campaign.clickedCount / campaign.openedCount) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" asChild><Link href="/email-hub/campaigns">← Campaigns</Link></Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{campaign.name}</h1>
              {statusBadge(campaign.status)}
              {campaign.isRecurring && <Badge variant="outline" className="text-[10px]"><RefreshCw className="h-2.5 w-2.5 mr-1" />{campaign.recurrenceType}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{campaign.subject}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {campaign.status === "draft" && <Button size="sm" onClick={() => { if (confirm("Send now?")) sendMutation.mutate(); }} disabled={sendMutation.isPending}><Send className="h-4 w-4 mr-2" />Send Now</Button>}
          {campaign.status === "scheduled" && <Button size="sm" variant="outline" onClick={() => { if (confirm("Cancel?")) cancelMutation.mutate(); }}><Ban className="h-4 w-4 mr-2" />Cancel</Button>}
        </div>
      </div>

      {/* Meta info */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground bg-muted/40 rounded-lg px-4 py-2 flex-wrap">
        {campaign.creatorName && <span className="flex items-center gap-1.5"><User className="h-3.5 w-3.5" />{campaign.creatorName}</span>}
        <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />Created {new Date(campaign.createdAt).toLocaleString()}</span>
        {campaign.fromEmail && <span><strong>From:</strong> {campaign.fromName ? `${campaign.fromName} <${campaign.fromEmail}>` : campaign.fromEmail}</span>}
        <Badge variant="outline" className="text-[10px] capitalize">{campaign.type}</Badge>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard icon={Users} label="Recipients" value={campaign.totalRecipients} color="text-primary" />
        <StatCard icon={Send} label="Sent" value={campaign.sentCount} color="text-blue-500" />
        <StatCard icon={CheckCircle} label="Delivered" value={campaign.deliveredCount} color="text-green-500" />
        <StatCard icon={Eye} label="Opened" value={campaign.openedCount} color="text-violet-500" />
        <StatCard icon={MousePointerClick} label="Clicked" value={campaign.clickedCount} color="text-orange-500" />
        <StatCard icon={XCircle} label="Failed" value={campaign.failedCount} color="text-red-500" />
      </div>

      {/* Rate cards */}
      <div className="grid grid-cols-3 gap-3">
        {[{ label: "Delivery Rate", value: deliveryRate }, { label: "Open Rate", value: openRate }, { label: "Click-Through Rate", value: clickRate }].map(r => (
          <Card key={r.label}><CardContent className="py-4 px-4 text-center">
            <p className="text-3xl font-bold text-primary">{r.value}%</p>
            <p className="text-xs text-muted-foreground mt-1">{r.label}</p>
          </CardContent></Card>
        ))}
      </div>

      {/* Attachments */}
      {campaign.attachments.length > 0 && (
        <Card><CardHeader><CardTitle className="text-sm flex items-center gap-2"><Paperclip className="h-4 w-4" />Attachments</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {campaign.attachments.map(a => (
              <div key={a.id} className="flex items-center justify-between p-2 border rounded text-sm">
                <div className="flex items-center gap-2">
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{a.filename}</span>
                  {a.isInline && <Badge variant="outline" className="text-[9px]">CID: {a.cid}</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{(a.fileSizeBytes / 1024).toFixed(1)} KB</span>
                  {campaign.status === "draft" && <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => deleteAttMutation.mutate(a.id)}><XCircle className="h-3.5 w-3.5" /></Button>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Tabs: Recipients | Events */}
      <div>
        <div className="flex border-b mb-4">
          {(["recipients", "events"] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${activeTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t}</button>
          ))}
        </div>

        {activeTab === "recipients" && (
          <Card>
            <div className="flex items-center gap-2 p-4 border-b">
              <Select value={recipientStatus} onValueChange={setRecipientStatus}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {["pending","sent","failed","delivered","opened","clicked","bounced","unsubscribed","spam"].map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">{recipientData?.total ?? 0} total</span>
            </div>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Status</TableHead><TableHead>Sent At</TableHead><TableHead>Error</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredRecipients.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No recipients</TableCell></TableRow>}
                  {filteredRecipients.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm font-mono">{r.email}</TableCell>
                      <TableCell><Badge variant="outline" className={`capitalize text-xs ${r.status === "sent" || r.status === "delivered" ? "text-green-600" : r.status === "failed" || r.status === "bounced" ? "text-red-600" : ""}`}>{r.status}</Badge></TableCell>
                      <TableCell className="text-xs">{r.sentAt ? new Date(r.sentAt).toLocaleString() : "—"}</TableCell>
                      <TableCell className="text-xs text-red-500 max-w-[200px] truncate">{r.errorMessage ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {(recipientData?.pages ?? 1) > 1 && (
                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t text-sm text-muted-foreground">
                  <span>Page {recipientPage} of {recipientData?.pages}</span>
                  <Button variant="outline" size="icon" className="h-7 w-7" disabled={recipientPage <= 1} onClick={() => setRecipientPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <Button variant="outline" size="icon" className="h-7 w-7" disabled={recipientPage >= (recipientData?.pages ?? 1)} onClick={() => setRecipientPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "events" && (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Event</TableHead><TableHead>Message ID</TableHead><TableHead>Time</TableHead></TableRow></TableHeader>
                <TableBody>
                  {events.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No events yet — they appear after Netcore webhooks are received.</TableCell></TableRow>}
                  {events.map(e => (
                    <TableRow key={e.id}>
                      <TableCell className="text-sm font-mono">{e.email}</TableCell>
                      <TableCell><Badge variant="outline" className={`capitalize text-xs ${e.eventType === "delivered" || e.eventType === "opened" || e.eventType === "clicked" ? "text-green-600" : e.eventType === "bounced" || e.eventType === "spam" ? "text-red-600" : ""}`}>{e.eventType}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{e.netcoreMessageId ?? "—"}</TableCell>
                      <TableCell className="text-xs">{new Date(e.eventAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {(eventData?.pages ?? 1) > 1 && (
                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t text-sm text-muted-foreground">
                  <span>Page {eventPage} of {eventData?.pages}</span>
                  <Button variant="outline" size="icon" className="h-7 w-7" disabled={eventPage <= 1} onClick={() => setEventPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <Button variant="outline" size="icon" className="h-7 w-7" disabled={eventPage >= (eventData?.pages ?? 1)} onClick={() => setEventPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
