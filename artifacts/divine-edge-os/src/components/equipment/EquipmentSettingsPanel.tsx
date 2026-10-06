import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetTenantSettings, getGetTenantSettingsQueryKey,
  useUpdateTenantSettings,
  useListEquipmentTypes, getListEquipmentTypesQueryKey,
  useCreateEquipmentType, useUpdateEquipmentType, useDeleteEquipmentType,
} from '@workspace/api-client-react';
import type { EquipmentType } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, GripVertical } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

type ChecklistItem = { id: string; label: string; required: boolean; equipmentTypes?: string[] };

type ChecklistEditorProps = {
  items: ChecklistItem[];
  equipmentTypes: EquipmentType[];
  onChange: (items: ChecklistItem[]) => void;
};

function ChecklistEditor({ items, equipmentTypes, onChange }: ChecklistEditorProps) {
  const updateItem = (index: number, update: Partial<ChecklistItem>) => {
    onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item));
  };

  return (
    <>
      {items.map((item, index) => (
        <div key={item.id} className="rounded-lg border p-3 space-y-3" data-testid={`checklist-item-${item.id}`}>
          <div className="flex items-center gap-2">
            <GripVertical className="w-4 h-4 text-muted-foreground" />
            <Input
              value={item.label}
              onChange={event => updateItem(index, { label: event.target.value })}
              data-testid={`input-checklist-label-${item.id}`}
            />
            <label className="flex items-center gap-2 text-xs whitespace-nowrap">
              <Checkbox
                checked={item.required}
                onCheckedChange={checked => updateItem(index, { required: checked === true })}
                data-testid={`checkbox-checklist-required-${item.id}`}
              />
              Required
            </label>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
              data-testid={`button-delete-checklist-${item.id}`}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
          <div className="pl-6 space-y-2">
            <p className="text-xs font-medium">Applies to equipment types</p>
            {equipmentTypes.length === 0 ? (
              <p className="text-xs text-muted-foreground">All equipment (add equipment types below to target this question).</p>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={!item.equipmentTypes?.length}
                    onCheckedChange={checked => {
                      if (checked === true) updateItem(index, { equipmentTypes: [] });
                    }}
                    data-testid={`checkbox-checklist-all-types-${item.id}`}
                  />
                  All equipment
                </label>
                {equipmentTypes.map(equipmentType => {
                  const selectedTypes = item.equipmentTypes ?? [];
                  const checked = selectedTypes.includes(equipmentType.label);
                  return (
                    <label key={equipmentType.id} className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={nextChecked => {
                          const nextTypes = nextChecked === true
                            ? [...selectedTypes, equipmentType.label]
                            : selectedTypes.filter(type => type !== equipmentType.label);
                          updateItem(index, { equipmentTypes: nextTypes });
                        }}
                        data-testid={`checkbox-checklist-type-${item.id}-${equipmentType.id}`}
                      />
                      {equipmentType.label}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

export function EquipmentSettingsPanel() {
  const qc = useQueryClient();
  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const updateSettings = useUpdateTenantSettings();

  const [equipRepairPct, setEquipRepairPct] = useState('50');
  const [equipResalePct, setEquipResalePct] = useState('20');
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [checklistName, setChecklistName] = useState('Pre-trip');
  const savedChecklistName = settings?.preTripChecklistName?.trim() || 'Pre-trip';
  const [endOfDayChecklist, setEndOfDayChecklist] = useState<ChecklistItem[]>([]);

  useEffect(() => {
    if (!settings) return;
    setEquipRepairPct(String((settings as any).equipmentRepairThresholdPct ?? 50));
    setEquipResalePct(String((settings as any).equipmentResaleThresholdPct ?? 20));
    setChecklistName(settings.preTripChecklistName?.trim() || 'Pre-trip');
    setChecklist(((settings as any).preTripChecklist ?? []) as ChecklistItem[]);
    setEndOfDayChecklist(((settings as any).endOfDayChecklist ?? []) as ChecklistItem[]);
  }, [settings]);

  const saveThresholds = () => {
    updateSettings.mutate(
      { data: { equipmentRepairThresholdPct: parseFloat(equipRepairPct) || 50, equipmentResaleThresholdPct: parseFloat(equipResalePct) || 20 } as any },
      {
        onSuccess: () => { toast.success('Equipment thresholds saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save thresholds'),
      }
    );
  };

  const saveChecklist = () => {
    if (checklist.some(item => !item.label.trim())) { toast.error('Every checklist item needs a label'); return; }
    const name = checklistName.trim();
    if (!name) { toast.error('Give the checklist a name'); return; }
    if (name.length > 40) { toast.error('Keep the checklist name to 40 characters or fewer'); return; }
    updateSettings.mutate({ data: { preTripChecklist: checklist, preTripChecklistName: name } }, {
      onSuccess: () => { toast.success(`${name} checklist saved`); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
      onError: () => toast.error(`Failed to save ${savedChecklistName.toLowerCase()} checklist`),
    });
  };
  const saveEndOfDayChecklist = () => {
    if (endOfDayChecklist.some(item => !item.label.trim())) { toast.error('Every checklist item needs a label'); return; }
    updateSettings.mutate({ data: { endOfDayChecklist } }, {
      onSuccess: () => { toast.success(endOfDayChecklist.length ? 'End-of-day checklist saved' : 'End-of-day checklist disabled'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
      onError: () => toast.error('Failed to save end-of-day checklist'),
    });
  };

  const { data: equipmentTypes = [] } = useListEquipmentTypes({ query: { queryKey: getListEquipmentTypesQueryKey() } });
  const createEquipmentType = useCreateEquipmentType();
  const updateEquipmentType = useUpdateEquipmentType();
  const deleteEquipmentType = useDeleteEquipmentType();

  const [newTypeLabel, setNewTypeLabel] = useState('');
  const [editingTypeId, setEditingTypeId] = useState<number | null>(null);
  const [editingTypeLabel, setEditingTypeLabel] = useState('');

  const doCreateType = () => {
    if (!newTypeLabel.trim()) return;
    createEquipmentType.mutate(
      { data: { label: newTypeLabel.trim(), sortOrder: equipmentTypes.length } },
      {
        onSuccess: () => { qc.invalidateQueries({ queryKey: getListEquipmentTypesQueryKey() }); setNewTypeLabel(''); },
        onError: () => toast.error('Failed to add type'),
      }
    );
  };

  const doSaveType = (id: number) => {
    if (!editingTypeLabel.trim()) return;
    updateEquipmentType.mutate(
      { id, data: { label: editingTypeLabel.trim() } },
      {
        onSuccess: () => { qc.invalidateQueries({ queryKey: getListEquipmentTypesQueryKey() }); setEditingTypeId(null); },
        onError: () => toast.error('Failed to rename type'),
      }
    );
  };

  return (
    <div className="space-y-6 py-2">
      {/* Sell Thresholds */}
      <Card>
        <CardHeader>
          <CardTitle>Equipment Sell Thresholds</CardTitle>
          <CardDescription>
            Configure when the system should recommend selling a piece of equipment.
            A sell badge appears when either condition is met.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">Repair Cost Threshold (%)</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number" min={0} max={200} step={5}
                  className="w-24 text-right"
                  title="Flag equipment when cumulative repair costs exceed this percentage of its purchase price"
                  value={equipRepairPct}
                  onChange={e => setEquipRepairPct(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">% of purchase price</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Flag when total repair cost exceeds this % of the original purchase price.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Resale Value Threshold (%)</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number" min={0} max={100} step={5}
                  className="w-24 text-right"
                  title="Flag equipment when estimated resale value falls below this percentage of the purchase price"
                  value={equipResalePct}
                  onChange={e => setEquipResalePct(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">% of purchase price</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Flag when estimated resale value (age-depreciated) falls below this %.
              </p>
            </div>
          </div>
          <Button onClick={saveThresholds} disabled={updateSettings.isPending} variant="outline">
            Save Thresholds
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Optional End-of-Day Checklist</CardTitle>
          <CardDescription>Field staff can complete this separately for each piece of equipment. Leave it empty to disable the end-of-day option.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ChecklistEditor items={endOfDayChecklist} equipmentTypes={equipmentTypes} onChange={setEndOfDayChecklist} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEndOfDayChecklist(current => [...current, { id: `end-day-${Date.now()}`, label: '', required: true, equipmentTypes: [] }])} data-testid="button-add-end-day-question"><Plus className="w-4 h-4 mr-1" /> Add Question</Button>
            <Button onClick={saveEndOfDayChecklist} disabled={updateSettings.isPending}>{endOfDayChecklist.length ? 'Save End-of-Day Checklist' : 'Keep Disabled'}</Button>
          </div>
        </CardContent>
      </Card>

      {/* Equipment Types */}
      <Card>
        <CardHeader>
          <CardTitle>{savedChecklistName} Checklist</CardTitle>
          <CardDescription>Name the morning equipment check the way your crews say it. The name shows on the field app button, screen title, and save button. Choose which equipment types see each question. Questions set to all equipment preserve the tenant-wide checklist behavior. Completed inspections keep the wording that was used that day.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5 pb-2">
            <label className="text-sm font-medium" htmlFor="pre-trip-checklist-name">Checklist name</label>
            <Input
              id="pre-trip-checklist-name"
              className="max-w-xs"
              maxLength={40}
              placeholder="Pre-trip"
              value={checklistName}
              onChange={e => setChecklistName(e.target.value)}
              data-testid="input-pre-trip-checklist-name"
            />
            <p className="text-xs text-muted-foreground">Examples: Morning Check, Truck Walkaround. Saved with the checklist below.</p>
          </div>
          <ChecklistEditor items={checklist} equipmentTypes={equipmentTypes} onChange={setChecklist} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setChecklist(current => [...current, { id: `item-${Date.now()}`, label: '', required: true, equipmentTypes: [] }])} data-testid="button-add-pre-trip-question"><Plus className="w-4 h-4 mr-1" /> Add Question</Button>
            <Button onClick={saveChecklist} disabled={updateSettings.isPending}>Save Checklist</Button>
          </div>
        </CardContent>
      </Card>

      {/* Equipment Types */}
      <Card>
        <CardHeader>
          <CardTitle>Equipment Types</CardTitle>
          <CardDescription>
            Define the type labels available when adding or editing equipment.
            Staff can still type a custom value if a type isn't listed here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {equipmentTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No types defined yet. Add your first type below.</p>
          ) : (
            <div className="divide-y border rounded-lg">
              {equipmentTypes.map((et: EquipmentType) => (
                <div key={et.id} className="flex items-center gap-2 px-3 py-2">
                  {editingTypeId === et.id ? (
                    <>
                      <Input
                        className="h-7 text-sm flex-1"
                        value={editingTypeLabel}
                        onChange={e => setEditingTypeLabel(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') doSaveType(et.id);
                          if (e.key === 'Escape') setEditingTypeId(null);
                        }}
                        autoFocus
                      />
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => doSaveType(et.id)}>Save</Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingTypeId(null)}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm">{et.label}</span>
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7"
                        title="Rename this equipment type"
                        onClick={() => { setEditingTypeId(et.id); setEditingTypeLabel(et.label); }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title="Delete this equipment type"
                        onClick={() => {
                          deleteEquipmentType.mutate({ id: et.id }, {
                            onSuccess: () => qc.invalidateQueries({ queryKey: getListEquipmentTypesQueryKey() }),
                            onError: () => toast.error('Failed to delete type'),
                          });
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input
              className="flex-1"
              placeholder="New type label (e.g. Riding Mower)"
              value={newTypeLabel}
              onChange={e => setNewTypeLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') doCreateType(); }}
            />
            <Button
              variant="outline"
              disabled={!newTypeLabel.trim() || createEquipmentType.isPending}
              onClick={doCreateType}
            >
              <Plus className="w-4 h-4 mr-1" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
