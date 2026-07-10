import React, { useState } from 'react';
import {
  useListInventoryItems, getListInventoryItemsQueryKey,
  useGetInventoryItem, getGetInventoryItemQueryKey,
  useGetInventorySummary, getGetInventorySummaryQueryKey,
  useCreateInventoryItem, useUpdateInventoryItem, useDeleteInventoryItem,
  useGetTenantSettings, getGetTenantSettingsQueryKey,
} from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Plus, AlertTriangle, Package, DollarSign, Edit, Trash2,
  TrendingUp, ArrowRight, Eye, EyeOff,
} from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';

type ItemForm = {
  name: string;
  sku: string;
  description: string;
  category: string;
  costPrice: string;
  markupPct: string;
  quantity: string;
  reorderPoint: string;
  unit: string;
};

const EMPTY_FORM: ItemForm = {
  name: '', sku: '', description: '', category: '',
  costPrice: '', markupPct: '', quantity: '0', reorderPoint: '5', unit: 'each',
};

export default function InventoryPage() {
  const { user, isTechnician } = useAuth();
  const canManage = !isTechnician;
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [sheetMode, setSheetMode] = useState<'create' | 'edit' | 'view' | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<ItemForm>(EMPTY_FORM);
  const [sellPreview, setSellPreview] = useState<number | null>(null);

  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const defaultMarkupPct = settings?.defaultMarkupPct ?? 20;
  const showCostPriceToTech = settings?.showCostPriceToTech ?? false;
  const canSeeCost = !isTechnician || showCostPriceToTech;

  const { data: summary } = useGetInventorySummary({ query: { queryKey: getGetInventorySummaryQueryKey() } });
  const { data: items, isLoading } = useListInventoryItems(
    { q: debouncedSearch || undefined },
    { query: { queryKey: getListInventoryItemsQueryKey({ q: debouncedSearch || undefined }) } },
  );
  const { data: selectedItem } = useGetInventoryItem(selectedId!, {
    query: { enabled: selectedId != null, queryKey: getGetInventoryItemQueryKey(selectedId!) },
  });

  const createItem = useCreateInventoryItem();
  const updateItem = useUpdateInventoryItem();
  const deleteItem = useDeleteInventoryItem();

  // Recompute sell preview whenever cost or markup changes in the form
  const updateSellPreview = (cost: string, markup: string) => {
    const c = parseFloat(cost);
    const m = parseFloat(markup || String(defaultMarkupPct));
    if (!isNaN(c) && !isNaN(m)) setSellPreview(c * (1 + m / 100));
    else setSellPreview(null);
  };

  const openCreate = () => {
    const mPct = String(defaultMarkupPct);
    setForm({ ...EMPTY_FORM, markupPct: mPct });
    setSellPreview(null);
    setSelectedId(null);
    setSheetMode('create');
  };

  const openView = (id: number) => {
    setSelectedId(id);
    setSheetMode('view');
  };

  const openEdit = (id: number) => {
    const item = items?.find(i => i.id === id);
    if (!item) return;
    const costVal = item.costPrice != null ? String(item.costPrice) : '';
    const mPct = String(item.markupPct ?? defaultMarkupPct);
    setForm({
      name: item.name,
      sku: item.sku,
      description: item.description ?? '',
      category: item.category ?? '',
      costPrice: costVal,
      markupPct: mPct,
      quantity: String(item.quantity),
      reorderPoint: String(item.reorderPoint),
      unit: item.unit ?? 'each',
    });
    updateSellPreview(costVal, mPct);
    setSelectedId(id);
    setSheetMode('edit');
  };

  const handleSave = () => {
    if (!form.name || !form.sku) { toast.error('Name and SKU are required'); return; }
    const data = {
      name: form.name,
      sku: form.sku,
      description: form.description || undefined,
      category: form.category || undefined,
      costPrice: parseFloat(form.costPrice) || 0,
      markupPct: form.markupPct ? parseFloat(form.markupPct) : undefined,
      quantity: parseInt(form.quantity, 10) || 0,
      reorderPoint: parseInt(form.reorderPoint, 10) || 5,
      unit: form.unit || 'each',
    };

    if (sheetMode === 'create') {
      createItem.mutate({ data }, {
        onSuccess: () => {
          toast.success('Item added');
          qc.invalidateQueries({ queryKey: getListInventoryItemsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetInventorySummaryQueryKey() });
          setSheetMode(null);
        },
        onError: () => toast.error('Failed to add item'),
      });
    } else if (sheetMode === 'edit' && selectedId) {
      updateItem.mutate({ id: selectedId, data }, {
        onSuccess: () => {
          toast.success('Item updated');
          qc.invalidateQueries({ queryKey: getListInventoryItemsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetInventoryItemQueryKey(selectedId) });
          qc.invalidateQueries({ queryKey: getGetInventorySummaryQueryKey() });
          setSheetMode(null);
        },
        onError: () => toast.error('Failed to update item'),
      });
    }
  };

  const handleDelete = (id: number) => {
    deleteItem.mutate({ id }, {
      onSuccess: () => {
        toast.success('Item deleted');
        qc.invalidateQueries({ queryKey: getListInventoryItemsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetInventorySummaryQueryKey() });
        setSheetMode(null);
      },
      onError: () => toast.error('Failed to delete item'),
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inventory</h1>
          <p className="text-muted-foreground mt-1">Manage parts, tools, and materials.</p>
        </div>
        {canManage && (
          <Button className="gap-2" onClick={openCreate}>
            <Plus className="w-4 h-4" /> Add Item
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Value</p>
              <p className="text-3xl font-bold">${(summary?.totalValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <DollarSign className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Items</p>
              <p className="text-3xl font-bold">{summary?.totalItems ?? 0}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
              <Package className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
        <Card className={(summary?.lowStockCount ?? 0) > 0 ? 'border-destructive/50 bg-destructive/5' : ''}>
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-destructive">Low Stock Alerts</p>
              <p className="text-3xl font-bold text-destructive">{summary?.lowStockCount ?? 0}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by SKU or name..."
                className="pl-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {!canSeeCost && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <EyeOff className="w-3.5 h-3.5" /> Buy price hidden
              </div>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Category</TableHead>
                {canSeeCost && <TableHead className="text-right">Buy Price</TableHead>}
                <TableHead className="text-right">
                  <span className="flex items-center justify-end gap-1">
                    <TrendingUp className="w-3.5 h-3.5" /> Markup
                  </span>
                </TableHead>
                <TableHead className="text-right">Sell Price</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="w-[32px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading inventory...</TableCell></TableRow>
              ) : items?.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No items found.</TableCell></TableRow>
              ) : (
                items?.map(item => (
                  <TableRow
                    key={item.id}
                    className={`cursor-pointer ${item.isLowStock ? 'bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-muted/50'}`}
                    onClick={() => openView(item.id)}
                  >
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{item.sku}</TableCell>
                    <TableCell>
                      {item.category && <Badge variant="outline">{item.category}</Badge>}
                    </TableCell>
                    {canSeeCost && (
                      <TableCell className="text-right text-muted-foreground text-sm">
                        {item.costPrice != null ? `$${item.costPrice.toFixed(2)}` : '—'}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                        {(item.markupPct ?? defaultMarkupPct).toFixed(0)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium">${item.unitPrice.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <span className={`font-medium ${item.isLowStock ? 'text-destructive' : ''}`}>
                        {item.quantity} {item.unit || ''}
                      </span>
                    </TableCell>
                    <TableCell>
                      {item.isLowStock && <AlertTriangle className="w-4 h-4 text-destructive" />}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* View Detail Sheet */}
      <Sheet open={sheetMode === 'view'} onOpenChange={open => { if (!open) setSheetMode(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selectedItem ? (
            <>
              <SheetHeader className="pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <SheetTitle>{selectedItem.name}</SheetTitle>
                    <SheetDescription className="font-mono mt-1">{selectedItem.sku}</SheetDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedItem.isLowStock && <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" /> Low Stock</Badge>}
                    {canManage && (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setSheetMode(null); setTimeout(() => openEdit(selectedItem.id), 50); }}>
                        <Edit className="w-3.5 h-3.5" /> Edit
                      </Button>
                    )}
                  </div>
                </div>
              </SheetHeader>

              <div className="space-y-5">
                {/* Pricing breakdown */}
                <div className="rounded-xl border overflow-hidden">
                  <div className="bg-muted/40 px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pricing</div>
                  <div className="divide-y">
                    {canSeeCost && selectedItem.costPrice != null && (
                      <div className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-2 text-sm">
                          {canSeeCost ? <Eye className="w-4 h-4 text-muted-foreground" /> : <EyeOff className="w-4 h-4 text-muted-foreground" />}
                          <span className="text-muted-foreground">Buy Price</span>
                        </div>
                        <span className="font-medium">${selectedItem.costPrice.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-2 text-sm">
                        <TrendingUp className="w-4 h-4 text-primary" />
                        <span className="text-muted-foreground">Markup</span>
                      </div>
                      <span className="font-medium text-primary">+{(selectedItem.markupPct ?? defaultMarkupPct).toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-3 bg-primary/5">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <ArrowRight className="w-4 h-4 text-primary" />
                        <span>Sell Price</span>
                      </div>
                      <span className="text-lg font-bold text-primary">${selectedItem.unitPrice.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Stock info */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">In Stock</p>
                    <p className={`text-2xl font-bold ${selectedItem.isLowStock ? 'text-destructive' : ''}`}>
                      {selectedItem.quantity} <span className="text-sm font-normal text-muted-foreground">{selectedItem.unit}</span>
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Reorder At</p>
                    <p className="text-2xl font-bold">{selectedItem.reorderPoint} <span className="text-sm font-normal text-muted-foreground">{selectedItem.unit}</span></p>
                  </div>
                  {selectedItem.category && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Category</p>
                      <Badge variant="outline">{selectedItem.category}</Badge>
                    </div>
                  )}
                </div>

                {selectedItem.description && (
                  <>
                    <Separator />
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Description</p>
                      <p className="text-sm">{selectedItem.description}</p>
                    </div>
                  </>
                )}

                {canManage && (
                  <>
                    <Separator />
                    <Button
                      variant="ghost"
                      className="text-destructive hover:text-destructive gap-2 w-full"
                      onClick={() => handleDelete(selectedItem.id)}
                      disabled={deleteItem.isPending}
                    >
                      <Trash2 className="w-4 h-4" /> Delete Item
                    </Button>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">Loading...</div>
          )}
        </SheetContent>
      </Sheet>

      {/* Create / Edit Sheet */}
      <Sheet open={sheetMode === 'create' || sheetMode === 'edit'} onOpenChange={open => { if (!open) setSheetMode(null); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>{sheetMode === 'create' ? 'Add Inventory Item' : 'Edit Item'}</SheetTitle>
            <SheetDescription>
              {sheetMode === 'create' ? 'Add a new part or material to inventory.' : 'Update this item\'s details.'}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 pb-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 col-span-2">
                <label className="text-sm font-medium">Name <span className="text-destructive">*</span></label>
                <Input placeholder="e.g. Brass Gate Valve 1in" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">SKU <span className="text-destructive">*</span></label>
                <Input placeholder="BGV-1IN" className="font-mono" value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Category</label>
                <Input placeholder="Valves" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
              </div>
            </div>

            <Separator />

            {/* Pricing section */}
            <div className="space-y-3">
              <p className="text-sm font-semibold">Pricing</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Buy Price ($)</label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={form.costPrice}
                    onChange={e => {
                      setForm(f => ({ ...f, costPrice: e.target.value }));
                      updateSellPreview(e.target.value, form.markupPct);
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Markup (%)</label>
                  <Input
                    type="number"
                    step="1"
                    placeholder={String(defaultMarkupPct)}
                    value={form.markupPct}
                    onChange={e => {
                      setForm(f => ({ ...f, markupPct: e.target.value }));
                      updateSellPreview(form.costPrice, e.target.value);
                    }}
                  />
                </div>
              </div>

              {/* Sell price preview */}
              <div className={`flex items-center justify-between rounded-lg border px-4 py-3 ${sellPreview != null ? 'border-primary/30 bg-primary/5' : 'border-dashed'}`}>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ArrowRight className="w-4 h-4 text-primary" />
                  <span>Sell Price</span>
                </div>
                <span className={`text-lg font-bold ${sellPreview != null ? 'text-primary' : 'text-muted-foreground'}`}>
                  {sellPreview != null ? `$${sellPreview.toFixed(2)}` : '—'}
                </span>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Quantity</label>
                <Input type="number" min={0} value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Reorder At</label>
                <Input type="number" min={0} value={form.reorderPoint} onChange={e => setForm(f => ({ ...f, reorderPoint: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Unit</label>
                <Input placeholder="each" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Input placeholder="Optional notes" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setSheetMode(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={createItem.isPending || updateItem.isPending}>
                {createItem.isPending || updateItem.isPending ? 'Saving...' : sheetMode === 'create' ? 'Add Item' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
