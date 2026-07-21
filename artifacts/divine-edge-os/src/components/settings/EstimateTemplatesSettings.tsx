import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListEstimateTemplates, getListEstimateTemplatesQueryKey,
  useCreateEstimateTemplate, useUpdateEstimateTemplate, useDeleteEstimateTemplate,
  useDuplicateEstimateTemplate,
} from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Plus, Trash2, FileText, Copy } from 'lucide-react';

interface LineItem {
  id: string;
  description: string;
  qty: number;
  unitPrice: number;
  markup: number;
  discount: number;
  isOptional: boolean;
  optionalPitchLine: string;
}

function emptyItem(): LineItem {
  return {
    id: crypto.randomUUID(),
    description: '',
    qty: 1,
    unitPrice: 0,
    markup: 0,
    discount: 0,
    isOptional: false,
    optionalPitchLine: '',
  };
}

function calcItem(item: LineItem) {
  const base = item.qty * item.unitPrice;
  const afterMarkup = base * (1 + item.markup / 100);
  return afterMarkup * (1 - item.discount / 100);
}

const EMPTY_FORM = { name: '', description: '' };

export default function EstimateTemplatesSettings() {
  const qc = useQueryClient();
  const [sheetMode, setSheetMode] = useState<'create' | 'edit' | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyItem()]);

  const { data: templates, isLoading } = useListEstimateTemplates({
    query: { queryKey: getListEstimateTemplatesQueryKey() },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListEstimateTemplatesQueryKey() });
  const createMutation = useCreateEstimateTemplate();
  const updateMutation = useUpdateEstimateTemplate();
  const deleteMutation = useDeleteEstimateTemplate();
  const duplicateMutation = useDuplicateEstimateTemplate();

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setLineItems([emptyItem()]);
    setSelectedId(null);
    setSheetMode('create');
  };

  const openEdit = (t: NonNullable<typeof templates>[number]) => {
    setForm({ name: t.name, description: t.description ?? '' });
    setSelectedId(t.id);
    const items: LineItem[] = ((t.lineItems as any[]) ?? []).map((i: any) => ({
      id: i.id ?? crypto.randomUUID(),
      description: i.description ?? '',
      qty: i.qty ?? 1,
      unitPrice: i.unitPrice ?? 0,
      markup: i.markup ?? 0,
      discount: i.discount ?? 0,
      isOptional: i.isOptional ?? false,
      optionalPitchLine: i.optionalPitchLine ?? '',
    }));
    setLineItems(items.length > 0 ? items : [emptyItem()]);
    setSheetMode('edit');
  };

  const handleDuplicate = (t: NonNullable<typeof templates>[number], e: React.MouseEvent) => {
    e.stopPropagation();
    duplicateMutation.mutate({ id: t.id }, {
      onSuccess: (copy) => {
        toast.success('Template duplicated');
        invalidate();
        openEdit(copy as NonNullable<typeof templates>[number]);
      },
      onError: () => toast.error('Failed to duplicate template'),
    });
  };

  const updateLineItem = (idx: number, patch: Partial<LineItem>) => {
    setLineItems(items => items.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const subtotal = lineItems.reduce((sum, i) => sum + calcItem(i), 0);

  const handleSave = () => {
    if (!form.name.trim()) {
      toast.error('Template name is required');
      return;
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      lineItems: lineItems.map(i => ({
        id: i.id,
        description: i.description,
        qty: i.qty,
        unitPrice: i.unitPrice,
        markup: i.markup,
        discount: i.discount,
        isOptional: i.isOptional,
        optionalPitchLine: i.optionalPitchLine || null,
        acceptedByCustomer: !i.isOptional,
      })),
    };

    if (sheetMode === 'create') {
      createMutation.mutate({ data: payload }, {
        onSuccess: () => {
          toast.success('Estimate template created');
          invalidate();
          setSheetMode(null);
        },
        onError: () => toast.error('Failed to create estimate template'),
      });
    } else if (sheetMode === 'edit' && selectedId != null) {
      updateMutation.mutate({ id: selectedId, data: payload }, {
        onSuccess: () => {
          toast.success('Estimate template updated');
          invalidate();
          setSheetMode(null);
        },
        onError: () => toast.error('Failed to update estimate template'),
      });
    }
  };

  const handleDelete = () => {
    if (selectedId == null) return;
    if (!window.confirm('Delete this estimate template? This cannot be undone.')) return;
    deleteMutation.mutate({ id: selectedId }, {
      onSuccess: () => {
        toast.success('Estimate template deleted');
        invalidate();
        setSheetMode(null);
      },
      onError: () => toast.error('Failed to delete estimate template'),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Estimate Templates</h3>
          <p className="text-sm text-muted-foreground">
            Pre-build common quote line items so staff can apply a template and send a quote in seconds.
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
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Est. Total</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Loading...</TableCell>
                </TableRow>
              ) : (templates ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-12 text-center text-muted-foreground">
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No estimate templates yet. Create one to speed up quoting.
                  </TableCell>
                </TableRow>
              ) : (templates ?? []).map(t => {
                const items: LineItem[] = ((t.lineItems as any[]) ?? []).map((i: any) => ({
                  id: i.id ?? '',
                  description: i.description ?? '',
                  qty: i.qty ?? 1,
                  unitPrice: i.unitPrice ?? 0,
                  markup: i.markup ?? 0,
                  discount: i.discount ?? 0,
                  isOptional: i.isOptional ?? false,
                  optionalPitchLine: i.optionalPitchLine ?? '',
                }));
                const total = items.reduce((sum, i) => sum + calcItem(i), 0);
                const optionalCount = items.filter(i => i.isOptional).length;
                return (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => openEdit(t)}
                  >
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                      {t.description || '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {items.length}
                      {optionalCount > 0 && (
                        <span className="ml-1 text-xs text-amber-600">+{optionalCount} optional</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      ${total.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                        onClick={(e) => handleDuplicate(t, e)}
                        disabled={duplicateMutation.isPending}
                        title="Duplicate template"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={sheetMode !== null} onOpenChange={open => { if (!open) setSheetMode(null); }}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>
              {sheetMode === 'create' ? 'Add Estimate Template' : 'Edit Estimate Template'}
            </SheetTitle>
            <SheetDescription>
              Define a reusable set of line items. Staff can apply this template when creating a new estimate.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5 pb-8">
            {/* Name & description */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Template Name <span className="text-destructive">*</span>
              </label>
              <Input
                placeholder="e.g. Lawn Mow Quote, Hedge Trim Quote"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                rows={2}
                placeholder="Optional — describe when to use this template."
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            <Separator />

            {/* Line items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Line Items</h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLineItems(items => [...items, emptyItem()])}
                >
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Item
                </Button>
              </div>

              {lineItems.map((item, idx) => (
                <div
                  key={item.id}
                  className={`rounded-lg border p-4 space-y-3 ${
                    item.isOptional ? 'border-dashed border-amber-300 bg-amber-50/50' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <Input
                        placeholder="Description"
                        value={item.description}
                        onChange={e => updateLineItem(idx, { description: e.target.value })}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground h-9 w-9 p-0 shrink-0"
                      onClick={() => setLineItems(items => items.filter((_, j) => j !== idx))}
                      disabled={lineItems.length === 1}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Qty</label>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        value={item.qty}
                        onChange={e => updateLineItem(idx, { qty: parseFloat(e.target.value) || 1 })}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Unit Price</label>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={item.unitPrice}
                        onChange={e => updateLineItem(idx, { unitPrice: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Markup %</label>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={item.markup}
                        onChange={e => updateLineItem(idx, { markup: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Discount %</label>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={item.discount}
                        onChange={e => updateLineItem(idx, { discount: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer text-sm select-none">
                      <input
                        type="checkbox"
                        checked={item.isOptional}
                        onChange={e => updateLineItem(idx, { isOptional: e.target.checked })}
                        className="rounded"
                      />
                      Mark as Optional (Add-On / Upsell)
                    </label>
                    <span className="ml-auto text-sm font-medium">${calcItem(item).toFixed(2)}</span>
                  </div>

                  {item.isOptional && (
                    <Input
                      placeholder="Pitch line shown to customer (e.g. While we're there — trim your hedges for $45)"
                      value={item.optionalPitchLine}
                      onChange={e => updateLineItem(idx, { optionalPitchLine: e.target.value })}
                      className="text-sm"
                    />
                  )}
                </div>
              ))}

              <div className="flex justify-end pt-1">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Template Subtotal</p>
                  <p className="text-lg font-bold">${subtotal.toFixed(2)}</p>
                </div>
              </div>
            </div>

            <Separator />

            {sheetMode === 'edit' && selectedId != null && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive w-full gap-2"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="w-4 h-4" /> Delete Template
              </Button>
            )}

            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setSheetMode(null)}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending
                  ? 'Saving...'
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
