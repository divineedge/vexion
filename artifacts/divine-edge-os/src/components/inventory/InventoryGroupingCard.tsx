import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  getGetTenantSettingsQueryKey,
  getListInventorySizesQueryKey,
  getListInventoryTypesQueryKey,
  useCreateInventorySize,
  useCreateInventoryType,
  useDeleteInventorySize,
  useDeleteInventoryType,
  useGetTenantSettings,
  useListInventorySizes,
  useListInventoryTypes,
  useUpdateInventorySize,
  useUpdateInventoryType,
  useUpdateTenantSettings,
} from '@workspace/api-client-react';
import type { InventoryGroupBy } from '@/lib/inventoryGrouping';
import { sizesForType } from '@/lib/inventoryGrouping';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function InventoryGroupingCard() {
  const qc = useQueryClient();
  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const updateSettings = useUpdateTenantSettings();
  const { data: types = [] } = useListInventoryTypes({ query: { queryKey: getListInventoryTypesQueryKey() } });
  const { data: sizes = [] } = useListInventorySizes(undefined, { query: { queryKey: getListInventorySizesQueryKey() } });
  const createType = useCreateInventoryType();
  const updateType = useUpdateInventoryType();
  const deleteType = useDeleteInventoryType();
  const createSize = useCreateInventorySize();
  const updateSize = useUpdateInventorySize();
  const deleteSize = useDeleteInventorySize();

  const groupBy: InventoryGroupBy = settings?.inventoryGroupBy === 'size' ? 'size' : 'type';
  const [newTypeName, setNewTypeName] = useState('');
  const [editingTypeId, setEditingTypeId] = useState<number | null>(null);
  const [editingTypeName, setEditingTypeName] = useState('');
  const [newSizeName, setNewSizeName] = useState<Record<number, string>>({});
  const [editingSizeId, setEditingSizeId] = useState<number | null>(null);
  const [editingSizeName, setEditingSizeName] = useState('');

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getListInventoryTypesQueryKey() });
    void qc.invalidateQueries({ queryKey: getListInventorySizesQueryKey() });
  };

  const saveGroupBy = (next: InventoryGroupBy) => {
    if (next === groupBy) return;
    updateSettings.mutate({ data: { inventoryGroupBy: next } }, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() });
        toast.success(next === 'type' ? 'Inventory is organized by type' : 'Inventory is organized by size');
      },
      onError: () => toast.error('Could not save the organize-by setting'),
    });
  };

  const addType = () => {
    const name = newTypeName.trim();
    if (!name) return;
    createType.mutate({ data: { name } }, {
      onSuccess: () => { setNewTypeName(''); refresh(); toast.success(`Added type ${name}`); },
      onError: () => toast.error('Could not add that type'),
    });
  };

  const saveType = (id: number) => {
    const name = editingTypeName.trim();
    if (!name) return;
    updateType.mutate({ id, data: { name } }, {
      onSuccess: () => { setEditingTypeId(null); refresh(); },
      onError: () => toast.error('Could not rename that type'),
    });
  };

  const addSize = (typeId: number) => {
    const name = (newSizeName[typeId] ?? '').trim();
    if (!name) return;
    createSize.mutate({ data: { typeId, name } }, {
      onSuccess: () => {
        setNewSizeName(current => ({ ...current, [typeId]: '' }));
        refresh();
        toast.success(`Added size ${name}`);
      },
      onError: () => toast.error('Could not add that size'),
    });
  };

  const saveSize = (id: number) => {
    const name = editingSizeName.trim();
    if (!name) return;
    updateSize.mutate({ id, data: { name } }, {
      onSuccess: () => { setEditingSizeId(null); refresh(); },
      onError: () => toast.error('Could not rename that size'),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventory grouping</CardTitle>
        <CardDescription>
          Type is the parent, such as Pipe or Fitting. A size such as 1&quot; or elbow can be used on any type and category.
          The inventory list uses the organize-by choice below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-medium">Organize inventory by</p>
          <div className="flex items-center rounded-md border p-1 bg-muted/50 w-fit gap-1">
            <Button
              type="button"
              size="sm"
              variant={groupBy === 'type' ? 'secondary' : 'ghost'}
              className="h-8 px-4 text-sm"
              data-testid="button-organize-by-type"
              title="Group the inventory list by type"
              onClick={() => saveGroupBy('type')}
            >Type</Button>
            <Button
              type="button"
              size="sm"
              variant={groupBy === 'size' ? 'secondary' : 'ghost'}
              className="h-8 px-4 text-sm"
              data-testid="button-organize-by-size"
              title="Group the inventory list by size"
              onClick={() => saveGroupBy('size')}
            >Size</Button>
          </div>
        </div>

        {types.length === 0 ? (
          <p className="text-sm text-muted-foreground">No types yet. Add Pipe, Fitting, or whatever your parts are called.</p>
        ) : (
          <div className="divide-y border rounded-lg">
            {types.map(type => {
              const typeSizes = sizesForType(sizes, type.id);
              return (
                <div key={type.id} className="px-3 py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    {editingTypeId === type.id ? (
                      <>
                        <Input
                          className="h-8 text-sm flex-1"
                          value={editingTypeName}
                          data-testid={`input-rename-type-${type.id}`}
                          onChange={event => setEditingTypeName(event.target.value)}
                          onKeyDown={event => {
                            if (event.key === 'Enter') saveType(type.id);
                            if (event.key === 'Escape') setEditingTypeId(null);
                          }}
                          autoFocus
                        />
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" data-testid={`button-save-type-${type.id}`} onClick={() => saveType(type.id)}>Save</Button>
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setEditingTypeId(null)}>Cancel</Button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm font-medium">{type.name}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title={`Rename ${type.name}`}
                          data-testid={`button-rename-type-${type.id}`}
                          onClick={() => { setEditingTypeId(type.id); setEditingTypeName(type.name); }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          title={`Remove ${type.name}`}
                          data-testid={`button-delete-type-${type.id}`}
                          onClick={() => deleteType.mutate({ id: type.id }, {
                            onSuccess: () => { refresh(); toast.success(`Removed ${type.name}`); },
                            onError: () => toast.error('Could not remove that type'),
                          })}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                  <div className="pl-3 space-y-1.5">
                    {typeSizes.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No sizes under {type.name} yet.</p>
                    ) : typeSizes.map(size => (
                      <div key={size.id} className="flex items-center gap-2">
                        {editingSizeId === size.id ? (
                          <>
                            <Input
                              className="h-7 text-sm flex-1"
                              value={editingSizeName}
                              data-testid={`input-rename-size-${size.id}`}
                              onChange={event => setEditingSizeName(event.target.value)}
                              onKeyDown={event => {
                                if (event.key === 'Enter') saveSize(size.id);
                                if (event.key === 'Escape') setEditingSizeId(null);
                              }}
                              autoFocus
                            />
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => saveSize(size.id)}>Save</Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingSizeId(null)}>Cancel</Button>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 text-sm text-muted-foreground">{size.name}</span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              title={`Rename ${size.name}`}
                              data-testid={`button-rename-size-${size.id}`}
                              onClick={() => { setEditingSizeId(size.id); setEditingSizeName(size.name); }}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              title={`Remove ${size.name}`}
                              data-testid={`button-delete-size-${size.id}`}
                              onClick={() => deleteSize.mutate({ id: size.id }, {
                                onSuccess: () => refresh(),
                                onError: () => toast.error('Could not remove that size'),
                              })}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    ))}
                    <div className="flex gap-2 pt-1">
                      <Input
                        className="h-8 text-sm"
                        placeholder={`Size under ${type.name}`}
                        title={`Add a size under ${type.name}`}
                        data-testid={`input-new-size-${type.id}`}
                        value={newSizeName[type.id] ?? ''}
                        onChange={event => setNewSizeName(current => ({ ...current, [type.id]: event.target.value }))}
                        onKeyDown={event => { if (event.key === 'Enter') addSize(type.id); }}
                      />
                      <Button type="button" variant="outline" size="sm" className="h-8" data-testid={`button-add-size-${type.id}`} onClick={() => addSize(type.id)}>
                        <Plus className="w-3.5 h-3.5 mr-1" /> Size
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            className="max-w-xs"
            placeholder="New type, such as Pipe"
            title="Name a type, then add sizes under it"
            data-testid="input-new-inventory-type"
            value={newTypeName}
            onChange={event => setNewTypeName(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') addType(); }}
          />
          <Button type="button" variant="outline" data-testid="button-add-inventory-type" onClick={addType} disabled={createType.isPending}>
            <Plus className="w-4 h-4 mr-1" /> Add type
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
