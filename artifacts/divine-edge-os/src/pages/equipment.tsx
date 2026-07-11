import React, { useState } from 'react';
import {
  useListEquipment,
  getListEquipmentQueryKey,
  useCreateEquipment,
  useUpdateEquipment,
  useDeleteEquipment,
  useHardDeleteEquipment,
  useListEquipmentMaintenance,
  getListEquipmentMaintenanceQueryKey,
  useCreateEquipmentMaintenance,
  useDeleteEquipmentMaintenance,
  useListEquipmentMaintenanceMedia,
  getListEquipmentMaintenanceMediaQueryKey,
  useListEquipmentFuelLogs,
  getListEquipmentFuelLogsQueryKey,
  useCreateEquipmentFuelLog,
  useDeleteEquipmentFuelLog,
  useListEquipmentTasks, getListEquipmentTasksQueryKey,
} from '@workspace/api-client-react';
import type { Equipment, EquipmentMaintenance, EquipmentFuelLog } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { TaskFormDrawer } from '@/components/tasks/TaskFormDrawer';
import { TaskActions } from '@/components/tasks/TaskActions';
import { priorityBadgeClass, statusBadgeClass } from '@/lib/taskConstants';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import MediaGallery from '@/components/media/MediaGallery';
import {
  Wrench, Plus, Trash2, AlertTriangle, TrendingUp, Fuel, Clock, DollarSign,
  ChevronRight, ChevronDown, X, CheckCircle2, BarChart3, Archive, Paperclip,
} from 'lucide-react';
import { toast } from 'sonner';

const EQUIPMENT_TYPES = [
  { value: 'mower', label: 'Mower' },
  { value: 'truck', label: 'Truck' },
  { value: 'trailer', label: 'Trailer' },
  { value: 'sprayer', label: 'Sprayer' },
  { value: 'blower', label: 'Blower' },
  { value: 'edger', label: 'Edger' },
  { value: 'chainsaw', label: 'Chainsaw' },
  { value: 'other', label: 'Other' },
];

/**
 * The equipment list query is parameterized by `includeArchived`, so a plain
 * `getListEquipmentQueryKey()` invalidation only matches by key-prefix. Use a predicate
 * instead so every variant of the list query (with or without archived items) is refreshed,
 * regardless of which filter is currently active on the page.
 */
function invalidateEquipmentLists(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ predicate: query => query.queryKey[0] === getListEquipmentQueryKey()[0] });
}

function fmt$(v: number | null | undefined) {
  if (v == null) return '—';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtHours(v: number | null | undefined) {
  if (v == null) return '—';
  return `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })} hrs`;
}

// ── Equipment Form ─────────────────────────────────────────────────────────────

interface EquipmentFormState {
  name: string;
  type: string;
  purchaseDate: string;
  purchasePrice: string;
  expectedLifespanYears: string;
  expectedLifespanHours: string;
  currentHours: string;
  currentMiles: string;
  notes: string;
}

const EMPTY_EQ_FORM: EquipmentFormState = {
  name: '', type: 'mower', purchaseDate: '', purchasePrice: '',
  expectedLifespanYears: '', expectedLifespanHours: '', currentHours: '',
  currentMiles: '', notes: '',
};

function equipmentToForm(e: Equipment): EquipmentFormState {
  return {
    name: e.name,
    type: e.type,
    purchaseDate: e.purchaseDate ?? '',
    purchasePrice: String(e.purchasePrice ?? ''),
    expectedLifespanYears: e.expectedLifespanYears != null ? String(e.expectedLifespanYears) : '',
    expectedLifespanHours: e.expectedLifespanHours != null ? String(e.expectedLifespanHours) : '',
    currentHours: String(e.currentHours ?? ''),
    currentMiles: e.currentMiles != null ? String(e.currentMiles) : '',
    notes: e.notes ?? '',
  };
}

// ── Maintenance Record Row (with receipt/photo attachments) ────────────────────

function MaintenanceRecordItem({
  record,
  isTechnician,
  onDelete,
}: {
  record: EquipmentMaintenance;
  isTechnician: boolean;
  onDelete: (id: number) => void;
}) {
  const qc = useQueryClient();
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const { data: attachments } = useListEquipmentMaintenanceMedia(record.id, {
    query: {
      queryKey: getListEquipmentMaintenanceMediaQueryKey(record.id),
      enabled: attachmentsOpen,
    },
  });

  const refetchAttachments = () => {
    qc.invalidateQueries({ queryKey: getListEquipmentMaintenanceMediaQueryKey(record.id) });
  };

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium">{record.description}</p>
            <Badge variant="outline" className="text-xs">{fmt$(record.cost)}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{record.date}{record.vendor ? ` · ${record.vendor}` : ''}</p>
          {(record.nextServiceDueDate || record.nextServiceDueHours || record.nextServiceDueMiles) && (
            <p className="text-xs text-primary mt-1">
              Next service: {[
                record.nextServiceDueDate,
                record.nextServiceDueHours ? `${record.nextServiceDueHours} hrs` : null,
                record.nextServiceDueMiles ? `${record.nextServiceDueMiles} mi` : null,
              ].filter(Boolean).join(' · ')}
            </p>
          )}
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground mt-2 flex items-center gap-1"
            onClick={() => setAttachmentsOpen(o => !o)}
          >
            {attachmentsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <Paperclip className="w-3 h-3" />
            {attachmentsOpen ? 'Hide' : 'Show'} receipts & photos{attachments && attachments.length > 0 ? ` (${attachments.length})` : ''}
          </button>
        </div>
        {!isTechnician && (
          <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-destructive shrink-0" onClick={() => onDelete(record.id)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      {attachmentsOpen && (
        <div className="mt-3 pt-3 border-t">
          <MediaGallery
            entityType="equipment_maintenance"
            entityId={record.id}
            media={attachments ?? []}
            onMediaAdded={refetchAttachments}
            onMediaDeleted={refetchAttachments}
            readOnly={isTechnician}
            documentsOnly
          />
        </div>
      )}
    </div>
  );
}

// ── Equipment Detail Panel ─────────────────────────────────────────────────────

function EquipmentDetailPanel({ equipment, onClose }: { equipment: Equipment; onClose: () => void }) {
  const qc = useQueryClient();
  const { isTechnician } = useAuth();

  // Maintenance
  const { data: maintenance } = useListEquipmentMaintenance(equipment.id, {
    query: { queryKey: getListEquipmentMaintenanceQueryKey(equipment.id) },
  });
  const createMaintenance = useCreateEquipmentMaintenance();
  const deleteMaintenance = useDeleteEquipmentMaintenance();

  const [maintForm, setMaintForm] = useState({ date: '', description: '', cost: '', vendor: '', nextServiceDueDate: '', nextServiceDueHours: '', nextServiceDueMiles: '' });
  const [maintOpen, setMaintOpen] = useState(false);

  // Fuel
  const { data: fuelLogs } = useListEquipmentFuelLogs(equipment.id, {
    query: { queryKey: getListEquipmentFuelLogsQueryKey(equipment.id) },
  });
  const createFuelLog = useCreateEquipmentFuelLog();
  const deleteFuelLog = useDeleteEquipmentFuelLog();

  const [fuelForm, setFuelForm] = useState({ date: '', gallons: '', cost: '', odometerReading: '' });
  const [fuelOpen, setFuelOpen] = useState(false);

  // Maintenance tasks (internal to-do queue linked to this equipment)
  const { data: equipmentTasks } = useListEquipmentTasks(equipment.id, {
    query: { queryKey: getListEquipmentTasksQueryKey(equipment.id) },
  });
  const [taskFormOpen, setTaskFormOpen] = useState(false);

  const handleAddMaintenance = () => {
    if (!maintForm.date || !maintForm.description) { toast.error('Date and description are required'); return; }
    createMaintenance.mutate({
      id: equipment.id,
      data: {
        date: maintForm.date,
        description: maintForm.description,
        cost: maintForm.cost ? parseFloat(maintForm.cost) : 0,
        vendor: maintForm.vendor || undefined,
        nextServiceDueDate: maintForm.nextServiceDueDate || undefined,
        nextServiceDueHours: maintForm.nextServiceDueHours ? parseFloat(maintForm.nextServiceDueHours) : undefined,
        nextServiceDueMiles: maintForm.nextServiceDueMiles ? parseFloat(maintForm.nextServiceDueMiles) : undefined,
      },
    }, {
      onSuccess: () => {
        toast.success('Maintenance record added');
        qc.invalidateQueries({ queryKey: getListEquipmentMaintenanceQueryKey(equipment.id) });
        invalidateEquipmentLists(qc);
        setMaintOpen(false);
        setMaintForm({ date: '', description: '', cost: '', vendor: '', nextServiceDueDate: '', nextServiceDueHours: '', nextServiceDueMiles: '' });
      },
      onError: () => toast.error('Failed to add maintenance record'),
    });
  };

  const handleAddFuel = () => {
    if (!fuelForm.date || !fuelForm.gallons) { toast.error('Date and gallons are required'); return; }
    createFuelLog.mutate({
      id: equipment.id,
      data: {
        date: fuelForm.date,
        gallons: parseFloat(fuelForm.gallons),
        cost: fuelForm.cost ? parseFloat(fuelForm.cost) : 0,
        odometerReading: fuelForm.odometerReading ? parseFloat(fuelForm.odometerReading) : undefined,
      },
    }, {
      onSuccess: () => {
        toast.success('Fuel log added');
        qc.invalidateQueries({ queryKey: getListEquipmentFuelLogsQueryKey(equipment.id) });
        qc.invalidateQueries({ queryKey: getListEquipmentQueryKey() });
        setFuelOpen(false);
        setFuelForm({ date: '', gallons: '', cost: '', odometerReading: '' });
      },
      onError: () => toast.error('Failed to add fuel log'),
    });
  };

  const handleDeleteMaintenance = (id: number) => {
    if (!window.confirm('Delete this maintenance record?')) return;
    deleteMaintenance.mutate({ equipmentId: equipment.id, id }, {
      onSuccess: () => {
        toast.success('Record deleted');
        qc.invalidateQueries({ queryKey: getListEquipmentMaintenanceQueryKey(equipment.id) });
        invalidateEquipmentLists(qc);
      },
      onError: () => toast.error('Failed to delete'),
    });
  };

  const handleDeleteFuel = (id: number) => {
    if (!window.confirm('Delete this fuel log?')) return;
    deleteFuelLog.mutate({ equipmentId: equipment.id, id }, {
      onSuccess: () => {
        toast.success('Fuel log deleted');
        qc.invalidateQueries({ queryKey: getListEquipmentFuelLogsQueryKey(equipment.id) });
        invalidateEquipmentLists(qc);
      },
      onError: () => toast.error('Failed to delete'),
    });
  };

  const totalCost = equipment.purchasePrice + equipment.totalRepairCost + equipment.totalFuelCost;

  // Build projected cost-per-hour at 500-hour intervals for mini chart
  const projections = (() => {
    if (!equipment.currentHours || equipment.currentHours === 0) return [];
    const maxHours = Math.max(equipment.currentHours * 1.5, 500);
    const pts: { hours: number; cph: number }[] = [];
    for (let h = 500; h <= maxHours; h += 500) {
      pts.push({ hours: h, cph: h > 0 ? totalCost / h : 0 });
    }
    return pts;
  })();

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between p-6 border-b">
        <div>
          <h2 className="text-xl font-bold">{equipment.name}</h2>
          <p className="text-sm text-muted-foreground capitalize">{equipment.type}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Sell recommendation banner */}
        {equipment.sellRecommended && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive">
            <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-sm">Sell Recommendation</p>
              <p className="text-xs mt-0.5 text-destructive/80">{equipment.sellReason}</p>
            </div>
          </div>
        )}

        {/* Cost summary cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5"><DollarSign className="w-3 h-3" /> Purchase Price</p>
            <p className="font-semibold">{fmt$(equipment.purchasePrice)}</p>
          </div>
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Clock className="w-3 h-3" /> Cost / Hour</p>
            <p className="font-semibold">{equipment.costPerHour != null ? fmt$(equipment.costPerHour) : '—'}</p>
          </div>
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Wrench className="w-3 h-3" /> Total Repairs</p>
            <p className="font-semibold">{fmt$(equipment.totalRepairCost)}</p>
          </div>
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Fuel className="w-3 h-3" /> Total Fuel</p>
            <p className="font-semibold">{fmt$(equipment.totalFuelCost)}</p>
          </div>
        </div>

        {/* Resale value */}
        {equipment.estimatedResaleValue != null && (
          <div className="rounded-lg border p-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Est. Resale Value (depreciated)</p>
              <p className="font-semibold">{fmt$(equipment.estimatedResaleValue)}</p>
            </div>
            <Badge variant={equipment.sellRecommended ? 'destructive' : 'secondary'}>
              {Math.round((equipment.estimatedResaleValue / equipment.purchasePrice) * 100)}% of purchase
            </Badge>
          </div>
        )}

        {/* Projected CPH table */}
        {projections.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5" /> Projected Cost/Hour
            </p>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Hours</TableHead>
                    <TableHead className="text-xs text-right">Cost / Hour</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projections.map(p => (
                    <TableRow key={p.hours} className={p.hours === Math.round(equipment.currentHours / 500) * 500 ? 'bg-primary/5' : ''}>
                      <TableCell className="text-sm">{p.hours.toLocaleString()}</TableCell>
                      <TableCell className="text-sm text-right font-mono">{fmt$(p.cph)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <Separator />

        {/* Tabs for maintenance / fuel */}
        <Tabs defaultValue="maintenance">
          <TabsList className="w-full">
            <TabsTrigger value="maintenance" className="flex-1 flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5" /> Maintenance ({maintenance?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="fuel" className="flex-1 flex items-center gap-1.5">
              <Fuel className="w-3.5 h-3.5" /> Fuel ({fuelLogs?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="tasks" className="flex-1 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Tasks ({equipmentTasks?.length ?? 0})
            </TabsTrigger>
          </TabsList>

          {/* Maintenance tab */}
          <TabsContent value="maintenance" className="space-y-3 mt-4">
            {!isTechnician && (
              <Button size="sm" className="w-full gap-2" onClick={() => setMaintOpen(true)}>
                <Plus className="w-4 h-4" /> Log Maintenance / Repair
              </Button>
            )}
            {maintOpen && (
              <Card className="border-primary/30">
                <CardContent className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Date *</label>
                      <Input type="date" value={maintForm.date} onChange={e => setMaintForm(f => ({ ...f, date: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Cost ($)</label>
                      <Input type="number" placeholder="0.00" value={maintForm.cost} onChange={e => setMaintForm(f => ({ ...f, cost: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Description *</label>
                    <Input placeholder="e.g. Oil change, blade replacement" value={maintForm.description} onChange={e => setMaintForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Vendor / Shop</label>
                    <Input placeholder="e.g. ABC Repair" value={maintForm.vendor} onChange={e => setMaintForm(f => ({ ...f, vendor: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Next Due Date</label>
                      <Input type="date" value={maintForm.nextServiceDueDate} onChange={e => setMaintForm(f => ({ ...f, nextServiceDueDate: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Next @ Hours</label>
                      <Input type="number" placeholder="250" value={maintForm.nextServiceDueHours} onChange={e => setMaintForm(f => ({ ...f, nextServiceDueHours: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Next @ Miles</label>
                      <Input type="number" placeholder="5000" value={maintForm.nextServiceDueMiles} onChange={e => setMaintForm(f => ({ ...f, nextServiceDueMiles: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => setMaintOpen(false)}>Cancel</Button>
                    <Button size="sm" onClick={handleAddMaintenance} disabled={createMaintenance.isPending}>Save</Button>
                  </div>
                </CardContent>
              </Card>
            )}
            {maintenance && maintenance.length > 0 ? (
              <div className="space-y-2">
                {maintenance.map(m => (
                  <MaintenanceRecordItem
                    key={m.id}
                    record={m}
                    isTechnician={isTechnician}
                    onDelete={handleDeleteMaintenance}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">No maintenance records yet.</p>
            )}
          </TabsContent>

          {/* Fuel tab */}
          <TabsContent value="fuel" className="space-y-3 mt-4">
            <Button size="sm" className="w-full gap-2" onClick={() => setFuelOpen(true)}>
              <Plus className="w-4 h-4" /> Log Fuel Fill
            </Button>
            {fuelOpen && (
              <Card className="border-primary/30">
                <CardContent className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Date *</label>
                      <Input type="date" value={fuelForm.date} onChange={e => setFuelForm(f => ({ ...f, date: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Gallons *</label>
                      <Input type="number" placeholder="5.0" step="0.1" value={fuelForm.gallons} onChange={e => setFuelForm(f => ({ ...f, gallons: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Cost ($)</label>
                      <Input type="number" placeholder="0.00" value={fuelForm.cost} onChange={e => setFuelForm(f => ({ ...f, cost: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Hours Reading</label>
                      <Input type="number" placeholder="Current hours" value={fuelForm.odometerReading} onChange={e => setFuelForm(f => ({ ...f, odometerReading: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => setFuelOpen(false)}>Cancel</Button>
                    <Button size="sm" onClick={handleAddFuel} disabled={createFuelLog.isPending}>Save</Button>
                  </div>
                </CardContent>
              </Card>
            )}
            {fuelLogs && fuelLogs.length > 0 ? (
              <div className="space-y-2">
                {fuelLogs.map(f => (
                  <div key={f.id} className="rounded-lg border p-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{f.gallons} gal</p>
                        <Badge variant="outline" className="text-xs">{fmt$(f.cost)}</Badge>
                        {f.odometerReading != null && <span className="text-xs text-muted-foreground">@ {f.odometerReading} hrs</span>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{f.date}</p>
                    </div>
                    {!isTechnician && (
                      <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-destructive shrink-0" onClick={() => handleDeleteFuel(f.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">No fuel logs yet.</p>
            )}
          </TabsContent>

          {/* Maintenance Tasks tab — internal to-do queue linked to this equipment */}
          <TabsContent value="tasks" className="space-y-3 mt-4">
            <Button size="sm" className="w-full gap-2" onClick={() => setTaskFormOpen(true)}>
              <Plus className="w-4 h-4" /> Flag for Repair / Maintenance
            </Button>
            {equipmentTasks && equipmentTasks.length > 0 ? (
              <div className="space-y-2">
                {equipmentTasks.map(t => (
                  <div key={t.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium flex-1 min-w-0 truncate">{t.title}</p>
                      <Badge variant="outline" className={priorityBadgeClass(t.priority) + ' text-[10px]'}>{t.priority}</Badge>
                      <Badge variant="outline" className={statusBadgeClass(t.status) + ' text-[10px]'}>{t.status.replace('_', ' ')}</Badge>
                    </div>
                    {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">→ {t.assignedToName ?? t.assignedToRole ?? '—'}</span>
                      <TaskActions task={t} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">No open maintenance tasks for this equipment.</p>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <TaskFormDrawer
        open={taskFormOpen}
        onOpenChange={setTaskFormOpen}
        lockedContext={{ contextType: 'equipment', contextId: equipment.id, label: equipment.name }}
      />
    </div>
  );
}

// ── Main Equipment Page ────────────────────────────────────────────────────────

export default function EquipmentPage() {
  const qc = useQueryClient();
  const { isTechnician, isOwner } = useAuth();

  const [includeArchived, setIncludeArchived] = useState(false);
  const { data: equipment, isLoading } = useListEquipment(
    { includeArchived },
    { query: { queryKey: getListEquipmentQueryKey({ includeArchived }) } },
  );
  const createEquipment = useCreateEquipment();
  const updateEquipment = useUpdateEquipment();
  const deleteEquipment = useDeleteEquipment();
  const hardDeleteEquipment = useHardDeleteEquipment();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Equipment | null>(null);
  const [form, setForm] = useState<EquipmentFormState>(EMPTY_EQ_FORM);

  const selectedEquipment = equipment?.find(e => e.id === selectedId) ?? null;

  const openCreate = () => {
    setEditingItem(null);
    setForm(EMPTY_EQ_FORM);
    setFormOpen(true);
  };

  const openEdit = (item: Equipment) => {
    setEditingItem(item);
    setForm(equipmentToForm(item));
    setFormOpen(true);
  };

  const handleSave = () => {
    if (!form.name) { toast.error('Name is required'); return; }
    const payload = {
      name: form.name,
      type: form.type,
      purchaseDate: form.purchaseDate || undefined,
      purchasePrice: form.purchasePrice ? parseFloat(form.purchasePrice) : 0,
      expectedLifespanYears: form.expectedLifespanYears ? parseFloat(form.expectedLifespanYears) : undefined,
      expectedLifespanHours: form.expectedLifespanHours ? parseFloat(form.expectedLifespanHours) : undefined,
      currentHours: form.currentHours ? parseFloat(form.currentHours) : 0,
      currentMiles: form.currentMiles ? parseFloat(form.currentMiles) : undefined,
      notes: form.notes || undefined,
    };

    if (editingItem) {
      updateEquipment.mutate({ id: editingItem.id, data: payload }, {
        onSuccess: () => {
          toast.success('Equipment updated');
          invalidateEquipmentLists(qc);
          setFormOpen(false);
        },
        onError: () => toast.error('Failed to update equipment'),
      });
    } else {
      createEquipment.mutate({ data: payload }, {
        onSuccess: () => {
          toast.success('Equipment added');
          invalidateEquipmentLists(qc);
          setFormOpen(false);
        },
        onError: () => toast.error('Failed to add equipment'),
      });
    }
  };

  const handleDelete = (id: number, name: string) => {
    if (!window.confirm(`Archive "${name}"? It will be hidden from the active list, but its maintenance and fuel history will be kept.`)) return;
    deleteEquipment.mutate({ id }, {
      onSuccess: () => {
        toast.success(`${name} archived`);
        invalidateEquipmentLists(qc);
        if (selectedId === id) setSelectedId(null);
      },
      onError: () => toast.error('Failed to archive equipment'),
    });
  };

  const handleHardDelete = (id: number, name: string) => {
    if (!window.confirm(`Permanently delete "${name}"? This cannot be undone and will remove all maintenance and fuel records.`)) return;
    hardDeleteEquipment.mutate({ id }, {
      onSuccess: () => {
        toast.success(`${name} permanently deleted`);
        invalidateEquipmentLists(qc);
        if (selectedId === id) setSelectedId(null);
      },
      onError: () => toast.error('Failed to permanently delete equipment'),
    });
  };

  const sellCount = equipment?.filter(e => e.sellRecommended).length ?? 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Equipment</h1>
          <p className="text-muted-foreground mt-1">Track operating costs, maintenance, and fuel for your fleet.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-input"
              checked={includeArchived}
              onChange={e => setIncludeArchived(e.target.checked)}
            />
            Include archived
          </label>
          {!isTechnician && (
            <Button onClick={openCreate} className="gap-2">
              <Plus className="w-4 h-4" /> Add Equipment
            </Button>
          )}
        </div>
      </div>

      {/* Summary banner */}
      {sellCount > 0 && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">
            {sellCount} piece{sellCount > 1 ? 's' : ''} of equipment flagged for sell recommendation. Review the details below.
          </p>
        </div>
      )}

      <div className="flex gap-6">
        {/* Equipment list */}
        <div className={`flex flex-col gap-3 ${selectedEquipment ? 'w-1/2' : 'w-full'}`}>
          {isLoading && (
            <div className="text-center text-muted-foreground py-12">Loading equipment…</div>
          )}
          {!isLoading && equipment?.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                  <Wrench className="w-8 h-8 text-muted-foreground" />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-lg">No equipment yet</p>
                  <p className="text-muted-foreground text-sm mt-1">Add your first piece of equipment to start tracking costs.</p>
                </div>
                {!isTechnician && <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> Add Equipment</Button>}
              </CardContent>
            </Card>
          )}
          {equipment?.map(item => {
            const repairRatio = item.purchasePrice > 0 ? (item.totalRepairCost / item.purchasePrice) * 100 : 0;
            return (
              <Card
                key={item.id}
                className={`cursor-pointer transition-all hover:shadow-md ${selectedId === item.id ? 'border-primary ring-1 ring-primary' : ''} ${item.sellRecommended ? 'border-destructive/40' : ''} ${item.archivedAt ? 'opacity-70' : ''}`}
                onClick={() => setSelectedId(selectedId === item.id ? null : item.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${item.sellRecommended ? 'bg-destructive/10' : 'bg-primary/10'}`}>
                      <Wrench className={`w-5 h-5 ${item.sellRecommended ? 'text-destructive' : 'text-primary'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold">{item.name}</p>
                        <Badge variant="secondary" className="text-xs capitalize">{item.type}</Badge>
                        {item.sellRecommended && (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <AlertTriangle className="w-3 h-3" /> Sell Rec.
                          </Badge>
                        )}
                        {item.archivedAt ? (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Archive className="w-3 h-3" /> Archived
                          </Badge>
                        ) : !item.isActive && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                      </div>
                      <div className="flex items-center gap-4 mt-2 flex-wrap">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {fmtHours(item.currentHours)}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <DollarSign className="w-3 h-3" /> CPH: {item.costPerHour != null ? fmt$(item.costPerHour) : '—'}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Wrench className="w-3 h-3" /> Repairs: {fmt$(item.totalRepairCost)}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Fuel className="w-3 h-3" /> Fuel: {fmt$(item.totalFuelCost)}
                        </span>
                      </div>
                      {/* Repair cost bar */}
                      {item.purchasePrice > 0 && (
                        <div className="mt-2">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[10px] text-muted-foreground">Repair cost vs purchase</span>
                            <span className="text-[10px] text-muted-foreground">{Math.round(repairRatio)}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${repairRatio >= 50 ? 'bg-destructive' : repairRatio >= 30 ? 'bg-amber-500' : 'bg-primary'}`}
                              style={{ width: `${Math.min(100, repairRatio)}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!isTechnician && !item.archivedAt && (
                        <>
                          <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-primary" onClick={e => { e.stopPropagation(); openEdit(item); }}>
                            <Wrench className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-destructive" onClick={e => { e.stopPropagation(); handleDelete(item.id, item.name); }}>
                            <Archive className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                      {isOwner && item.archivedAt && (
                        <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-destructive" title="Permanently delete" onClick={e => { e.stopPropagation(); handleHardDelete(item.id, item.name); }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${selectedId === item.id ? 'rotate-90' : ''}`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Detail panel */}
        {selectedEquipment && (
          <div className="w-1/2 border rounded-xl bg-background overflow-hidden sticky top-0 max-h-[calc(100vh-12rem)]">
            <EquipmentDetailPanel equipment={selectedEquipment} onClose={() => setSelectedId(null)} />
          </div>
        )}
      </div>

      {/* Add/Edit sheet */}
      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader className="pb-4">
            <SheetTitle>{editingItem ? 'Edit Equipment' : 'Add Equipment'}</SheetTitle>
            <SheetDescription>Track purchase cost, hours, and lifespan to calculate operating costs.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 overflow-y-auto max-h-[calc(100vh-10rem)] pb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name *</label>
              <Input placeholder="e.g. Husqvarna 60&quot; Zero-Turn" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Type</label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EQUIPMENT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Purchase Date</label>
                <Input type="date" value={form.purchaseDate} onChange={e => setForm(f => ({ ...f, purchaseDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Purchase Price ($)</label>
                <Input type="number" placeholder="0.00" value={form.purchasePrice} onChange={e => setForm(f => ({ ...f, purchasePrice: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Expected Lifespan (yrs)</label>
                <Input type="number" placeholder="10" value={form.expectedLifespanYears} onChange={e => setForm(f => ({ ...f, expectedLifespanYears: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Expected Lifespan (hrs)</label>
                <Input type="number" placeholder="2000" value={form.expectedLifespanHours} onChange={e => setForm(f => ({ ...f, expectedLifespanHours: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Current Hours</label>
                <Input type="number" placeholder="0" value={form.currentHours} onChange={e => setForm(f => ({ ...f, currentHours: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Current Miles (optional)</label>
                <Input type="number" placeholder="0" value={form.currentMiles} onChange={e => setForm(f => ({ ...f, currentMiles: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes</label>
              <Input placeholder="Any notes about this equipment" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={createEquipment.isPending || updateEquipment.isPending}>
                {editingItem ? 'Save Changes' : 'Add Equipment'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
