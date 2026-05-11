import { useState, useEffect, useCallback } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, Trash2, ShieldAlert, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useAuth, getAccessToken } from "@/lib/auth";
import { PiiField } from "@/components/pii-field";

interface PiiRecordMasked {
  id: number;
  name: string;
  company: string | null;
  phone: string | null;
  nationalId: string | null;
  bankAccount: string | null;
  panNumber: string | null;
  emailCounterparty: string | null;
  address: string | null;
  createdAt: string;
}

const EMPTY_FORM = {
  name: "", company: "", phone: "", nationalId: "", bankAccount: "", panNumber: "", emailCounterparty: "", address: "",
};

// Maps PiiField fieldName → DB field_type for permission lookup
const FIELD_TYPE_MAP: Record<string, string> = {
  phone: "phone",
  nationalId: "national_id",
  bankAccount: "bank_account",
  panNumber: "pan_number",
  emailCounterparty: "email_counterparty",
  address: "address",
};

export default function PiiRecords() {
  const { user } = useAuth();
  const [records, setRecords] = useState<PiiRecordMasked[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [allowedFields, setAllowedFields] = useState<Set<string>>(new Set());

  const apiBase = `${import.meta.env.BASE_URL}api`;
  const isAdmin = user?.roleName === "Admin";

  // Fetch which field types the current user's role can unmask
  useEffect(() => {
    const token = getAccessToken();
    fetch(`${apiBase}/pii/my-permissions`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : { allowedFieldTypes: [] })
      .then(d => setAllowedFields(new Set(d.allowedFieldTypes ?? [])))
      .catch(() => setAllowedFields(new Set()));
  }, []);

  function canReveal(fieldName: string): boolean {
    return allowedFields.has(FIELD_TYPE_MAP[fieldName] ?? fieldName);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/pii/records?page=${page}&pageSize=${pageSize}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load records");
      const data = await res.json();
      setRecords(data.records);
      setTotal(data.total);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load records");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSubmitting(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/pii/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: form.name, company: form.company || undefined,
          phone: form.phone || undefined, nationalId: form.nationalId || undefined,
          bankAccount: form.bankAccount || undefined, panNumber: form.panNumber || undefined,
          emailCounterparty: form.emailCounterparty || undefined, address: form.address || undefined,
        }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? "Failed to create"); }
      toast.success("PII record created and encrypted");
      setAddOpen(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create record");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const token = getAccessToken();
      const res = await fetch(`${apiBase}/pii/records/${deleteId}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 204) throw new Error("Failed to delete");
      toast.success("Record deleted");
      setDeleteId(null);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete record");
    }
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShieldAlert className="h-6 w-6 text-primary" />
              PII Records
            </h1>
            <p className="text-muted-foreground mt-1">
              Sensitive fields are encrypted at rest (AES-256-GCM) and masked by default.
              Reveal requires per-field role permission.
            </p>
          </div>
          {isAdmin && (
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-2" />Add Record</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Add PII Record</DialogTitle>
                  <DialogDescription>
                    All PII fields will be encrypted using AES-256-GCM before storage.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-4 py-2">
                  <div className="col-span-2">
                    <Label>Full Name *</Label>
                    <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Counterparty name" />
                  </div>
                  <div className="col-span-2">
                    <Label>Company</Label>
                    <Input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder="Organisation" />
                  </div>
                  <div>
                    <Label>Phone Number</Label>
                    <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91 98765 43210" />
                  </div>
                  <div>
                    <Label>National ID / Aadhaar</Label>
                    <Input value={form.nationalId} onChange={e => setForm(f => ({ ...f, nationalId: e.target.value }))} placeholder="1234 5678 9012" />
                  </div>
                  <div>
                    <Label>Bank Account</Label>
                    <Input value={form.bankAccount} onChange={e => setForm(f => ({ ...f, bankAccount: e.target.value }))} placeholder="Account number" />
                  </div>
                  <div>
                    <Label>PAN Number</Label>
                    <Input value={form.panNumber} onChange={e => setForm(f => ({ ...f, panNumber: e.target.value }))} placeholder="ABCDE1234F" />
                  </div>
                  <div className="col-span-2">
                    <Label>Counterparty Email</Label>
                    <Input value={form.emailCounterparty} onChange={e => setForm(f => ({ ...f, emailCounterparty: e.target.value }))} placeholder="partner@example.com" type="email" />
                  </div>
                  <div className="col-span-2">
                    <Label>Address</Label>
                    <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Full residential or business address" />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                  <Button onClick={handleAdd} disabled={submitting}>
                    {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Encrypt & Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <div className="rounded-md border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            PII fields are stored encrypted using AES-256-GCM. The <span className="font-mono tracking-widest">••••••••</span> mask is always applied.
            The <strong>eye icon</strong> appears only for fields your role is permitted to reveal — each reveal is recorded in the Audit Log.
            {allowedFields.size === 0 && " Your role currently has no unmask permissions — contact your administrator."}
          </span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Counterparty Records</span>
              <Badge variant="secondary">{total} total</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : records.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <ShieldAlert className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No PII records yet.</p>
                {isAdmin && <p className="text-sm mt-1">Click "Add Record" to create one.</p>}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>National ID</TableHead>
                      <TableHead>Bank Account</TableHead>
                      <TableHead>PAN</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Address</TableHead>
                      {isAdmin && <TableHead className="w-12" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-muted-foreground">{r.company ?? "—"}</TableCell>
                        <TableCell>
                          <PiiField recordId={r.id} fieldName="phone" hasValue={!!r.phone} canReveal={canReveal("phone")} fieldLabel="Phone Number" />
                        </TableCell>
                        <TableCell>
                          <PiiField recordId={r.id} fieldName="nationalId" hasValue={!!r.nationalId} canReveal={canReveal("nationalId")} fieldLabel="National ID" />
                        </TableCell>
                        <TableCell>
                          <PiiField recordId={r.id} fieldName="bankAccount" hasValue={!!r.bankAccount} canReveal={canReveal("bankAccount")} fieldLabel="Bank Account" />
                        </TableCell>
                        <TableCell>
                          <PiiField recordId={r.id} fieldName="panNumber" hasValue={!!r.panNumber} canReveal={canReveal("panNumber")} fieldLabel="PAN Number" />
                        </TableCell>
                        <TableCell>
                          <PiiField recordId={r.id} fieldName="emailCounterparty" hasValue={!!r.emailCounterparty} canReveal={canReveal("emailCounterparty")} fieldLabel="Counterparty Email" />
                        </TableCell>
                        <TableCell>
                          <PiiField recordId={r.id} fieldName="address" hasValue={!!r.address} canReveal={canReveal("address")} fieldLabel="Address" />
                        </TableCell>
                        {isAdmin && (
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => setDeleteId(r.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page === totalPages}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={deleteId !== null} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete PII Record?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the record and all its encrypted PII fields. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
