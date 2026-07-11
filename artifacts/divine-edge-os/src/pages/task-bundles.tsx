import React, { useMemo, useState } from 'react';
import {
  useListTaskBundles, getListTaskBundlesQueryKey,
  useGetTaskBundle, getGetTaskBundleQueryKey,
  useCreateTaskBundle, useUpdateTaskBundle, useDeleteTaskBundle,
  useCreateTaskBundleItem, useUpdateTaskBundleItem, useDeleteTaskBundleItem,
  useStartTaskBundle, useCompleteTaskBundleCompletion,
  useListTaskBundleCompletions, getListTaskBundleCompletionsQueryKey,
  useListShrinkageReports, getListShrinkageReportsQueryKey,
  useListUsers, getListUsersQueryKey,
  useListEquipment, getListEquipmentQueryKey,
  useListInventoryItems, getListInventoryItemsQueryKey,
  type TaskBundle, type TaskBundleItem, type TaskBundleCompletion,
  type TaskBundleItemResultInput,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TASK_ROLE_BUCKETS, roleBucketLabel } from '@/lib/taskConstants';
import {
  ClipboardList, Plus, Trash2, Edit, PlayCircle, CheckCircle2, XCircle, Eye,
  Timer, ListChecks, History, PackageSearch, User as UserIcon, Users as UsersIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, formatDistanceStrict } from 'date-fns';

const ITEM_TYPES = [
  { value: 'checklist', label: 'Checklist item (Pass/Fail/Concern)' },
  { value: 'safety_check', label: 'Safety check (Pass/Fail/Concern)' },
  { value: 'mileage_log', label: 'Mileage log (linked to equipment)' },
  { value: 'fuel_log', label: 'Fuel log (linked to equipment)' },
  { value: 'hour_meter_log', label: 'Hour meter log (linked to equipment)' },
  { value: 'tool_inventory_check', label: 'Tool inventory check' },
  { value: 'free_text', label: 'Free text note' },
  { value: 'warehouse_inventory_count', label: 'Warehouse inventory count' },
];

const FREQ_LABELS: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', as_needed: 'As Needed' };

function itemTypeLabel(type: string) {
  return ITEM_TYPES.find(t => t.value === type)?.label ?? type;
}

function fmt$(v: number | null | undefined) {
  if (v == null) return '—';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function needsEquipment(type: string) {
  return type === 'mileage_log' || type === 'fuel_log' || type === 'hour_meter_log';
}

/** Checklist-style items may optionally link to a specific piece of equipment; a "Concern"
 *  result on a linked item raises a procurement alert tied to that equipment. */
function canLinkEquipment(type: string) {
  return needsEquipment(type) || type === 'checklist' || type === 'safety_check' || type === 'tool_inventory_check';
}

// ─── Bundle Builder (create/edit) ───────────────────────────────────────────────

interface DraftItem {
  key: string;
  id?: number;
  type: string;
  label: string;
  linkedEquipmentId?: number;
  config?: { inventoryItemIds?: number[] };
}

function BundleBuilderSheet({
  open, onOpenChange, bundle,
}: { open: boolean; onOpenChange: (o: boolean) => void; bundle: TaskBundle | null }) {
  const qc = useQueryClient();
  const isEdit = !!bundle;

  const { data: detail } = useGetTaskBundle(bundle?.id ?? 0, {
    query: { queryKey: getGetTaskBundleQueryKey(bundle?.id ?? 0), enabled: open && isEdit },
  });
  const { data: users = [] } = useListUsers({ query: { queryKey: getListUsersQueryKey(), enabled: open } });
  const { data: equipmentList = [] } = useListEquipment(undefined, { query: { queryKey: getListEquipmentQueryKey(), enabled: open } });
  const { data: inventory = [] } = useListInventoryItems(undefined, { query: { queryKey: getListInventoryItemsQueryKey(), enabled: open } });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [frequency, setFrequency] = useState('daily');
  const [assignee, setAssignee] = useState(''); // "user:<id>" or "role:<bucket>"
  const [items, setItems] = useState<DraftItem[]>([]);

  const createBundle = useCreateTaskBundle();
  const updateBundle = useUpdateTaskBundle();
  const deleteBundle = useDeleteTaskBundle();
  const createItem = useCreateTaskBundleItem();
  const updateItem = useUpdateTaskBundleItem();
  const deleteItem = useDeleteTaskBundleItem();

  const invalidate = () => qc.invalidateQueries({ queryKey: getListTaskBundlesQueryKey() });

  React.useEffect(() => {
    if (!open) return;
    if (isEdit && detail) {
      setName(detail.name);
      setDescription(detail.description ?? '');
      setFrequency(detail.frequency);
      setAssignee(detail.assignedToUserId ? `user:${detail.assignedToUserId}` : detail.assignedToRole ? `role:${detail.assignedToRole}` : '');
      setItems(detail.items.map(i => ({
        key: String(i.id), id: i.id, type: i.type, label: i.label,
        linkedEquipmentId: i.linkedEquipmentId ?? undefined,
        config: (i.config as { inventoryItemIds?: number[] }) ?? undefined,
      })));
    } else if (!isEdit) {
      setName(''); setDescription(''); setFrequency('daily'); setAssignee(''); setItems([]);
    }
  }, [open, isEdit, detail]);

  const addItem = () => {
    setItems(list => [...list, { key: `new-${Date.now()}-${list.length}`, type: 'checklist', label: '' }]);
  };
  const updateDraftItem = (key: string, patch: Partial<DraftItem>) => {
    setItems(list => list.map(i => (i.key === key ? { ...i, ...patch } : i)));
  };
  const removeDraftItem = (key: string) => {
    const item = items.find(i => i.key === key);
    setItems(list => list.filter(i => i.key !== key));
    if (isEdit && item?.id) {
      deleteItem.mutate({ id: item.id }, { onSuccess: invalidate });
    }
  };

  const handleSave = () => {
    if (!name.trim()) { toast.error('Bundle name is required'); return; }
    if (!assignee) { toast.error('Assign this bundle to a person or a role'); return; }
    const [kind, value] = assignee.split(':');
    const assignedToUserId = kind === 'user' ? parseInt(value, 10) : undefined;
    const assignedToRole = kind === 'role' ? value : undefined;

    if (isEdit && bundle) {
      updateBundle.mutate({
        id: bundle.id,
        data: { name, description: description || undefined, frequency, assignedToUserId: assignedToUserId ?? null, assignedToRole: assignedToRole ?? null },
      }, {
        onSuccess: () => {
          // Persist item changes: update existing, create new
          items.forEach(it => {
            const payload = { type: it.type, label: it.label, linkedEquipmentId: it.linkedEquipmentId, config: it.config };
            if (it.id) updateItem.mutate({ id: it.id, data: payload }, { onSuccess: invalidate });
            else createItem.mutate({ id: bundle.id, data: payload }, { onSuccess: invalidate });
          });
          toast.success('Bundle updated');
          invalidate();
          onOpenChange(false);
        },
        onError: () => toast.error('Failed to update bundle'),
      });
    } else {
      createBundle.mutate({
        data: {
          name, description: description || undefined, frequency, assignedToUserId, assignedToRole,
          items: items.map(it => ({ type: it.type, label: it.label, linkedEquipmentId: it.linkedEquipmentId, config: it.config })),
        },
      }, {
        onSuccess: () => { toast.success('Bundle created'); invalidate(); onOpenChange(false); },
        onError: () => toast.error('Failed to create bundle'),
      });
    }
  };

  const handleDelete = () => {
    if (!bundle) return;
    if (!window.confirm(`Delete "${bundle.name}"? This cannot be undone.`)) return;
    deleteBundle.mutate({ id: bundle.id }, {
      onSuccess: () => { toast.success('Bundle deleted'); invalidate(); onOpenChange(false); },
      onError: () => toast.error('This bundle has completion history and cannot be deleted. Deactivate it instead.'),
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle>{isEdit ? 'Edit Task Bundle' : 'New Task Bundle'}</SheetTitle>
          <SheetDescription>Build a checklist of items your team will fill out on a recurring basis.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 pb-8">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name *</label>
            <Input placeholder="e.g. Morning Truck Inspection" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description</label>
            <Textarea rows={2} placeholder="What is this bundle for?" value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Frequency</label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="as_needed">As Needed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Assign To *</label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger><SelectValue placeholder="Select person or role" /></SelectTrigger>
                <SelectContent>
                  {users.map(u => <SelectItem key={`user:${u.id}`} value={`user:${u.id}`}>{u.name}</SelectItem>)}
                  {TASK_ROLE_BUCKETS.map(r => <SelectItem key={`role:${r.value}`} value={`role:${r.value}`}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold flex items-center gap-1.5"><ListChecks className="w-4 h-4" /> Task Items ({items.length})</p>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={addItem}><Plus className="w-3.5 h-3.5" /> Add Item</Button>
            </div>

            {items.map((it, idx) => (
              <Card key={it.key} className="border-muted-foreground/20">
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-5 shrink-0">{idx + 1}.</span>
                    <Select value={it.type} onValueChange={v => updateDraftItem(it.key, { type: v })}>
                      <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ITEM_TYPES.map(t => <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0" onClick={() => removeDraftItem(it.key)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <Input
                    className="h-8 text-xs"
                    placeholder="Item label, e.g. Check tire pressure"
                    value={it.label}
                    onChange={e => updateDraftItem(it.key, { label: e.target.value })}
                  />
                  {canLinkEquipment(it.type) && (
                    <div className="space-y-1">
                      <Select value={it.linkedEquipmentId ? String(it.linkedEquipmentId) : ''} onValueChange={v => updateDraftItem(it.key, { linkedEquipmentId: parseInt(v, 10) })}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder={needsEquipment(it.type) ? 'Link to equipment' : 'Link to equipment (optional)'} />
                        </SelectTrigger>
                        <SelectContent>
                          {equipmentList.map(e => <SelectItem key={e.id} value={String(e.id)} className="text-xs">{e.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {(it.type === 'checklist' || it.type === 'safety_check') && (
                        <p className="text-[10px] text-muted-foreground">If linked, a "Concern / Watch" result raises a procurement alert for this equipment.</p>
                      )}
                    </div>
                  )}
                  {it.type === 'warehouse_inventory_count' && (
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">Items to count:</p>
                      <div className="max-h-28 overflow-y-auto border rounded-md p-2 space-y-1">
                        {inventory.map(inv => {
                          const checked = it.config?.inventoryItemIds?.includes(inv.id) ?? false;
                          return (
                            <label key={inv.id} className="flex items-center gap-2 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={e => {
                                  const current = it.config?.inventoryItemIds ?? [];
                                  const next = e.target.checked ? [...current, inv.id] : current.filter(id => id !== inv.id);
                                  updateDraftItem(it.key, { config: { inventoryItemIds: next } });
                                }}
                              />
                              {inv.name} <span className="text-muted-foreground">({inv.sku})</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            {items.length === 0 && <p className="text-xs text-muted-foreground text-center py-4 border rounded-lg border-dashed">No items yet. Add at least one.</p>}
          </div>

          <Separator />
          <div className="flex items-center justify-between">
            {isEdit ? (
              <Button variant="ghost" className="text-destructive hover:text-destructive gap-2" onClick={handleDelete}>
                <Trash2 className="w-4 h-4" /> Delete
              </Button>
            ) : <div />}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={createBundle.isPending || updateBundle.isPending}>
                {isEdit ? 'Save Changes' : 'Create Bundle'}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Run Bundle Dialog (start → fill in → submit) ───────────────────────────────

function RunBundleDialog({ bundleId, open, onOpenChange }: { bundleId: number | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { data: bundle } = useGetTaskBundle(bundleId ?? 0, {
    query: { queryKey: getGetTaskBundleQueryKey(bundleId ?? 0), enabled: open && !!bundleId },
  });
  const { data: inventory = [] } = useListInventoryItems(undefined, { query: { queryKey: getListInventoryItemsQueryKey(), enabled: open } });

  const startBundle = useStartTaskBundle();
  const completeBundle = useCompleteTaskBundleCompletion();

  const [completionId, setCompletionId] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, TaskBundleItemResultInput>>({});
  const [elapsed, setElapsed] = useState(0);

  React.useEffect(() => {
    if (open && bundleId && !completionId) {
      startBundle.mutate({ id: bundleId }, {
        onSuccess: c => { setCompletionId(c.id); setStartedAt(Date.now()); },
        onError: () => { toast.error('Could not start this task'); onOpenChange(false); },
      });
    }
    if (!open) { setCompletionId(null); setStartedAt(null); setResults({}); setElapsed(0); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bundleId]);

  React.useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  const setResult = (item: TaskBundleItem, patch: Partial<TaskBundleItemResultInput>) => {
    setResults(r => {
      const existing = r[item.id];
      const base: TaskBundleItemResultInput = existing ?? { itemId: item.id, type: item.type, label: item.label };
      return { ...r, [item.id]: { ...base, ...patch } };
    });
  };

  const handleSubmit = () => {
    if (!completionId || !bundle) return;
    const itemResults = bundle.items.map(i => results[i.id] ?? { itemId: i.id, type: i.type, label: i.label });
    completeBundle.mutate({ id: completionId, data: { itemResults } }, {
      onSuccess: () => {
        toast.success('Task submitted');
        qc.invalidateQueries({ queryKey: getListTaskBundleCompletionsQueryKey() });
        qc.invalidateQueries({ queryKey: getListShrinkageReportsQueryKey() });
        onOpenChange(false);
      },
      onError: () => toast.error('Failed to submit'),
    });
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>{bundle?.name ?? 'Loading…'}</DialogTitle>
              <DialogDescription>Fill in each item, then submit.</DialogDescription>
            </div>
            <Badge variant="secondary" className="gap-1.5 font-mono text-sm"><Timer className="w-3.5 h-3.5" /> {mm}:{ss}</Badge>
          </div>
        </DialogHeader>

        {bundle && (
          <div className="space-y-4">
            {bundle.items.map(item => {
              const equipment = item.linkedEquipmentId;
              return (
                <div key={item.id} className="rounded-lg border p-3 space-y-2">
                  <p className="text-sm font-medium">{item.label}</p>
                  {(item.type === 'checklist' || item.type === 'safety_check' || item.type === 'tool_inventory_check') && (
                    <div className="flex gap-2">
                      {(['pass', 'concern', 'fail'] as const).map(s => (
                        <Button
                          key={s}
                          type="button"
                          size="sm"
                          variant={results[item.id]?.status === s ? 'default' : 'outline'}
                          className={
                            results[item.id]?.status === s
                              ? s === 'pass' ? 'bg-emerald-600 hover:bg-emerald-700' : s === 'concern' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-destructive hover:bg-destructive/90'
                              : ''
                          }
                          onClick={() => setResult(item, { status: s })}
                        >
                          {s === 'pass' ? <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> : s === 'concern' ? <Eye className="w-3.5 h-3.5 mr-1" /> : <XCircle className="w-3.5 h-3.5 mr-1" />}
                          {s === 'pass' ? 'Pass' : s === 'concern' ? 'Concern / Watch' : 'Fail'}
                        </Button>
                      ))}
                    </div>
                  )}
                  {results[item.id]?.status === 'concern' && (
                    <p className="text-[11px] text-amber-600">Stays in service, but flags a procurement alert on the mechanic dashboard.</p>
                  )}
                  {(item.type === 'checklist' || item.type === 'safety_check' || item.type === 'tool_inventory_check') && (
                    <Input
                      className="h-8 text-xs"
                      placeholder="Optional note"
                      value={String(results[item.id]?.note ?? '')}
                      onChange={e => setResult(item, { note: e.target.value })}
                    />
                  )}
                  {(item.type === 'mileage_log' || item.type === 'fuel_log' || item.type === 'hour_meter_log') && (
                    <Input
                      type="number"
                      className="h-8 text-xs"
                      placeholder={item.type === 'fuel_log' ? 'Gallons' : item.type === 'mileage_log' ? 'Current mileage' : 'Current hour meter reading'}
                      value={String(results[item.id]?.value ?? '')}
                      onChange={e => setResult(item, { value: e.target.value })}
                    />
                  )}
                  {item.type === 'free_text' && (
                    <Textarea
                      rows={2}
                      placeholder="Notes"
                      value={String(results[item.id]?.value ?? '')}
                      onChange={e => setResult(item, { value: e.target.value })}
                    />
                  )}
                  {item.type === 'warehouse_inventory_count' && (
                    <div className="space-y-1.5">
                      {((item.config as { inventoryItemIds?: number[] })?.inventoryItemIds ?? []).map(invId => {
                        const inv = inventory.find(i => i.id === invId);
                        if (!inv) return null;
                        const counts = results[item.id]?.counts ?? [];
                        const current = counts.find(c => c.inventoryItemId === invId)?.actualCount ?? '';
                        return (
                          <div key={invId} className="flex items-center gap-2">
                            <span className="text-xs flex-1 truncate">{inv.name}</span>
                            <Input
                              type="number"
                              className="h-8 text-xs w-24"
                              placeholder="Count"
                              value={String(current)}
                              onChange={e => {
                                const val = parseFloat(e.target.value);
                                const nextCounts = counts.filter(c => c.inventoryItemId !== invId);
                                if (!isNaN(val)) nextCounts.push({ inventoryItemId: invId, actualCount: val });
                                setResult(item, { counts: nextCounts });
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!bundle || completeBundle.isPending} className="gap-2">
            <CheckCircle2 className="w-4 h-4" /> Submit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── My Tasks Tab ────────────────────────────────────────────────────────────────

function MyTasksTab() {
  const params = { scope: 'mine' as const };
  const { data: bundles = [], isLoading } = useListTaskBundles(params, { query: { queryKey: getListTaskBundlesQueryKey(params) } });
  const [runningId, setRunningId] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {isLoading && <p className="text-sm text-muted-foreground text-center py-8">Loading your tasks…</p>}
      {!isLoading && bundles.length === 0 && (
        <div className="text-center py-12 text-muted-foreground border rounded-xl border-dashed">
          No task bundles are assigned to you right now.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {bundles.map(b => (
          <Card key={b.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{b.name}</p>
                <Badge variant="outline" className="text-xs">{FREQ_LABELS[b.frequency] ?? b.frequency}</Badge>
              </div>
              {b.description && <p className="text-xs text-muted-foreground line-clamp-2">{b.description}</p>}
              <p className="text-xs text-muted-foreground">{b.itemCount} item{b.itemCount !== 1 ? 's' : ''}</p>
              <Button size="sm" className="w-full gap-2" onClick={() => setRunningId(b.id)}>
                <PlayCircle className="w-4 h-4" /> Start
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <RunBundleDialog bundleId={runningId} open={runningId != null} onOpenChange={o => { if (!o) setRunningId(null); }} />
    </div>
  );
}

// ─── Bundles (admin builder) Tab ─────────────────────────────────────────────────

function BundlesTab() {
  const { data: bundles = [], isLoading } = useListTaskBundles(undefined, { query: { queryKey: getListTaskBundlesQueryKey() } });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<TaskBundle | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button className="gap-2" onClick={() => { setEditing(null); setSheetOpen(true); }}>
          <Plus className="w-4 h-4" /> New Bundle
        </Button>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground text-center py-8">Loading bundles…</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {bundles.map(b => (
          <Card key={b.id} className="cursor-pointer hover:shadow-md transition-all" onClick={() => { setEditing(b); setSheetOpen(true); }}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-semibold truncate">{b.name}</p>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={e => { e.stopPropagation(); setEditing(b); setSheetOpen(true); }}>
                  <Edit className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs">{FREQ_LABELS[b.frequency] ?? b.frequency}</Badge>
                <Badge variant="secondary" className="text-xs gap-1">
                  {b.assignedToUserId ? <UserIcon className="w-3 h-3" /> : <UsersIcon className="w-3 h-3" />}
                  {b.assignedToName ?? roleBucketLabel(b.assignedToRole)}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{b.itemCount} item{b.itemCount !== 1 ? 's' : ''}</p>
            </CardContent>
          </Card>
        ))}
        {!isLoading && bundles.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground border rounded-xl border-dashed">
            No task bundles yet. Click "New Bundle" to build your first checklist.
          </div>
        )}
      </div>
      <BundleBuilderSheet open={sheetOpen} onOpenChange={setSheetOpen} bundle={editing} />
    </div>
  );
}

// ─── Completion Log Tab ──────────────────────────────────────────────────────────

function CompletionLogTab() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const params = { ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}) };
  const { data: completions = [], isLoading } = useListTaskBundleCompletions(params, { query: { queryKey: getListTaskBundleCompletionsQueryKey(params) } });

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <div className="space-y-1"><label className="text-xs font-medium">From</label><Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-xs font-medium">To</label><Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
      </div>
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bundle</TableHead>
              <TableHead>Completed By</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Flags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>}
            {!isLoading && completions.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No completions in this range.</TableCell></TableRow>}
            {completions.map((c: TaskBundleCompletion) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.bundleName ?? `#${c.bundleId}`}</TableCell>
                <TableCell>{c.userName ?? `#${c.userId}`}</TableCell>
                <TableCell className="text-xs">{format(new Date(c.startedAt), 'MMM d, yyyy h:mm a')}</TableCell>
                <TableCell className="text-xs">{c.durationSeconds != null ? formatDistanceStrict(0, c.durationSeconds * 1000) : '—'}</TableCell>
                <TableCell><Badge variant={c.status === 'completed' ? 'default' : 'outline'} className="text-xs capitalize">{c.status.replace('_', ' ')}</Badge></TableCell>
                <TableCell>{c.hasFlags ? <Badge variant="destructive" className="text-xs">Needs review</Badge> : <span className="text-muted-foreground text-xs">—</span>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Shrinkage Report Tab ─────────────────────────────────────────────────────────

function ShrinkageReportTab() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const params = { ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}) };
  const { data: ledger, isLoading } = useListShrinkageReports(params, { query: { queryKey: getListShrinkageReportsQueryKey(params) } });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-3">
          <div className="space-y-1"><label className="text-xs font-medium">From</label><Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-xs font-medium">To</label><Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
        </div>
        <div className="rounded-lg border px-4 py-2 text-right">
          <p className="text-xs text-muted-foreground">Cumulative Loss</p>
          <p className="text-lg font-bold text-destructive">{fmt$(ledger?.totalLoss ?? 0)}</p>
        </div>
      </div>
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead className="text-right">Loss</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>}
            {!isLoading && (ledger?.lines.length ?? 0) === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No shrinkage recorded in this range.</TableCell></TableRow>}
            {ledger?.lines.map(line => (
              <TableRow key={line.id}>
                <TableCell className="text-xs">{format(new Date(line.createdAt), 'MMM d, yyyy')}</TableCell>
                <TableCell className="font-medium">{line.itemName}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{line.sku}</TableCell>
                <TableCell className="text-right">{line.expectedStock}</TableCell>
                <TableCell className="text-right">{line.actualCount}</TableCell>
                <TableCell className={`text-right font-mono ${line.variance < 0 ? 'text-destructive' : 'text-emerald-600'}`}>{line.variance > 0 ? '+' : ''}{line.variance}</TableCell>
                <TableCell className="text-right font-mono">{fmt$(line.totalLoss)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────────

export default function TaskBundlesPage() {
  const { isTechnician, isOwner, isManager, isDepartmentManager, isCrewManager, canManageOffice } = useAuth();
  const isAdmin = isOwner || isManager || isDepartmentManager || isCrewManager || canManageOffice;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2"><ClipboardList className="w-7 h-7" /> Daily Tasks</h1>
        <p className="text-muted-foreground mt-1">Recurring checklists, readings, and counts — separate from customer Jobs and Internal Tasks.</p>
      </div>

      <Tabs defaultValue="my-tasks">
        <TabsList>
          <TabsTrigger value="my-tasks" className="gap-1.5"><PlayCircle className="w-3.5 h-3.5" /> My Tasks</TabsTrigger>
          {isAdmin && <TabsTrigger value="bundles" className="gap-1.5"><ListChecks className="w-3.5 h-3.5" /> Bundles</TabsTrigger>}
          {isAdmin && <TabsTrigger value="log" className="gap-1.5"><History className="w-3.5 h-3.5" /> Completion Log</TabsTrigger>}
          {isAdmin && <TabsTrigger value="shrinkage" className="gap-1.5"><PackageSearch className="w-3.5 h-3.5" /> Shrinkage Report</TabsTrigger>}
        </TabsList>
        <TabsContent value="my-tasks" className="mt-4"><MyTasksTab /></TabsContent>
        {isAdmin && <TabsContent value="bundles" className="mt-4"><BundlesTab /></TabsContent>}
        {isAdmin && <TabsContent value="log" className="mt-4"><CompletionLogTab /></TabsContent>}
        {isAdmin && <TabsContent value="shrinkage" className="mt-4"><ShrinkageReportTab /></TabsContent>}
      </Tabs>
    </div>
  );
}
