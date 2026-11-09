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

type ChecklistItem = { id: string; label: string; required: boolean; equipmentTypes?: string[]; equipmentIds?: number[]; logHours?: boolean; fuelFillUp?: boolean };
type CategoryRule = { category: string; warnHours: string; retireHours: string; repairPct: string; resalePct: string; intervals: { label: string; everyHours: string }[] };

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
            <label className="block text-xs space-y-1">
              Specific equipment IDs
              <Input
                value={(item.equipmentIds ?? []).join(', ')}
                placeholder="Leave blank for every unit of the selected types"
                onChange={event => updateItem(index, { equipmentIds: event.target.value.split(/[^0-9]+/).filter(Boolean).map(Number) })}
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={item.logHours === true} onCheckedChange={checked => updateItem(index, { logHours: checked === true })} />
              Ask for operating hours on this question
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={item.fuelFillUp === true} onCheckedChange={checked => updateItem(index, { fuelFillUp: checked === true })} />
              Offer a fuel fill-up on this question
            </label>
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
  const [preTripEnabled, setPreTripEnabled] = useState(true);
  const [postTripEnabled, setPostTripEnabled] = useState(false);
  const [promptHours, setPromptHours] = useState(false);
  const [promptFuel, setPromptFuel] = useState(false);
  const [categoryRules, setCategoryRules] = useState<CategoryRule[]>([]);

  useEffect(() => {
    if (!settings) return;
    setEquipRepairPct(String((settings as any).equipmentRepairThresholdPct ?? 50));
    setEquipResalePct(String((settings as any).equipmentResaleThresholdPct ?? 20));
    setChecklistName(settings.preTripChecklistName?.trim() || 'Pre-trip');
    setChecklist(((settings as any).preTripChecklist ?? []) as ChecklistItem[]);
    setEndOfDayChecklist(((settings as any).endOfDayChecklist ?? []) as ChecklistItem[]);
    setPreTripEnabled((settings as any).preTripEnabled !== false);
    setPostTripEnabled((settings as any).postTripEnabled === true);
    setPromptHours((settings as any).promptEquipmentHours === true);
    setPromptFuel((settings as any).promptFuelFillUp === true);
    setCategoryRules((((settings as any).equipmentCategoryThresholds ?? []) as any[]).map(rule => ({
      category: String(rule.category ?? ''),
      warnHours: rule.warnHours == null ? '' : String(rule.warnHours),
      retireHours: rule.retireHours == null ? '' : String(rule.retireHours),
      repairPct: rule.repairPct == null ? '' : String(rule.repairPct),
      resalePct: rule.resalePct == null ? '' : String(rule.resalePct),
      intervals: Array.isArray(rule.intervals) ? rule.intervals.map((interval: any) => ({ label: String(interval.label ?? ''), everyHours: String(interval.everyHours ?? '') })) : [],
    })));
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
          <CardTitle>Category hour thresholds</CardTitle>
          <CardDescription>Set operating-hour warnings, retirement points, and maintenance intervals for an equipment category. A logged hour reading at or past an interval notifies managers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {categoryRules.map((rule, index) => (
            <div key={index} className="rounded-lg border p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Category, such as Mower" value={rule.category} onChange={event => setCategoryRules(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, category: event.target.value } : item))} />
                <Input placeholder="Warning hours" value={rule.warnHours} onChange={event => setCategoryRules(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, warnHours: event.target.value } : item))} />
                <Input placeholder="Retirement hours" value={rule.retireHours} onChange={event => setCategoryRules(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, retireHours: event.target.value } : item))} />
                <Input placeholder="Repair % of purchase" value={rule.repairPct} onChange={event => setCategoryRules(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, repairPct: event.target.value } : item))} />
                <Input placeholder="Resale % of purchase" value={rule.resalePct} onChange={event => setCategoryRules(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, resalePct: event.target.value } : item))} />
              </div>
              {rule.intervals.map((interval, intervalIndex) => (
                <div key={intervalIndex} className="flex gap-2">
                  <Input placeholder="Oil change" value={interval.label} onChange={event => setCategoryRules(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, intervals: item.intervals.map((entry, entryIndex) => entryIndex === intervalIndex ? { ...entry, label: event.target.value } : entry) } : item))} />
                  <Input placeholder="Every hours" value={interval.everyHours} onChange={event => setCategoryRules(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, intervals: item.intervals.map((entry, entryIndex) => entryIndex === intervalIndex ? { ...entry, everyHours: event.target.value } : entry) } : item))} />
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setCategoryRules(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, intervals: [...item.intervals, { label: '', everyHours: '' }] } : item))}>Add interval</Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCategoryRules(current => [...current, { category: '', warnHours: '', retireHours: '', repairPct: '', resalePct: '', intervals: [] }])}>Add category</Button>
            <Button onClick={() => updateSettings.mutate({ data: { equipmentCategoryThresholds: categoryRules.filter(rule => rule.category.trim()).map(rule => ({
              category: rule.category.trim(),
              warnHours: rule.warnHours ? Number(rule.warnHours) : null,
              retireHours: rule.retireHours ? Number(rule.retireHours) : null,
              repairPct: rule.repairPct ? Number(rule.repairPct) : null,
              resalePct: rule.resalePct ? Number(rule.resalePct) : null,
              intervals: rule.intervals.filter(interval => interval.label.trim() && Number(interval.everyHours) > 0).map(interval => ({ label: interval.label.trim(), everyHours: Number(interval.everyHours) })),
            })) } as any }, { onSuccess: () => toast.success('Category thresholds saved'), onError: () => toast.error('Failed to save category thresholds') })}>Save category thresholds</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Checklist requirements</CardTitle>
          <CardDescription>Turn pre-trip and post-trip checks on for field crews. Hour and fuel prompts apply when that check is on.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center justify-between gap-3 text-sm"><span>Pre-trip checklist</span><Checkbox checked={preTripEnabled} onCheckedChange={checked => setPreTripEnabled(checked === true)} /></label>
          <label className="flex items-center justify-between gap-3 text-sm"><span>Post-trip checklist</span><Checkbox checked={postTripEnabled} onCheckedChange={checked => setPostTripEnabled(checked === true)} /></label>
          <label className="flex items-center justify-between gap-3 text-sm"><span>Require operating hours</span><Checkbox checked={promptHours} onCheckedChange={checked => setPromptHours(checked === true)} /></label>
          <label className="flex items-center justify-between gap-3 text-sm"><span>Offer fuel fill-up</span><Checkbox checked={promptFuel} onCheckedChange={checked => setPromptFuel(checked === true)} /></label>
          <Button onClick={() => updateSettings.mutate({ data: { preTripEnabled, postTripEnabled, promptEquipmentHours: promptHours, promptFuelFillUp: promptFuel } as any }, { onSuccess: () => toast.success('Checklist requirements saved'), onError: () => toast.error('Failed to save checklist requirements') })}>Save checklist requirements</Button>
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
