import React, { useRef, useState, useMemo } from 'react';
import {
  useListVendors, getListVendorsQueryKey,
  useCreateVendor, useUpdateVendor, useDeleteVendor,
  useListExpenses, getListExpensesQueryKey,
  useCreateExpense, useUpdateExpense, useDeleteExpense,
  customFetch,
} from '@workspace/api-client-react';
import type { Vendor, ExpenseEntry } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Building2, Receipt, Download, Paperclip, ExternalLink, X, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { downloadCsv } from '@/lib/csvExport';

const EXPENSE_CATEGORIES = ['supplies', 'fuel', 'equipment', 'insurance', 'payroll', 'rent', 'utilities', 'marketing', 'other'];

function currentMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const end = now.toISOString().slice(0, 10);
  return { start, end };
}

/** Fetches a short-lived signed URL for a private object and opens it in a new tab. */
async function openReceipt(objectPath: string) {
  try {
    const { signedUrl } = await customFetch<{ signedUrl: string }>(
      `/api/storage/read-url?objectPath=${encodeURIComponent(objectPath)}`,
    );
    window.open(signedUrl, '_blank', 'noopener,noreferrer');
  } catch {
    toast.error('Could not open receipt');
  }
}

export default function VendorExpenseLedger({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { data: vendors = [] } = useListVendors({ query: { queryKey: getListVendorsQueryKey() } });
  const { data: expenses = [] } = useListExpenses({}, { query: { queryKey: getListExpensesQueryKey({}) } });

  const [vendorSheetOpen, setVendorSheetOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [expenseSheetOpen, setExpenseSheetOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseEntry | null>(null);

  const createVendor = useCreateVendor();
  const updateVendor = useUpdateVendor();
  const deleteVendor = useDeleteVendor();
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();

  const invalidateVendors = () => qc.invalidateQueries({ queryKey: getListVendorsQueryKey() });
  const invalidateExpenses = () => qc.invalidateQueries({ queryKey: getListExpensesQueryKey({}) });

  const { start: monthStart, end: monthEnd } = useMemo(() => currentMonthRange(), []);
  const thisMonthExpenses = useMemo(
    () => expenses.filter(e => e.date >= monthStart && e.date <= monthEnd),
    [expenses, monthStart, monthEnd],
  );
  const byCategory = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of thisMonthExpenses) totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }, [thisMonthExpenses]);
  const monthTotal = thisMonthExpenses.reduce((s, e) => s + e.amount, 0);

  const handleDeleteVendor = async (id: number) => {
    if (!confirm('Delete this vendor? Existing expense entries will keep their history but lose the vendor link.')) return;
    await deleteVendor.mutateAsync({ id });
    invalidateVendors();
    invalidateExpenses();
    toast.success('Vendor deleted');
  };

  const handleDeleteExpense = async (id: number) => {
    if (!confirm('Delete this expense entry?')) return;
    await deleteExpense.mutateAsync({ id });
    invalidateExpenses();
    toast.success('Expense deleted');
  };

  const exportExpensesCsv = () => {
    downloadCsv('expense-ledger.csv', expenses.map(e => ({
      date: e.date,
      vendor: e.vendorName ?? '',
      category: e.category,
      amount: e.amount,
      description: e.description ?? '',
      receipt: e.receiptUrl ? 'yes' : 'no',
    })));
  };

  return (
    <div className="space-y-6">
      {/* This month summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Receipt className="w-4 h-4" /> This Month's Spend by Category</CardTitle>
        </CardHeader>
        <CardContent>
          {byCategory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No expenses logged this month yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {byCategory.map(([cat, amt]) => (
                <Badge key={cat} variant="secondary" className="text-sm font-normal px-3 py-1.5">
                  {cat}: <span className="font-semibold ml-1">${amt.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </Badge>
              ))}
              <Badge className="text-sm px-3 py-1.5 bg-primary/10 text-primary border-transparent">
                Total: ${monthTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Vendors */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" /> Vendors</CardTitle>
          {canEdit && (
            <Button size="sm" className="gap-2" onClick={() => { setEditingVendor(null); setVendorSheetOpen(true); }}>
              <Plus className="w-4 h-4" /> Add Vendor
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Notes</TableHead>
                {canEdit && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendors.map(v => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.name}</TableCell>
                  <TableCell className="text-muted-foreground">{v.category ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{v.contact ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground truncate max-w-[240px]">{v.notes ?? '—'}</TableCell>
                  {canEdit && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingVendor(v); setVendorSheetOpen(true); }}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteVendor(v.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {vendors.length === 0 && (
                <TableRow><TableCell colSpan={canEdit ? 5 : 4} className="text-center text-muted-foreground py-8">No vendors yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Expenses */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Receipt className="w-4 h-4" /> Expense Ledger</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-2" onClick={exportExpensesCsv}><Download className="w-4 h-4" /> Export CSV</Button>
            {canEdit && (
              <Button size="sm" className="gap-2" onClick={() => { setEditingExpense(null); setExpenseSheetOpen(true); }}>
                <Plus className="w-4 h-4" /> Log Expense
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-10"></TableHead>
                {canEdit && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map(e => (
                <TableRow key={e.id}>
                  <TableCell>{format(new Date(e.date), 'MMM d, yyyy')}</TableCell>
                  <TableCell>{e.vendorName ?? '—'}</TableCell>
                  <TableCell><Badge variant="secondary" className="font-normal">{e.category}</Badge></TableCell>
                  <TableCell className="text-muted-foreground truncate max-w-[240px]">{e.description ?? '—'}</TableCell>
                  <TableCell className="text-right font-medium">${e.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                  <TableCell>
                    {e.receiptUrl && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title="View receipt"
                        onClick={() => openReceipt(e.receiptUrl!)}
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </TableCell>
                  {canEdit && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingExpense(e); setExpenseSheetOpen(true); }}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteExpense(e.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {expenses.length === 0 && (
                <TableRow><TableCell colSpan={canEdit ? 7 : 6} className="text-center text-muted-foreground py-8">No expenses logged yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Vendor Sheet */}
      <Sheet open={vendorSheetOpen} onOpenChange={setVendorSheetOpen}>
        <SheetContent>
          <SheetHeader><SheetTitle>{editingVendor ? 'Edit Vendor' : 'Add Vendor'}</SheetTitle></SheetHeader>
          <VendorForm
            editing={editingVendor}
            onSubmit={async (values) => {
              if (editingVendor) {
                await updateVendor.mutateAsync({ id: editingVendor.id, data: values });
                toast.success('Vendor updated');
              } else {
                await createVendor.mutateAsync({ data: values });
                toast.success('Vendor created');
              }
              invalidateVendors();
              setVendorSheetOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>

      {/* Expense Sheet */}
      <Sheet open={expenseSheetOpen} onOpenChange={setExpenseSheetOpen}>
        <SheetContent>
          <SheetHeader><SheetTitle>{editingExpense ? 'Edit Expense' : 'Log Expense'}</SheetTitle></SheetHeader>
          <ExpenseForm
            editing={editingExpense}
            vendors={vendors}
            onSubmit={async (values, receiptFile) => {
              let receiptObjectPath: string | undefined;

              // Upload the receipt first so we have the objectPath ready for the expense record
              if (receiptFile) {
                const { uploadURL, objectPath } = await customFetch<{ uploadURL: string; objectPath: string }>(
                  '/api/storage/uploads/request-url',
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: receiptFile.name, size: receiptFile.size, contentType: receiptFile.type }),
                  },
                );
                const uploadRes = await fetch(uploadURL, {
                  method: 'PUT',
                  body: receiptFile,
                  headers: { 'Content-Type': receiptFile.type },
                });
                if (!uploadRes.ok) throw new Error('Receipt upload failed');
                receiptObjectPath = objectPath;
              }

              let saved: ExpenseEntry;
              if (editingExpense) {
                saved = await updateExpense.mutateAsync({
                  id: editingExpense.id,
                  data: { ...values, ...(receiptObjectPath !== undefined ? { receiptUrl: receiptObjectPath } : {}) },
                });
                toast.success('Expense updated');
              } else {
                saved = await createExpense.mutateAsync({
                  data: { ...values, ...(receiptObjectPath !== undefined ? { receiptUrl: receiptObjectPath } : {}) },
                });
                toast.success('Expense logged');
              }

              // Register the receipt as a media attachment so /storage/read-url can verify ownership
              if (receiptFile && receiptObjectPath) {
                try {
                  await customFetch(`/api/expenses/${saved.id}/receipt`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      fileKey: receiptObjectPath,
                      mimeType: receiptFile.type,
                      sizeBytes: receiptFile.size,
                    }),
                  });
                } catch {
                  toast.warning(
                    'Expense saved, but the receipt may not be viewable. Try re-opening the expense and re-attaching the receipt.',
                  );
                }
              }

              invalidateExpenses();
              setExpenseSheetOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function VendorForm({ editing, onSubmit }: { editing: Vendor | null; onSubmit: (values: { name: string; category?: string; contact?: string; notes?: string }) => Promise<void> }) {
  const [name, setName] = useState(editing?.name ?? '');
  const [category, setCategory] = useState(editing?.category ?? '');
  const [contact, setContact] = useState(editing?.contact ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Vendor name is required'); return; }
    setSaving(true);
    try {
      await onSubmit({ name: name.trim(), category: category.trim() || undefined, contact: contact.trim() || undefined, notes: notes.trim() || undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 mt-6">
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Name</label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Acme Supply Co." />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Category</label>
        <Input value={category} onChange={e => setCategory(e.target.value)} placeholder="Supplies, fuel, insurance…" />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Contact</label>
        <Input value={contact} onChange={e => setContact(e.target.value)} placeholder="Phone or email" />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Notes</label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
      </div>
      <Button className="w-full" onClick={handleSave} disabled={saving}>{editing ? 'Save Changes' : 'Add Vendor'}</Button>
    </div>
  );
}

function ExpenseForm({ editing, vendors, onSubmit }: {
  editing: ExpenseEntry | null;
  vendors: Vendor[];
  onSubmit: (
    values: { vendorId?: number; date: string; amount: number; category: string; description?: string },
    receiptFile: File | null,
  ) => Promise<void>;
}) {
  const [vendorId, setVendorId] = useState<string>(editing?.vendorId ? String(editing.vendorId) : '');
  const [date, setDate] = useState(editing?.date ?? new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '');
  const [category, setCategory] = useState(editing?.category ?? 'other');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const existingReceiptUrl = editing?.receiptUrl ?? null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = file.type.startsWith('image/') || file.type === 'application/pdf';
    if (!allowed) { toast.error('Only images (JPG, PNG, etc.) and PDFs are allowed'); e.target.value = ''; return; }
    if (file.size > 20 * 1024 * 1024) { toast.error('File too large — maximum 20 MB'); e.target.value = ''; return; }
    setReceiptFile(file);
  };

  const handleSave = async () => {
    const amt = parseFloat(amount);
    if (!date || !amt || amt <= 0) { toast.error('Enter a valid date and amount'); return; }
    setSaving(true);
    try {
      await onSubmit(
        {
          vendorId: vendorId ? parseInt(vendorId, 10) : undefined,
          date,
          amount: amt,
          category,
          description: description.trim() || undefined,
        },
        receiptFile,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 mt-6">
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Date</label>
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Amount</label>
        <Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Category</label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Vendor (optional)</label>
        <Select value={vendorId || '__none__'} onValueChange={v => setVendorId(v === '__none__' ? '' : v)}>
          <SelectTrigger><SelectValue placeholder="No vendor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No vendor</SelectItem>
            {vendors.map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Description</label>
        <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
      </div>

      {/* Receipt upload */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Receipt (optional)</label>
        {receiptFile ? (
          <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm bg-muted/40">
            <Paperclip className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="truncate flex-1">{receiptFile.name}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => { setReceiptFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        ) : existingReceiptUrl && !receiptFile ? (
          <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm bg-muted/40">
            <Paperclip className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="truncate flex-1 text-muted-foreground">Receipt attached</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              title="View receipt"
              onClick={() => openReceipt(existingReceiptUrl)}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Button>
          </div>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={handleFileChange}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 w-full"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="w-4 h-4" />
          {receiptFile || existingReceiptUrl ? 'Replace Receipt' : 'Attach Receipt'}
        </Button>
      </div>

      <Button className="w-full" onClick={handleSave} disabled={saving}>
        {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{receiptFile ? 'Uploading…' : 'Saving…'}</> : (editing ? 'Save Changes' : 'Log Expense')}
      </Button>
    </div>
  );
}
