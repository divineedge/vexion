import React, { useRef, useState, useMemo } from 'react';
import {
  useListVendors, getListVendorsQueryKey,
  useCreateVendor, useUpdateVendor, useDeleteVendor,
  useListExpenses, getListExpensesQueryKey,
  useCreateExpense, useUpdateExpense, useDeleteExpense,
  useListInventoryItems, getListInventoryItemsQueryKey,
  useListInventoryLocations, getListInventoryLocationsQueryKey,
  getGetFinancialsSummaryQueryKey,
  customFetch,
  useListExpenseCategories,
  useGetVendorExpenseDefaults,
  getGetVendorExpenseDefaultsQueryKey,
} from '@workspace/api-client-react';
import type { Vendor, ExpenseEntry, InventoryItem, InventoryLocation,ExpenseCategory } from '@workspace/api-client-react';
import ExpenseCategoryManager from './ExpenseCategoryManager';
import type { VendorExpenseDefaultsConfig } from '@workspace/api-client-react';
import { resolveVendorExpenseDefaults } from '@/lib/vendorExpenseDefaults';
import { useAllExpenseCategories } from '@/lib/expenseCategories';
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
import { Plus, Pencil, Trash2, Building2, Receipt, Download, Paperclip, ExternalLink, X, Loader2, PackagePlus } from 'lucide-react';
import { format } from 'date-fns';
import { downloadCsv } from '@/lib/csvExport';


export interface ReceiptRowInput { inventoryItemId: number; locationId?: number; quantity: number; costPrice: number; updatePrice: boolean; markupPct?: number }
interface ReceiptDraft { key: string; itemId: string; locationId: string; quantity: string; costPrice: string; updatePrice: boolean; markupPct: string }
/** purchaseCostPrice = pre-tax unit cost paid; costPrice = unit cost saved to the item (tax-inclusive when capitalized). */
interface SavedReceipt { shippingAllocation?: number | null; landedUnitCost?: number | null; purchaseCostPrice?: number | null; inventoryItemId?: number; itemName?: string | null; locationName?: string | null; quantity?: number; costPrice?: number; markupPct?: number | null; updatePrice?: boolean }
/** Temporary local extension until codegen adds Vendor.contactPhone. */
type VendorX = Vendor & { contactPhone?: string | null };
const receiptsOf = (e: ExpenseEntry | null): SavedReceipt[] =>
  ((e as unknown as { inventoryReceipts?: SavedReceipt[] | null } | null)?.inventoryReceipts ?? []);
const newDraft = (): ReceiptDraft => ({ key: crypto.randomUUID(), itemId: '', locationId: '', quantity: '1', costPrice: '', updatePrice: false, markupPct: '' });

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
  const expenseDefaults = useGetVendorExpenseDefaults({ query: { queryKey: getGetVendorExpenseDefaultsQueryKey(), enabled: canEdit } });
  const { data: expenses = [] } = useListExpenses({}, { query: { queryKey: getListExpensesQueryKey({}) } });
  const categoryQuery=useListExpenseCategories();
  const categories=categoryQuery.data??[];
  const allCategories=useAllExpenseCategories();
  // History labels use every category (including deleted); pickers use active ones only.
  const categoryName=(key:string)=>allCategories.data?.find(c=>c.key===key)?.name??categories.find(c=>c.key===key)?.name??key;

  const [vendorSheetOpen, setVendorSheetOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [expenseSheetOpen, setExpenseSheetOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseEntry | null>(null);
  const [createRequestId, setCreateRequestId] = useState<string>(() => crypto.randomUUID());
  const { data: inventoryItems = [] } = useListInventoryItems(undefined, { query: { queryKey: getListInventoryItemsQueryKey(), enabled: canEdit } });
  const { data: inventoryLocations = [] } = useListInventoryLocations({ query: { queryKey: getListInventoryLocationsQueryKey(), enabled: canEdit } });
  const [expenseSearch, setExpenseSearch] = useState('');
  const [expenseDateFrom, setExpenseDateFrom] = useState('');
  const [expenseDateTo, setExpenseDateTo] = useState('');

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
    try {
      await deleteExpense.mutateAsync({ id });
      invalidateExpenses();
      toast.success('Expense deleted');
    } catch (err) {
      const d = (err as { data?: { error?: string; message?: string } })?.data;
      toast.error(d?.error || d?.message || 'Could not delete expense');
    }
  };

  const exportExpensesCsv = () => {
    downloadCsv('expense-ledger.csv', expenses.map(e => ({
      date: e.date,
      vendor: e.vendorName ?? '',
      category: categoryName(e.category),
      amount: e.amount,
      description: e.description ?? '',
      receipt: e.receiptUrl ? 'yes' : 'no',
    })));
  };

  return (
    <div className="space-y-6">
      {categoryQuery.isError&&<Button variant="outline" onClick={()=>categoryQuery.refetch()}>Could not load categories. Retry</Button>}
      {canEdit && expenseDefaults.isError && <div role="alert" className="text-sm text-destructive">Expense defaults could not be loaded. <Button variant="outline" size="sm" onClick={() => expenseDefaults.refetch()}>Retry</Button></div>}
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
                  {categoryName(cat)}: <span className="font-semibold ml-1">${amt.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
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
            <div className="flex gap-2"><ExpenseCategoryManager/>
            <Button size="sm" title="Add a new vendor or supplier" className="gap-2" onClick={() => { setEditingVendor(null); setVendorSheetOpen(true); }}>
              <Plus className="w-4 h-4" /> Add Vendor
            </Button>
            </div>
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
                  <TableCell className="font-medium" title={v.name}>{v.name}</TableCell>
                  <TableCell className="text-muted-foreground">{v.category ? categoryName(v.category) : '—'}</TableCell>
                  <TableCell className="text-muted-foreground"><div>{v.contactName}</div>{(v as VendorX).contactPhone&&<div>Contact: <a href={`tel:${(v as VendorX).contactPhone}`}>{(v as VendorX).contactPhone}</a></div>}{v.officePhone&&<div>Office: <a href={`tel:${v.officePhone}`}>{v.officePhone}</a></div>}<div>{v.contact}</div>{!v.contactName&&!(v as VendorX).contactPhone&&!v.officePhone&&!v.contact&&'—'}</TableCell>
                  <TableCell className="text-muted-foreground truncate max-w-[240px]" title={v.notes ?? undefined}>{v.notes ?? '—'}</TableCell>
                  {canEdit && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" title="Edit this vendor" className="h-8 w-8" onClick={() => { setEditingVendor(v); setVendorSheetOpen(true); }}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Delete this vendor" className="h-8 w-8 text-destructive" onClick={() => handleDeleteVendor(v.id)}>
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
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2"><Receipt className="w-4 h-4" /> Expense Ledger</CardTitle>
          <div className="flex gap-2 flex-wrap items-center">
            <input
              type="text"
              title="Search by vendor name or expense description"
              value={expenseSearch}
              onChange={e => setExpenseSearch(e.target.value)}
              placeholder="Search vendor/desc…"
              className="h-8 text-xs px-2 rounded-md border border-input bg-background w-40"
            />
            <input
              type="date"
              value={expenseDateFrom}
              onChange={e => setExpenseDateFrom(e.target.value)}
              className="h-8 text-xs px-2 rounded-md border border-input bg-background w-36"
              title="From date"
            />
            <input
              type="date"
              value={expenseDateTo}
              onChange={e => setExpenseDateTo(e.target.value)}
              className="h-8 text-xs px-2 rounded-md border border-input bg-background w-36"
              title="To date"
            />
            <Button size="sm" variant="outline" className="gap-2" title="Download expenses as CSV" onClick={exportExpensesCsv}><Download className="w-4 h-4" /> Export CSV</Button>
            {canEdit && (
              <Button size="sm" className="gap-2" title="Log a new vendor expense" disabled={!expenseDefaults.data || expenseDefaults.isError} onClick={() => { setEditingExpense(null); setCreateRequestId(crypto.randomUUID()); setExpenseSheetOpen(true); }}>
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
              {expenses.filter(e => {
                const q = expenseSearch.trim().toLowerCase();
                if (q && !(e.vendorName ?? '').toLowerCase().includes(q) && !(e.description ?? '').toLowerCase().includes(q)) return false;
                if (expenseDateFrom && e.date < expenseDateFrom) return false;
                if (expenseDateTo && e.date > expenseDateTo) return false;
                return true;
              }).map(e => (
                <TableRow key={e.id}>
                  <TableCell title={format(new Date(e.date), 'EEEE, MMMM d, yyyy')}>{format(new Date(e.date), 'MMM d, yyyy')}</TableCell>
                  <TableCell title={e.vendorName ?? undefined}>{e.vendorName ?? '—'}</TableCell>
                  <TableCell><Badge variant="secondary" className="font-normal">{categoryName(e.category)}</Badge></TableCell>
                  <TableCell className="text-muted-foreground truncate max-w-[240px]" title={e.description ?? undefined}>{e.description ?? '—'}</TableCell>
                  <TableCell className="text-right font-medium" title={`Expense amount: $${e.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}>${e.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
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
                      <Button variant="ghost" size="icon" title="Edit this expense" className="h-8 w-8" onClick={() => { setEditingExpense(e); setExpenseSheetOpen(true); }}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      {receiptsOf(e).length > 0 ? (
                        <span className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground" title="Received inventory into stock. Cannot be deleted, to protect the stock audit trail." data-testid={`icon-expense-locked-${e.id}`}>
                          <PackagePlus className="w-4 h-4" />
                        </span>
                      ) : (
                        <Button variant="ghost" size="icon" title="Delete this expense" className="h-8 w-8 text-destructive" onClick={() => handleDeleteExpense(e.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
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
        <SheetContent className="w-full overflow-y-auto sm:w-[66.666667vw] sm:min-w-[66.666667vw] sm:max-w-[66.666667vw]">
          <SheetHeader><SheetTitle>{editingVendor ? 'Edit Vendor' : 'Add Vendor'}</SheetTitle></SheetHeader>
          <VendorForm
            key={editingVendor?.id??'new'}
            editing={editingVendor}
            categories={categories}
            onSubmit={async (values) => {
              if (editingVendor) {
                await updateVendor.mutateAsync({ id: editingVendor.id, data: values as Parameters<typeof updateVendor.mutateAsync>[0]['data'] });
                toast.success('Vendor updated');
              } else {
                await createVendor.mutateAsync({ data: values as Parameters<typeof createVendor.mutateAsync>[0]['data'] });
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
        <SheetContent className="w-full overflow-y-auto sm:w-[66.666667vw] sm:min-w-[66.666667vw] sm:max-w-[66.666667vw]">
          <SheetHeader><SheetTitle>{editingExpense ? 'Edit Expense' : 'Log Expense'}</SheetTitle></SheetHeader>
          <ExpenseForm
            key={editingExpense ? `e-${editingExpense.id}` : createRequestId}
            editing={editingExpense}
            defaults={expenseDefaults.data}
            vendors={vendors}
            categories={categories}
            categoryName={categoryName}
            inventoryItems={inventoryItems}
            inventoryLocations={inventoryLocations}
            onSubmit={async (values, receiptFile, removeReceipt, inventoryReceipts) => {
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
                  data: {
                    ...values,
                    ...(receiptObjectPath !== undefined ? { receiptUrl: receiptObjectPath } : {}),
                    requestId: createRequestId,
                    inventoryReceipts,
                  } as Parameters<typeof createExpense.mutateAsync>[0]['data'],
                });
                toast.success(inventoryReceipts.length ? `Expense logged and ${inventoryReceipts.length} inventory receipt${inventoryReceipts.length > 1 ? 's' : ''} applied` : 'Expense logged');
                if (inventoryReceipts.length) {
                  qc.invalidateQueries({ queryKey: getListInventoryItemsQueryKey() });
                  qc.invalidateQueries({ queryKey: ['/api/inventory'] });
                  qc.invalidateQueries({ queryKey: getListInventoryLocationsQueryKey() });
                  qc.invalidateQueries({ predicate: q => JSON.stringify(q.queryKey).includes('stock') });
                }
                qc.invalidateQueries({ queryKey: getGetFinancialsSummaryQueryKey() });
                qc.invalidateQueries({ predicate: q => JSON.stringify(q.queryKey).includes('summary') });
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

              // Remove receipt if staff clicked the trash button and no new file was chosen
              if (removeReceipt && !receiptFile && editingExpense) {
                await customFetch(`/api/expenses/${saved.id}/receipt`, { method: 'DELETE' });
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

function VendorForm({ editing, categories,onSubmit }: { editing: Vendor | null;categories:ExpenseCategory[]; onSubmit: (values: { name: string; category?: string; contact?: string; notes?: string;contactName?:string;contactPhone?:string;officePhone?:string }) => Promise<void> }) {
  const [name, setName] = useState(editing?.name ?? '');
  const [category, setCategory] = useState(editing?.category ?? '');
  const [contact, setContact] = useState(editing?.contact ?? '');
  const [contactName,setContactName]=useState(editing?.contactName??'');
  const [officePhone,setOfficePhone]=useState(editing?.officePhone??'');
  const [contactPhone,setContactPhone]=useState((editing as VendorX|null)?.contactPhone??'');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Vendor name is required'); return; }
    setSaving(true);
    try {
      await onSubmit({ name: name.trim(), category, contact: contact.trim(), notes: notes.trim(),contactName:contactName.trim(),contactPhone:contactPhone.trim(),officePhone:officePhone.trim() });
    } catch(error){
      toast.error((error as {data?:{error?:string}})?.data?.error??'Could not save vendor');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 mt-6">
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Name</label>
        <Input title="Vendor or supplier name" value={name} onChange={e => setName(e.target.value)} placeholder="Acme Supply Co." />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1.5"><label className="text-sm font-medium" htmlFor="vendor-contact-name">Contact name</label><Input id="vendor-contact-name" value={contactName} maxLength={200} onChange={e=>setContactName(e.target.value)} placeholder="Your contact at this vendor" data-testid="input-vendor-contact-name"/></div>
        <div className="space-y-1.5"><label className="text-sm font-medium" htmlFor="vendor-contact-phone">Contact phone</label><Input id="vendor-contact-phone" type="tel" maxLength={80} value={contactPhone} onChange={e=>setContactPhone(e.target.value)} placeholder="Your contact's direct or mobile number" data-testid="input-vendor-contact-phone"/></div>
        <div className="space-y-1.5"><label className="text-sm font-medium" htmlFor="vendor-office-phone">Office phone</label><Input id="vendor-office-phone" type="tel" maxLength={80} value={officePhone} onChange={e=>setOfficePhone(e.target.value)} placeholder="Office phone number" data-testid="input-vendor-office-phone"/></div>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Category</label>
        <Select value={category||'__none__'} onValueChange={v=>setCategory(v==='__none__'?'':v)}>
          <SelectTrigger title="Choose the vendor's default expense category"><SelectValue placeholder="Choose a category"/></SelectTrigger>
          <SelectContent><SelectItem value="__none__">No default category</SelectItem>{categories.map(c=><SelectItem key={c.key} value={c.key}>{c.name}</SelectItem>)}
            {category&&!categories.some(c=>c.key===category)&&<SelectItem value={category}>{category} (deleted)</SelectItem>}</SelectContent>
        </Select>
        <ExpenseCategoryManager/>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Email / other contact details</label>
        <Input title="Vendor contact information (phone or email)" value={contact} onChange={e => setContact(e.target.value)} placeholder="Phone or email" />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Notes</label>
        <Textarea title="Additional notes about this vendor (billing terms, special instructions, etc.)" value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
      </div>
      <Button title={editing ? 'Save changes to this vendor' : 'Add this vendor to the list'} className="w-full" onClick={handleSave} disabled={saving}>{editing ? 'Save Changes' : 'Add Vendor'}</Button>
    </div>
  );
}

function ExpenseForm({ editing, defaults, vendors,categories,categoryName, inventoryItems, inventoryLocations, onSubmit }: {
  editing: ExpenseEntry | null;
  defaults?: VendorExpenseDefaultsConfig;
  vendors: Vendor[];
  categories:ExpenseCategory[];
  categoryName:(key:string)=>string;
  inventoryItems: InventoryItem[];
  inventoryLocations: InventoryLocation[];
  onSubmit: (
    values: { vendorId?: number|null; date: string; amount: number; category: string; description?: string; subtotal?: number; salesTaxPct?: number; capitalizeSalesTax?: boolean; shippingAmount?: number; capitalizeShipping?: boolean },
    receiptFile: File | null,
    removeReceipt: boolean,
    inventoryReceipts: ReceiptRowInput[],
  ) => Promise<void>;
}) {
  const [receipts, setReceipts] = useState<ReceiptDraft[]>([]);
  const savedReceipts = receiptsOf(editing);
  const activeLocations = inventoryLocations.filter(l => l.isActive);
  const locationRequired = activeLocations.length > 1;
  const patchReceipt = (key: string, patch: Partial<ReceiptDraft>) => setReceipts(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r));
  const [vendorId, setVendorId] = useState<string>(editing?.vendorId ? String(editing.vendorId) : '');
  const [date, setDate] = useState(editing?.date ?? new Date().toISOString().slice(0, 10));
  const ex = editing as (ExpenseEntry & { subtotal?: number | null; salesTaxPct?: number | null; capitalizeSalesTax?: boolean | null; salesTaxAmount?: number | null; shippingAmount?: number | null; capitalizeShipping?: boolean | null }) | null;
  // Subtotal is pre-tax; legacy expenses without a subtotal treat amount as the subtotal (no double tax).
  const [amount, setAmount] = useState(ex ? String(ex.subtotal ?? ex.amount) : '');
  const initialDefaults = defaults ? resolveVendorExpenseDefaults(defaults) : undefined;
  const [taxPct, setTaxPct] = useState(String(ex ? ex.salesTaxPct ?? 0 : initialDefaults?.salesTaxPct ?? 0));
  const [capitalizeTax, setCapitalizeTax] = useState(ex ? !!ex.capitalizeSalesTax : initialDefaults?.capitalizeSalesTax ?? false);
  const [shipping, setShipping] = useState(String(ex ? ex.shippingAmount ?? 0 : initialDefaults?.shippingAmount ?? 0));
  const [capitalizeShipping, setCapitalizeShipping] = useState(ex ? !!ex.capitalizeShipping : initialDefaults?.capitalizeShipping ?? false);
  const financialLocked = savedReceipts.length > 0;
  const subCents = Math.round((parseFloat(amount) || 0) * 100);
  const rate = Math.min(100, Math.max(0, parseFloat(taxPct) || 0));
  const taxCents = Math.round(subCents * rate / 100);
  const shipCents = Math.max(0, Math.round((parseFloat(shipping) || 0) * 100));
  const totalCents = subCents + taxCents + shipCents;
  const taxFactor = capitalizeTax ? 1 + rate / 100 : 1;
  // Preview only; the server does the authoritative allocation (by pre-tax value, or quantity when all values are 0).
  const draftBases = receipts.map(r => { const q = Number(r.quantity), c = Number(r.costPrice); const okQ = Number.isFinite(q) && q > 0 ? q : 0; return { q: okQ, base: okQ * (Number.isFinite(c) && c > 0 ? c : 0) }; });
  const baseTotal = draftBases.reduce((t, d) => t + d.base, 0);
  const qtyTotal = draftBases.reduce((t, d) => t + d.q, 0);
  const landedUnit = (i: number, cost: number) => {
    const d = draftBases[i]; let ship = 0;
    if (capitalizeShipping && shipCents > 0 && d && d.q > 0) {
      const share = baseTotal > 0 ? d.base / baseTotal : qtyTotal > 0 ? d.q / qtyTotal : 0;
      ship = (shipCents / 100) * share / d.q;
    }
    return cost * taxFactor + ship;
  };
  const [category, setCategory] = useState(editing?.category ?? 'other');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptRemoved, setReceiptRemoved] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const existingReceiptUrl = receiptRemoved ? null : (editing?.receiptUrl ?? null);

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
    if (!date || !amt || amt <= 0) { toast.error('Enter a valid date and subtotal'); return; }
    const pct = Number(taxPct || 0);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) { toast.error('Sales tax rate must be between 0 and 100'); return; }
    const shipVal = Number(shipping || 0);
    if (!Number.isFinite(shipVal) || shipVal < 0) { toast.error('Shipping must be 0 or more'); return; }
    if (!financialLocked && capitalizeShipping && shipVal > 0 && !editing && receipts.length === 0) { toast.error('Add a received supply, or turn off including delivery in supply costs for this expense'); return; }
    const rows: ReceiptRowInput[] = [];
    if (!editing) {
      for (const [i, r] of receipts.entries()) {
        const n = i + 1;
        if (!r.itemId) { toast.error(`Inventory row ${n}: choose an item`); return; }
        if (locationRequired && !r.locationId) { toast.error(`Inventory row ${n}: choose a receiving location`); return; }
        const qty = Number(r.quantity);
        if (!Number.isInteger(qty) || qty <= 0) { toast.error(`Inventory row ${n}: quantity must be a whole number above 0`); return; }
        const cost = Number(r.costPrice);
        if (r.costPrice.trim() === '' || !Number.isFinite(cost) || cost < 0) { toast.error(`Inventory row ${n}: unit cost must be 0 or more`); return; }
        let markup: number | undefined;
        if (r.updatePrice && r.markupPct.trim() !== '') {
          markup = Number(r.markupPct);
          if (!Number.isFinite(markup) || markup < 0) { toast.error(`Inventory row ${n}: markup must be 0 or more`); return; }
        }
        rows.push({
          inventoryItemId: Number(r.itemId),
          ...(r.locationId ? { locationId: Number(r.locationId) } : {}),
          quantity: qty, costPrice: cost, updatePrice: r.updatePrice,
          ...(markup !== undefined ? { markupPct: markup } : {}),
        });
      }
    }
    setSaving(true);
    try {
      await onSubmit(
        {
          vendorId: vendorId ? parseInt(vendorId, 10) : null,
          date,
          category,
          description: description.trim() || undefined,
          ...(financialLocked && ex
            ? { amount: ex.amount }
            : { amount: totalCents / 100, subtotal: subCents / 100, salesTaxPct: pct, capitalizeSalesTax: capitalizeTax, shippingAmount: shipCents / 100, capitalizeShipping: capitalizeShipping && shipCents > 0 }),
        },
        receiptFile,
        receiptRemoved,
        rows,
      );
    } catch(error){
      toast.error((error as {data?:{error?:string}})?.data?.error??(error instanceof Error?error.message:'Could not save expense'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 mt-6">
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Vendor</label>
        <Select value={vendorId||'__none__'} onValueChange={v=>{
          const next=v==='__none__'?'':v;setVendorId(next);
          setCategory(vendors.find(v=>String(v.id)===next)?.category||'other');
          if (!editing && defaults) {
            const values = resolveVendorExpenseDefaults(defaults, next ? Number(next) : null);
            setTaxPct(String(values.salesTaxPct)); setShipping(String(values.shippingAmount));
            setCapitalizeTax(values.capitalizeSalesTax); setCapitalizeShipping(values.capitalizeShipping);
          }
        }}>
          <SelectTrigger title="Choose the vendor first"><SelectValue placeholder="Choose a vendor or No vendor"/></SelectTrigger>
          <SelectContent><SelectItem value="__none__">No vendor / manual expense</SelectItem>{vendors.map(v=><SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{editing ? 'Changing the vendor does not change this expense’s recorded tax or delivery.' : 'Selecting a vendor fills its category and tax/delivery defaults. You can adjust these for this expense.'}</p>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Date</label>
        <Input type="date" title="Date of this expense" value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="expense-subtotal">Subtotal (before tax)</label>
        <Input id="expense-subtotal" type="number" step="0.01" min={0} disabled={financialLocked} value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" data-testid="input-expense-subtotal" />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="expense-tax-pct">Sales tax rate (%)</label>
        <Input id="expense-tax-pct" type="number" step="0.001" min={0} max={100} disabled={financialLocked} value={taxPct} onChange={e => setTaxPct(e.target.value)} data-testid="input-expense-tax-pct" />
      </div>
      <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1" data-testid="panel-expense-totals">
        <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">${(subCents / 100).toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Sales tax ({rate}%)</span><span className="tabular-nums">${(taxCents / 100).toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Shipping / delivery (not taxed)</span><span className="tabular-nums">${(shipCents / 100).toFixed(2)}</span></div>
        <div className="flex justify-between font-semibold border-t pt-1"><span>Total paid</span><span className="tabular-nums" data-testid="text-expense-total">${(totalCents / 100).toFixed(2)}</span></div>
        {financialLocked && <p className="text-xs text-muted-foreground pt-1">Subtotal, tax and shipping are locked because stock was received on this expense. You can still change the date, vendor, category and description.</p>}
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="expense-shipping">Shipping / delivery</label>
        <Input id="expense-shipping" type="number" step="0.01" min={0} disabled={financialLocked} value={shipping} onChange={e => setShipping(e.target.value)} placeholder="0.00" data-testid="input-expense-shipping" />
        <p className="text-xs text-muted-foreground">Added to the total after tax. Sales tax is never applied to shipping.</p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={capitalizeShipping} disabled={financialLocked} onChange={e => setCapitalizeShipping(e.target.checked)} data-testid="checkbox-capitalize-shipping" />
        <span>Add shipping to the cost of received supplies<span className="block text-xs text-muted-foreground">The whole shipping charge is spread across the supplies received below, in proportion to their pre-tax value (or by quantity if they're all $0). Requires at least one received supply.</span></span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={capitalizeTax} disabled={financialLocked} onChange={e => setCapitalizeTax(e.target.checked)} data-testid="checkbox-capitalize-sales-tax" />
        <span>Include sales tax in supply cost<span className="block text-xs text-muted-foreground">The received unit cost includes tax, so stock cost and markup are based on the tax-inclusive cost.</span></span>
      </label>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Category</label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger title="Select the expense category"><SelectValue /></SelectTrigger>
          <SelectContent>
            {categories.map(c => <SelectItem key={c.key} value={c.key}>{c.name}</SelectItem>)}
            {category && !categories.some(c => c.key === category) && <SelectItem value={category}>{categoryName(category)} (deleted)</SelectItem>}
          </SelectContent>
        </Select>
      </div>
      <ExpenseCategoryManager/>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Description</label>
        <Textarea title="Brief description of what the expense was for" value={description} onChange={e => setDescription(e.target.value)} rows={2} />
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
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-destructive hover:text-destructive"
              title="Remove receipt"
              onClick={() => setReceiptRemoved(true)}
            >
              <Trash2 className="w-3.5 h-3.5" />
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
          title="Attach a receipt image or PDF for this expense"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="w-4 h-4" />
          {receiptFile || existingReceiptUrl ? 'Replace Receipt' : 'Attach Receipt'}
        </Button>
      </div>

      {/* Inventory receipts */}
      {editing ? (
        savedReceipts.length > 0 && (
          <div className="space-y-1.5 rounded-md border bg-muted/30 p-3" data-testid="list-saved-inventory-receipts">
            <p className="text-sm font-medium flex items-center gap-1.5"><PackagePlus className="w-4 h-4" /> Inventory received</p>
            {savedReceipts.map((r, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                {r.quantity ?? 0} x {r.itemName ?? `Item #${r.inventoryItemId}`}{r.locationName ? ` to ${r.locationName}` : ''} at ${Number(r.purchaseCostPrice ?? r.costPrice ?? 0).toFixed(2)} each{r.purchaseCostPrice != null && Number(r.purchaseCostPrice) !== Number(r.costPrice ?? 0) ? ` before tax, stock cost $${Number(r.costPrice ?? 0).toFixed(2)}` : ''}{r.shippingAllocation != null && Number(r.shippingAllocation) > 0 ? `, shipping share $${Number(r.shippingAllocation).toFixed(2)}` : ''}{r.landedUnitCost != null ? `, landed $${Number(r.landedUnitCost).toFixed(2)} each` : ''}{r.updatePrice ? ' (selling price updated' + (r.markupPct != null ? `, markup ${r.markupPct}%` : '') + ')' : ''}
              </p>
            ))}
            <p className="text-xs text-muted-foreground">Stock was already applied when this expense was logged. Editing the expense does not change inventory, and this expense cannot be deleted. Adjust stock from Inventory if needed.</p>
          </div>
        )
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Inventory received (optional)</label>
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setReceipts(rs => [...rs, newDraft()])} data-testid="button-add-inventory-receipt">
              <PackagePlus className="w-3.5 h-3.5" /> Add item
            </Button>
          </div>
          {receipts.length > 0 && <p className="text-xs text-muted-foreground">Stock is added once when the expense is saved and cannot be edited on the expense later. Job costing uses the highest paid cost among batches still in stock, so a cheaper new delivery won't lower the cost until the pricier stock is used up.</p>}
          {receipts.map((r, i) => {
            const item = inventoryItems.find(it => String(it.id) === r.itemId);
            return (
              <div key={r.key} className="rounded-md border p-2.5 space-y-2 bg-muted/20" data-testid={`row-inventory-receipt-${i}`}>
                <div className="flex gap-2">
                  <Select value={r.itemId} onValueChange={v => patchReceipt(r.key, { itemId: v, costPrice: r.costPrice || String(inventoryItems.find(it => String(it.id) === v)?.costPrice ?? '') })}>
                    <SelectTrigger className="h-8 text-xs flex-1" data-testid={`select-receipt-item-${i}`}><SelectValue placeholder="Select item" /></SelectTrigger>
                    <SelectContent>{inventoryItems.map(it => <SelectItem key={it.id} value={String(it.id)}>{it.name}{it.sku ? ` (${it.sku})` : ''}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Remove row" onClick={() => setReceipts(rs => rs.filter(x => x.key !== r.key))}><X className="w-3.5 h-3.5" /></Button>
                </div>
                <Select value={r.locationId || '__none__'} onValueChange={v => patchReceipt(r.key, { locationId: v === '__none__' ? '' : v })}>
                  <SelectTrigger className="h-8 text-xs" data-testid={`select-receipt-location-${i}`}><SelectValue placeholder={locationRequired ? 'Choose receiving location' : 'Receiving location (optional)'} /></SelectTrigger>
                  <SelectContent>
                    {!locationRequired && <SelectItem value="__none__">{activeLocations.length === 1 ? `Default (${activeLocations[0].name})` : 'No specific location'}</SelectItem>}
                    {activeLocations.map(l => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-2 gap-2">
                  <Input type="number" min={1} step={1} className="h-8 text-xs" placeholder="Quantity" value={r.quantity} onChange={e => patchReceipt(r.key, { quantity: e.target.value })} data-testid={`input-receipt-qty-${i}`} />
                  <Input type="number" min={0} step="0.01" className="h-8 text-xs" placeholder="Unit cost" value={r.costPrice} onChange={e => patchReceipt(r.key, { costPrice: e.target.value })} data-testid={`input-receipt-cost-${i}`} />
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={r.updatePrice} onChange={e => patchReceipt(r.key, { updatePrice: e.target.checked })} data-testid={`checkbox-receipt-update-${i}`} />
                  Update selling price (keeps the item's markup)
                </label>
                {r.updatePrice && (
                  <Input type="number" min={0} step="0.1" className="h-8 text-xs"
                    placeholder={`Markup % override (blank keeps ${item?.markupPct ?? 'existing'}%)`}
                    value={r.markupPct} onChange={e => patchReceipt(r.key, { markupPct: e.target.value })} data-testid={`input-receipt-markup-${i}`} />
                )}
                {r.costPrice.trim() !== '' && Number.isFinite(Number(r.costPrice)) && (
                  <p className="text-xs text-muted-foreground" data-testid={`text-receipt-effective-cost-${i}`}>
                    Estimated landed unit cost: ${landedUnit(i, Number(r.costPrice)).toFixed(2)}
                    {[capitalizeTax && rate > 0 ? `${rate}% tax` : '', capitalizeShipping && shipCents > 0 ? 'shipping share' : ''].filter(Boolean).length ? ` (includes ${[capitalizeTax && rate > 0 ? `${rate}% tax` : '', capitalizeShipping && shipCents > 0 ? 'shipping share' : ''].filter(Boolean).join(' and ')})` : ''}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Button title={editing ? 'Save changes to this expense' : 'Log this expense to the ledger'} className="w-full" onClick={handleSave} disabled={saving}>
        {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{receiptFile ? 'Uploading…' : 'Saving…'}</> : (editing ? 'Save Changes' : 'Log Expense')}
      </Button>
    </div>
  );
}
