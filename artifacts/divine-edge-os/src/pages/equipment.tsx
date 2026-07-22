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
  useListJobs,
  getListJobsQueryKey,
  useListEquipmentTasks, getListEquipmentTasksQueryKey,
  useGetEquipmentLedger, getGetEquipmentLedgerQueryKey,
  useListTasks, getListTasksQueryKey,
  useGetEquipmentLinkedParts, getGetEquipmentLinkedPartsQueryKey,
  useCreateTask,
  useListEquipmentLifecycleEvents, getListEquipmentLifecycleEventsQueryKey,
  useListEquipmentTypes, getListEquipmentTypesQueryKey,
} from '@workspace/api-client-react';
import type { Equipment, EquipmentMaintenance, EquipmentFuelLog, EquipmentLinkedPart } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { TaskFormDrawer } from '@/components/tasks/TaskFormDrawer';
import { ImportExportControls } from '@/components/data-io/ImportExportControls';
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
  Eye, Gauge, RotateCcw, ShoppingCart, PackageSearch, AlertCircle, History,
} from 'lucide-react';
import { toast } from 'sonner';

// EQUIPMENT_TYPES is now loaded from the tenant's equipment types list via API.
// The combobox below falls back to free-form entry for values not in the list.

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
  name: '', type: '', purchaseDate: '', purchasePrice: '',
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

// ── Equipment Ledger Panel (Operating vs Maintenance & Repair, side by side) ────

function EquipmentLedgerPanel({ equipmentId }: { equipmentId: number }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
  const { data: ledger, isLoading } = useGetEquipmentLedger(equipmentId, params, {
    query: { queryKey: getGetEquipmentLedgerQueryKey(equipmentId, params) },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium">From</label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">To</label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground text-center py-6">Loading ledger…</p>}

      {ledger && (
        <div className="grid grid-cols-2 gap-3">
          {/* Operating / Run Cost */}
          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <Gauge className="w-4 h-4 text-primary" /> Operating / Run Cost
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">Fuel</span><span className="font-mono">{fmt$(ledger.operating.fuelCost)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Runtime ({ledger.operating.runtimeHours.toLocaleString(undefined, { maximumFractionDigits: 1 })} hrs)</span><span className="font-mono">{fmt$(ledger.operating.runtimeCost)}</span></div>
              <Separator />
              <div className="flex justify-between font-semibold"><span>Running Total</span><span className="font-mono">{fmt$(ledger.operating.total)}</span></div>
            </div>
            {ledger.operating.fuelLogs.length > 0 && (
              <div className="pt-2 border-t space-y-1 max-h-40 overflow-y-auto">
                {ledger.operating.fuelLogs.map(f => (
                  <div key={f.id} className="flex justify-between text-[11px] text-muted-foreground">
                    <span>{f.date} · {f.gallons} gal</span>
                    <span className="font-mono">{fmt$(f.cost)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Maintenance & Repair Cost */}
          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <Wrench className="w-4 h-4 text-amber-500" /> Maintenance & Repair Cost
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">Parts</span><span className="font-mono">{fmt$(ledger.maintenance.partsCost)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Labor</span><span className="font-mono">{fmt$(ledger.maintenance.laborCost)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Downtime ({ledger.maintenance.downtimeHours.toLocaleString(undefined, { maximumFractionDigits: 1 })} hrs)</span><span className="font-mono">{fmt$(ledger.maintenance.downtimeValue)}</span></div>
              <Separator />
              <div className="flex justify-between font-semibold"><span>Running Total</span><span className="font-mono">{fmt$(ledger.maintenance.total)}</span></div>
            </div>
            {ledger.maintenance.records.length > 0 && (
              <div className="pt-2 border-t space-y-1 max-h-40 overflow-y-auto">
                {ledger.maintenance.records.map(m => (
                  <div key={m.id} className="flex justify-between text-[11px] text-muted-foreground">
                    <span className="truncate max-w-[140px]">{m.date} · {m.description}</span>
                    <span className="font-mono shrink-0">{fmt$(m.partsCost + m.laborCost)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
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

  const [fuelForm, setFuelForm] = useState({ date: '', gallons: '', cost: '', odometerReading: '', jobId: '' });
  const [fuelOpen, setFuelOpen] = useState(false);

  // Recent jobs for linking a fuel fill to a specific job
  const { data: recentJobs = [] } = useListJobs(
    undefined,
    { query: { queryKey: getListJobsQueryKey(), enabled: fuelOpen } },
  );

  // Maintenance tasks (internal to-do queue linked to this equipment)
  const { data: equipmentTasks } = useListEquipmentTasks(equipment.id, {
    query: { queryKey: getListEquipmentTasksQueryKey(equipment.id) },
  });
  const [taskFormOpen, setTaskFormOpen] = useState(false);

  // Lifecycle events (archive / restore history)
  const { data: lifecycleEvents } = useListEquipmentLifecycleEvents(equipment.id, {
    query: { queryKey: getListEquipmentLifecycleEventsQueryKey(equipment.id) },
  });

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
        jobId: fuelForm.jobId ? parseInt(fuelForm.jobId, 10) : undefined,
      },
    }, {
      onSuccess: () => {
        toast.success('Fuel log added');
        qc.invalidateQueries({ queryKey: getListEquipmentFuelLogsQueryKey(equipment.id) });
        qc.invalidateQueries({ queryKey: getListEquipmentQueryKey() });
        setFuelOpen(false);
        setFuelForm({ date: '', gallons: '', cost: '', odometerReading: '', jobId: '' });
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

        {/* Maintenance status banner */}
        {equipment.maintenanceDue ? (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive">
            <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">Maintenance Overdue</p>
              <div className="flex flex-wrap gap-3 mt-1.5">
                {equipment.hoursUntilService != null && (
                  <span className="text-xs flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {equipment.hoursUntilService < 0
                      ? `${Math.abs(equipment.hoursUntilService).toFixed(1)} hrs overdue`
                      : `${equipment.hoursUntilService.toFixed(1)} hrs remaining`}
                  </span>
                )}
                {equipment.milesUntilService != null && (
                  <span className="text-xs flex items-center gap-1">
                    <Gauge className="w-3 h-3" />
                    {equipment.milesUntilService < 0
                      ? `${Math.abs(equipment.milesUntilService).toFixed(0)} mi overdue`
                      : `${equipment.milesUntilService.toFixed(0)} mi remaining`}
                  </span>
                )}
                {equipment.nextServiceDueDate && (
                  <span className="text-xs flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Due {equipment.nextServiceDueDate}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (equipment.hoursUntilService != null && equipment.hoursUntilService >= 0 && equipment.hoursUntilService <= 10) ||
           (equipment.milesUntilService != null && equipment.milesUntilService >= 0 && equipment.milesUntilService <= 50) ? (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400">
            <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">Service Coming Up Soon</p>
              <div className="flex flex-wrap gap-3 mt-1.5">
                {equipment.hoursUntilService != null && equipment.hoursUntilService >= 0 && equipment.hoursUntilService <= 10 && (
                  <span className="text-xs flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {equipment.hoursUntilService.toFixed(1)} hrs remaining
                  </span>
                )}
                {equipment.milesUntilService != null && equipment.milesUntilService >= 0 && equipment.milesUntilService <= 50 && (
                  <span className="text-xs flex items-center gap-1">
                    <Gauge className="w-3 h-3" />
                    {equipment.milesUntilService.toFixed(0)} mi remaining
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : equipment.hoursUntilService != null || equipment.milesUntilService != null ? (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border text-muted-foreground">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600 dark:text-green-400" />
            <div className="flex flex-wrap gap-3">
              {equipment.hoursUntilService != null && (
                <span className="text-xs flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {equipment.hoursUntilService.toFixed(1)} hrs to next service
                </span>
              )}
              {equipment.milesUntilService != null && (
                <span className="text-xs flex items-center gap-1">
                  <Gauge className="w-3 h-3" />
                  {equipment.milesUntilService.toFixed(0)} mi to next service
                </span>
              )}
            </div>
          </div>
        ) : null}

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
            <TabsTrigger value="ledger" className="flex-1 flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5" /> Ledger
            </TabsTrigger>
            <TabsTrigger value="activity" className="flex-1 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" /> Activity
            </TabsTrigger>
          </TabsList>

          {/* Maintenance tab */}
          <TabsContent value="maintenance" className="space-y-3 mt-4">
            {!isTechnician && !equipment.archivedAt && (
              <Button size="sm" className="w-full gap-2" onClick={() => setMaintOpen(true)}>
                <Plus className="w-4 h-4" /> Log Maintenance / Repair
              </Button>
            )}
            {equipment.archivedAt && (
              <p className="text-xs text-muted-foreground text-center py-2 flex items-center justify-center gap-1.5">
                <Archive className="w-3.5 h-3.5" /> Archived — new maintenance records cannot be added
              </p>
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
            {!equipment.archivedAt && (
              <Button size="sm" className="w-full gap-2" onClick={() => setFuelOpen(true)}>
                <Plus className="w-4 h-4" /> Log Fuel Fill
              </Button>
            )}
            {equipment.archivedAt && (
              <p className="text-xs text-muted-foreground text-center py-2 flex items-center justify-center gap-1.5">
                <Archive className="w-3.5 h-3.5" /> Archived — new fuel fills cannot be added
              </p>
            )}
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
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Job (optional)</label>
                    <Select value={fuelForm.jobId || '__none__'} onValueChange={v => setFuelForm(f => ({ ...f, jobId: v === '__none__' ? '' : v }))}>
                      <SelectTrigger className="w-full text-sm">
                        <SelectValue placeholder="No job — fleet overhead" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">No job — fleet overhead</SelectItem>
                        {recentJobs.map(j => (
                          <SelectItem key={j.id} value={String(j.id)}>
                            {j.title}{j.scheduledAt ? ` · ${j.scheduledAt.slice(0, 10)}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Linking to a job attributes the fuel cost directly to that job's profitability.</p>
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
                {fuelLogs.map(f => {
                  const linkedJob = f.jobId != null ? recentJobs.find(j => j.id === f.jobId) : null;
                  return (
                    <div key={f.id} className="rounded-lg border p-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium">{f.gallons} gal</p>
                          <Badge variant="outline" className="text-xs">{fmt$(f.cost)}</Badge>
                          {f.odometerReading != null && <span className="text-xs text-muted-foreground">@ {f.odometerReading} hrs</span>}
                          {f.jobId != null && (
                            <Badge variant="secondary" className="text-xs gap-1">
                              <Fuel className="w-3 h-3" />
                              {linkedJob ? linkedJob.title : `Job #${f.jobId}`}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{f.date}</p>
                      </div>
                      {!isTechnician && (
                        <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-destructive shrink-0" onClick={() => handleDeleteFuel(f.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  );
                })}
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

          {/* Ledger tab — Operating vs Maintenance & Repair cost, side by side */}
          <TabsContent value="ledger" className="mt-4">
            <EquipmentLedgerPanel equipmentId={equipment.id} />
          </TabsContent>

          {/* Activity tab — archive / restore lifecycle history */}
          <TabsContent value="activity" className="mt-4">
            {lifecycleEvents && lifecycleEvents.length > 0 ? (
              <div className="space-y-2">
                {lifecycleEvents.map(event => (
                  <div key={event.id} className="rounded-lg border p-3 flex items-start gap-3">
                    <div className={`mt-0.5 shrink-0 rounded-full p-1 ${event.eventType === 'archived' ? 'bg-destructive/10 text-destructive' : 'bg-green-500/10 text-green-600'}`}>
                      {event.eventType === 'archived'
                        ? <Archive className="w-3.5 h-3.5" />
                        : <RotateCcw className="w-3.5 h-3.5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium capitalize">{event.eventType}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {event.performedByName ?? 'Unknown user'} · {new Date(event.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">No archive or restore events recorded yet.</p>
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

// ── Reorder Suggestion Sheet ──────────────────────────────────────────────────

function ReorderSuggestionSheet({
  equipmentId,
  equipmentName,
  open,
  onClose,
}: {
  equipmentId: number | null;
  equipmentName: string;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: parts, isLoading } = useGetEquipmentLinkedParts(
    equipmentId ?? 0,
    { query: { enabled: open && equipmentId != null, queryKey: getGetEquipmentLinkedPartsQueryKey(equipmentId ?? 0) } },
  );
  const createTask = useCreateTask();
  const [createdIds, setCreatedIds] = React.useState<Set<number>>(new Set());

  const handleReorder = (part: EquipmentLinkedPart) => {
    createTask.mutate({
      data: {
        title: `Reorder: ${part.name} (SKU: ${part.sku})`,
        description: `Stock level: ${part.quantity} ${part.unit} (reorder point: ${part.reorderPoint}). Flagged via equipment concern check on "${equipmentName}". ${part.checkLabels.length > 0 ? `Related checks: ${part.checkLabels.join(', ')}.` : ''}`,
        taskType: 'custom',
        priority: part.isLowStock ? 'high' : 'normal',
        assignedToRole: 'admin_office',
        contextType: 'equipment',
        contextId: equipmentId!,
      },
    }, {
      onSuccess: (task) => {
        toast.success(`Reorder task created for ${part.name}`);
        setCreatedIds(prev => new Set(prev).add(part.id));
        qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        qc.invalidateQueries({ queryKey: getListEquipmentTasksQueryKey(equipmentId!) });
      },
      onError: () => toast.error('Failed to create reorder task'),
    });
  };

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) { onClose(); setCreatedIds(new Set()); } }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-amber-600" />
            Reorder Suggestions
          </SheetTitle>
          <SheetDescription>
            Parts linked to <span className="font-medium text-foreground">{equipmentName}</span> via Daily Task checks.
            Create a reorder task for any item that needs restocking.
          </SheetDescription>
        </SheetHeader>

        {isLoading && (
          <p className="text-sm text-muted-foreground text-center py-8">Loading linked parts…</p>
        )}

        {!isLoading && parts && parts.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <PackageSearch className="w-10 h-10 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">No linked parts found</p>
              <p className="text-xs text-muted-foreground mt-1">
                Link inventory items to this equipment's Daily Task checks to get reorder suggestions automatically.
              </p>
            </div>
          </div>
        )}

        {parts && parts.length > 0 && (
          <div className="space-y-3">
            {parts.map(part => (
              <div
                key={part.id}
                className={`rounded-lg border p-4 space-y-3 ${part.isLowStock ? 'border-amber-500/40 bg-amber-500/5' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{part.name}</p>
                    <p className="text-xs text-muted-foreground">SKU: {part.sku}{part.category ? ` · ${part.category}` : ''}</p>
                    {part.checkLabels.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">Checks: {part.checkLabels.join(', ')}</p>
                    )}
                  </div>
                  {part.isLowStock && (
                    <Badge variant="outline" className="text-[10px] border-amber-500/60 text-amber-700 dark:text-amber-400 shrink-0 gap-1">
                      <AlertCircle className="w-3 h-3" /> Low Stock
                    </Badge>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded bg-muted/50 px-2 py-1.5 text-center">
                    <p className="text-muted-foreground">In Stock</p>
                    <p className={`font-semibold mt-0.5 ${part.isLowStock ? 'text-amber-700 dark:text-amber-400' : ''}`}>
                      {part.quantity} {part.unit}
                    </p>
                  </div>
                  <div className="rounded bg-muted/50 px-2 py-1.5 text-center">
                    <p className="text-muted-foreground">Reorder At</p>
                    <p className="font-semibold mt-0.5">{part.reorderPoint} {part.unit}</p>
                  </div>
                  <div className="rounded bg-muted/50 px-2 py-1.5 text-center">
                    <p className="text-muted-foreground">Sell Price</p>
                    <p className="font-semibold mt-0.5">{fmt$(part.unitPrice)}</p>
                  </div>
                </div>

                {createdIds.has(part.id) ? (
                  <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Reorder task created
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant={part.isLowStock ? 'default' : 'outline'}
                    className="w-full gap-2"
                    onClick={() => handleReorder(part)}
                    disabled={createTask.isPending}
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    Create Reorder Task
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
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
  const { data: equipmentTypes = [] } = useListEquipmentTypes({ query: { queryKey: getListEquipmentTypesQueryKey() } });
  const createEquipment = useCreateEquipment();
  const updateEquipment = useUpdateEquipment();
  const deleteEquipment = useDeleteEquipment();
  const hardDeleteEquipment = useHardDeleteEquipment();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Equipment | null>(null);
  const [form, setForm] = useState<EquipmentFormState>(EMPTY_EQ_FORM);

  // Procurement alerts raised by a "Concern-Watch" checklist result during a Daily Task
  const concernParams = { scope: 'all' as const, contextType: 'equipment', status: 'open' };
  const { data: concernTasksRaw } = useListTasks(concernParams, { query: { queryKey: getListTasksQueryKey(concernParams) } });
  const concernTasks = concernTasksRaw?.filter(t => t.taskType === 'equipment_concern');

  // Reorder suggestion sheet state
  const [reorderEquipmentId, setReorderEquipmentId] = useState<number | null>(null);
  const reorderEquipment = equipment?.find(e => e.id === reorderEquipmentId) ?? null;

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

  const handleRestore = (id: number, name: string) => {
    updateEquipment.mutate({ id, data: { name, isActive: true } }, {
      onSuccess: () => {
        toast.success(`${name} restored`);
        invalidateEquipmentLists(qc);
      },
      onError: () => toast.error('Failed to restore equipment'),
    });
  };

  const sellCount = equipment?.filter(e => e.sellRecommended).length ?? 0;
  const maintenanceDueCount = equipment?.filter(e => !e.archivedAt && e.maintenanceDue).length ?? 0;

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
            <ImportExportControls
              entity="equipment"
              entityLabel="Equipment"
              exportQuery={{ includeArchived: includeArchived ? 'true' : undefined }}
              onImportComplete={() => qc.invalidateQueries({ queryKey: getListEquipmentQueryKey({ includeArchived }) })}
            />
          )}
          {!isTechnician && (
            <Button onClick={openCreate} className="gap-2">
              <Plus className="w-4 h-4" /> Add Equipment
            </Button>
          )}
        </div>
      </div>

      {/* Maintenance due banner */}
      {maintenanceDueCount > 0 && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">
            {maintenanceDueCount} piece{maintenanceDueCount > 1 ? 's' : ''} of equipment {maintenanceDueCount > 1 ? 'are' : 'is'} overdue for maintenance. Review the details below.
          </p>
        </div>
      )}

      {/* Summary banner */}
      {sellCount > 0 && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">
            {sellCount} piece{sellCount > 1 ? 's' : ''} of equipment flagged for sell recommendation. Review the details below.
          </p>
        </div>
      )}

      {/* Concern-Watch alerts — distinct from Fail: equipment stays active, but flagged for procurement/mechanic follow-up */}
      {concernTasks && concernTasks.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400">
          <Eye className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">
              {concernTasks.length} equipment concern{concernTasks.length > 1 ? 's' : ''} flagged for procurement — Watch status, not failed
            </p>
            <div className="mt-2 space-y-2">
              {concernTasks.map(t => (
                <div key={t.id} className="text-xs flex items-center justify-between gap-2">
                  <span className="truncate">{t.title}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400">Concern</Badge>
                    {t.contextId != null && (
                      <button
                        type="button"
                        onClick={() => setReorderEquipmentId(t.contextId!)}
                        className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded border border-amber-500/40 hover:bg-amber-500/20 transition-colors"
                      >
                        <ShoppingCart className="w-2.5 h-2.5" />
                        Suggest Reorder
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
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
                        {!item.archivedAt && item.maintenanceDue && (
                          <Badge className="text-xs gap-1 bg-destructive text-destructive-foreground">
                            <AlertTriangle className="w-3 h-3" /> Maintenance Due
                          </Badge>
                        )}
                        {!item.archivedAt && !item.maintenanceDue && (
                          (item.hoursUntilService != null && item.hoursUntilService >= 0 && item.hoursUntilService <= 10) ||
                          (item.milesUntilService != null && item.milesUntilService >= 0 && item.milesUntilService <= 50)
                        ) && (
                          <Badge className="text-xs gap-1 bg-amber-500 text-white">
                            <AlertCircle className="w-3 h-3" /> Service Soon
                          </Badge>
                        )}
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
                      {!isTechnician && item.archivedAt && (
                        <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-primary" title="Restore equipment" onClick={e => { e.stopPropagation(); handleRestore(item.id, item.name); }}>
                          <RotateCcw className="w-3.5 h-3.5" />
                        </Button>
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
              {/* Combobox: shows tenant-defined types as suggestions, allows free-form entry */}
              <Input
                list="equipment-type-options"
                placeholder="e.g. Mower"
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              />
              <datalist id="equipment-type-options">
                {equipmentTypes.map((t: { id: number; label: string }) => (
                  <option key={t.id} value={t.label} />
                ))}
              </datalist>
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

      {/* Reorder suggestion sheet — opened from the concern banner */}
      <ReorderSuggestionSheet
        equipmentId={reorderEquipmentId}
        equipmentName={reorderEquipment?.name ?? ''}
        open={reorderEquipmentId != null}
        onClose={() => setReorderEquipmentId(null)}
      />
    </div>
  );
}
