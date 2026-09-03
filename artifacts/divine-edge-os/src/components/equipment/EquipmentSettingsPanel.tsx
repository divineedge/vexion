import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetTenantSettings, getGetTenantSettingsQueryKey,
  useUpdateTenantSettings,
  useListEquipmentTypes, getListEquipmentTypesQueryKey,
  useCreateEquipmentType, useUpdateEquipmentType, useDeleteEquipmentType,
  useRecoverMisassignedDivineEdgeEquipment, getListEquipmentQueryKey,
} from '@workspace/api-client-react';
import type { EquipmentType } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, GripVertical } from 'lucide-react';

type ChecklistItem = { id: string; label: string; required: boolean };

export function EquipmentSettingsPanel() {
  const qc = useQueryClient();
  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const updateSettings = useUpdateTenantSettings();
  const recoverEquipment = useRecoverMisassignedDivineEdgeEquipment();

  const [equipRepairPct, setEquipRepairPct] = useState('50');
  const [equipResalePct, setEquipResalePct] = useState('20');
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [endOfDayChecklist, setEndOfDayChecklist] = useState<ChecklistItem[]>([]);

  useEffect(() => {
    if (!settings) return;
    setEquipRepairPct(String((settings as any).equipmentRepairThresholdPct ?? 50));
    setEquipResalePct(String((settings as any).equipmentResaleThresholdPct ?? 20));
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
    updateSettings.mutate({ data: { preTripChecklist: checklist } }, {
      onSuccess: () => { toast.success('Pre-trip checklist saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
      onError: () => toast.error('Failed to save pre-trip checklist'),
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
      {(settings as any)?.tenantId === 11 && (
        <Card className="border-amber-300 bg-amber-50/40">
          <CardHeader>
            <CardTitle>Recover September Equipment</CardTitle>
            <CardDescription>Three confirmed equipment records were saved to the legacy seed business on September 1. This owner-only action moves only those exact records into Divine Edge.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              disabled={recoverEquipment.isPending}
              onClick={() => recoverEquipment.mutate(undefined, {
                onSuccess: result => {
                  toast.success(result.recoveredCount ? `Recovered ${result.recoveredCount} equipment records` : 'Those equipment records are already recovered');
                  qc.invalidateQueries({ queryKey: getListEquipmentQueryKey() });
                },
                onError: () => toast.error('Could not recover the equipment records'),
              })}
            >
              {recoverEquipment.isPending ? 'Recovering…' : 'Move 3 Equipment Records to Divine Edge'}
            </Button>
          </CardContent>
        </Card>
      )}
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
          {endOfDayChecklist.map((item, index) => (
            <div key={item.id} className="flex items-center gap-2">
              <GripVertical className="w-4 h-4 text-muted-foreground" />
              <Input value={item.label} onChange={e => setEndOfDayChecklist(current => current.map((row, i) => i === index ? { ...row, label: e.target.value } : row))} />
              <label className="flex items-center gap-1 text-xs whitespace-nowrap"><input type="checkbox" checked={item.required} onChange={e => setEndOfDayChecklist(current => current.map((row, i) => i === index ? { ...row, required: e.target.checked } : row))} /> Required</label>
              <Button size="icon" variant="ghost" onClick={() => setEndOfDayChecklist(current => current.filter((_, i) => i !== index))}><Trash2 className="w-4 h-4" /></Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEndOfDayChecklist(current => [...current, { id: `end-day-${Date.now()}`, label: '', required: true }])}><Plus className="w-4 h-4 mr-1" /> Add Question</Button>
            <Button onClick={saveEndOfDayChecklist} disabled={updateSettings.isPending}>{endOfDayChecklist.length ? 'Save End-of-Day Checklist' : 'Keep Disabled'}</Button>
          </div>
        </CardContent>
      </Card>

      {/* Equipment Types */}
      <Card>
        <CardHeader>
          <CardTitle>Pre-Trip Checklist</CardTitle>
          <CardDescription>These questions appear in the Field App for every equipment inspection. Completed inspections keep the wording that was used that day.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {checklist.map((item, index) => (
            <div key={item.id} className="flex items-center gap-2">
              <GripVertical className="w-4 h-4 text-muted-foreground" />
              <Input value={item.label} onChange={e => setChecklist(current => current.map((row, i) => i === index ? { ...row, label: e.target.value } : row))} />
              <label className="flex items-center gap-1 text-xs whitespace-nowrap"><input type="checkbox" checked={item.required} onChange={e => setChecklist(current => current.map((row, i) => i === index ? { ...row, required: e.target.checked } : row))} /> Required</label>
              <Button size="icon" variant="ghost" onClick={() => setChecklist(current => current.filter((_, i) => i !== index))}><Trash2 className="w-4 h-4" /></Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setChecklist(current => [...current, { id: `item-${Date.now()}`, label: '', required: true }])}><Plus className="w-4 h-4 mr-1" /> Add Question</Button>
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
