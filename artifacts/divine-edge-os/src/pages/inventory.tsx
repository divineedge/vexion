import React, { useState } from 'react';
import {
  useListInventoryItems, getListInventoryItemsQueryKey,
  useGetInventoryItem, getGetInventoryItemQueryKey,
  useGetInventorySummary, getGetInventorySummaryQueryKey,
  useCreateInventoryItem, useUpdateInventoryItem, useDeleteInventoryItem,
  useAdjustInventoryStock,
  useGetTenantSettings, getGetTenantSettingsQueryKey,
  useListInventoryLocations, getListInventoryLocationsQueryKey,
  useCreateInventoryLocation, useUpdateInventoryLocation, useDeleteInventoryLocation,
  useGetLocationStock, getGetLocationStockQueryKey,
  useTransferInventoryStock,
  useGetInventoryItemByLocation, getGetInventoryItemByLocationQueryKey,
} from '@workspace/api-client-react';
import type { InventoryLocation } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ImportExportControls } from '@/components/data-io/ImportExportControls';
import {
  Search, Plus, AlertTriangle, Package, DollarSign, Edit, Trash2,
  TrendingUp, ArrowRight, Eye, EyeOff, PlusCircle, MinusCircle,
  Warehouse, Truck, ArrowLeftRight, MapPin,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useDebounce } from '@/hooks/use-debounce';

function ItemLocationSection({ inventoryItemId }: { inventoryItemId: number }) {
  const { data: locationStock } = useGetInventoryItemByLocation(inventoryItemId, {
    query: { queryKey: getGetInventoryItemByLocationQueryKey(inventoryItemId) },
  });
  if (!locationStock || locationStock.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
        <MapPin className="w-3.5 h-3.5" /> Stock by Location
      </p>
      <div className="rounded-lg border divide-y text-sm">
        {locationStock.map(loc => (
          <div key={loc.id} className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              {loc.locationName?.toLowerCase().includes('trailer')
                ? <Truck className="w-3.5 h-3.5 text-muted-foreground" />
                : <Warehouse className="w-3.5 h-3.5 text-muted-foreground" />}
              <span>{loc.locationName}</span>
            </div>
            <span className={`font-semibold ${loc.isLowStock ? 'text-destructive' : ''}`}>
              {loc.quantity} {loc.unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  availableForBlueprint: boolean;
  commissionPct: string;
};

const EMPTY_FORM: ItemForm = {
  name: '', sku: '', description: '', category: '',
  costPrice: '', markupPct: '', quantity: '0', reorderPoint: '5', unit: 'each',
  availableForBlueprint: false, commissionPct: '',
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

  // Locations
  const [activeTab, setActiveTab] = useState<'all' | 'by-location'>('all');
  const [selectedLocationId, setSelectedLocationId] = useState<number | 'all'>('all');
  const [locDialogOpen, setLocDialogOpen] = useState(false);
  const [locForm, setLocForm] = useState({ name: '', description: '', type: 'warehouse' as 'warehouse' | 'trailer' | 'other' });
  const [editingLocId, setEditingLocId] = useState<number | null>(null);

  // Transfer dialog
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  // 'main_stock' is a UI sentinel for "from main warehouse" — mapped to undefined/null on submit
  const [transferForm, setTransferForm] = useState({ inventoryItemId: '', fromLocationId: 'main_stock', toLocationId: '', quantity: '1', reason: '' });

  // Stock adjustment dialog
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [adjustItemId, setAdjustItemId] = useState<number | null>(null);
  const [adjustItemName, setAdjustItemName] = useState('');
  const [adjustDelta, setAdjustDelta] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const defaultMarkupPct = settings?.defaultMarkupPct ?? 20;
  const showCostPriceToTech = settings?.showCostPriceToTech ?? false;
  const canSeeCost = !isTechnician || showCostPriceToTech;

  const adjustStock = useAdjustInventoryStock();

  // Location hooks
  const { data: locations } = useListInventoryLocations({ query: { queryKey: getListInventoryLocationsQueryKey() } });
  const createLocation = useCreateInventoryLocation();
  const updateLocation = useUpdateInventoryLocation();
  const deleteLocation = useDeleteInventoryLocation();
  const transferStock = useTransferInventoryStock();
  const { data: locationStock } = useGetLocationStock(
    typeof selectedLocationId === 'number' ? selectedLocationId : 0,
    { query: { enabled: typeof selectedLocationId === 'number', queryKey: getGetLocationStockQueryKey(typeof selectedLocationId === 'number' ? selectedLocationId : 0) } }
  );

  const handleSaveLocation = () => {
    if (!locForm.name) { toast.error('Location name is required'); return; }
    if (editingLocId) {
      updateLocation.mutate({ id: editingLocId, data: locForm }, {
        onSuccess: () => {
          toast.success('Location updated');
          qc.invalidateQueries({ queryKey: getListInventoryLocationsQueryKey() });
          setLocDialogOpen(false);
          setEditingLocId(null);
        },
        onError: () => toast.error('Failed to update location'),
      });
    } else {
      createLocation.mutate({ data: locForm }, {
        onSuccess: () => {
          toast.success('Location created');
          qc.invalidateQueries({ queryKey: getListInventoryLocationsQueryKey() });
          setLocDialogOpen(false);
        },
        onError: () => toast.error('Failed to create location'),
      });
    }
  };

  const handleTransfer = () => {
    if (!transferForm.inventoryItemId || !transferForm.toLocationId || !transferForm.quantity) {
      toast.error('Fill in all required transfer fields');
      return;
    }
    const fromLocId = transferForm.fromLocationId === 'main_stock' ? undefined : parseInt(transferForm.fromLocationId, 10);
    transferStock.mutate({
      data: {
        inventoryItemId: parseInt(transferForm.inventoryItemId, 10),
        fromLocationId: fromLocId,
        toLocationId: parseInt(transferForm.toLocationId, 10),
        quantity: parseInt(transferForm.quantity, 10),
        reason: transferForm.reason || undefined,
      }
    }, {
      onSuccess: () => {
        toast.success('Stock transferred');
        qc.invalidateQueries({ queryKey: getListInventoryLocationsQueryKey() });
        qc.invalidateQueries({ queryKey: getListInventoryItemsQueryKey() });
        setTransferDialogOpen(false);
        setTransferForm({ inventoryItemId: '', fromLocationId: 'main_stock', toLocationId: '', quantity: '1', reason: '' });
      },
      onError: (e: any) => toast.error(e?.message ?? 'Transfer failed'),
    });
  };

  const openAdjustDialog = (id: number, name: string) => {
    setAdjustItemId(id);
    setAdjustItemName(name);
    setAdjustDelta('');
    setAdjustReason('');
    setAdjustDialogOpen(true);
  };

  const handleAdjustStock = () => {
    if (!adjustItemId || !adjustDelta) { toast.error('Enter a quantity change'); return; }
    const delta = parseInt(adjustDelta, 10);
    if (isNaN(delta) || delta === 0) { toast.error('Enter a non-zero quantity'); return; }
    adjustStock.mutate({ id: adjustItemId, data: { delta, reason: adjustReason || undefined } }, {
      onSuccess: () => {
        toast.success(`Stock adjusted by ${delta > 0 ? '+' : ''}${delta}`);
        qc.invalidateQueries({ queryKey: getListInventoryItemsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetInventorySummaryQueryKey() });
        if (selectedId === adjustItemId) qc.invalidateQueries({ queryKey: getGetInventoryItemQueryKey(adjustItemId) });
        setAdjustDialogOpen(false);
      },
      onError: () => toast.error('Failed to adjust stock'),
    });
  };

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
    // Do NOT pre-fill markupPct — leave it blank so the placeholder shows the current
    // default and the server uses the live tenant default (avoids stale frontend value).
    setForm({ ...EMPTY_FORM });
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
      availableForBlueprint: item.availableForBlueprint ?? false,
      commissionPct: item.commissionPct != null ? String(item.commissionPct) : '',
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
      availableForBlueprint: form.availableForBlueprint,
      commissionPct: form.commissionPct ? parseFloat(form.commissionPct) : undefined,
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
        <div className="flex items-center gap-2">
          <ImportExportControls
            entity="inventory"
            entityLabel="Inventory"
            exportQuery={{ q: search || undefined }}
            onImportComplete={() => {
              qc.invalidateQueries({ queryKey: getListInventoryItemsQueryKey() });
              qc.invalidateQueries({ queryKey: getGetInventorySummaryQueryKey() });
            }}
          />
          {canManage && (
            <Button variant="outline" className="gap-2" onClick={() => { setTransferDialogOpen(true); }}>
              <ArrowLeftRight className="w-4 h-4" /> Transfer
            </Button>
          )}
          {canManage && (
            <Button className="gap-2" onClick={openCreate}>
              <Plus className="w-4 h-4" /> Add Item
            </Button>
          )}
        </div>
      </div>

      {/* Location filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => { setActiveTab('all'); setSelectedLocationId('all'); }}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${activeTab === 'all' && selectedLocationId === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted border-border'}`}
        >
          All Items
        </button>
        {locations?.map(loc => (
          <button
            key={loc.id}
            onClick={() => { setActiveTab('by-location'); setSelectedLocationId(loc.id); }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors flex items-center gap-1.5 ${typeof selectedLocationId === 'number' && selectedLocationId === loc.id ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted border-border'}`}
          >
            {loc.type === 'trailer' ? <Truck className="w-3 h-3" /> : loc.type === 'warehouse' ? <Warehouse className="w-3 h-3" /> : <MapPin className="w-3 h-3" />}
            {loc.name}
          </button>
        ))}
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-muted-foreground gap-1"
            onClick={() => { setEditingLocId(null); setLocForm({ name: '', description: '', type: 'warehouse' }); setLocDialogOpen(true); }}
          >
            <Plus className="w-3 h-3" /> Add Location
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

      {/* By-Location Stock View */}
      {typeof selectedLocationId === 'number' && (
        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-sm">
                {locations?.find(l => l.id === selectedLocationId)?.type === 'trailer'
                  ? <Truck className="w-4 h-4 text-muted-foreground" />
                  : <Warehouse className="w-4 h-4 text-muted-foreground" />
                }
                Stock at: {locations?.find(l => l.id === selectedLocationId)?.name}
              </div>
              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-xs"
                  onClick={() => {
                    const loc = locations?.find(l => l.id === selectedLocationId);
                    if (!loc) return;
                    setEditingLocId(loc.id);
                    setLocForm({ name: loc.name, description: loc.description ?? '', type: loc.type as typeof locForm.type });
                    setLocDialogOpen(true);
                  }}
                >
                  <Edit className="w-3 h-3" /> Edit Location
                </Button>
              )}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Qty at Location</TableHead>
                  <TableHead className="text-right">Reorder At</TableHead>
                  <TableHead className="text-right">Sell Price</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {!locationStock || locationStock.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No stock assigned to this location. Use the Transfer button to move items here.
                    </TableCell>
                  </TableRow>
                ) : locationStock.map(entry => (
                  <TableRow
                    key={entry.id}
                    className={entry.isLowStock ? 'bg-destructive/5' : ''}
                  >
                    <TableCell className="font-medium flex items-center gap-1.5">
                      {entry.isLowStock && <AlertTriangle className="w-3.5 h-3.5 text-destructive" />}
                      {entry.itemName}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{entry.itemSku}</TableCell>
                    <TableCell className="text-right">
                      <span className={`font-bold ${entry.isLowStock ? 'text-destructive' : ''}`}>{entry.quantity}</span>
                      {entry.isLowStock && <Badge variant="destructive" className="ml-2 text-[10px]">Low</Badge>}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{entry.reorderPoint}</TableCell>
                    <TableCell className="text-right">${(entry.unitPrice ?? 0).toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openView(entry.inventoryItemId)}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* All Items Table */}
      {selectedLocationId === 'all' && <Card>
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
      </Card>}

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
                    {selectedItem.availableForBlueprint && <Badge variant="outline" className="text-primary border-primary/40">Blueprint Ready</Badge>}
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

                {canManage && (
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={() => openAdjustDialog(selectedItem.id, selectedItem.name)}
                  >
                    <PlusCircle className="w-4 h-4" /> Adjust Stock
                  </Button>
                )}

                <ItemLocationSection inventoryItemId={selectedItem.id} />

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

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Salesperson Commission (%)</label>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="100"
                placeholder="0"
                value={form.commissionPct}
                onChange={e => setForm(f => ({ ...f, commissionPct: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Percentage of gross margin paid as commission to the salesperson on this item.</p>
            </div>

            <Separator />

            <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/20">
              <div>
                <p className="text-sm font-medium">Available for Blueprint design</p>
                <p className="text-xs text-muted-foreground">Show this item as a pickable option in the Blueprint canvas palette.</p>
              </div>
              <Switch
                checked={form.availableForBlueprint}
                onCheckedChange={v => setForm(f => ({ ...f, availableForBlueprint: v }))}
              />
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

      {/* Location Management Dialog */}
      <Dialog open={locDialogOpen} onOpenChange={open => { if (!open) setLocDialogOpen(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingLocId ? 'Edit Location' : 'New Inventory Location'}</DialogTitle>
            <DialogDescription>Create a named location such as a warehouse or crew trailer.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name <span className="text-destructive">*</span></label>
              <Input placeholder="e.g. Main Warehouse" value={locForm.name} onChange={e => setLocForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Type</label>
              <Select value={locForm.type} onValueChange={v => setLocForm(f => ({ ...f, type: v as typeof locForm.type }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="warehouse">Warehouse</SelectItem>
                  <SelectItem value="trailer">Trailer</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Input placeholder="Optional description" value={locForm.description} onChange={e => setLocForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setLocDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveLocation} disabled={createLocation.isPending || updateLocation.isPending}>
                {createLocation.isPending || updateLocation.isPending ? 'Saving...' : editingLocId ? 'Update' : 'Create'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Transfer Dialog */}
      <Dialog open={transferDialogOpen} onOpenChange={open => { if (!open) setTransferDialogOpen(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer Stock</DialogTitle>
            <DialogDescription>Move inventory from one location to another.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Item <span className="text-destructive">*</span></label>
              <Select value={transferForm.inventoryItemId} onValueChange={v => setTransferForm(f => ({ ...f, inventoryItemId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select item..." /></SelectTrigger>
                <SelectContent>
                  {items?.map(item => (
                    <SelectItem key={item.id} value={String(item.id)}>{item.name} (stock: {item.quantity})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">From Location</label>
                <Select value={transferForm.fromLocationId} onValueChange={v => setTransferForm(f => ({ ...f, fromLocationId: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="main_stock">Main Warehouse Stock</SelectItem>
                    {locations?.map(loc => (
                      <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">To Location <span className="text-destructive">*</span></label>
                <Select value={transferForm.toLocationId} onValueChange={v => setTransferForm(f => ({ ...f, toLocationId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {locations?.map(loc => (
                      <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Quantity <span className="text-destructive">*</span></label>
              <Input type="number" min={1} value={transferForm.quantity} onChange={e => setTransferForm(f => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason</label>
              <Input placeholder="e.g. Stocking trailer for week" value={transferForm.reason} onChange={e => setTransferForm(f => ({ ...f, reason: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setTransferDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleTransfer} disabled={transferStock.isPending}>
                {transferStock.isPending ? 'Transferring...' : 'Transfer'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Stock Adjustment Dialog */}
      <Dialog open={adjustDialogOpen} onOpenChange={open => { if (!open) setAdjustDialogOpen(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust Stock</DialogTitle>
            <DialogDescription>
              Enter a positive number to receive stock, or a negative number to record consumption. Item: <strong>{adjustItemName}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Quantity Change <span className="text-destructive">*</span></label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setAdjustDelta(d => String((parseInt(d || '0', 10) - 1)))}
                >
                  <MinusCircle className="w-4 h-4" />
                </Button>
                <Input
                  type="number"
                  className="text-center font-bold text-lg"
                  value={adjustDelta}
                  onChange={e => setAdjustDelta(e.target.value)}
                  placeholder="0"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setAdjustDelta(d => String((parseInt(d || '0', 10) + 1)))}
                >
                  <PlusCircle className="w-4 h-4" />
                </Button>
              </div>
              {adjustDelta && !isNaN(parseInt(adjustDelta, 10)) && (
                <p className={`text-xs font-medium ${parseInt(adjustDelta, 10) > 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                  {parseInt(adjustDelta, 10) > 0 ? `+${adjustDelta} units will be added` : `${adjustDelta} units will be removed`}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason (optional)</label>
              <Input
                placeholder="e.g. Restocked from supplier"
                value={adjustReason}
                onChange={e => setAdjustReason(e.target.value)}
              />
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="outline" onClick={() => setAdjustDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleAdjustStock} disabled={adjustStock.isPending || !adjustDelta}>
                {adjustStock.isPending ? 'Saving...' : 'Apply Adjustment'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
