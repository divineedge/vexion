import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListInvoiceTemplates, getListInvoiceTemplatesQueryKey,
  useCreateInvoiceTemplate, useUpdateInvoiceTemplate,
  useDeleteInvoiceTemplate, useDuplicateInvoiceTemplate,
  useGetTenantSettings, getGetTenantSettingsQueryKey,
  useUpdateTenantSettings,
} from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Trash2, FileText, Copy, ChevronUp, ChevronDown } from 'lucide-react';
import type { InvoiceTemplate } from '@workspace/api-client-react';

type Layout = 'clean' | 'detailed' | 'compact';
type FeeType = 'percent' | 'flat';

interface LineItem {
  id: string;
  description: string;
  qty: number;
  unitPrice: number;
}

function emptyItem(): LineItem {
  return { id: crypto.randomUUID(), description: '', qty: 1, unitPrice: 0 };
}

const LAYOUT_LABELS: Record<Layout, string> = {
  clean: 'Clean — simple totals, minimal detail',
  detailed: 'Detailed — line items + quantity breakdown',
  compact: 'Compact — condensed single-column',
};

const EMPTY_FORM = {
  name: '',
  layout: 'clean' as Layout,
  termsText: '',
  lateFeeEnabled: false,
  lateFeeType: 'percent' as FeeType,
  lateFeeAmount: 0,
  lateFeeDaysGrace: 7,
};

export default function InvoiceTemplatesSettings() {
  const qc = useQueryClient();
  const [sheetMode, setSheetMode] = useState<'create' | 'edit' | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyItem()]);
  const [deleteTemplatePending, setDeleteTemplatePending] = useState(false);

  const { data: templates, isLoading } = useListInvoiceTemplates({
    query: { queryKey: getListInvoiceTemplatesQueryKey() },
  });
  const { data: settings } = useGetTenantSettings({
    query: { queryKey: getGetTenantSettingsQueryKey() },
  });
  const updateSettings = useUpdateTenantSettings();

  const invalidate = () => qc.invalidateQueries({ queryKey: getListInvoiceTemplatesQueryKey() });
  const createMutation = useCreateInvoiceTemplate();
  const updateMutation = useUpdateInvoiceTemplate();
  const deleteMutation = useDeleteInvoiceTemplate();
  const duplicateMutation = useDuplicateInvoiceTemplate();

  const moveItem = (idx: number, dir: -1 | 1) => {
    setLineItems(items => {
      const next = [...items];
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= next.length) return items;
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  };

  const updateLineItem = (idx: number, patch: Partial<LineItem>) =>
    setLineItems(items => items.map((item, i) => (i === idx ? { ...item, ...patch } : item)));

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setLineItems([emptyItem()]);
    setSelectedId(null);
    setDeleteTemplatePending(false);
    setSheetMode('create');
  };

  const openEdit = (t: InvoiceTemplate) => {
    const items = ((t.lineItems as unknown[]) ?? []).map((i: any) => ({
      id: i.id ?? crypto.randomUUID(),
      description: i.description ?? '',
      qty: i.quantity ?? i.qty ?? 1,
      unitPrice: i.unitPrice ?? 0,
    }));
    setForm({
      name: t.name,
      layout: (t.layout ?? 'clean') as Layout,
      termsText: t.termsText ?? '',
      lateFeeEnabled: t.lateFeeEnabled ?? false,
      lateFeeType: (t.lateFeeType ?? 'percent') as FeeType,
      lateFeeAmount: t.lateFeeAmount ?? 0,
      lateFeeDaysGrace: t.lateFeeDaysGrace ?? 7,
    });
    setLineItems(items.length > 0 ? items : [emptyItem()]);
    setSelectedId(t.id);
    setDeleteTemplatePending(false);
    setSheetMode('edit');
  };

  const handleDuplicate = (t: InvoiceTemplate, e: React.MouseEvent) => {
    e.stopPropagation();
    duplicateMutation.mutate({ id: t.id }, {
      onSuccess: (copy) => {
        toast.success('Template duplicated');
        invalidate();
        openEdit(copy as InvoiceTemplate);
      },
      onError: () => toast.error('Failed to duplicate template'),
    });
  };

  const handleSave = () => {
    if (!form.name.trim()) { toast.error('Template name is required'); return; }

    const payload = {
      name: form.name.trim(),
      layout: form.layout,
      lineItems: lineItems.map(i => ({
        id: i.id,
        description: i.description,
        quantity: i.qty,
        unitPrice: i.unitPrice,
      })),
      termsText: form.termsText.trim() || undefined,
      lateFeeEnabled: form.lateFeeEnabled,
      lateFeeType: form.lateFeeEnabled ? form.lateFeeType : undefined,
      lateFeeAmount: form.lateFeeEnabled ? form.lateFeeAmount : undefined,
      lateFeeDaysGrace: form.lateFeeDaysGrace,
    };

    if (sheetMode === 'create') {
      createMutation.mutate({ data: payload }, {
        onSuccess: () => { toast.success('Invoice template created'); invalidate(); setSheetMode(null); },
        onError: () => toast.error('Failed to create invoice template'),
      });
    } else if (sheetMode === 'edit' && selectedId != null) {
      updateMutation.mutate({ id: selectedId, data: payload }, {
        onSuccess: () => { toast.success('Invoice template updated'); invalidate(); setSheetMode(null); },
        onError: () => toast.error('Failed to update invoice template'),
      });
    }
  };

  const handleDelete = () => {
    if (selectedId == null) return;
    if (!deleteTemplatePending) { setDeleteTemplatePending(true); return; }
    setDeleteTemplatePending(false);
    deleteMutation.mutate({ id: selectedId }, {
      onSuccess: () => { toast.success('Invoice template deleted'); invalidate(); setSheetMode(null); },
      onError: () => { toast.error('Failed to delete invoice template'); setDeleteTemplatePending(false); },
    });
  };

  const closeSheet = (open: boolean) => {
    if (!open) { setSheetMode(null); setDeleteTemplatePending(false); }
  };

  const handleDefaultChange = (value: string) => {
    const id = value === '' ? null : parseInt(value, 10);
    updateSettings.mutate(
      { data: { defaultInvoiceTemplateId: id as any } },
      {
        onSuccess: () => {
          toast.success(id ? 'Default template updated' : 'Default template cleared');
          qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() });
        },
        onError: () => toast.error('Failed to update default template'),
      }
    );
  };

  const currentDefault = (settings as any)?.defaultInvoiceTemplateId ?? null;

  return (
    <div className="space-y-4">
      {/* Default template picker */}
      {(templates ?? []).length > 0 && (
        <Card>
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Default Invoice Template</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Automatically applied when staff create a new invoice. Staff can override per-invoice.
                </p>
              </div>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-48"
                value={currentDefault ?? ''}
                onChange={e => handleDefaultChange(e.target.value)}
                disabled={updateSettings.isPending}
              >
                <option value="">None — no default</option>
                {(templates ?? []).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Invoice Templates</h3>
          <p className="text-sm text-muted-foreground">
            Define layouts, pre-filled line items, terms &amp; conditions, and late-fee policies for invoices.
          </p>
        </div>
        <Button size="sm" className="gap-2" onClick={openCreate}>
          <Plus className="w-4 h-4" /> Add Template
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template Name</TableHead>
                <TableHead>Layout</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead>Late Fee</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Loading...</TableCell>
                </TableRow>
              ) : (templates ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No invoice templates yet. Create one to apply a consistent look to every invoice.
                  </TableCell>
                </TableRow>
              ) : (templates ?? []).map(t => (
                <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openEdit(t)}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">{t.layout}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {((t.lineItems as unknown[]) ?? []).length}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.lateFeeEnabled
                      ? `${t.lateFeeAmount}${t.lateFeeType === 'percent' ? '%' : '$'} after ${t.lateFeeDaysGrace}d`
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost" size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                      onClick={(e) => handleDuplicate(t, e)}
                      disabled={duplicateMutation.isPending}
                      title="Duplicate template"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={sheetMode !== null} onOpenChange={closeSheet}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>
              {sheetMode === 'create' ? 'Add Invoice Template' : 'Edit Invoice Template'}
            </SheetTitle>
            <SheetDescription>
              Configure the layout, pre-filled items, terms, and late-fee policy for this template.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5 pb-8">
            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Template Name <span className="text-destructive">*</span>
              </label>
              <Input
                placeholder="e.g. Standard Invoice, Lawn Care, Seasonal Package"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            {/* Layout picker */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Invoice Layout</label>
              <div className="space-y-2">
                {(Object.entries(LAYOUT_LABELS) as [Layout, string][]).map(([value, label]) => (
                  <label
                    key={value}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      form.layout === value
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="layout"
                      value={value}
                      checked={form.layout === value}
                      onChange={() => setForm(f => ({ ...f, layout: value }))}
                      className="shrink-0"
                    />
                    <div>
                      <p className="text-sm font-medium capitalize">{value}</p>
                      <p className="text-xs text-muted-foreground">{label}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <Separator />

            {/* Line items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Pre-filled Line Items</h3>
                  <p className="text-xs text-muted-foreground">Auto-added to new invoices using this template.</p>
                </div>
                <Button
                  variant="outline" size="sm"
                  onClick={() => setLineItems(items => [...items, emptyItem()])}
                >
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Item
                </Button>
              </div>

              {lineItems.map((item, idx) => (
                <div key={item.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col gap-0.5 shrink-0 pt-0.5">
                      <Button variant="ghost" size="sm" className="h-5 w-6 p-0 text-muted-foreground/60"
                        onClick={() => moveItem(idx, -1)} disabled={idx === 0} title="Move up">
                        <ChevronUp className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-5 w-6 p-0 text-muted-foreground/60"
                        onClick={() => moveItem(idx, 1)} disabled={idx === lineItems.length - 1} title="Move down">
                        <ChevronDown className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="flex-1">
                      <Input
                        placeholder="Description"
                        value={item.description}
                        onChange={e => updateLineItem(idx, { description: e.target.value })}
                      />
                    </div>
                    <Button
                      variant="ghost" size="sm"
                      className="text-muted-foreground h-9 w-9 p-0 shrink-0"
                      onClick={() => setLineItems(items => items.filter((_, j) => j !== idx))}
                      disabled={lineItems.length === 1}
                      title="Remove item"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Qty</label>
                      <Input type="number" min={1} step={1} value={item.qty}
                        onChange={e => updateLineItem(idx, { qty: parseFloat(e.target.value) || 1 })} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Unit Price ($)</label>
                      <Input type="number" min={0} step={0.01} value={item.unitPrice}
                        onChange={e => updateLineItem(idx, { unitPrice: parseFloat(e.target.value) || 0 })} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Separator />

            {/* Terms & Conditions */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Terms &amp; Conditions</label>
              <p className="text-xs text-muted-foreground">Shown at the bottom of every invoice using this template.</p>
              <Textarea
                rows={4}
                placeholder="e.g. Payment due upon receipt. A 1.5% monthly late fee applies after 30 days…"
                value={form.termsText}
                onChange={e => setForm(f => ({ ...f, termsText: e.target.value }))}
              />
            </div>

            <Separator />

            {/* Late Fee */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.lateFeeEnabled}
                    onChange={e => setForm(f => ({ ...f, lateFeeEnabled: e.target.checked }))}
                    className="rounded"
                  />
                  <span className="text-sm font-medium">Enable late-fee notice on overdue invoices</span>
                </label>
              </div>
              {form.lateFeeEnabled && (
                <div className="pl-6 space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Fee Type</label>
                      <select
                        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                        value={form.lateFeeType}
                        onChange={e => setForm(f => ({ ...f, lateFeeType: e.target.value as FeeType }))}
                      >
                        <option value="percent">Percent (%)</option>
                        <option value="flat">Flat ($)</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">
                        {form.lateFeeType === 'percent' ? 'Rate (%)' : 'Amount ($)'}
                      </label>
                      <Input
                        type="number" min={0} step={0.01}
                        value={form.lateFeeAmount}
                        onChange={e => setForm(f => ({ ...f, lateFeeAmount: parseFloat(e.target.value) || 0 }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Grace Period (days)</label>
                      <Input
                        type="number" min={0} step={1}
                        value={form.lateFeeDaysGrace}
                        onChange={e => setForm(f => ({ ...f, lateFeeDaysGrace: parseInt(e.target.value) || 0 }))}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    A late-fee notice will appear on the public invoice page once the invoice is overdue by more than {form.lateFeeDaysGrace} day{form.lateFeeDaysGrace !== 1 ? 's' : ''}.
                  </p>
                </div>
              )}
            </div>

            <Separator />

            {sheetMode === 'edit' && selectedId != null && (
              <Button
                variant={deleteTemplatePending ? 'destructive' : 'ghost'}
                className={deleteTemplatePending ? 'w-full gap-2' : 'text-destructive hover:text-destructive w-full gap-2'}
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="w-4 h-4" />
                {deleteTemplatePending ? 'Confirm delete?' : 'Delete Template'}
              </Button>
            )}

            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setSheetMode(null)}>Cancel</Button>
              <Button
                onClick={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending
                  ? 'Saving…'
                  : sheetMode === 'create'
                  ? 'Create Template'
                  : 'Save Changes'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
