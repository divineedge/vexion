import React, { useState, useMemo } from 'react';
import { useLocation } from 'wouter';
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
  useAdjustLocationStock,
  useGetInventoryItemByLocation, getGetInventoryItemByLocationQueryKey,
  useListInventoryTypes, getListInventoryTypesQueryKey, getListInventoryTypesQueryOptions,
  useListInventorySizes, getListInventorySizesQueryKey, getListInventorySizesQueryOptions,
  useCreateInventoryType,
  useCreateInventorySize,
  useListVendors, getListVendorsQueryKey,
  useUpdateTenantSettings,
  useDuplicateInventoryItems,
} from '@workspace/api-client-react';
import type { InventoryLocation, InventorySize, InventoryType } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { isFromPickerPortal } from '@/components/shared/SearchableCombobox';
import { CreatableOptionMenu } from '@/components/inventory/CreatableOptionMenu';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ImportExportControls } from '@/components/data-io/ImportExportControls';
import {
  Search, Plus, AlertTriangle, Package, DollarSign, Edit, Trash2,
  TrendingUp, ArrowRight, Eye, EyeOff, PlusCircle, MinusCircle,
  Warehouse, Truck, ArrowLeftRight, MapPin, Building2,
  PackageSearch, Copy,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useDebounce } from '@/hooks/use-debounce';
import { upsertInventoryLocation } from '@/lib/inventoryLocations';
import { groupInventoryItems, type InventoryGroupBy } from '@/lib/inventoryGrouping';
import { categoryChoices, feetFromLength, inventoryListFigures, inventorySizeOptions, isPipeTypeName, namedId, pipeSellPerFoot, sizeIdAcrossTypes } from '@/lib/inventoryPartForm';
import { ShrinkageReport } from '@/components/inventory/ShrinkageReport';

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

function LocationStockCard({
  location,
  canManage,
  onEditLocation,
  onViewItem,
  onAdjust,
  onTransfer,
}: {
  location: InventoryLocation;
  canManage: boolean;
  onEditLocation: () => void;
  onViewItem: (id: number) => void;
  onAdjust: (itemId: number, itemName: string) => void;
  onTransfer: () => void;
}) {
  const { data: stock, isLoading } = useGetLocationStock(location.id, {
    query: { queryKey: getGetLocationStockQueryKey(location.id) },
  });
  const lowCount = (stock ?? []).filter(s => s.isLowStock).length;

  return (
    <Card className={lowCount > 0 ? 'border-destructive/30' : ''}>
      <CardContent className="p-0">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-sm">
            {location.type === 'trailer'
              ? <Truck className="w-4 h-4 text-muted-foreground" />
              : location.type === 'warehouse'
                ? <Warehouse className="w-4 h-4 text-muted-foreground" />
                : <MapPin className="w-4 h-4 text-muted-foreground" />
            }
            {location.name}
            {lowCount > 0 && (
              <Badge variant="destructive" className="text-[10px] gap-1">
                <AlertTriangle className="w-3 h-3" /> {lowCount} low
              </Badge>
            )}
            {stock && stock.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">({stock.length} item{stock.length !== 1 ? 's' : ''})</span>
            )}
          </div>
          {canManage && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1 text-xs h-7"
                title={`Transfer stock to ${location.name}`} onClick={onTransfer}>
                <ArrowLeftRight className="w-3 h-3" /> Transfer
              </Button>
              <Button size="sm" variant="ghost" className="gap-1 text-xs h-7"
                title="Edit location" onClick={onEditLocation}>
                <Edit className="w-3 h-3" />
              </Button>
            </div>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Qty Here</TableHead>
              <TableHead className="text-right">Reorder At</TableHead>
              <TableHead className="text-right">Sell Price</TableHead>
              <TableHead className="w-[120px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : !stock || stock.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                  No stock at this location. Use Transfer to move items here.
                </TableCell>
              </TableRow>
            ) : stock.map(entry => (
              <TableRow key={entry.id} className={entry.isLowStock ? 'bg-destructive/5' : ''}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-1.5">
                    {entry.isLowStock && <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                    {entry.itemName}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{entry.itemSku}</TableCell>
                <TableCell className="text-right">
                  <span className={`font-bold ${entry.isLowStock ? 'text-destructive' : ''}`}>{entry.quantity}</span>
                  {entry.unit && <span className="text-xs text-muted-foreground ml-1">{entry.unit}</span>}
                  {entry.isLowStock && <Badge variant="destructive" className="ml-2 text-[10px]">Low</Badge>}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{entry.reorderPoint}</TableCell>
                <TableCell className="text-right">${(entry.unitPrice ?? 0).toFixed(2)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {canManage && (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1"
                        title="Adjust quantity at this location"
                        onClick={() => onAdjust(entry.inventoryItemId, entry.itemName ?? '')}>
                        <PlusCircle className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                      onClick={() => onViewItem(entry.inventoryItemId)}>
                      View
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

type ItemForm = {
  name: string;
  sku: string;
  description: string;
  category: string;
  typeId: string;
  sizeId: string;
  costPrice: string;
  markupPct: string;
  quantity: string;
  reorderPoint: string;
  unit: string;
  lengthReceived: string;
  pricePerFoot: string;
  availableForBlueprint: boolean;
  commissionPct: string;
  vendorId: string;
};

const EMPTY_FORM: ItemForm = {
  name: '', sku: '', description: '', category: '', typeId: '', sizeId: '',
  costPrice: '', markupPct: '', quantity: '0', reorderPoint: '5', unit: 'each',
  lengthReceived: '', pricePerFoot: '',
  availableForBlueprint: false, commissionPct: '', vendorId: '',
};

export default function InventoryPage() {
  const [, setLocation] = useLocation();
  const { user, isTechnician, isOwner, isManager, isDepartmentManager, isCrewManager, canManageOffice } = useAuth();
  const canManage = !isTechnician;
  const isAdmin = isOwner || isManager || isDepartmentManager || isCrewManager || canManageOffice;
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const debouncedSearch = useDebounce(search, 300);
  const [typeFilter, setTypeFilter] = useState('');
  const [sizeFilter, setSizeFilter] = useState('');
  const [sheetMode, setSheetMode] = useState<'create' | 'edit' | 'view' | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<ItemForm>(EMPTY_FORM);
  const [sellPreview, setSellPreview] = useState<number | null>(null);

  // Locations
  const [activeTab, setActiveTab] = useState<'all' | 'by-location' | 'by-location-overview' | 'shrinkage'>('all');
  const [selectedLocationId, setSelectedLocationId] = useState<number | 'all'>('all');
  const [locDialogOpen, setLocDialogOpen] = useState(false);
  const [locForm, setLocForm] = useState({ name: '', description: '', type: 'warehouse' as 'warehouse' | 'trailer' | 'other' });
  const [editingLocId, setEditingLocId] = useState<number | null>(null);

  // Transfer dialog
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  // 'main_stock' is a UI sentinel for "from main warehouse" — mapped to undefined/null on submit
  const [transferForm, setTransferForm] = useState({ inventoryItemId: '', fromLocationId: 'main_stock', toLocationId: '', quantity: '1', reason: '' });

  // Stock adjustment dialog (global)
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [adjustItemId, setAdjustItemId] = useState<number | null>(null);
  const [adjustItemName, setAdjustItemName] = useState('');
  const [adjustDelta, setAdjustDelta] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  // Per-location stock adjustment dialog
  const [locAdjustDialogOpen, setLocAdjustDialogOpen] = useState(false);
  const [locAdjustLocationId, setLocAdjustLocationId] = useState<number | null>(null);
  const [locAdjustItemId, setLocAdjustItemId] = useState<number | null>(null);
  const [locAdjustItemName, setLocAdjustItemName] = useState('');
  const [locAdjustLocationName, setLocAdjustLocationName] = useState('');
  const [locAdjustDelta, setLocAdjustDelta] = useState('');
  const [locAdjustReason, setLocAdjustReason] = useState('');

  const [draftCategories, setDraftCategories] = useState<string[]>([]);

  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const defaultMarkupPct = settings?.defaultMarkupPct ?? 20;
  const showCostPriceToTech = settings?.showCostPriceToTech ?? false;
  const canSeeCost = !isTechnician || showCostPriceToTech;

  const adjustStock = useAdjustInventoryStock();
  const adjustLocationStockMutation = useAdjustLocationStock();

  // Location hooks
  const locationQueryKey = getListInventoryLocationsQueryKey();
  const { data: locations } = useListInventoryLocations({
    query: { queryKey: locationQueryKey },
    request: { cache: 'no-store' },
  });
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
        onSuccess: (updated) => {
          toast.success('Location updated');
          qc.setQueryData(locationQueryKey, (current: InventoryLocation[] | undefined) => upsertInventoryLocation(current, updated));
          void qc.invalidateQueries({ queryKey: locationQueryKey });
          setLocDialogOpen(false);
          setEditingLocId(null);
        },
        onError: () => toast.error('Failed to update location'),
      });
    } else {
      createLocation.mutate({ data: locForm }, {
        onSuccess: (created) => {
          toast.success('Location created');
          qc.setQueryData(locationQueryKey, (current: InventoryLocation[] | undefined) => upsertInventoryLocation(current, created));
          void qc.invalidateQueries({ queryKey: locationQueryKey });
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

  const openLocAdjustDialog = (locationId: number, locationName: string, itemId: number, itemName: string) => {
    setLocAdjustLocationId(locationId);
    setLocAdjustLocationName(locationName);
    setLocAdjustItemId(itemId);
    setLocAdjustItemName(itemName);
    setLocAdjustDelta('');
    setLocAdjustReason('');
    setLocAdjustDialogOpen(true);
  };

  const handleLocAdjustStock = () => {
    if (!locAdjustLocationId || !locAdjustItemId || !locAdjustDelta) { toast.error('Enter a quantity change'); return; }
    const delta = parseInt(locAdjustDelta, 10);
    if (isNaN(delta) || delta === 0) { toast.error('Enter a non-zero quantity'); return; }
    adjustLocationStockMutation.mutate(
      { id: locAdjustLocationId, data: { inventoryItemId: locAdjustItemId, delta, reason: locAdjustReason || undefined } },
      {
        onSuccess: () => {
          toast.success(`Stock at ${locAdjustLocationName} adjusted by ${delta > 0 ? '+' : ''}${delta}`);
          qc.invalidateQueries({ queryKey: getGetLocationStockQueryKey(locAdjustLocationId) });
          qc.invalidateQueries({ queryKey: getListInventoryItemsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetInventorySummaryQueryKey() });
          setLocAdjustDialogOpen(false);
        },
        onError: (e: any) => toast.error(e?.message ?? 'Failed to adjust stock'),
      }
    );
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
  const listParams = {
    q: debouncedSearch || undefined,
    typeId: typeFilter ? Number(typeFilter) : undefined,
    sizeId: sizeFilter ? Number(sizeFilter) : undefined,
  };
  const { data: items, isLoading } = useListInventoryItems(
    listParams,
    { query: { queryKey: getListInventoryItemsQueryKey(listParams) } },
  );
  const { data: partTypes = [] } = useListInventoryTypes({ query: { queryKey: getListInventoryTypesQueryKey() } });
  const { data: partSizes = [] } = useListInventorySizes(undefined, { query: { queryKey: getListInventorySizesQueryKey() } });
  const updateSettings = useUpdateTenantSettings();
  const groupBy: InventoryGroupBy = settings?.inventoryGroupBy === 'size' ? 'size' : 'type';
  const groupedItems = useMemo(() => groupInventoryItems(items ?? [], groupBy), [items, groupBy]);
  const visibleIds = (items ?? []).map(item => item.id);
  const listColumnCount = (canSeeCost ? 11 : 10) + (canManage ? 1 : 0);
  const sizeOptions = useMemo(() => inventorySizeOptions(partSizes), [partSizes]);
  const { data: selectedItem } = useGetInventoryItem(selectedId!, {
    query: { enabled: selectedId != null, queryKey: getGetInventoryItemQueryKey(selectedId!) },
  });
  const selectedFigures = selectedItem ? inventoryListFigures({
    costPrice: selectedItem.costPrice,
    pricePerFoot: selectedItem.pricePerFoot,
    unitPrice: selectedItem.unitPrice,
    markupPct: selectedItem.markupPct,
    defaultMarkupPct,
  }) : null;

  const createItem = useCreateInventoryItem();
  const duplicateInventory = useDuplicateInventoryItems();
  const updateItem = useUpdateInventoryItem();
  const deleteItem = useDeleteInventoryItem();
  const createType = useCreateInventoryType();
  const createSize = useCreateInventorySize();
  const { data: vendors = [] } = useListVendors({ query: { queryKey: getListVendorsQueryKey() } });

  const categoryOptions = useMemo(
    () => categoryChoices((items ?? []).map(item => item.category ?? ''), draftCategories, form.category),
    [items, draftCategories, form.category],
  );
  const selectedTypeName = partTypes.find(type => String(type.id) === form.typeId)?.name ?? '';
  const pipePart = isPipeTypeName(selectedTypeName);
  const pipeFootSell = pipePart ? pipeSellPerFoot(form.pricePerFoot, form.markupPct, defaultMarkupPct) : null;

  const rememberType = (created: InventoryType) => {
    qc.setQueryData(getListInventoryTypesQueryKey(), (current: InventoryType[] | undefined) => {
      const list = current ?? [];
      if (list.some(type => type.id === created.id)) return list;
      return [...list, created].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    });
  };

  const rememberSize = (created: InventorySize) => {
    qc.setQueryData(getListInventorySizesQueryKey(), (current: InventorySize[] | undefined) => {
      const list = current ?? [];
      if (list.some(size => size.id === created.id)) return list;
      return [...list, created];
    });
  };

  const errorStatus = (err: unknown) => (
    err && typeof err === 'object' && 'status' in err && typeof err.status === 'number' ? err.status : undefined
  );

  const addType = async (name: string) => {
    const existingId = namedId(partTypes, name);
    if (existingId != null) {
      const existingName = partTypes.find(type => type.id === existingId)?.name ?? name;
      setForm(current => ({ ...current, typeId: String(existingId), unit: isPipeTypeName(existingName) ? 'ft' : current.unit }));
      return;
    }
    try {
      const created = await createType.mutateAsync({ data: { name } });
      rememberType(created);
      setForm(current => ({ ...current, typeId: String(created.id), unit: isPipeTypeName(created.name) ? 'ft' : current.unit }));
      toast.success(`Added type ${created.name}`);
    } catch (err) {
      if (errorStatus(err) === 409) {
        const fresh = await qc.fetchQuery(getListInventoryTypesQueryOptions()) as InventoryType[];
        const id = namedId(fresh, name);
        if (id != null) {
          rememberType(fresh.find(type => type.id === id)!);
          setForm(current => ({ ...current, typeId: String(id) }));
          return;
        }
      }
      toast.error('Could not add that type');
      throw err;
    }
  };

  const addSize = async (name: string) => {
    const typeId = Number(form.typeId);
    if (!typeId) { toast.error('Choose a type before adding a size'); throw new Error('Choose a type first'); }
    const existingId = namedId(partSizes, name);
    if (existingId != null) {
      setForm(current => ({ ...current, sizeId: String(existingId) }));
      return;
    }
    try {
      const created = await createSize.mutateAsync({ data: { typeId, name } });
      rememberSize(created);
      setForm(current => ({ ...current, sizeId: String(created.id) }));
      toast.success(`Added size ${created.name}`);
    } catch (err) {
      if (errorStatus(err) === 409) {
        const fresh = await qc.fetchQuery(getListInventorySizesQueryOptions()) as InventorySize[];
        const id = namedId(fresh, name);
        if (id != null) {
          const match = fresh.find(size => size.id === id);
          if (match) rememberSize(match);
          setForm(current => ({ ...current, sizeId: String(id) }));
          return;
        }
      }
      toast.error('Could not add that size');
      throw err;
    }
  };

  const addCategory = (name: string) => {
    const match = categoryOptions.find(option => option.toLowerCase() === name.trim().toLowerCase());
    const chosen = match ?? name.trim();
    if (!match) setDraftCategories(current => current.some(option => option.toLowerCase() === chosen.toLowerCase()) ? current : [...current, chosen]);
    setForm(current => ({ ...current, category: chosen }));
  };

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
    setDraftCategories([]);
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
    const figures = inventoryListFigures({
      costPrice: item.costPrice,
      pricePerFoot: item.pricePerFoot,
      unitPrice: item.unitPrice,
      markupPct: item.markupPct,
      defaultMarkupPct,
    });
    const mPct = Math.abs(figures.markupPct - defaultMarkupPct) < 0.001 ? '' : String(figures.markupPct);
    setForm({
      name: item.name,
      sku: item.sku,
      description: item.description ?? '',
      category: item.category ?? '',
      typeId: item.typeId != null ? String(item.typeId) : '',
      sizeId: item.sizeId != null ? String(item.sizeId) : '',
      costPrice: costVal,
      markupPct: mPct,
      quantity: String(item.quantity),
      reorderPoint: String(item.reorderPoint),
      unit: item.unit ?? 'each',
      lengthReceived: item.lengthReceived != null ? String(item.lengthReceived) : '',
      pricePerFoot: item.pricePerFoot != null ? String(item.pricePerFoot) : '',
      availableForBlueprint: item.availableForBlueprint ?? false,
      commissionPct: item.commissionPct != null ? String(item.commissionPct) : '',
      vendorId: item.vendorId != null ? String(item.vendorId) : '',
    });
    setDraftCategories([]);
    updateSellPreview(costVal, mPct);
    setSelectedId(id);
    setSheetMode('edit');
  };

  const handleSave = () => {
    if (!form.name || !form.sku) { toast.error('Name and SKU are required'); return; }
    if (form.sizeId && !form.typeId) { toast.error('Choose a type before choosing a size'); return; }
    const length = form.lengthReceived.trim();
    const perFoot = form.pricePerFoot.trim();
    if (length && (!Number.isFinite(Number(length)) || Number(length) < 0)) { toast.error('Length received must be a non-negative number'); return; }
    if (perFoot && (!Number.isFinite(Number(perFoot)) || Number(perFoot) < 0)) { toast.error('Price per foot must be a non-negative number'); return; }
    const data = {
      name: form.name,
      sku: form.sku,
      description: form.description || undefined,
      category: form.category.trim(),
      typeId: form.typeId ? parseInt(form.typeId, 10) : null,
      sizeId: form.sizeId ? parseInt(form.sizeId, 10) : null,
      costPrice: parseFloat(form.costPrice) || 0,
      markupPct: form.markupPct.trim() === '' ? null : parseFloat(form.markupPct),
      quantity: parseInt(form.quantity, 10) || 0,
      reorderPoint: parseInt(form.reorderPoint, 10) || 5,
      unit: pipePart ? 'ft' : (form.unit || 'each'),
      lengthReceived: length ? Number(length) : null,
      pricePerFoot: perFoot ? Number(perFoot) : null,
      availableForBlueprint: form.availableForBlueprint,
      commissionPct: form.commissionPct ? parseFloat(form.commissionPct) : undefined,
      vendorId: form.vendorId ? parseInt(form.vendorId, 10) : null,
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

  const duplicateIds = (ids: number[]) => {
    if (ids.length === 0) return;
    duplicateInventory.mutate({ data: { ids } }, {
      onSuccess: (result) => {
        const count = result.items.length;
        toast.success(count === 1 ? `Created ${result.items[0]?.name ?? 'a copy'}` : `Created ${count} copies`);
        qc.invalidateQueries({ queryKey: getListInventoryItemsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetInventorySummaryQueryKey() });
        setSelectedIds(current => current.filter(id => !ids.includes(id)));
        const created = result.items[0];
        if (count === 1 && created) {
          setSelectedId(created.id);
          setSheetMode('view');
          qc.invalidateQueries({ queryKey: getGetInventoryItemQueryKey(created.id) });
        }
      },
      onError: () => toast.error('Could not duplicate inventory'),
    });
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
            exportQuery={{ q: search || undefined, ...(typeof selectedLocationId === 'number' ? { locationId: String(selectedLocationId) } : {}) }}
            onImportComplete={() => {
              qc.invalidateQueries({ queryKey: getListInventoryItemsQueryKey() });
              qc.invalidateQueries({ queryKey: getGetInventorySummaryQueryKey() });
              qc.invalidateQueries({ queryKey: getListInventoryTypesQueryKey() });
              qc.invalidateQueries({ queryKey: getListInventorySizesQueryKey() });
            }}
          />
          {canManage && (
            <Button variant="outline" title="Transfer stock between locations" className="gap-2" onClick={() => { setTransferDialogOpen(true); }}>
              <ArrowLeftRight className="w-4 h-4" /> Transfer
            </Button>
          )}
          {canManage && (
            <Button title="Add a new inventory item" className="gap-2" data-testid="button-add-inventory-item" onClick={openCreate}>
              <Plus className="w-4 h-4" /> Add Item
            </Button>
          )}
        </div>
      </div>

      {/* Location filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          title="Show inventory across all locations"
          onClick={() => { setActiveTab('all'); setSelectedLocationId('all'); }}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${activeTab === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted border-border'}`}
        >
          All Items
        </button>
        {(locations?.length ?? 0) > 0 && (
          <button
            title="See stock quantities across all locations at a glance"
            onClick={() => { setActiveTab('by-location-overview'); setSelectedLocationId('all'); }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors flex items-center gap-1.5 ${activeTab === 'by-location-overview' ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted border-border'}`}
          >
            <Warehouse className="w-3 h-3" /> By Location
          </button>
        )}
        {locations?.map(loc => (
          <button
            key={loc.id}
            onClick={() => { setActiveTab('by-location'); setSelectedLocationId(loc.id); }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors flex items-center gap-1.5 ${activeTab === 'by-location' && typeof selectedLocationId === 'number' && selectedLocationId === loc.id ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted border-border'}`}
          >
            {loc.type === 'trailer' ? <Truck className="w-3 h-3" /> : loc.type === 'warehouse' ? <Warehouse className="w-3 h-3" /> : <MapPin className="w-3 h-3" />}
            {loc.name}
          </button>
        ))}
        {isAdmin && (
          <button
            title="Review inventory count variances and shrinkage loss"
            onClick={() => { setActiveTab('shrinkage'); setSelectedLocationId('all'); }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors flex items-center gap-1.5 ${activeTab === 'shrinkage' ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted border-border'}`}
          >
            <PackageSearch className="w-3 h-3" /> Shrinkage
          </button>
        )}
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            title="Add a new storage location (warehouse, trailer, vehicle)"
            className="h-8 px-2 text-xs text-muted-foreground gap-1"
            onClick={() => { setEditingLocId(null); setLocForm({ name: '', description: '', type: 'warehouse' }); setLocDialogOpen(true); }}
          >
            <Plus className="w-3 h-3" /> Add Location
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      {activeTab !== 'shrinkage' && <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Value</p>
              <p className="text-3xl font-bold" title={`Total inventory value at sell price: $${(summary?.totalValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}>${(summary?.totalValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
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
              <p className="text-3xl font-bold" title={`${summary?.totalItems ?? 0} distinct inventory items`}>{summary?.totalItems ?? 0}</p>
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
              <p className="text-3xl font-bold text-destructive" title={`${summary?.lowStockCount ?? 0} item${(summary?.lowStockCount ?? 0) !== 1 ? 's' : ''} at or below their reorder threshold`}>{summary?.lowStockCount ?? 0}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>}

      {activeTab === 'shrinkage' && isAdmin && <ShrinkageReport />}

      {/* By-Location Overview — all locations at once */}
      {activeTab === 'by-location-overview' && (
        <div className="space-y-4">
          {!locations || locations.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">No locations defined yet. Use the Add Location button to create one.</CardContent></Card>
          ) : locations.map(loc => (
            <LocationStockCard
              key={loc.id}
              location={loc}
              canManage={canManage}
              onEditLocation={() => {
                setEditingLocId(loc.id);
                setLocForm({ name: loc.name, description: loc.description ?? '', type: loc.type as typeof locForm.type });
                setLocDialogOpen(true);
              }}
              onViewItem={openView}
              onAdjust={(itemId, itemName) => openLocAdjustDialog(loc.id, loc.name, itemId, itemName)}
              onTransfer={() => { setTransferForm(f => ({ ...f, toLocationId: String(loc.id) })); setTransferDialogOpen(true); }}
            />
          ))}
        </div>
      )}

      {/* Single-Location Stock View */}
      {activeTab === 'by-location' && typeof selectedLocationId === 'number' && (
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
              <div className="flex items-center gap-2">
                {canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 text-xs"
                    title="Transfer stock to or from this location"
                    onClick={() => {
                      setTransferForm(f => ({ ...f, toLocationId: String(selectedLocationId) }));
                      setTransferDialogOpen(true);
                    }}
                  >
                    <ArrowLeftRight className="w-3 h-3" /> Transfer
                  </Button>
                )}
                {canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 text-xs"
                    title="Edit this location's name, type, or description"
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
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Qty at Location</TableHead>
                  <TableHead className="text-right">Reorder At</TableHead>
                  <TableHead className="text-right">Sell Price</TableHead>
                  <TableHead className="w-[120px]" />
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
                    <TableCell className="font-medium" title={entry.itemName}>
                      <div className="flex items-center gap-1.5">
                        {entry.isLowStock && <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                        {entry.itemName}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground" title={entry.itemSku ? `SKU: ${entry.itemSku}` : undefined}>{entry.itemSku}</TableCell>
                    <TableCell className="text-right" title={`${entry.quantity} in stock at this location${entry.isLowStock ? ' — low stock' : ''}`}>
                      <span className={`font-bold ${entry.isLowStock ? 'text-destructive' : ''}`}>{entry.quantity}</span>
                      {entry.isLowStock && <Badge variant="destructive" className="ml-2 text-[10px]">Low</Badge>}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground" title={`Reorder at: ${entry.reorderPoint}`}>{entry.reorderPoint}</TableCell>
                    <TableCell className="text-right" title={`Sell price: $${(entry.unitPrice ?? 0).toFixed(2)}`}>${(entry.unitPrice ?? 0).toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canManage && (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" title="Adjust quantity at this location"
                            onClick={() => openLocAdjustDialog(selectedLocationId, locations?.find(l => l.id === selectedLocationId)?.name ?? '', entry.inventoryItemId, entry.itemName ?? '')}>
                            <PlusCircle className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openView(entry.inventoryItemId)}>
                          View
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* All Items Table */}
      {activeTab === 'all' && <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                title="Search inventory by SKU, name, type, or size"
                placeholder="Search by SKU, name, type, or size..."
                className="pl-9"
                data-testid="input-inventory-search"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <Select
              value={typeFilter || '__all__'}
              onValueChange={value => setTypeFilter(value === '__all__' ? '' : value)}
            >
              <SelectTrigger className="w-[160px]" title="Filter the list by type" data-testid="select-filter-type">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All types</SelectItem>
                {partTypes.map(type => <SelectItem key={type.id} value={String(type.id)}>{type.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select
              value={sizeFilter || '__all__'}
              onValueChange={value => setSizeFilter(value === '__all__' ? '' : value)}
            >
              <SelectTrigger className="w-[180px]" title="Filter the list by size" data-testid="select-filter-size">
                <SelectValue placeholder="All sizes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All sizes</SelectItem>
                {sizeOptions.map(size => (
                  <SelectItem key={size.value} value={size.value}>{size.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canManageOffice && (
              <div className="flex items-center rounded-md border p-1 bg-muted/50 gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={groupBy === 'type' ? 'secondary' : 'ghost'}
                  className="h-8 px-3 text-xs"
                  data-testid="button-organize-by-type"
                  title="Organize this list by type"
                  onClick={() => updateSettings.mutate({ data: { inventoryGroupBy: 'type' } }, {
                    onSuccess: () => qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }),
                    onError: () => toast.error('Could not save the organize-by setting'),
                  })}
                >By type</Button>
                <Button
                  type="button"
                  size="sm"
                  variant={groupBy === 'size' ? 'secondary' : 'ghost'}
                  className="h-8 px-3 text-xs"
                  data-testid="button-organize-by-size"
                  title="Organize this list by size"
                  onClick={() => updateSettings.mutate({ data: { inventoryGroupBy: 'size' } }, {
                    onSuccess: () => qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }),
                    onError: () => toast.error('Could not save the organize-by setting'),
                  })}
                >By size</Button>
              </div>
            )}
            {canManage && selectedIds.length > 0 && (
              <Button
                variant="outline"
                className="gap-2"
                title="Duplicate the selected items onto the same stock"
                data-testid="button-duplicate-selected"
                disabled={duplicateInventory.isPending}
                onClick={() => duplicateIds(selectedIds)}
              >
                <Copy className="w-4 h-4" /> Duplicate {selectedIds.length} selected
              </Button>
            )}
            {!canSeeCost && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <EyeOff className="w-3.5 h-3.5" /> Buy price hidden
              </div>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                {canManage && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id))}
                      onCheckedChange={checked => setSelectedIds(checked === true ? visibleIds : [])}
                      aria-label="Select all inventory items"
                      data-testid="checkbox-inventory-all"
                    />
                  </TableHead>
                )}
                <TableHead>Item</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Category</TableHead>
                {canSeeCost && <TableHead className="text-right">Buy Price</TableHead>}
                <TableHead className="text-right">Price / ft</TableHead>
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
                <TableRow><TableCell colSpan={listColumnCount} className="text-center py-8 text-muted-foreground">Loading inventory...</TableCell></TableRow>
              ) : items?.length === 0 ? (
                <TableRow><TableCell colSpan={listColumnCount} className="text-center py-8 text-muted-foreground">No items found.</TableCell></TableRow>
              ) : (
                groupedItems.map(group => (
                  <React.Fragment key={group.key}>
                    <TableRow className="bg-muted/40 hover:bg-muted/40" data-testid={`inventory-group-${group.key}`}>
                      <TableCell colSpan={listColumnCount} className="py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {groupBy === 'type' ? 'Type' : 'Size'}: {group.label}
                        <span className="ml-2 font-normal normal-case">{group.items.length} item{group.items.length === 1 ? '' : 's'}</span>
                      </TableCell>
                    </TableRow>
                    {group.items.map(item => {
                      const figures = inventoryListFigures({
                        costPrice: item.costPrice,
                        pricePerFoot: item.pricePerFoot,
                        unitPrice: item.unitPrice,
                        markupPct: item.markupPct,
                        defaultMarkupPct,
                      });
                      return (
                  <TableRow
                    key={item.id}
                    className={`cursor-pointer ${item.isLowStock ? 'bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-muted/50'}`}
                    onClick={() => openView(item.id)}
                    data-testid={`inventory-item-${item.id}`}
                  >
                    {canManage && (
                      <TableCell onClick={event => event.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.includes(item.id)}
                          onCheckedChange={checked => setSelectedIds(current => (
                            checked === true ? [...current, item.id] : current.filter(id => id !== item.id)
                          ))}
                          aria-label={`Select ${item.name}`}
                          data-testid={`checkbox-inventory-${item.id}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-medium" title={item.name}>{item.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground" title={item.sku ? `SKU: ${item.sku}` : undefined}>{item.sku}</TableCell>
                    <TableCell>{item.typeName ? <Badge variant="outline" title={`Type: ${item.typeName}`}>{item.typeName}</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{item.sizeName ? <Badge variant="secondary" title={`Size: ${item.sizeName}`}>{item.sizeName}</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      {item.category && <Badge variant="outline" title={`Category: ${item.category}`}>{item.category}</Badge>}
                    </TableCell>
                    {canSeeCost && (
                      <TableCell className="text-right text-muted-foreground text-sm" title={item.costPrice != null ? `Cost price: $${item.costPrice.toFixed(2)}` : 'No cost price set'}>
                        {item.costPrice != null ? `$${item.costPrice.toFixed(2)}` : '—'}
                      </TableCell>
                    )}
                    <TableCell className="text-right text-sm" data-testid={`list-price-per-foot-${item.id}`} title={figures.pricePerFoot != null ? `Price per foot: $${figures.pricePerFoot.toFixed(2)}` : 'No price per foot'}>
                      {figures.pricePerFoot != null ? `$${figures.pricePerFoot.toFixed(2)}` : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium" data-testid={`list-markup-${item.id}`} title={`Markup: ${figures.markupPct.toFixed(0)}%`}>
                        {figures.markupPct.toFixed(0)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium" data-testid={`list-sell-price-${item.id}`} title={figures.pricePerFoot != null ? `Sell price: $${figures.sellPrice.toFixed(2)} per foot` : `Sell price: $${figures.sellPrice.toFixed(2)}`}>
                      ${figures.sellPrice.toFixed(2)}{figures.pricePerFoot != null ? '/ft' : ''}
                    </TableCell>
                    <TableCell className="text-right" data-testid={`list-quantity-${item.id}`} title={`${item.quantity} ${item.unit || 'units'} in stock`}>
                      <span className={`font-medium ${item.isLowStock ? 'text-destructive' : ''}`}>
                        {item.quantity} {item.unit || ''}
                      </span>
                    </TableCell>
                    <TableCell onClick={event => event.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {item.isLowStock && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive" title={`Low stock — reorder point is ${item.reorderPoint} ${item.unit || 'units'}`}>
                            <AlertTriangle className="w-3.5 h-3.5" /> Low
                          </span>
                        )}
                        {canManage && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs gap-1"
                            title="Duplicate this item onto the same stock"
                            data-testid={`button-duplicate-item-${item.id}`}
                            disabled={duplicateInventory.isPending}
                            onClick={() => duplicateIds([item.id])}
                          >
                            <Copy className="w-3.5 h-3.5" /> Duplicate
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                      );
                    })}
                  </React.Fragment>
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
                    <SheetTitle title={selectedItem.name}>{selectedItem.name}</SheetTitle>
                    <SheetDescription className="font-mono mt-1" title={selectedItem.sku ? `SKU: ${selectedItem.sku}` : undefined}>{selectedItem.sku}</SheetDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedItem.isLowStock && (
                      <>
                        <Badge variant="destructive" className="gap-1" title={`Stock below reorder point of ${selectedItem.reorderPoint} ${selectedItem.unit ?? 'units'}`}><AlertTriangle className="w-3 h-3" /> Low Stock</Badge>
                        {canManage && (
                          <Button size="sm" variant="outline" className="gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => { const prefill = encodeURIComponent(JSON.stringify({ title: `Reorder: ${selectedItem.name}`, description: `Item ${selectedItem.sku ?? ''} is below reorder point (${selectedItem.reorderPoint ?? '?'} ${selectedItem.unit ?? 'units'}). Current quantity: ${selectedItem.quantity}.` })); setLocation(`/tasks?prefill=${prefill}`); }}>
                            <Plus className="w-3.5 h-3.5" /> Reorder Task
                          </Button>
                        )}
                      </>
                    )}
                    {selectedItem.availableForBlueprint && <Badge variant="outline" className="text-primary border-primary/40">Blueprint Ready</Badge>}
                    {canManage && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        data-testid="button-duplicate-open-item"
                        disabled={duplicateInventory.isPending}
                        onClick={() => duplicateIds([selectedItem.id])}
                      >
                        <Copy className="w-3.5 h-3.5" /> Duplicate
                      </Button>
                    )}
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
                        <span className="font-medium" title={`Buy/cost price: $${selectedItem.costPrice.toFixed(2)}`}>${selectedItem.costPrice.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-2 text-sm">
                        <TrendingUp className="w-4 h-4 text-primary" />
                        <span className="text-muted-foreground">Markup</span>
                      </div>
                      <span className="font-medium text-primary" title={`Markup applied: +${(selectedFigures?.markupPct ?? defaultMarkupPct).toFixed(0)}%`}>+{(selectedFigures?.markupPct ?? defaultMarkupPct).toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-3 bg-primary/5">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <ArrowRight className="w-4 h-4 text-primary" />
                        <span>Sell Price</span>
                      </div>
                      <span className="text-lg font-bold text-primary" data-testid="text-item-sell-price" title={`Sell price charged to customers: $${(selectedFigures?.sellPrice ?? selectedItem.unitPrice).toFixed(2)}`}>${(selectedFigures?.sellPrice ?? selectedItem.unitPrice).toFixed(2)}{selectedFigures?.pricePerFoot != null ? '/ft' : ''}</span>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Stock info */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">In Stock</p>
                    <p className={`text-2xl font-bold ${selectedItem.isLowStock ? 'text-destructive' : ''}`} data-testid="text-item-quantity" title={`${selectedItem.quantity} ${selectedItem.unit ?? 'units'} in stock${selectedItem.isLowStock ? ' — below reorder point' : ''}`}>
                      {selectedItem.quantity} <span className="text-sm font-normal text-muted-foreground">{selectedItem.unit}</span>
                    </p>
                    {selectedItem.stockItemId != null && (
                      <p className="text-xs text-muted-foreground" data-testid="text-shared-stock">
                        On-hand quantity is shared. Receiving, using, or adjusting it changes the same stock as the original item.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Reorder At</p>
                    <p className="text-2xl font-bold" title={`Reorder when stock falls below ${selectedItem.reorderPoint} ${selectedItem.unit ?? 'units'}`}>{selectedItem.reorderPoint} <span className="text-sm font-normal text-muted-foreground">{selectedItem.unit}</span></p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Type</p>
                    <p className="text-sm font-medium">{selectedItem.typeName || 'None'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Size</p>
                    <p className="text-sm font-medium">{selectedItem.sizeName || 'None'}</p>
                  </div>
                  {selectedItem.category && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Category</p>
                      <Badge variant="outline" title={`Category: ${selectedItem.category}`}>{selectedItem.category}</Badge>
                    </div>
                  )}
                  {selectedItem.lengthReceived != null && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Length received</p>
                      <p className="text-sm font-medium">{selectedItem.lengthReceived} ft</p>
                    </div>
                  )}
                  {selectedItem.pricePerFoot != null && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Price per foot</p>
                      <p className="text-sm font-medium" data-testid="text-price-per-foot" title="Per-foot price before markup">${selectedItem.pricePerFoot.toFixed(2)}</p>
                    </div>
                  )}
                </div>

                {canManage && (
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    data-testid="button-adjust-stock"
                    onClick={() => openAdjustDialog(selectedItem.id, selectedItem.name)}
                  >
                    <PlusCircle className="w-4 h-4" /> Adjust Stock
                  </Button>
                )}

                <ItemLocationSection inventoryItemId={selectedItem.id} />

                {(selectedItem as any).supplierName && (
                  <>
                    <Separator />
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5" /> Supplier
                      </p>
                      <p className="text-sm font-medium">{(selectedItem as any).supplierName}</p>
                    </div>
                  </>
                )}

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
        <SheetContent
          className="w-full sm:max-w-md overflow-y-auto"
          onInteractOutside={event => { isFromPickerPortal(event); }}
          onPointerDownOutside={event => { isFromPickerPortal(event); }}
          onFocusOutside={event => { isFromPickerPortal(event); }}
        >
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
                <Input title="Item name as it appears in inventory and on invoices" placeholder="e.g. Brass Gate Valve 1in" data-testid="input-inventory-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <label className="text-sm font-medium">SKU <span className="text-destructive">*</span></label>
                <Input title="Unique stock-keeping unit identifier for this item" placeholder="BGV-1IN" className="font-mono" data-testid="input-inventory-sku" value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Type</label>
                <CreatableOptionMenu
                  testId="select-part-type"
                  title="Type for this part"
                  placeholder="No type"
                  noneLabel="No type"
                  value={form.typeId}
                  options={partTypes.map(type => ({ value: String(type.id), label: type.name }))}
                  emptyText="No types yet. Add one below."
                  addPlaceholder="New type, such as Pipe"
                  addLabel="Type"
                  adding={createType.isPending}
                  onChange={typeId => {
                    const nextName = partTypes.find(type => String(type.id) === typeId)?.name ?? '';
                    const nextPipe = isPipeTypeName(nextName);
                    setForm(current => ({
                      ...current,
                      typeId,
                      sizeId: typeId ? sizeIdAcrossTypes(current.sizeId, partSizes) : '',
                      unit: nextPipe ? 'ft' : (current.unit === 'ft' ? 'each' : current.unit),
                      lengthReceived: nextPipe ? current.lengthReceived : '',
                      pricePerFoot: nextPipe ? current.pricePerFoot : '',
                    }));
                  }}
                  onAdd={addType}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Size</label>
                <CreatableOptionMenu
                  testId="select-part-size"
                  title="Size. The same list is available for every type and category."
                  placeholder="No size"
                  noneLabel="No size"
                  value={form.sizeId}
                  options={sizeOptions}
                  emptyText="No sizes yet. Add one below."
                  addPlaceholder="New size, such as 1&quot;"
                  addLabel="Size"
                  adding={createSize.isPending}
                  onChange={sizeId => setForm(current => ({ ...current, sizeId }))}
                  onAdd={addSize}
                />
              </div>
              <div className="space-y-1.5 col-span-2">
                <label className="text-sm font-medium">Category</label>
                <CreatableOptionMenu
                  testId="select-part-category"
                  title="Category for this part"
                  placeholder="No category"
                  noneLabel="No category"
                  value={form.category}
                  options={categoryOptions.map(name => ({ value: name, label: name }))}
                  emptyText="No categories yet. Add one below."
                  addPlaceholder="New category"
                  addLabel="Category"
                  onChange={category => setForm(current => ({ ...current, category }))}
                  onAdd={addCategory}
                />
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
                    title="Cost to purchase this item (not shown to technicians)"
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
                    title={`Leave blank to use the company standard of ${defaultMarkupPct}%. Type a percent to override it for this item.`}
                    placeholder={String(defaultMarkupPct)}
                    value={form.markupPct}
                    onChange={e => {
                      setForm(f => ({ ...f, markupPct: e.target.value }));
                      updateSellPreview(form.costPrice, e.target.value);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">Blank uses the company standard ({defaultMarkupPct}%).</p>
                </div>
              </div>

              {pipePart && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Length received (ft)</label>
                    <Input
                      type="number"
                      min={0}
                      step="0.1"
                      title="Feet of pipe that arrived with this stock"
                      placeholder="0"
                      data-testid="input-length-received"
                      value={form.lengthReceived}
                      onChange={e => {
                        const lengthReceived = e.target.value;
                        setForm(current => {
                          const next = { ...current, lengthReceived, unit: 'ft' };
                          if (sheetMode === 'create') {
                            const parsed = Number(lengthReceived);
                            if (lengthReceived.trim() !== '' && Number.isFinite(parsed)) next.quantity = String(feetFromLength(parsed));
                          }
                          return next;
                        });
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Price per foot ($)</label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      title="Per-foot price before markup. Inventory markup is added the same way it is added to a buy price."
                      placeholder="0.00"
                      data-testid="input-price-per-foot"
                      value={form.pricePerFoot}
                      onChange={e => setForm(current => ({ ...current, pricePerFoot: e.target.value, unit: 'ft' }))}
                    />
                  </div>
                  <p className="col-span-2 text-xs text-muted-foreground">Pipe is stocked in feet. Markup is added to the per-foot price, and that sell price is what a sale charges.</p>
                </div>
              )}

              {/* Sell price preview */}
              <div className={`flex items-center justify-between rounded-lg border px-4 py-3 ${pipeFootSell != null || sellPreview != null ? 'border-primary/30 bg-primary/5' : 'border-dashed'}`}>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ArrowRight className="w-4 h-4 text-primary" />
                  <span>{pipeFootSell != null ? 'Sell price per foot' : 'Sell Price'}</span>
                </div>
                <span data-testid="text-sell-price" className={`text-lg font-bold ${pipeFootSell != null || sellPreview != null ? 'text-primary' : 'text-muted-foreground'}`}>
                  {pipeFootSell != null
                    ? `$${pipeFootSell.toFixed(2)}/ft`
                    : sellPreview != null ? `$${sellPreview.toFixed(2)}` : '—'}
                </span>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{pipePart ? 'Feet on hand' : 'Quantity'}</label>
                <Input type="number" min={0} title={pipePart ? 'Feet of this pipe currently in stock' : 'Current stock quantity on hand'} data-testid="input-inventory-quantity" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
                {sheetMode === 'edit' && selectedItem?.stockItemId != null && (
                  <p className="text-xs text-muted-foreground">This quantity is shared. Saving it changes the original item's on-hand stock too.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Reorder At</label>
                <Input type="number" min={0} title="Stock level that triggers a reorder alert" value={form.reorderPoint} onChange={e => setForm(f => ({ ...f, reorderPoint: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Unit</label>
                <Input title="Unit of measure (e.g. each, ft, gallon)" placeholder="each" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Input title="Optional description or notes about this item" placeholder="Optional notes" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Salesperson Commission (%)</label>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="100"
                title="Percentage of gross margin paid as commission to the salesperson on this item"
                placeholder="0"
                value={form.commissionPct}
                onChange={e => setForm(f => ({ ...f, commissionPct: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Percentage of gross margin paid as commission to the salesperson on this item.</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Supplier</label>
              <CreatableOptionMenu
                testId="select-part-supplier"
                title="Supplier from the vendor list"
                placeholder="No supplier"
                noneLabel="No supplier"
                value={form.vendorId}
                options={vendors.map(vendor => ({ value: String(vendor.id), label: vendor.name }))}
                emptyText="No vendors yet. Add vendors on the Vendors page."
                onChange={vendorId => setForm(current => ({ ...current, vendorId }))}
              />
              <p className="text-xs text-muted-foreground">Choose a vendor that already exists. This list does not take a typed supplier name.</p>
            </div>

            <Separator />

            <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/20">
              <div>
                <p className="text-sm font-medium">Available for Blueprint design</p>
                <p className="text-xs text-muted-foreground">Show this item as a pickable option in the Blueprint canvas palette.</p>
              </div>
              <Switch
                title={form.availableForBlueprint ? 'Available for blueprint canvas palette — click to disable' : 'Not in blueprint palette — click to enable'}
                checked={form.availableForBlueprint}
                onCheckedChange={v => setForm(f => ({ ...f, availableForBlueprint: v }))}
              />
            </div>

            <Separator />
            <div className="flex gap-3 justify-end">
              {sheetMode === 'edit' && selectedId != null && (
                <Button
                  variant="outline"
                  className="mr-auto gap-1.5"
                  data-testid="button-duplicate-editing-item"
                  disabled={duplicateInventory.isPending}
                  onClick={() => duplicateIds([selectedId])}
                >
                  <Copy className="w-3.5 h-3.5" /> Duplicate
                </Button>
              )}
              <Button variant="outline" onClick={() => setSheetMode(null)}>Cancel</Button>
              <Button title={sheetMode === 'create' ? 'Add this item to inventory' : 'Save changes to this inventory item'} data-testid="button-save-inventory-item" onClick={handleSave} disabled={createItem.isPending || updateItem.isPending}>
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

      {/* Per-Location Stock Adjustment Dialog */}
      <Dialog open={locAdjustDialogOpen} onOpenChange={open => { if (!open) setLocAdjustDialogOpen(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust Stock at Location</DialogTitle>
            <DialogDescription>
              Adjust the quantity of <strong>{locAdjustItemName}</strong> at <strong>{locAdjustLocationName}</strong>.
              Enter a positive number to add stock or a negative number to remove it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Quantity Change <span className="text-destructive">*</span></label>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={() => setLocAdjustDelta(d => String((parseInt(d || '0', 10) - 1)))}>
                  <MinusCircle className="w-4 h-4" />
                </Button>
                <Input
                  type="number"
                  className="text-center font-bold text-lg"
                  value={locAdjustDelta}
                  onChange={e => setLocAdjustDelta(e.target.value)}
                  placeholder="0"
                />
                <Button variant="outline" size="icon" onClick={() => setLocAdjustDelta(d => String((parseInt(d || '0', 10) + 1)))}>
                  <PlusCircle className="w-4 h-4" />
                </Button>
              </div>
              {locAdjustDelta && !isNaN(parseInt(locAdjustDelta, 10)) && (
                <p className={`text-xs font-medium ${parseInt(locAdjustDelta, 10) > 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                  {parseInt(locAdjustDelta, 10) > 0 ? `+${locAdjustDelta} units will be added at this location` : `${locAdjustDelta} units will be removed from this location`}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason (optional)</label>
              <Input
                placeholder="e.g. Restocked from main warehouse"
                value={locAdjustReason}
                onChange={e => setLocAdjustReason(e.target.value)}
              />
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="outline" onClick={() => setLocAdjustDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleLocAdjustStock} disabled={adjustLocationStockMutation.isPending || !locAdjustDelta}>
                {adjustLocationStockMutation.isPending ? 'Saving...' : 'Apply Adjustment'}
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
                  data-testid="input-adjust-delta"
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
              <Button data-testid="button-apply-stock-adjustment" onClick={handleAdjustStock} disabled={adjustStock.isPending || !adjustDelta}>
                {adjustStock.isPending ? 'Saving...' : 'Apply Adjustment'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
