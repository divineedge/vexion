import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
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
  useListEquipmentUses, getListEquipmentUsesQueryKey,
  useListUsers,
  useListCrews,
  getListUsersQueryKey,
  getListCrewsQueryKey,
  useRecoverMisassignedDivineEdgeEquipment,
  useGetMisassignedDivineEdgeEquipmentRecoveryStatus,
  getGetMisassignedDivineEdgeEquipmentRecoveryStatusQueryKey,
} from '@workspace/api-client-react';
import type { Equipment, EquipmentMaintenance, EquipmentFuelLog, EquipmentLinkedPart } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { TaskFormDrawer } from '@/components/tasks/TaskFormDrawer';
import { ImportExportControls } from '@/components/data-io/ImportExportControls';
import { TaskActions } from '@/components/tasks/TaskActions';
import { priorityBadgeClass, statusBadgeClass } from '@/lib/taskConstants';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EquipmentSettingsPanel } from '@/components/equipment/EquipmentSettingsPanel';
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
  Eye, Gauge, RotateCcw, ShoppingCart, PackageSearch, AlertCircle, History, Search,
  CalendarCheck2, Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { SlidersHorizontal } from 'lucide-react';

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
  model: string;
  serialNumber: string;
  year: string;
  attachmentType: string;
  attachmentModel: string;
  attachmentSerialNumber: string;
  attachmentYear: string;
  oilFilterNumber: string;
  airFilterNumber: string;
  fuelFilterNumber: string;
  hydraulicFilterNumber: string;
  otherFilterNumbers: string;
  purchaseDate: string;
  purchasePrice: string;
  expectedLifespanYears: string;
  expectedLifespanHours: string;
  currentHours: string;
  currentMiles: string;
  notes: string;
  sellAfterHours: string;
  neverSell: boolean;
  assignedUserId: string;
  assignedCrewId: string;
}

const EMPTY_EQ_FORM: EquipmentFormState = {
  name: '', type: '', purchaseDate: '', purchasePrice: '',
  model: '', serialNumber: '', year: '', attachmentType: '', attachmentModel: '',
  attachmentSerialNumber: '', attachmentYear: '', oilFilterNumber: '', airFilterNumber: '',
  fuelFilterNumber: '', hydraulicFilterNumber: '', otherFilterNumbers: '',
  expectedLifespanYears: '', expectedLifespanHours: '', currentHours: '',
  currentMiles: '', notes: '', sellAfterHours: '', neverSell: false,
  assignedUserId: '', assignedCrewId: '',
};

function equipmentToForm(e: Equipment): EquipmentFormState {
  return {
    name: e.name,
    type: e.type,
    model: e.model ?? '',
    serialNumber: e.serialNumber ?? '',
    year: e.year != null ? String(e.year) : '',
    attachmentType: e.attachmentType ?? '',
    attachmentModel: e.attachmentModel ?? '',
    attachmentSerialNumber: e.attachmentSerialNumber ?? '',
    attachmentYear: e.attachmentYear != null ? String(e.attachmentYear) : '',
    oilFilterNumber: e.oilFilterNumber ?? '',
    airFilterNumber: e.airFilterNumber ?? '',
    fuelFilterNumber: e.fuelFilterNumber ?? '',
    hydraulicFilterNumber: e.hydraulicFilterNumber ?? '',
    otherFilterNumbers: e.otherFilterNumbers ?? '',
    purchaseDate: e.purchaseDate ?? '',
    purchasePrice: String(e.purchasePrice ?? ''),
    expectedLifespanYears: e.expectedLifespanYears != null ? String(e.expectedLifespanYears) : '',
    expectedLifespanHours: e.expectedLifespanHours != null ? String(e.expectedLifespanHours) : '',
    currentHours: String(e.currentHours ?? ''),
    currentMiles: e.currentMiles != null ? String(e.currentMiles) : '',
    notes: e.notes ?? '',
    sellAfterHours: (e as any).sellAfterHours != null ? String((e as any).sellAfterHours) : '',
    neverSell: !!(e as any).neverSell,
    assignedUserId: e.assignedUserId != null ? String(e.assignedUserId) : '',
    assignedCrewId: e.assignedCrewId != null ? String(e.assignedCrewId) : '',
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
          <p className="text-xs text-muted-foreground mt-0.5">{record.date ? new Date(record.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}{record.vendor ? ` · ${record.vendor}` : ''}</p>
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
          <Button variant="ghost" size="icon" title="Delete this maintenance record" className="w-7 h-7 text-muted-foreground hover:text-destructive shrink-0 disabled:opacity-40" onClick={() => onDelete(record.id)}>
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
          />
        </div>
      )}
    </div>
  );
}

// ── Maintenance Records with search ──────────────────────────────────────────────
function MaintSearch({ records, isTechnician, onDelete }: { records: EquipmentMaintenance[]; isTechnician: boolean; onDelete: (id: number) => void }) {
  const [q, setQ] = useState('');
  const visible = q ? records.filter(r => r.description.toLowerCase().includes(q.toLowerCase()) || (r.vendor ?? '').toLowerCase().includes(q.toLowerCase())) : records;
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input placeholder="Search records…" title="Search maintenance records" value={q} onChange={e => setQ(e.target.value)} className="h-8 text-sm pl-8" />
      </div>
      {visible.map(m => (
        <MaintenanceRecordItem key={m.id} record={m} isTechnician={isTechnician} onDelete={onDelete} />
      ))}
      {visible.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No records match "{q}"</p>}
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
          <Input type="date" title="Ledger from date" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">To</label>
          <Input type="date" title="Ledger to date" value={to} onChange={e => setTo(e.target.value)} />
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
                    <span>{f.date ? new Date(f.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'} · {f.gallons} gal</span>
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
                    <span className="truncate max-w-[140px]" title={`${m.date} — ${m.description}`}>{m.date} · {m.description}</span>
                    <span className="font-mono shrink-0" title={`Cost: ${fmt$(m.partsCost + m.laborCost)}`}>{fmt$(m.partsCost + m.laborCost)}</span>
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

function EquipmentDetailPanel({ equipment, onClose, onEdit }: { equipment: Equipment; onClose: () => void; onEdit?: () => void }) {
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

  const todayStr = new Date().toISOString().slice(0, 10);
  const [fuelForm, setFuelForm] = useState({ date: todayStr, gallons: '', costPerGallon: '', cost: '', odometerReading: '', jobId: '' });
  const [fuelOpen, setFuelOpen] = useState(false);
  useEffect(() => { if (maintOpen) setMaintForm(f => ({ ...f, date: todayStr })); }, [maintOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (fuelOpen) setFuelForm(f => ({ ...f, date: todayStr })); }, [fuelOpen]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Use history — jobs this equipment has been logged on
  const { data: equipmentUses } = useListEquipmentUses(equipment.id, {
    query: { queryKey: getListEquipmentUsesQueryKey(equipment.id) },
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
    const gallons = parseFloat(fuelForm.gallons);
    const cpg = fuelForm.costPerGallon ? parseFloat(fuelForm.costPerGallon) : null;
    const totalCost = fuelForm.cost ? parseFloat(fuelForm.cost) : (cpg ? gallons * cpg : 0);
    createFuelLog.mutate({
      id: equipment.id,
      data: {
        date: fuelForm.date,
        gallons,
        costPerGallon: cpg ?? undefined,
        cost: totalCost,
        odometerReading: fuelForm.odometerReading ? parseFloat(fuelForm.odometerReading) : undefined,
        jobId: fuelForm.jobId ? parseInt(fuelForm.jobId, 10) : undefined,
      } as Parameters<typeof createFuelLog.mutate>[0]['data'],
    }, {
      onSuccess: () => {
        toast.success('Fuel log added');
        qc.invalidateQueries({ queryKey: getListEquipmentFuelLogsQueryKey(equipment.id) });
        qc.invalidateQueries({ queryKey: getListEquipmentQueryKey() });
        setFuelOpen(false);
        setFuelForm({ date: '', gallons: '', costPerGallon: '', cost: '', odometerReading: '', jobId: '' });
      },
      onError: () => toast.error('Failed to add fuel log'),
    });
  };

  const handleDeleteMaintenance = (id: number) => {
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

  // Show how the current recorded total cost amortizes across the unit's useful life.
  const projections = (() => {
    if (!equipment.expectedLifespanHours || equipment.expectedLifespanHours <= 0) return [];
    const maxHours = equipment.expectedLifespanHours;
    const pts: { hours: number; cph: number }[] = [];
    const interval = maxHours <= 1000 ? 250 : 500;
    for (let h = interval; h < maxHours; h += interval) {
      pts.push({ hours: h, cph: h > 0 ? totalCost / h : 0 });
    }
    pts.push({ hours: maxHours, cph: totalCost / maxHours });
    return pts;
  })();

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between p-6 border-b">
        <div>
          <h2 className="text-xl font-bold" title={equipment.name}>{equipment.name}</h2>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
            <span className="text-sm text-muted-foreground capitalize">{equipment.type}</span>
            {((equipment as any).make || (equipment as any).model || (equipment as any).year) && (
              <>
                <span className="text-muted-foreground/40">·</span>
                {(equipment as any).year && <span className="text-xs text-muted-foreground" title={`Year: ${(equipment as any).year}`}>{(equipment as any).year}</span>}
                {(equipment as any).make && <span className="text-xs text-muted-foreground" title={`Make: ${(equipment as any).make}`}>{(equipment as any).make}</span>}
                {(equipment as any).model && <span className="text-xs text-muted-foreground font-medium" title={`Model: ${(equipment as any).model}`}>{(equipment as any).model}</span>}
              </>
            )}
            {(equipment as any).serialNumber && (
              <span className="text-xs text-muted-foreground/70 font-mono">#{(equipment as any).serialNumber}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!isTechnician && onEdit && <Button variant="outline" size="sm" title="Edit this equipment record" className="gap-1.5 text-xs h-8" onClick={onEdit}><Pencil className="w-3 h-3" /> Edit</Button>}
          <Button variant="ghost" size="icon" title="Close equipment detail panel" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
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
          <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive cursor-pointer" onClick={() => { const el = document.getElementById('equipment-maint-tab'); el?.click(); el?.scrollIntoView({ behavior: 'smooth' }); }}>
            <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">Maintenance Overdue <span className="font-normal text-xs opacity-70">— click to log service</span></p>
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

        {(equipment.model || equipment.serialNumber || equipment.year || equipment.attachmentType || equipment.attachmentModel || equipment.attachmentSerialNumber || equipment.attachmentYear) && (
          <div className="rounded-lg border p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Equipment Identification</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <p className="font-medium">Primary machine</p>
                <p className="text-muted-foreground">{[equipment.year, equipment.model].filter(Boolean).join(' ') || 'Model not entered'}</p>
                {equipment.serialNumber && <p className="font-mono text-xs">Serial: {equipment.serialNumber}</p>}
              </div>
              {(equipment.attachmentType || equipment.attachmentModel || equipment.attachmentSerialNumber || equipment.attachmentYear) && (
                <div>
                  <p className="font-medium">{equipment.attachmentType || 'Attachment'}</p>
                  <p className="text-muted-foreground">{[equipment.attachmentYear, equipment.attachmentModel].filter(Boolean).join(' ') || 'Model not entered'}</p>
                  {equipment.attachmentSerialNumber && <p className="font-mono text-xs">Serial: {equipment.attachmentSerialNumber}</p>}
                </div>
              )}
            </div>
          </div>
        )}
        {(equipment.oilFilterNumber || equipment.airFilterNumber || equipment.fuelFilterNumber || equipment.hydraulicFilterNumber || equipment.otherFilterNumbers) && (
          <div className="rounded-lg border p-4 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Filter Part Numbers</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {equipment.oilFilterNumber && <p><span className="text-muted-foreground">Oil:</span> <span className="font-mono">{equipment.oilFilterNumber}</span></p>}
              {equipment.airFilterNumber && <p><span className="text-muted-foreground">Air:</span> <span className="font-mono">{equipment.airFilterNumber}</span></p>}
              {equipment.fuelFilterNumber && <p><span className="text-muted-foreground">Fuel:</span> <span className="font-mono">{equipment.fuelFilterNumber}</span></p>}
              {equipment.hydraulicFilterNumber && <p><span className="text-muted-foreground">Hydraulic:</span> <span className="font-mono">{equipment.hydraulicFilterNumber}</span></p>}
            </div>
            {equipment.otherFilterNumbers && <p className="text-sm whitespace-pre-wrap"><span className="text-muted-foreground">Other:</span> {equipment.otherFilterNumbers}</p>}
          </div>
        )}

        {/* Cost summary cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5"><DollarSign className="w-3 h-3" /> Purchase Price</p>
            <p className="font-semibold">{fmt$(equipment.purchasePrice)}</p>
            {equipment.purchaseDate && <p className="text-[10px] text-muted-foreground" title={new Date(equipment.purchaseDate).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}>{new Date(equipment.purchaseDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</p>}
          </div>
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Clock className="w-3 h-3" /> Lifetime Cost / Hour</p>
            <p className="font-semibold">{equipment.costPerHour != null ? fmt$(equipment.costPerHour) : '—'}</p>
            <p className="text-[10px] text-muted-foreground">
              {equipment.expectedLifespanHours
                ? `Based on ${equipment.expectedLifespanHours.toLocaleString()} expected hours`
                : 'Set expected lifespan hours to calculate'}
            </p>
          </div>
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Wrench className="w-3 h-3" /> Total Repairs</p>
            <p className="font-semibold">{fmt$(equipment.totalRepairCost)}</p>
          </div>
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Fuel className="w-3 h-3" /> Total Fuel</p>
            <p className="font-semibold">{fmt$(equipment.totalFuelCost)}</p>
            {fuelLogs && fuelLogs.length > 0 && (
              <p className="text-[10px] text-muted-foreground" title={`Last fuel fill: ${format(new Date(fuelLogs[0].date), 'EEEE, MMMM d, yyyy')}`}>
                Last fill: {format(new Date(fuelLogs[0].date), 'MMM d, yyyy')}
              </p>
            )}
          </div>
        </div>

        {/* Resale value */}
        {equipment.estimatedResaleValue != null && (
          <div className="rounded-lg border p-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Est. Resale Value (depreciated)</p>
              <p className="font-semibold">{fmt$(equipment.estimatedResaleValue)}</p>
            </div>
            <Badge variant={equipment.sellRecommended ? 'destructive' : 'secondary'} title={equipment.sellRecommended ? 'Resale value is low relative to purchase price — consider selling' : 'Resale value relative to purchase price'}>
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
                    <TableRow key={p.hours} className={p.hours === Math.round(equipment.currentHours / 500) * 500 ? 'bg-primary/5' : ''} title={`At ${p.hours.toLocaleString()} hours: CPH = ${fmt$(p.cph)}`}>
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
            <TabsTrigger id="equipment-maint-tab" value="maintenance" title="Maintenance records and service history" className="flex-1 flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5" /> Maintenance ({maintenance?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="fuel" title="Fuel log and consumption records" className="flex-1 flex items-center gap-1.5">
              <Fuel className="w-3.5 h-3.5" /> Fuel ({fuelLogs?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="tasks" title="Linked tasks for this equipment" className="flex-1 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Tasks ({equipmentTasks?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="ledger" title="Cost ledger — operating and repair expenses" className="flex-1 flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5" /> Ledger
            </TabsTrigger>
            <TabsTrigger value="activity" title="Audit trail of changes to this equipment record" className="flex-1 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" /> Activity
            </TabsTrigger>
            <TabsTrigger value="uses" title="All jobs this equipment has been used on" className="flex-1 flex items-center gap-1.5">
              <CalendarCheck2 className="w-3.5 h-3.5" /> Use ({equipmentUses?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="report" title="Cost and efficiency summary for this equipment" className="flex-1 flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5" /> Report
            </TabsTrigger>
          </TabsList>

          {/* Maintenance tab */}
          <TabsContent value="maintenance" className="space-y-3 mt-4">
            {!equipment.archivedAt && (
              <Button size="sm" title="Log a new maintenance event or repair for this equipment" className="w-full gap-2" onClick={() => setMaintOpen(true)}>
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
                      <Input type="date" title="Date maintenance was performed" value={maintForm.date} onChange={e => setMaintForm(f => ({ ...f, date: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Cost ($)</label>
                      <Input type="number" title="Total cost of this maintenance in dollars" placeholder="0.00" value={maintForm.cost} onChange={e => setMaintForm(f => ({ ...f, cost: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Description *</label>
                    <Input title="What was done (e.g. oil change, blade replacement)" placeholder="e.g. Oil change, blade replacement" value={maintForm.description} onChange={e => setMaintForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Vendor / Shop</label>
                    <Input title="Repair shop or vendor that performed the maintenance" placeholder="e.g. ABC Repair" value={maintForm.vendor} onChange={e => setMaintForm(f => ({ ...f, vendor: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Next Due Date</label>
                      <Input type="date" title="Calendar date when next service is due" value={maintForm.nextServiceDueDate} onChange={e => setMaintForm(f => ({ ...f, nextServiceDueDate: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Next @ Hours</label>
                      <Input type="number" title="Engine hour reading at which next service is due" placeholder="250" value={maintForm.nextServiceDueHours} onChange={e => setMaintForm(f => ({ ...f, nextServiceDueHours: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Next @ Miles</label>
                      <Input type="number" title="Odometer reading (miles) at which next service is due" placeholder="5000" value={maintForm.nextServiceDueMiles} onChange={e => setMaintForm(f => ({ ...f, nextServiceDueMiles: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" title="Discard this maintenance entry" disabled={createMaintenance.isPending} onClick={() => setMaintOpen(false)}>Cancel</Button>
                    <Button size="sm" title="Save this maintenance record" onClick={handleAddMaintenance} disabled={createMaintenance.isPending}>{createMaintenance.isPending ? 'Saving…' : 'Save'}</Button>
                  </div>
                </CardContent>
              </Card>
            )}
            {maintenance && maintenance.length > 0 && (
              <MaintSearch records={maintenance} isTechnician={isTechnician} onDelete={handleDeleteMaintenance} />
            )}
            {maintenance && maintenance.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No maintenance records yet.</p>
            )}
          </TabsContent>

          {/* Fuel tab */}
          <TabsContent value="fuel" className="space-y-3 mt-4">
            {!equipment.archivedAt && (
              <Button size="sm" className="w-full gap-2" title="Log a new fuel fill for this equipment" onClick={() => setFuelOpen(true)}>
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
                      <Input type="date" title="Date this fuel fill-up occurred" value={fuelForm.date} onChange={e => setFuelForm(f => ({ ...f, date: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Gallons *</label>
                      <Input type="number" title="Number of gallons filled" placeholder="5.0" step="0.1" value={fuelForm.gallons}
                        onChange={e => {
                          const gals = e.target.value;
                          const cpg = parseFloat(fuelForm.costPerGallon) || 0;
                          setFuelForm(f => ({ ...f, gallons: gals, cost: cpg && gals ? String((parseFloat(gals) * cpg).toFixed(2)) : f.cost }));
                        }} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">$ / Gallon</label>
                      <Input type="number" title="Price paid per gallon — used to calculate total fuel cost" placeholder="e.g. 3.89" step="0.001" value={fuelForm.costPerGallon}
                        onChange={e => {
                          const cpg = e.target.value;
                          const gals = parseFloat(fuelForm.gallons) || 0;
                          setFuelForm(f => ({ ...f, costPerGallon: cpg, cost: cpg && gals ? String((parseFloat(cpg) * gals).toFixed(2)) : f.cost }));
                        }} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Total Cost ($)</label>
                      <Input type="number" title="Total amount paid for this fill-up (auto-calculated from gallons × price/gallon)" placeholder="0.00" value={fuelForm.cost} onChange={e => setFuelForm(f => ({ ...f, cost: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Hours Reading</label>
                      <Input type="number" title="Engine hour-meter reading at the time of fill-up (used for fuel efficiency calculations)" placeholder="Current hours" value={fuelForm.odometerReading} onChange={e => setFuelForm(f => ({ ...f, odometerReading: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Job (optional)</label>
                    <Select value={fuelForm.jobId || '__none__'} onValueChange={v => setFuelForm(f => ({ ...f, jobId: v === '__none__' ? '' : v }))}>
                      <SelectTrigger className="w-full text-sm" title="Optionally associate this fuel cost with a specific job">
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
                    <Button variant="outline" size="sm" disabled={createFuelLog.isPending} onClick={() => setFuelOpen(false)}>Cancel</Button>
                    <Button size="sm" title="Save this fuel fill-up record" onClick={handleAddFuel} disabled={createFuelLog.isPending}>{createFuelLog.isPending ? 'Saving…' : 'Save'}</Button>
                  </div>
                </CardContent>
              </Card>
            )}
            {fuelLogs && fuelLogs.length > 0 ? (
              <div className="space-y-2">
                {(() => { const totalGal = fuelLogs.reduce((s, f) => s + (f.gallons ?? 0), 0); const totalCost = fuelLogs.reduce((s, f) => s + (f.cost ?? 0), 0); return totalGal > 0 ? <div className="flex items-center gap-3 px-3 py-2 bg-muted/50 rounded-lg text-sm"><span className="text-muted-foreground">Total:</span><span className="font-medium">{totalGal.toFixed(1)} gal</span><span className="font-medium">${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div> : null; })()}
                {fuelLogs.map(f => {
                  const linkedJob = f.jobId != null ? recentJobs.find(j => j.id === f.jobId) : null;
                  return (
                    <div key={f.id} className="rounded-lg border p-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium" title={`${f.gallons} gallons`}>{f.gallons} gal</p>
                          <Badge variant="outline" className="text-xs" title={`Fuel cost: ${fmt$(f.cost)}`}>{fmt$(f.cost)}</Badge>
                          {f.odometerReading != null && <span className="text-xs text-muted-foreground" title={`Hour meter reading: ${f.odometerReading} hrs`}>@ {f.odometerReading} hrs</span>}
                          {f.jobId != null && (
                            <Badge variant="secondary" className="text-xs gap-1">
                              <Fuel className="w-3 h-3" />
                              {linkedJob ? linkedJob.title : `Job #${f.jobId}`}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5" title={f.date ? new Date(f.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : undefined}>{f.date ? new Date(f.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</p>
                      </div>
                      {!isTechnician && (
                        <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-destructive shrink-0 disabled:opacity-40" disabled={deleteFuelLog.isPending} onClick={() => handleDeleteFuel(f.id)}>
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
            <Button size="sm" title="Flag this equipment for repair or scheduled maintenance" className="w-full gap-2" onClick={() => setTaskFormOpen(true)}>
              <Plus className="w-4 h-4" /> Flag for Repair / Maintenance
            </Button>
            {equipmentTasks && equipmentTasks.length > 0 ? (
              <div className="space-y-2">
                {equipmentTasks.map(t => (
                  <div key={t.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium flex-1 min-w-0 truncate" title={t.title}>{t.title}</p>
                      <Badge variant="outline" className={priorityBadgeClass(t.priority) + ' text-[10px]'} title={`Priority: ${t.priority}`}>{t.priority}</Badge>
                      <Badge variant="outline" className={statusBadgeClass(t.status) + ' text-[10px]'} title={`Status: ${t.status.replace('_', ' ')}`}>{t.status.replace('_', ' ')}</Badge>
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

          {/* Use History tab — all jobs this equipment has been used on */}
          <TabsContent value="uses" className="mt-4">
            {equipmentUses && equipmentUses.length > 0 ? (
              <div className="rounded-lg border divide-y text-sm">
                {equipmentUses.map(use => (
                  <div key={use.id} className="flex items-start justify-between px-3 py-2.5">
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <p className="font-medium truncate" title={use.jobTitle ?? undefined}>{use.jobTitle ?? `Job #${use.jobId}`}</p>
                      {use.jobScheduledAt && (
                        <p className="text-xs text-muted-foreground">{new Date(use.jobScheduledAt).toLocaleDateString()}</p>
                      )}
                      {use.notes && <p className="text-xs text-muted-foreground italic">{use.notes}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0 ml-3">
                      <span className="text-sm font-semibold tabular-nums">{use.hoursUsed.toFixed(1)} h</span>
                      <span className="text-[10px] text-muted-foreground">{new Date(use.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
                <div className="flex justify-between px-3 py-2 bg-muted/30 font-semibold">
                  <span>Total hours</span>
                  <span>{(equipmentUses.reduce((s, u) => s + u.hoursUsed, 0)).toFixed(1)} h</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">No job usage logged yet. Add equipment hours from the job detail panel.</p>
            )}
          </TabsContent>

          {/* Report tab — cost and efficiency summary */}
          <TabsContent value="report" className="mt-4">
            {(() => {
              const age = equipment.createdAt
                ? Math.floor((Date.now() - new Date(equipment.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 365.25))
                : null;
              const totalCost = (equipment.purchasePrice ?? 0) + (equipment.totalRepairCost ?? 0) + (equipment.totalFuelCost ?? 0);
              const repairRatio = (equipment.purchasePrice ?? 0) > 0
                ? Math.round(((equipment.totalRepairCost ?? 0) / equipment.purchasePrice) * 100)
                : null;
              const jobHours = (equipmentUses ?? []).reduce((s, u) => s + u.hoursUsed, 0);
              return (
                <div className="space-y-4">
                  {/* Key metrics grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Purchase Price', value: fmt$(equipment.purchasePrice ?? 0), title: 'Original purchase price of this equipment' },
                      { label: 'Lifetime Cost Per Hour', value: equipment.costPerHour != null ? fmt$(equipment.costPerHour) : '—', title: 'Purchase, repair, and fuel cost divided by expected lifespan hours' },
                      { label: 'Total Repairs', value: fmt$(equipment.totalRepairCost ?? 0), title: 'Sum of all logged maintenance and repair costs' },
                      { label: 'Total Fuel', value: fmt$(equipment.totalFuelCost ?? 0), title: 'Sum of all logged fuel costs' },
                      { label: 'Total Cost', value: fmt$(totalCost), title: 'Purchase + repairs + fuel' },
                      { label: 'Hours on Record', value: `${fmtHours(equipment.currentHours)}`, title: 'Current hour-meter reading' },
                    ].map(m => (
                      <div key={m.label} className="rounded-lg border p-3 space-y-0.5" title={m.title}>
                        <p className="text-xs text-muted-foreground">{m.label}</p>
                        <p className="text-base font-semibold tabular-nums">{m.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Job usage hours (from job_equipment_uses) */}
                  {jobHours > 0 && (
                    <div className="rounded-lg border p-3 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Hours Logged on Jobs</p>
                        <p className="text-base font-semibold">{jobHours.toFixed(1)} h across {equipmentUses!.length} job{equipmentUses!.length !== 1 ? 's' : ''}</p>
                      </div>
                      <CalendarCheck2 className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}

                  {/* Repair cost bar */}
                  {repairRatio !== null && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground" title="Repair cost as a percentage of original purchase price">Repair Cost vs Purchase Price</span>
                        <span className={`font-semibold ${repairRatio >= 50 ? 'text-destructive' : repairRatio >= 30 ? 'text-amber-500' : 'text-muted-foreground'}`}>{repairRatio}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${repairRatio >= 50 ? 'bg-destructive' : repairRatio >= 30 ? 'bg-amber-500' : 'bg-primary'}`}
                          style={{ width: `${Math.min(100, repairRatio)}%` }}
                        />
                      </div>
                      {repairRatio >= 50 && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Repair cost has exceeded 50% of purchase price — consider replacement.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Age + status */}
                  <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                    {age !== null && <span>Age: <strong className="text-foreground">{age === 0 ? '< 1 year' : `${age} yr${age !== 1 ? 's' : ''}`}</strong></span>}
                    <span>Status: <strong className="text-foreground">{equipment.archivedAt ? 'Archived' : equipment.isActive ? 'Active' : 'Inactive'}</strong></span>
                    {equipment.sellRecommended && <span className="text-destructive font-medium flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Sale recommended</span>}
                  </div>
                </div>
              );
            })()}
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
                      <p className="text-sm font-medium capitalize" title={event.eventType.replace(/_/g, ' ')}>{event.eventType}</p>
                      <p className="text-xs text-muted-foreground mt-0.5" title={new Date(event.createdAt).toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}>
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
  const { can } = usePermissions();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [equipmentSearch, setEquipmentSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const { data: equipment, isLoading } = useListEquipment(
    { includeArchived },
    { query: { queryKey: getListEquipmentQueryKey({ includeArchived }) } },
  );
  const { data: equipmentTypes = [] } = useListEquipmentTypes({ query: { queryKey: getListEquipmentTypesQueryKey() } });
  const { data: users = [] } = useListUsers({ query: { queryKey: getListUsersQueryKey(), enabled: formOpen } });
  const { data: crews = [] } = useListCrews({ query: { queryKey: getListCrewsQueryKey(), enabled: formOpen } });
  const createEquipment = useCreateEquipment();
  const updateEquipment = useUpdateEquipment();
  const deleteEquipment = useDeleteEquipment();
  const hardDeleteEquipment = useHardDeleteEquipment();
  const recoverEquipment = useRecoverMisassignedDivineEdgeEquipment();
  const { data: recoveryStatus } = useGetMisassignedDivineEdgeEquipmentRecoveryStatus({
    query: {
      enabled: isOwner,
      queryKey: getGetMisassignedDivineEdgeEquipmentRecoveryStatusQueryKey(),
    },
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingItem, setEditingItem] = useState<Equipment | null>(null);
  const [form, setForm] = useState<EquipmentFormState>(EMPTY_EQ_FORM);

  // Procurement alerts raised by a "Concern-Watch" checklist result during a Daily Task
  const concernParams = { scope: 'all' as const, contextType: 'equipment', status: 'open' };
  const { data: concernTasksRaw } = useListTasks(concernParams, { query: { queryKey: getListTasksQueryKey(concernParams) } });
  const concernTasks = concernTasksRaw?.filter(t => t.taskType === 'equipment_concern');

  // Reorder suggestion sheet state
  const [reorderEquipmentId, setReorderEquipmentId] = useState<number | null>(null);
  const reorderEquipment = equipment?.find(e => e.id === reorderEquipmentId) ?? null;

  const [equipmentStatusFilter, setEquipmentStatusFilter] = useState<'all' | 'maintenance' | 'sell'>('all');
  const [equipmentTypeFilter, setEquipmentTypeFilter] = useState('');
  const [equipmentSort, setEquipmentSort] = useState<'name' | 'type' | 'age' | 'hours'>('name');

  const filteredEquipment = (equipment ?? [])
    .filter(e => !equipmentSearch.trim() || e.name.toLowerCase().includes(equipmentSearch.toLowerCase()) || (e.type ?? '').toLowerCase().includes(equipmentSearch.toLowerCase()))
    .filter(e => !equipmentTypeFilter || (e.type ?? '') === equipmentTypeFilter)
    .filter(e => equipmentStatusFilter === 'all' || (equipmentStatusFilter === 'maintenance' && e.maintenanceDue) || (equipmentStatusFilter === 'sell' && e.sellRecommended))
    .sort((a, b) => {
      if (equipmentSort === 'type') return (a.type ?? '').localeCompare(b.type ?? '');
      if (equipmentSort === 'age') return new Date(a.purchaseDate ?? '9999').getTime() - new Date(b.purchaseDate ?? '9999').getTime();
      if (equipmentSort === 'hours') return ((b as any).currentHours ?? 0) - ((a as any).currentHours ?? 0);
      return a.name.localeCompare(b.name);
    });

  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string; action: 'archive' | 'delete' } | null>(null);

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
      assignedUserId: form.assignedUserId ? Number(form.assignedUserId) : null,
      assignedCrewId: form.assignedCrewId ? Number(form.assignedCrewId) : null,
      name: form.name,
      type: form.type,
      model: form.model || null,
      serialNumber: form.serialNumber || null,
      year: form.year ? parseInt(form.year, 10) : null,
      attachmentType: form.attachmentType || null,
      attachmentModel: form.attachmentModel || null,
      attachmentSerialNumber: form.attachmentSerialNumber || null,
      attachmentYear: form.attachmentYear ? parseInt(form.attachmentYear, 10) : null,
      oilFilterNumber: form.oilFilterNumber || null,
      airFilterNumber: form.airFilterNumber || null,
      fuelFilterNumber: form.fuelFilterNumber || null,
      hydraulicFilterNumber: form.hydraulicFilterNumber || null,
      otherFilterNumbers: form.otherFilterNumbers || null,
      purchaseDate: form.purchaseDate || undefined,
      purchasePrice: form.purchasePrice ? parseFloat(form.purchasePrice) : 0,
      expectedLifespanYears: form.expectedLifespanYears ? parseFloat(form.expectedLifespanYears) : undefined,
      expectedLifespanHours: form.expectedLifespanHours ? parseFloat(form.expectedLifespanHours) : undefined,
      currentHours: form.currentHours ? parseFloat(form.currentHours) : 0,
      currentMiles: form.currentMiles ? parseFloat(form.currentMiles) : undefined,
      notes: form.notes || undefined,
      sellAfterHours: form.neverSell ? undefined : (form.sellAfterHours ? parseFloat(form.sellAfterHours) : undefined),
      neverSell: form.neverSell,
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
    setDeleteConfirm({ id, name, action: 'archive' });
  };

  const handleHardDelete = (id: number, name: string) => {
    setDeleteConfirm({ id, name, action: 'delete' });
  };

  const confirmEquipmentAction = () => {
    if (!deleteConfirm) return;
    const { id, name, action } = deleteConfirm;
    if (action === 'archive') {
      deleteEquipment.mutate({ id }, {
        onSuccess: () => {
          toast.success(`${name} archived`);
          invalidateEquipmentLists(qc);
          if (selectedId === id) setSelectedId(null);
          setDeleteConfirm(null);
        },
        onError: () => toast.error('Failed to archive equipment'),
      });
    } else {
      hardDeleteEquipment.mutate({ id }, {
        onSuccess: () => {
          toast.success(`${name} permanently deleted`);
          invalidateEquipmentLists(qc);
          if (selectedId === id) setSelectedId(null);
          setDeleteConfirm(null);
        },
        onError: () => toast.error('Failed to permanently delete equipment'),
      });
    }
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
    <div className="min-w-0 overflow-x-hidden space-y-6 animate-in fade-in duration-500">
      <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="shrink-0">
          <h1 className="text-3xl font-bold tracking-tight">Equipment</h1>
          <p className="text-muted-foreground mt-1">Track operating costs, maintenance, and fuel for your fleet.{(equipment?.length ?? 0) > 0 && <span className="ml-2 text-xs font-medium bg-muted px-1.5 py-0.5 rounded-full">{equipment?.length}</span>}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={equipmentSearch}
              onChange={e => setEquipmentSearch(e.target.value)}
              placeholder="Search equipment…"
              title="Search by equipment name, make, or model"
              className="h-9 w-full pl-7 text-sm sm:w-44"
            />
            {equipmentSearch && <button onClick={() => setEquipmentSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {(['all', 'maintenance', 'sell'] as const).map(s => (
              <button
                key={s}
                title={s === 'all' ? 'Show all equipment' : s === 'maintenance' ? 'Show equipment flagged for maintenance' : 'Show equipment flagged to sell'}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${equipmentStatusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                onClick={() => setEquipmentStatusFilter(s)}
              >
                {s === 'all' ? 'All' : s === 'maintenance' ? `Maintenance (${maintenanceDueCount})` : `Sell (${sellCount})`}
              </button>
            ))}
          </div>
          {equipmentTypes.length > 0 && (
            <select
              value={equipmentTypeFilter}
              onChange={e => setEquipmentTypeFilter(e.target.value)}
              className="h-9 text-sm px-2.5 rounded-md border border-input bg-background"
              title="Filter by type"
            >
              <option value="">All types</option>
              {equipmentTypes.map((t: { id: number; label: string }) => (
                <option key={t.id} value={t.label}>{t.label}</option>
              ))}
            </select>
          )}
          <select
            value={equipmentSort}
            onChange={e => setEquipmentSort(e.target.value as typeof equipmentSort)}
            className="h-9 text-sm px-2.5 rounded-md border border-input bg-background"
            title="Sort by"
          >
            <option value="name">Sort: Name</option>
            <option value="type">Sort: Type</option>
            <option value="age">Sort: Oldest first</option>
            <option value="hours">Sort: Highest hours</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              title="Show archived (retired) equipment alongside active equipment"
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
          {isOwner && (
            <Button variant="outline" size="icon" title="Equipment settings (types and sell thresholds)" onClick={() => setSettingsOpen(true)}>
              <SlidersHorizontal className="w-4 h-4" />
            </Button>
          )}
          {can('actions.addEquipment') && (
            <Button onClick={openCreate} className="gap-2" title="Add a new piece of equipment">
              <Plus className="w-4 h-4" /> Add Equipment
            </Button>
          )}
        </div>
      </div>

      {isOwner && recoveryStatus?.eligible && recoveryStatus.pendingCount > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50/70 p-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <RotateCcw className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <p className="text-sm font-semibold">Your {recoveryStatus.pendingCount} September equipment records are ready to recover</p>
              <p className="mt-0.5 text-xs text-amber-800">This moves only the three confirmed records from the incorrect business into Divine Edge.</p>
            </div>
          </div>
          <Button
            className="shrink-0"
            disabled={recoverEquipment.isPending}
            onClick={() => recoverEquipment.mutate(undefined, {
              onSuccess: result => {
                toast.success(result.recoveredCount ? `Recovered ${result.recoveredCount} equipment records` : 'Those equipment records were already recovered');
                invalidateEquipmentLists(qc);
                qc.invalidateQueries({ queryKey: getGetMisassignedDivineEdgeEquipmentRecoveryStatusQueryKey() });
              },
              onError: () => toast.error('Could not recover the equipment records'),
            })}
          >
            {recoverEquipment.isPending ? 'Recovering…' : `Recover ${recoveryStatus.pendingCount} Equipment Records`}
          </Button>
        </div>
      )}

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
                        title="Suggest a replacement equipment order for this concern"
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

      <div className="flex min-w-0 gap-6">
        {/* Equipment list — always full width; detail opens in Sheet */}
        <div className="flex min-w-0 w-full flex-col gap-3">
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
                {can('actions.addEquipment') && <Button onClick={openCreate} className="gap-2" title="Add a new piece of equipment"><Plus className="w-4 h-4" /> Add Equipment</Button>}
              </CardContent>
            </Card>
          )}
          {!isLoading && (equipment?.length ?? 0) > 0 && filteredEquipment.length < (equipment?.length ?? 0) && (
            <p className="text-xs text-muted-foreground px-1">Showing {filteredEquipment.length} of {equipment?.length} items</p>
          )}
          {filteredEquipment.map(item => {
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
                        <p className="font-semibold" title={item.name}>{item.name}</p>
                        <Badge variant="secondary" className="text-xs capitalize cursor-pointer hover:bg-secondary/70" title={`Show only ${item.type} equipment`} onClick={e => { e.stopPropagation(); setEquipmentTypeFilter(item.type); }}>{item.type}</Badge>
                        {item.assignedUserName && <Badge variant="outline" className="text-xs">Employee: {item.assignedUserName}</Badge>}
                        {item.assignedCrewName && <Badge variant="outline" className="text-xs">Crew: {item.assignedCrewName}</Badge>}
                        {!item.assignedUserId && !item.assignedCrewId && <Badge variant="outline" className="text-xs text-muted-foreground">Unassigned</Badge>}
                        {item.sellRecommended && (
                          <Badge variant="destructive" className="text-xs gap-1" title="Recommended for sale or retirement">
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
                        {!item.archivedAt && !item.maintenanceDue && (item as any).nextServiceDueDate && (
                          <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
                            <CalendarCheck2 className="w-3 h-3" /> Due {new Date((item as any).nextServiceDueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </Badge>
                        )}
                      </div>
                      {(item as any).notes && (
                        <p className="text-xs text-muted-foreground mt-1.5 line-clamp-1">{(item as any).notes}</p>
                      )}
                      {(item.oilFilterNumber || item.airFilterNumber || item.fuelFilterNumber || item.hydraulicFilterNumber || item.otherFilterNumbers) && (
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <span className="font-medium text-muted-foreground">Part numbers:</span>
                          {item.oilFilterNumber && <span><span className="text-muted-foreground">Oil</span> <span className="font-mono">{item.oilFilterNumber}</span></span>}
                          {item.airFilterNumber && <span><span className="text-muted-foreground">Air</span> <span className="font-mono">{item.airFilterNumber}</span></span>}
                          {item.fuelFilterNumber && <span><span className="text-muted-foreground">Fuel</span> <span className="font-mono">{item.fuelFilterNumber}</span></span>}
                          {item.hydraulicFilterNumber && <span><span className="text-muted-foreground">Hydraulic</span> <span className="font-mono">{item.hydraulicFilterNumber}</span></span>}
                          {item.otherFilterNumbers && <span><span className="text-muted-foreground">Other</span> {item.otherFilterNumbers}</span>}
                        </div>
                      )}
                      <div className="flex items-center gap-4 mt-2 flex-wrap">
                        <span className="text-xs text-muted-foreground flex items-center gap-1" title={`Hour meter: ${fmtHours(item.currentHours)}`}>
                          <Clock className="w-3 h-3" /> {fmtHours(item.currentHours)}
                        </span>
                        {(item as any).currentMileage != null && (item as any).currentMileage > 0 && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1" title={`Odometer: ${((item as any).currentMileage as number).toLocaleString()} miles`}>
                            <Gauge className="w-3 h-3" /> {((item as any).currentMileage as number).toLocaleString()} mi
                          </span>
                        )}
                        {(item as any).lastServicedAt && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1" title={`Last serviced: ${new Date((item as any).lastServicedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`}>
                            <CalendarCheck2 className="w-3 h-3" /> Last: {new Date((item as any).lastServicedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <DollarSign className="w-3 h-3" /> <span title="Lifetime CPH = (purchase + repairs + fuel) ÷ expected lifespan hours">CPH:</span> {item.costPerHour != null ? fmt$(item.costPerHour) : '—'}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1" title={`Total repair cost: ${fmt$(item.totalRepairCost)}`}>
                          <Wrench className="w-3 h-3" /> Repairs: {fmt$(item.totalRepairCost)}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1" title={`Total fuel cost: ${fmt$(item.totalFuelCost)}`}>
                          <Fuel className="w-3 h-3" /> Fuel: {fmt$(item.totalFuelCost)}
                        </span>
                      </div>
                      {/* Repair cost bar */}
                      {item.purchasePrice > 0 && (
                        <div className="mt-2">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[10px] text-muted-foreground" title={`Total repairs: ${fmt$(item.totalRepairCost)} vs purchase: ${fmt$(item.purchasePrice)}`}>Repair cost vs purchase</span>
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
                          <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-primary" title="Edit equipment" onClick={e => { e.stopPropagation(); openEdit(item); }}>
                            <Wrench className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-destructive" title="Archive equipment" onClick={e => { e.stopPropagation(); handleDelete(item.id, item.name); }}>
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
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

      </div>

      {/* Equipment detail — full-width Sheet */}
      <Sheet open={selectedEquipment !== null} onOpenChange={open => { if (!open) setSelectedId(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col p-0 gap-0">
          {selectedEquipment && (
            <EquipmentDetailPanel
              equipment={selectedEquipment}
              onClose={() => setSelectedId(null)}
              onEdit={() => { setSelectedId(null); openEdit(selectedEquipment); }}
            />
          )}
        </SheetContent>
      </Sheet>

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
              <Input title="Equipment name (e.g. make, model, and descriptor)" placeholder="e.g. Husqvarna 60&quot; Zero-Turn" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Type</label>
              {/* Combobox: shows tenant-defined types as suggestions, allows free-form entry */}
              <Input
                list="equipment-type-options"
                title="Equipment category — choose from saved types or enter a custom value"
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
            <div className="rounded-lg border p-3 space-y-3">
              <div>
                <p className="text-sm font-medium">Assignments</p>
                <p className="text-xs text-muted-foreground">Assign an employee, a crew, both, or neither. Either assignment grants field access.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Employee</label>
                  <Select value={form.assignedUserId || 'none'} onValueChange={value => setForm(f => ({ ...f, assignedUserId: value === 'none' ? '' : value }))}>
                    <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No employee</SelectItem>
                      {users.filter(user => user.isActive).map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Crew</label>
                  <Select value={form.assignedCrewId || 'none'} onValueChange={value => setForm(f => ({ ...f, assignedCrewId: value === 'none' ? '' : value }))}>
                    <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No crew</SelectItem>
                      {crews.map(crew => <SelectItem key={crew.id} value={String(crew.id)}>{crew.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div className="rounded-lg border p-3 space-y-3">
              <p className="text-sm font-medium">Machine Identification</p>
              <div className="grid grid-cols-3 gap-3">
                <Input placeholder="Model" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
                <Input placeholder="Serial number" value={form.serialNumber} onChange={e => setForm(f => ({ ...f, serialNumber: e.target.value }))} />
                <Input type="number" min="1900" max="2100" placeholder="Year" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} />
              </div>
            </div>
            <div className="rounded-lg border p-3 space-y-3">
              <div>
                <p className="text-sm font-medium">Attachment / Second Unit</p>
                <p className="text-xs text-muted-foreground">Optional—for a bagger or another attachment</p>
              </div>
              <Input placeholder="Attachment type (e.g. Bagger)" value={form.attachmentType} onChange={e => setForm(f => ({ ...f, attachmentType: e.target.value }))} />
              <div className="grid grid-cols-3 gap-3">
                <Input placeholder="Model" value={form.attachmentModel} onChange={e => setForm(f => ({ ...f, attachmentModel: e.target.value }))} />
                <Input placeholder="Serial number" value={form.attachmentSerialNumber} onChange={e => setForm(f => ({ ...f, attachmentSerialNumber: e.target.value }))} />
                <Input type="number" min="1900" max="2100" placeholder="Year" value={form.attachmentYear} onChange={e => setForm(f => ({ ...f, attachmentYear: e.target.value }))} />
              </div>
            </div>
            <div className="rounded-lg border p-3 space-y-3">
              <div>
                <p className="text-sm font-medium">Filter Part Numbers</p>
                <p className="text-xs text-muted-foreground">Replacement numbers used during maintenance</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="Oil filter" value={form.oilFilterNumber} onChange={e => setForm(f => ({ ...f, oilFilterNumber: e.target.value }))} />
                <Input placeholder="Air filter" value={form.airFilterNumber} onChange={e => setForm(f => ({ ...f, airFilterNumber: e.target.value }))} />
                <Input placeholder="Fuel filter" value={form.fuelFilterNumber} onChange={e => setForm(f => ({ ...f, fuelFilterNumber: e.target.value }))} />
                <Input placeholder="Hydraulic filter" value={form.hydraulicFilterNumber} onChange={e => setForm(f => ({ ...f, hydraulicFilterNumber: e.target.value }))} />
              </div>
              <Input placeholder="Other filters (name and part number)" value={form.otherFilterNumbers} onChange={e => setForm(f => ({ ...f, otherFilterNumbers: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Purchase Date</label>
                <Input type="date" title="Date the equipment was purchased" max={new Date().toISOString().split('T')[0]} value={form.purchaseDate} onChange={e => setForm(f => ({ ...f, purchaseDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Purchase Price ($)</label>
                <Input type="number" title="Original purchase price in dollars — used for repair cost threshold calculations" placeholder="0.00" value={form.purchasePrice} onChange={e => setForm(f => ({ ...f, purchasePrice: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Expected Lifespan (yrs)</label>
                <Input type="number" title="Expected useful life in years — used to estimate resale value decline" placeholder="10" value={form.expectedLifespanYears} onChange={e => setForm(f => ({ ...f, expectedLifespanYears: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Expected Lifespan (hrs)</label>
                <Input type="number" title="Expected useful life in engine hours — used for cost-per-hour projections" placeholder="2000" value={form.expectedLifespanHours} onChange={e => setForm(f => ({ ...f, expectedLifespanHours: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Current Hours</label>
                <Input type="number" title="Current engine hour-meter reading" placeholder="0" value={form.currentHours} onChange={e => setForm(f => ({ ...f, currentHours: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Current Miles (optional)</label>
                <Input type="number" title="Current odometer reading in miles (optional — for vehicles only)" placeholder="0" value={form.currentMiles} onChange={e => setForm(f => ({ ...f, currentMiles: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes</label>
              <Input title="Free-form notes about this equipment (condition, quirks, storage location, etc.)" placeholder="Any notes about this equipment" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            {/* Sell threshold */}
            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Sell Threshold</p>
                  <p className="text-xs text-muted-foreground">When to recommend selling this unit</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.neverSell}
                  onClick={() => setForm(f => ({ ...f, neverSell: !f.neverSell, sellAfterHours: !f.neverSell ? '' : f.sellAfterHours }))}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${form.neverSell ? 'bg-primary' : 'bg-muted'}`}
                  title="Toggle never-sell mode — suppresses all sell recommendations for this unit"
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${form.neverSell ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <label className="text-sm cursor-pointer" onClick={() => setForm(f => ({ ...f, neverSell: !f.neverSell }))}>Never sell this equipment</label>
              </div>
              {!form.neverSell && (
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Sell after (hours) — optional</label>
                  <Input
                    type="number" min="0" step="1"
                    title="System will flag this unit for sale once current hours reach this value"
                    placeholder="e.g. 2000"
                    value={form.sellAfterHours}
                    onChange={e => setForm(f => ({ ...f, sellAfterHours: e.target.value }))}
                  />
                  {form.sellAfterHours && (
                    <p className="text-xs text-muted-foreground">
                      ⚡ Sell recommended flag triggers at {parseFloat(form.sellAfterHours).toLocaleString()} hrs
                    </p>
                  )}
                </div>
              )}
            </div>

            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" title="Discard equipment form changes" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button title={editingItem ? 'Save changes to this equipment record' : 'Add this equipment to the fleet'} onClick={handleSave} disabled={createEquipment.isPending || updateEquipment.isPending}>
                {(createEquipment.isPending || updateEquipment.isPending) ? 'Saving…' : editingItem ? 'Save Changes' : 'Add Equipment'}
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

      {/* Archive / Hard-delete Confirmation */}
      {deleteConfirm != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="bg-card rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold">
              {deleteConfirm.action === 'archive' ? 'Archive Equipment' : 'Permanently Delete Equipment'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {deleteConfirm.action === 'archive'
                ? `Archive "${deleteConfirm.name}"? It will be hidden from the active list but its history will be kept.`
                : `Permanently delete "${deleteConfirm.name}"? This cannot be undone and will remove all maintenance and fuel records.`}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                className="text-sm px-3 py-1.5 rounded-md border hover:bg-muted transition-colors"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="text-sm px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                onClick={confirmEquipmentAction}
                disabled={deleteEquipment.isPending || hardDeleteEquipment.isPending}
              >
                {(deleteEquipment.isPending || hardDeleteEquipment.isPending) ? (deleteConfirm.action === 'archive' ? 'Archiving…' : 'Deleting…') : (deleteConfirm.action === 'archive' ? 'Archive' : 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Equipment Settings Sheet */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="pb-2">
            <SheetTitle>Equipment Settings</SheetTitle>
            <SheetDescription>Configure sell thresholds and equipment type labels.</SheetDescription>
          </SheetHeader>
          <EquipmentSettingsPanel />
        </SheetContent>
      </Sheet>
    </div>
  );
}
