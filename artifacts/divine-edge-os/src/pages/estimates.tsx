import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ImportExportControls } from '@/components/data-io/ImportExportControls';
import {
  customFetch,
  useListEstimates, getListEstimatesQueryKey,
  useGetEstimate, getGetEstimateQueryKey,
  useCreateEstimate,
  useUpdateEstimate,
  useDeleteEstimate,
  useSendEstimate,
  useResendEstimate,
  useConvertEstimateToJob,
  useGetEstimatePipeline, getGetEstimatePipelineQueryKey,
  useListCustomers, getListCustomersQueryKey,
  useListUsers, getListUsersQueryKey,
  useListProperties, getListPropertiesQueryKey,
  useListEstimateTemplates, getListEstimateTemplatesQueryKey,
  useGetTenantSettings, getGetTenantSettingsQueryKey,
  useListInventoryItems, getListInventoryItemsQueryKey,
} from '@workspace/api-client-react';
import { useDebounce } from '@/hooks/use-debounce';
import { format } from 'date-fns';
import {
  Plus, FileText, DollarSign, TrendingUp, Send, Briefcase, Trash2,
  ChevronRight, ChevronDown, Eye, Clock, User, MapPin, CheckCircle2, XCircle, Phone, Mail, Globe, Building2, Printer, Search, Edit2, RefreshCw, Copy, X, Target, Package, Layers, Calendar, Loader2, Receipt,
} from 'lucide-react';
import { Link, useSearch, useLocation } from 'wouter';
import { printEstimate } from '@/lib/printUtils';
import { SendDocumentDialog } from '@/components/shared/SendDocumentDialog';
const STATUS_COLORS: Record<string, string> = {
  draft:    'bg-gray-100 text-gray-700 border-gray-200',
  sent:     'bg-blue-100 text-blue-700 border-blue-200',
  approved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  declined: 'bg-red-100 text-red-700 border-red-200',
  expired:  'bg-amber-100 text-amber-700 border-amber-200',
};

const VISIT_MODE_LABELS: Record<string, string> = {
  scheduled: 'Scheduled Appointment',
  drop_by:   'Drop By / Flexible',
  drive_by:  'Drive-By',
};

interface LineItem {
  id: string;
  description: string;
  qty: number;
  unitPrice: number;
  markup: number;
  discount: number;
  isOptional: boolean;
  optionalPitchLine: string;
  acceptedByCustomer: boolean;
  /** Items sharing the same non-empty groupId are mutually exclusive (radio set) */
  groupId?: string;
  /** Cost category used for the breakdown view. Defaults to 'labor'. */
  category?: 'labor' | 'parts' | 'other';
  // Catalog linking
  serviceId?: number;
  serviceName?: string;
  secondaryServiceId?: number;
  secondaryServiceName?: string;
  // Plan template linking
  planTemplateId?: number;
  planTemplateName?: string;
  planBillingCycle?: string;
}

interface CatalogService {
  id: number;
  name: string;
  basePrice: number;
  category: string | null;
}

interface CatalogPlan {
  id: number;
  name: string;
  price: number;
  billingCycle: string;
  description: string | null;
}

interface SupplyItem {
  inventoryItemId: number;
  name: string;
  quantity: number;
  unit: string;
}

function emptyItem(): LineItem {
  return { id: crypto.randomUUID(), description: '', qty: 1, unitPrice: 0, markup: 0, discount: 0, isOptional: false, optionalPitchLine: '', acceptedByCustomer: true };
}

function calcItem(item: LineItem) {
  const base = item.qty * item.unitPrice;
  const afterMarkup = base * (1 + item.markup / 100);
  return afterMarkup * (1 - item.discount / 100);
}

/** Returns the cost category for a line item, defaulting to 'labor'. */
function getItemCategory(item: LineItem): 'labor' | 'parts' | 'other' {
  return item.category ?? 'labor';
}

const CATEGORY_LABELS: Record<'labor' | 'parts' | 'other', string> = {
  labor: 'Labor',
  parts: 'Parts / Materials',
  other: 'Other',
};

// ── Inline Estimate Preview ──────────────────────────────────────────────────
function EstimatePreviewDialog({ estimate, settings, open, onClose }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  estimate: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings: any;
  open: boolean;
  onClose: () => void;
}) {
  const [showPreviewBreakdown, setShowPreviewBreakdown] = useState(false);
  const items = (estimate?.lineItems ?? []) as LineItem[];
  const required = items.filter(i => !i.isOptional);
  const optional = items.filter(i => i.isOptional);
  const total = items.reduce((s, i) => s + calcItem(i), 0);

  // Build category groups for preview breakdown
  const previewCatGroups = (['labor', 'parts', 'other'] as const)
    .map(key => ({ key, label: CATEGORY_LABELS[key], items: required.filter(i => getItemCategory(i) === key) }))
    .filter(g => g.items.length > 0);
  const apiBase = (() => {
    const base = import.meta.env.BASE_URL ?? '/';
    return base.endsWith('/') ? base.slice(0, -1) : base;
  })();

  if (!estimate) return null;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        <div className="bg-muted/30 min-h-full">
          <div className="max-w-2xl mx-auto p-6 space-y-5">
            {/* Branding header */}
            <div className="text-center space-y-2">
              <img
                src={`${apiBase}/api/public/tenants/${estimate.tenantId}/logo`}
                alt="Company logo"
                className="h-14 w-auto mx-auto object-contain"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
              {settings?.companyName && <h1 className="text-xl font-bold">{settings.companyName}</h1>}
              {settings?.businessTagline && <p className="text-xs text-muted-foreground italic">{settings.businessTagline}</p>}
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {settings?.businessPhone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{settings.businessPhone}</span>}
                {settings?.businessEmail && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{settings.businessEmail}</span>}
                {settings?.businessWebsite && <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{settings.businessWebsite}</span>}
              </div>
            </div>

            {/* Estimate header */}
            <div className="bg-white rounded-xl border p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">Estimate #{estimate.id}</h2>
                  <p className="text-sm text-muted-foreground" title={estimate.createdAt ? `Prepared on ${format(new Date(estimate.createdAt), 'EEEE, MMMM d, yyyy')}` : undefined}>Prepared {estimate.createdAt ? format(new Date(estimate.createdAt), 'MMMM d, yyyy') : ''}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[estimate.status] ?? ''}`}>{estimate.status}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {estimate.customerName && (
                  <div><p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Customer</p>{(estimate as any).customerId ? <a href={`${import.meta.env.BASE_URL}customers/${(estimate as any).customerId}`} className="font-medium text-primary hover:underline">{estimate.customerName}</a> : <p className="font-medium">{estimate.customerName}</p>}</div>
                )}
                {estimate.propertyAddress && (
                  <div><p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Property</p>{(estimate as any).propertyId ? <a href={`${import.meta.env.BASE_URL}properties/${(estimate as any).propertyId}`} className="font-medium text-primary hover:underline">{estimate.propertyAddress}</a> : <p>{estimate.propertyAddress}</p>}</div>
                )}
                {estimate.scheduledAt && (
                  <div><p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Scheduled</p><p>{format(new Date(estimate.scheduledAt), 'MMM d, yyyy h:mm a')}</p></div>
                )}
                {estimate.expiresAt && (
                  <div><p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Expires</p><p>{format(new Date(estimate.expiresAt), 'MMM d, yyyy')}</p></div>
                )}
              </div>
              {estimate.notes && <p className="text-sm text-muted-foreground italic border-t pt-3">{estimate.notes}</p>}
            </div>

            {/* Line items */}
            <div className="bg-white rounded-xl border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Services</h3>
                <button
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                  onClick={() => setShowPreviewBreakdown(v => !v)}
                  title={showPreviewBreakdown ? 'Collapse to total only' : 'Expand to see cost breakdown by category'}
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showPreviewBreakdown ? 'rotate-180' : ''}`} />
                  {showPreviewBreakdown ? 'Hide breakdown' : 'View breakdown'}
                </button>
              </div>

              {showPreviewBreakdown ? (
                <div className="space-y-3">
                  {previewCatGroups.map(cat => {
                    const catTotal = cat.items.reduce((s, i) => s + calcItem(i), 0);
                    return (
                      <div key={cat.key}>
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{cat.label}</span>
                          <span className="text-xs font-semibold text-muted-foreground">${catTotal.toFixed(2)}</span>
                        </div>
                        <div className="pl-3 border-l-2 border-muted space-y-2">
                          {cat.items.map(item => (
                            <div key={item.id} className="flex items-start justify-between gap-4 text-sm">
                              <div className="flex-1">
                                <p className="font-medium">{item.description || '—'}</p>
                                {(item.markup > 0 || item.discount > 0) && (
                                  <p className="text-xs text-muted-foreground">
                                    ${item.unitPrice.toFixed(2)} each{item.markup > 0 && ` + ${item.markup}% markup`}{item.discount > 0 && ` − ${item.discount}% off`}
                                  </p>
                                )}
                              </div>
                              <span className="font-medium shrink-0">${calcItem(item).toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {optional.length > 0 && (
                    <div className="pt-1">
                      <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">Optional Add-Ons</p>
                      <div className="space-y-1">
                        {optional.map(item => (
                          <div key={item.id} className="flex items-start justify-between gap-4 text-sm bg-amber-50/40 rounded p-2">
                            <div className="flex-1">
                              <p className="font-medium">{item.description || '—'}</p>
                              {item.optionalPitchLine && <p className="text-xs text-muted-foreground italic">{item.optionalPitchLine}</p>}
                            </div>
                            <span className="font-medium shrink-0">${calcItem(item).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="border-t pt-3 flex justify-between items-center font-bold">
                    <span>Total</span>
                    <span className="text-lg">${total.toFixed(2)}</span>
                  </div>
                </div>
              ) : (
                <div className="border-t pt-3 flex justify-between items-center font-bold">
                  <span>Total</span>
                  <span className="text-lg">${total.toFixed(2)}</span>
                </div>
              )}
            </div>

            <div className="flex justify-center gap-3 pb-4">
              <Button variant="outline" size="sm" className="gap-2" onClick={() => printEstimate(estimate as Record<string, unknown>, settings as Record<string, unknown>)}>
                <Printer className="w-3.5 h-3.5" /> Print / Save PDF
              </Button>
            </div>
            <p className="text-center text-xs text-muted-foreground pb-2">
              Staff preview — the customer sees this after you send the estimate.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function EstimatesPage() {
  const { canManageOffice } = useAuth();
  const qc = useQueryClient();
  const search = useSearch();
  const [, setLocation] = useLocation();

  const [statusFilter, setStatusFilter] = useState('');
  const [visitModeFilter, setVisitModeFilter] = useState('');
  const [estimateDateFrom, setEstimateDateFrom] = useState('');
  const [estimateDateTo, setEstimateDateTo] = useState('');
  const [estimateSort, setEstimateSort] = useState<'newest' | 'oldest' | 'customer' | 'expiring' | 'value_desc' | 'value_asc'>('newest');
  const [estimateSearch, setEstimateSearch] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState<number | ''>('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesVal, setNotesVal] = useState('');

  // Auto-select an estimate when navigated here with ?highlight=<id>
  // Also open create sheet when arriving via quick-add shortcut (?action=create)
  useEffect(() => {
    const params = new URLSearchParams(search);
    const highlight = params.get('highlight');
    if (highlight) {
      const numId = parseInt(highlight, 10);
      if (!Number.isNaN(numId)) setSelectedId(numId);
    }
    if (params.get('action') === 'create') {
      setCreateOpen(true);
      const custId = params.get('customerId');
      if (custId && !Number.isNaN(parseInt(custId, 10))) {
        setForm(f => ({ ...f, customerId: custId }));
      }
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [search]);

  // Per-form duration unit state — effects that reference `settings` are placed
  // after the `settings` query below.
  const [estimateDurationUnit, setEstimateDurationUnit] = useState<'minutes' | 'hours'>('minutes');
  const syncedEstimateDurationUnit = React.useRef(false);

  // Auto-populate expiresAt when the create dialog opens
  useEffect(() => {
    if (!createOpen) return;
    const days = (settings as any)?.estimateExpiryDays ?? 30;
    if (days > 0) {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + days);
      const yyyy = expiry.getFullYear();
      const mm = String(expiry.getMonth() + 1).padStart(2, '0');
      const dd = String(expiry.getDate()).padStart(2, '0');
      setForm(f => f.expiresAt ? f : { ...f, expiresAt: `${yyyy}-${mm}-${dd}` });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createOpen]);
  const [deleteDialogId, setDeleteDialogId] = useState<number | null>(null);
  const [sendDialogId, setSendDialogId] = useState<number | null>(null);
  const [sendExpiresAt, setSendExpiresAt] = useState('');

  // Form state for create
  const [form, setForm] = useState({
    customerId: '',
    propertyId: '',
    assigneeId: '',
    visitMode: 'scheduled',
    scheduledAt: '',
    expiresAt: '',
    notes: '',
    templateId: '',
    estimatedDurationMin: '',
    paymentRequirement: 'none',
    depositValue: '',
  });
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyItem()]);
  const [catalogServices, setCatalogServices] = useState<CatalogService[] | null>(null);
  const [catalogPlans, setCatalogPlans] = useState<CatalogPlan[] | null>(null);

  // Supplies state for create form
  const [createSupplies, setCreateSupplies] = useState<SupplyItem[]>([]);
  const [addingCreateSupply, setAddingCreateSupply] = useState(false);
  const [createSupplySearch, setCreateSupplySearch] = useState('');
  const debouncedCreateSupplySearch = useDebounce(createSupplySearch, 300);
  const [createSupplyQtys, setCreateSupplyQtys] = useState<Record<number, string>>({});

  const listParams = { ...(statusFilter ? { status: statusFilter } : {}), ...(assigneeFilter ? { assigneeId: assigneeFilter } : {}) };
  const { data: estimates, isLoading } = useListEstimates(listParams, {
    query: { queryKey: getListEstimatesQueryKey(listParams) },
  });
  const { data: pipeline } = useGetEstimatePipeline({ query: { queryKey: getGetEstimatePipelineQueryKey() } });
  const { data: selectedEstimate } = useGetEstimate(selectedId!, {
    query: { enabled: selectedId != null, queryKey: getGetEstimateQueryKey(selectedId!) },
  });
  const { data: customers } = useListCustomers({}, { query: { enabled: createOpen, queryKey: getListCustomersQueryKey({}) } });
  const { data: users } = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  const { data: properties } = useListProperties({}, { query: { enabled: createOpen, queryKey: getListPropertiesQueryKey({}) } });
  const { data: templates } = useListEstimateTemplates({ query: { enabled: createOpen, queryKey: getListEstimateTemplatesQueryKey() } });
  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });

  // Sync estimateDurationUnit to the tenant default on open; also catches settings
  // loading after the dialog is already open; never overwrites a deliberate user choice.
  useEffect(() => {
    if (createOpen) {
      syncedEstimateDurationUnit.current = false; // arm for this session
      if ((settings as any)?.durationUnit) {
        setEstimateDurationUnit((settings as any).durationUnit as 'minutes' | 'hours');
        syncedEstimateDurationUnit.current = true;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createOpen]);
  useEffect(() => {
    if (createOpen && (settings as any)?.durationUnit && !syncedEstimateDurationUnit.current) {
      setEstimateDurationUnit((settings as any).durationUnit as 'minutes' | 'hours');
      syncedEstimateDurationUnit.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(settings as any)?.durationUnit]);

  const { data: supplySearchItems } = useListInventoryItems(
    { q: debouncedCreateSupplySearch || undefined },
    { query: { enabled: addingCreateSupply, queryKey: getListInventoryItemsQueryKey({ q: debouncedCreateSupplySearch || undefined }) } }
  );

  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    setNotesVal(selectedEstimate?.notes ?? '');
    setEditingNotes(false);
    setEditingLineItems(false);
    setEditLineItemsList([]);
    setShowBreakdown(false); // collapse breakdown when switching estimates
  }, [selectedId]);

  // Load service catalog and plan templates when create sheet opens
  useEffect(() => {
    if (!createOpen) return;
    if (catalogServices === null) {
      customFetch<CatalogService[]>('/api/services?activeOnly=true')
        .then(d => setCatalogServices(d))
        .catch(() => setCatalogServices([]));
    }
    if (catalogPlans === null) {
      customFetch<CatalogPlan[]>('/api/plan-templates')
        .then(d => setCatalogPlans(d.filter((p: any) => p.isActive !== false)))
        .catch(() => setCatalogPlans([]));
    }
  }, [createOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const createEstimate = useCreateEstimate();
  const updateEstimate = useUpdateEstimate();
  const deleteEstimate = useDeleteEstimate();
  const sendEstimate = useSendEstimate();
  const resendEstimate = useResendEstimate();
  const convertToJob = useConvertEstimateToJob();

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListEstimatesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetEstimatePipelineQueryKey() });
    if (selectedId) qc.invalidateQueries({ queryKey: getGetEstimateQueryKey(selectedId) });
  }

  function applyTemplate(templateId: string) {
    const tmpl = templates?.find(t => String(t.id) === templateId);
    if (tmpl && tmpl.lineItems) {
      setLineItems((tmpl.lineItems as LineItem[]).map(i => ({ ...i, id: crypto.randomUUID() })));
    }
    setForm(f => ({ ...f, templateId }));
  }

  const subtotal = lineItems.reduce((sum, i) => sum + calcItem(i), 0);

  function handleCreate() {
    createEstimate.mutate({
      data: {
        customerId: form.customerId ? parseInt(form.customerId, 10) : undefined,
        propertyId: form.propertyId ? parseInt(form.propertyId, 10) : undefined,
        assigneeId: form.assigneeId ? parseInt(form.assigneeId, 10) : undefined,
        visitMode: form.visitMode as 'scheduled' | 'drop_by' | 'drive_by',
        scheduledAt: form.scheduledAt || undefined,
        expiresAt: form.expiresAt || undefined,
        notes: form.notes || undefined,
        templateId: form.templateId ? parseInt(form.templateId, 10) : undefined,
        lineItems: lineItems.map(i => ({
          id: i.id,
          description: i.description,
          qty: i.qty,
          unitPrice: i.unitPrice,
          markup: i.markup,
          discount: i.discount,
          isOptional: i.isOptional,
          optionalPitchLine: i.optionalPitchLine || null,
          groupId: i.groupId || null,
          category: i.category ?? 'labor',
          acceptedByCustomer: !i.isOptional,
          serviceId: i.serviceId ?? null,
          serviceName: i.serviceName ?? null,
          secondaryServiceId: i.secondaryServiceId ?? null,
          secondaryServiceName: i.secondaryServiceName ?? null,
          planTemplateId: i.planTemplateId ?? null,
          planTemplateName: i.planTemplateName ?? null,
          planBillingCycle: i.planBillingCycle ?? null,
        })),
        estimatedDurationMin: form.estimatedDurationMin
          ? Math.round(parseFloat(form.estimatedDurationMin) * (estimateDurationUnit === 'hours' ? 60 : 1))
          : undefined,
        suppliesNeeded: createSupplies.length > 0 ? createSupplies : undefined,
        paymentRequirement: form.paymentRequirement as 'none' | 'full' | 'deposit_pct' | 'deposit_fixed',
        depositValue: form.paymentRequirement !== 'none' && form.depositValue ? parseFloat(form.depositValue) : undefined,
      },
    }, {
      onSuccess: (e) => {
        toast.success('Estimate created');
        invalidate();
        setCreateOpen(false);
        setLineItems([emptyItem()]);
        setCreateSupplies([]);
        setAddingCreateSupply(false);
        setCreateSupplySearch('');
        setForm({ customerId: '', propertyId: '', assigneeId: '', visitMode: 'scheduled', scheduledAt: '', expiresAt: '', notes: '', templateId: '', estimatedDurationMin: '', paymentRequirement: 'none', depositValue: '' });
        setSelectedId(e.id);
      },
      onError: () => toast.error('Failed to create estimate'),
    });
  }

  function handleResend(id: number) {
    resendEstimate.mutate({ id }, {
      onSuccess: (r) => {
        const result = r as typeof r & { emailSent?: boolean; emailError?: string | null };
        if (result.emailSent) {
          toast.success('Estimate re-sent — customer emailed again');
        } else if (result.emailError) {
          toast.warning('Resend attempted, but email failed', { description: result.emailError });
        } else {
          toast.success('Resend attempted');
        }
      },
      onError: () => toast.error('Failed to resend estimate'),
    });
  }

  function openSendDialog(estimate: NonNullable<typeof estimates>[number]) {
    if (estimate.expiresAt) {
      const d = new Date(estimate.expiresAt);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      setSendExpiresAt(`${yyyy}-${mm}-${dd}`);
    } else {
      const days = (settings as any)?.estimateExpiryDays ?? 30;
      const exp = new Date();
      exp.setDate(exp.getDate() + days);
      setSendExpiresAt(`${exp.getFullYear()}-${String(exp.getMonth() + 1).padStart(2, '0')}-${String(exp.getDate()).padStart(2, '0')}`);
    }
    setSendDialogId(estimate.id);
  }

  function handleSend(id: number) {
    sendEstimate.mutate({ id }, {
      onSuccess: (r) => {
        const result = r as typeof r & { emailSent?: boolean; emailError?: string | null };
        if (result.emailSent) {
          toast.success('Estimate sent — customer emailed');
        } else if (result.emailError) {
          toast.warning('Estimate sent, but email failed', { description: result.emailError });
        } else {
          toast.success('Estimate sent');
        }
        setSendDialogId(null);
        invalidate();
      },
      onError: () => toast.error('Failed to send estimate'),
    });
  }

  // Wrapped version for SendDocumentDialog (doesn't auto-close the dialog)
  async function handleSendForDialog(): Promise<void> {
    if (!sendDialogId) return;
    if (sendExpiresAt) {
      try {
        await fetch(`${import.meta.env.BASE_URL}api/estimates/${sendDialogId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...(window as any).__apiHeaders },
          body: JSON.stringify({ expiresAt: sendExpiresAt }),
        });
      } catch { /* non-fatal */ }
    }
    return new Promise<void>((resolve, reject) => {
      sendEstimate.mutate({ id: sendDialogId }, {
        onSuccess: (r) => {
          const result = r as typeof r & { emailSent?: boolean; emailError?: string | null };
          if (result.emailSent) {
            toast.success('Estimate sent — customer emailed');
          } else if (result.emailError) {
            toast.warning('Estimate sent, but email failed', { description: result.emailError });
          } else {
            toast.success('Estimate sent');
          }
          invalidate();
          resolve();
        },
        onError: () => { toast.error('Failed to send estimate'); reject(new Error('Failed')); },
      });
    });
  }

  // ── Line item editing (estimate detail panel) ────────────────────────────────
  const [editingLineItems, setEditingLineItems] = useState(false);
  const [editLineItemsList, setEditLineItemsList] = useState<LineItem[]>([]);

  function startEditLineItems() {
    if (!selectedEstimate) return;
    setEditLineItemsList(
      ((selectedEstimate.lineItems ?? []) as LineItem[]).map(i => ({ ...i, id: (i as any).id ?? crypto.randomUUID() }))
    );
    setEditingLineItems(true);
  }
  function cancelEditLineItems() { setEditingLineItems(false); setEditLineItemsList([]); }
  function saveEditLineItems() {
    if (!selectedEstimate) return;
    const total = editLineItemsList.reduce((s, i) => s + calcItem(i), 0);
    updateEstimate.mutate(
      { id: selectedEstimate.id, data: { lineItems: editLineItemsList, totalAmount: total } as any },
      {
        onSuccess: () => {
          toast.success('Line items saved');
          setEditingLineItems(false);
          qc.invalidateQueries({ queryKey: getListEstimatesQueryKey() });
          qc.invalidateQueries({ queryKey: getGetEstimateQueryKey(selectedEstimate.id) });
        },
        onError: () => toast.error('Failed to save line items'),
      }
    );
  }

  // ── Schedule-job dialog state ────────────────────────────────────────────────
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [scheduleEstimateId, setScheduleEstimateId] = useState<number | null>(null);
  const [scheduleForm, setScheduleForm] = useState({ title: '', scheduledAt: '', assigneeId: '', invoiceNow: true });
  const [converting, setConverting] = useState(false);

  function openScheduleDialog(estimate: any) {
    const defaultTitle = estimate.customerName ? `Service for ${estimate.customerName}` : `Job from Estimate #${estimate.id}`;
    setScheduleForm({ title: defaultTitle, scheduledAt: '', assigneeId: estimate.assigneeId ? String(estimate.assigneeId) : '', invoiceNow: true });
    setScheduleEstimateId(estimate.id);
    setScheduleDialogOpen(true);
  }

  async function handleConvertWithSchedule() {
    if (!scheduleEstimateId) return;
    setConverting(true);
    try {
      const r = await customFetch<{ jobId: number; invoiceId: number | null }>(`/api/estimates/${scheduleEstimateId}/convert`, {
        method: 'POST',
        body: JSON.stringify({
          title: scheduleForm.title || undefined,
          scheduledAt: scheduleForm.scheduledAt || undefined,
          assigneeId: scheduleForm.assigneeId ? parseInt(scheduleForm.assigneeId) : undefined,
          invoiceNow: scheduleForm.invoiceNow,
        }),
      });
      toast.success(`Job #${r.jobId} scheduled`, {
        action: { label: 'View Job', onClick: () => setLocation(`/schedule?jobId=${r.jobId}`) },
      });
      if (r.invoiceId) {
        toast.info('Draft invoice created — review and send it from Billing');
      }
      invalidate();
      setScheduleDialogOpen(false);
      setScheduleEstimateId(null);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to schedule job');
    } finally {
      setConverting(false);
    }
  }

  function handleDelete(id: number) {
    deleteEstimate.mutate({ id }, {
      onSuccess: () => { toast.success('Deleted'); invalidate(); setDeleteDialogId(null); if (selectedId === id) setSelectedId(null); },
      onError: () => toast.error('Failed to delete'),
    });
  }

  function updateLineItem(idx: number, patch: Partial<LineItem>) {
    setLineItems(items => items.map((item, i) => i === idx ? { ...item, ...patch } : item));
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Estimates</h1>
          <p className="text-muted-foreground mt-1">Manage price proposals and convert them to jobs.{Array.isArray(estimates) && (estimates as any[]).length > 0 ? ` · ${(estimates as any[]).length} total` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportControls
            entity="estimates"
            entityLabel="Estimates"
            exportQuery={{ status: statusFilter || undefined }}
            onImportComplete={() => qc.invalidateQueries({ queryKey: getListEstimatesQueryKey() })}
          />
          {canManageOffice && (
            <Button title="Create a new estimate" onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" /> New Estimate
            </Button>
          )}
        </div>
      </div>

      {/* Pipeline summary */}
      {pipeline && (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100">
                  <DollarSign className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Pipeline Value</p>
                  <p className="text-2xl font-bold">${(pipeline.pipelineValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  {(pipeline as any).sentCount > 0 && <p className="text-xs text-muted-foreground mt-0.5">{(pipeline as any).sentCount} sent</p>}
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-100">
                  <TrendingUp className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Upsell Revenue</p>
                  <p className="text-2xl font-bold">${(pipeline.upsellRevenue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  {(pipeline as any).approvedCount > 0 && <p className="text-xs text-emerald-600 mt-0.5">{(pipeline as any).approvedCount} approved</p>}
                </div>
              </div>
            </CardContent>
          </Card>
          {(() => { const sent = (pipeline as any).sentCount ?? 0; const approved = (pipeline as any).approvedCount ?? 0; if (sent === 0) return null; const rate = Math.round((approved / sent) * 100); return (
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-100">
                    <Target className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Win Rate</p>
                    <p className="text-2xl font-bold">{rate}%</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{approved} of {sent} sent</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ); })()}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={estimateSearch}
            onChange={e => setEstimateSearch(e.target.value)}
            placeholder="Search estimates…"
            title="Search by customer name, property address, or estimate number"
            className="h-9 text-sm pl-7 w-52"
          />
          {estimateSearch && <button onClick={() => setEstimateSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
        </div>
        <Select value={statusFilter || 'all'} onValueChange={v => setStatusFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-44" title="Filter by estimate status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="declined">Declined</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
        <Select value={visitModeFilter || 'all'} onValueChange={v => setVisitModeFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-36" title="Filter by visit mode (one-time, recurring, drive-by)">
            <SelectValue placeholder="All visit modes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Visit Modes</SelectItem>
            <SelectItem value="one_time">One-time</SelectItem>
            <SelectItem value="recurring">Recurring</SelectItem>
            <SelectItem value="drive_by">Drive-by</SelectItem>
          </SelectContent>
        </Select>
        {canManageOffice && (
          <Select value={assigneeFilter ? String(assigneeFilter) : 'all'} onValueChange={v => setAssigneeFilter(v === 'all' ? '' : Number(v))}>
            <SelectTrigger className="w-40" title="Filter by assigned salesperson">
              <SelectValue placeholder="All assignees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Assignees</SelectItem>
              {(users ?? []).filter(u => u.role !== 'technician').map(u => (
                <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value="" onValueChange={v => {
          const now = new Date(); const y = now.getFullYear(); const m = now.getMonth();
          if (v === 'thisMonth') { setEstimateDateFrom(new Date(y, m, 1).toISOString().slice(0, 10)); setEstimateDateTo(new Date(y, m + 1, 0).toISOString().slice(0, 10)); }
          else if (v === 'lastMonth') { setEstimateDateFrom(new Date(y, m - 1, 1).toISOString().slice(0, 10)); setEstimateDateTo(new Date(y, m, 0).toISOString().slice(0, 10)); }
          else if (v === 'thisYear') { setEstimateDateFrom(`${y}-01-01`); setEstimateDateTo(`${y}-12-31`); }
          else if (v === 'last30') { setEstimateDateFrom(new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10)); setEstimateDateTo(now.toISOString().slice(0, 10)); }
        }}>
          <SelectTrigger className="h-9 w-32 text-sm" title="Select a quick date range preset"><SelectValue placeholder="Quick…" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="last30">Last 30 days</SelectItem>
            <SelectItem value="thisMonth">This Month</SelectItem>
            <SelectItem value="lastMonth">Last Month</SelectItem>
            <SelectItem value="thisYear">This Year</SelectItem>
          </SelectContent>
        </Select>
        <input
          type="date"
          value={estimateDateFrom}
          onChange={e => setEstimateDateFrom(e.target.value)}
          className="h-9 text-sm px-2.5 rounded-md border border-input bg-background"
          title="From date"
        />
        <input
          type="date"
          value={estimateDateTo}
          onChange={e => setEstimateDateTo(e.target.value)}
          className="h-9 text-sm px-2.5 rounded-md border border-input bg-background"
          title="To date"
        />
        <Select value={estimateSort} onValueChange={v => setEstimateSort(v as typeof estimateSort)}>
          <SelectTrigger className="w-36" title="Sort estimates"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
            <SelectItem value="customer">Customer A–Z</SelectItem>
            <SelectItem value="expiring">Expiring soon</SelectItem>
            <SelectItem value="value_desc">Highest value</SelectItem>
            <SelectItem value="value_asc">Lowest value</SelectItem>
          </SelectContent>
        </Select>
        {(statusFilter || visitModeFilter || assigneeFilter || estimateDateFrom || estimateDateTo) && (
          <Button variant="ghost" size="sm" title="Reset all active filters" onClick={() => { setStatusFilter(''); setVisitModeFilter(''); setAssigneeFilter(''); setEstimateDateFrom(''); setEstimateDateTo(''); }}>Clear filters</Button>
        )}
      </div>

      {/* Estimates list */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground">Loading estimates...</div>
          ) : !estimates?.length ? (
            <div className="py-12 text-center text-muted-foreground">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No estimates yet.</p>
              {canManageOffice && <p className="text-sm mt-1">Create your first estimate to start the proposal workflow.</p>}
            </div>
          ) : (
            <div className="divide-y">
              {(estimateSearch.trim() || visitModeFilter || estimateDateFrom || estimateDateTo || !!statusFilter || !!assigneeFilter) && (() => {
                const n = (estimates ?? []).filter(e => !estimateSearch.trim() || `#${e.id}`.includes(estimateSearch) || (e.customerName ?? '').toLowerCase().includes(estimateSearch.toLowerCase()) || (e.propertyAddress ?? '').toLowerCase().includes(estimateSearch.toLowerCase())).filter(e => !visitModeFilter || e.visitMode === visitModeFilter).filter(e => !estimateDateFrom || (e.createdAt ?? '') >= estimateDateFrom).filter(e => !estimateDateTo || (e.createdAt ?? '') <= estimateDateTo + 'T23:59:59').filter(e => !statusFilter || e.status === statusFilter).filter(e => !assigneeFilter || (e as any).assigneeId === assigneeFilter).length;
                return <div key="est-count" className="px-5 py-2 text-xs text-muted-foreground bg-muted/20" title={`${n} of ${(estimates ?? []).length} estimates match the active filters`}>Showing {n} of {(estimates ?? []).length} estimate{(estimates ?? []).length !== 1 ? 's' : ''}</div>;
              })()}
              {(estimates ?? [])
                .filter(e => !estimateSearch.trim() || `#${e.id}`.includes(estimateSearch) || (e.customerName ?? '').toLowerCase().includes(estimateSearch.toLowerCase()) || (e.propertyAddress ?? '').toLowerCase().includes(estimateSearch.toLowerCase()))
                .filter(e => !visitModeFilter || e.visitMode === visitModeFilter)
                .filter(e => !estimateDateFrom || (e.createdAt ?? '') >= estimateDateFrom)
                .filter(e => !estimateDateTo || (e.createdAt ?? '') <= estimateDateTo + 'T23:59:59')
                .sort((a, b) => {
                  if (estimateSort === 'oldest') return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
                  if (estimateSort === 'customer') return (a.customerName ?? '').localeCompare(b.customerName ?? '');
                  if (estimateSort === 'expiring') return new Date((a as any).expiresAt ?? '9999').getTime() - new Date((b as any).expiresAt ?? '9999').getTime();
                  if (estimateSort === 'value_desc') return ((b as any).total ?? 0) - ((a as any).total ?? 0);
                  if (estimateSort === 'value_asc') return ((a as any).total ?? 0) - ((b as any).total ?? 0);
                  return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(); // newest
                })
                .map(est => (
                <div
                  key={est.id}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-muted/40 cursor-pointer transition-colors"
                  onClick={() => setSelectedId(est.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">Estimate #{est.id}</span>
                      <Badge className={`capitalize text-xs ${STATUS_COLORS[est.status] ?? ''}`} variant="outline" title={`Estimate status: ${est.status}`}>
                        {est.status}
                      </Badge>
                      <Badge variant="outline" className="text-xs text-muted-foreground border-muted" title={`Visit mode: ${VISIT_MODE_LABELS[est.visitMode] ?? est.visitMode}`}>
                        {VISIT_MODE_LABELS[est.visitMode] ?? est.visitMode}
                      </Badge>
                      {est.status === 'sent' && (est as any).expiresAt && (() => {
                        const daysLeft = Math.ceil((new Date((est as any).expiresAt).getTime() - Date.now()) / 86400000);
                        if (daysLeft <= 0) return <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-300">Expired</Badge>;
                        if (daysLeft <= 5) return <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300">Expires in {daysLeft}d</Badge>;
                        return null;
                      })()}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                      {est.customerName && (
                        (est as any).customerId
                          ? <button className="flex items-center gap-1 text-primary hover:underline" title={`View ${est.customerName}`} onClick={e => { e.stopPropagation(); setLocation(`/customers/${(est as any).customerId}`); }}><User className="w-3 h-3" />{est.customerName}</button>
                          : <span className="flex items-center gap-1"><User className="w-3 h-3" />{est.customerName}</span>
                      )}
                      {est.propertyAddress && <span className="flex items-center gap-1" title={est.propertyAddress}><MapPin className="w-3 h-3" />{est.propertyAddress}</span>}
                      {est.scheduledAt && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{format(new Date(est.scheduledAt), 'MMM d, yyyy')}</span>}
                      {(est as any).assigneeName && <span className="flex items-center gap-1 text-muted-foreground" title={`Assigned to: ${(est as any).assigneeName}`}><User className="w-3 h-3" />{(est as any).assigneeName}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold" title={`Total: $${(est.total ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}>${(est.total ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                    <p className="text-xs text-muted-foreground" title={format(new Date(est.createdAt), 'EEEE, MMMM d, yyyy')}>{format(new Date(est.createdAt), 'MMM d')}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Estimate Sheet */}
      <Sheet open={createOpen} onOpenChange={open => { if (!open) { setCreateOpen(false); setLineItems([emptyItem()]); } }}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>New Estimate</SheetTitle>
            <SheetDescription>Build a price proposal for a customer.</SheetDescription>
          </SheetHeader>

          <div className="space-y-5 pb-8">
            {/* Template picker */}
            {templates && templates.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Apply Template</label>
                <Select value={form.templateId} onValueChange={applyTemplate}>
                  <SelectTrigger title="Apply a saved estimate template to pre-fill line items and settings"><SelectValue placeholder="No template" /></SelectTrigger>
                  <SelectContent>
                    {templates.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Customer</label>
                <Select value={form.customerId} onValueChange={v => setForm(f => ({ ...f, customerId: v }))}>
                  <SelectTrigger title="Select the customer this estimate is for"><SelectValue placeholder="Select customer..." /></SelectTrigger>
                  <SelectContent>{(customers?.items ?? []).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Assign To</label>
                <Select value={form.assigneeId} onValueChange={v => setForm(f => ({ ...f, assigneeId: v }))}>
                  <SelectTrigger title="Assign this estimate to a staff member"><SelectValue placeholder="Select assignee..." /></SelectTrigger>
                  <SelectContent>{(users ?? []).map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            {form.customerId && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Property <span className="text-muted-foreground font-normal">(optional)</span></label>
                <Select value={form.propertyId} onValueChange={v => setForm(f => ({ ...f, propertyId: v }))}>
                  <SelectTrigger title="Select the property where work will be performed"><SelectValue placeholder="Select property..." /></SelectTrigger>
                  <SelectContent>
                    {((properties as any)?.items ?? properties ?? [])
                      .filter((p: any) => String(p.customerId) === form.customerId)
                      .map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.address || `Property #${p.id}`}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Visit Mode</label>
                <Select value={form.visitMode} onValueChange={v => setForm(f => ({ ...f, visitMode: v }))}>
                  <SelectTrigger title="How the technician will visit the property for this estimate"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="scheduled">Scheduled Appointment</SelectItem>
                    <SelectItem value="drop_by">Drop By / Flexible</SelectItem>
                    <SelectItem value="drive_by">Drive-By</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.visitMode === 'scheduled' && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Scheduled At</label>
                  <Input type="datetime-local" title="Date and time the estimate visit is scheduled" value={form.scheduledAt} onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Expires At</label>
              <Input type="date" title="Date after which this estimate is no longer valid" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Estimated Duration</label>
                <div className="flex gap-1.5">
                  <Input
                    type="number"
                    min={0}
                    step={estimateDurationUnit === 'minutes' ? 15 : 0.5}
                    placeholder={estimateDurationUnit === 'minutes' ? '90' : '1.5'}
                    title="Expected job duration — carries to the job when the estimate is accepted"
                    value={form.estimatedDurationMin}
                    onChange={e => setForm(f => ({ ...f, estimatedDurationMin: e.target.value }))}
                    className="flex-1"
                  />
                  <Select
                    value={estimateDurationUnit}
                    onValueChange={v => setEstimateDurationUnit(v as 'minutes' | 'hours')}
                  >
                    <SelectTrigger className="w-24" title="Duration unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minutes">min</SelectItem>
                      <SelectItem value="hours">hrs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Supplies needed */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5 text-muted-foreground" /> Supplies Needed
                  {createSupplies.length > 0 && <Badge variant="secondary" className="h-4 px-1 text-[10px]">{createSupplies.length}</Badge>}
                </label>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setAddingCreateSupply(true); setCreateSupplySearch(''); setCreateSupplyQtys({}); }}>
                  <Plus className="w-3 h-3" /> Add
                </Button>
              </div>
              {addingCreateSupply && (
                <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      className="w-full pl-8 pr-8 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                      placeholder="Search inventory..."
                      value={createSupplySearch}
                      onChange={e => setCreateSupplySearch(e.target.value)}
                      autoFocus
                    />
                    {createSupplySearch && <button onClick={() => setCreateSupplySearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
                  </div>
                  {supplySearchItems && supplySearchItems.length > 0 && (
                    <div className="rounded-md border divide-y text-sm max-h-40 overflow-y-auto">
                      {supplySearchItems.slice(0, 8).map(item => (
                        <div key={item.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{item.name}</div>
                            <div className="text-xs text-muted-foreground">{item.quantity} {item.unit} in stock</div>
                          </div>
                          <div className="flex items-center gap-1">
                            <input
                              type="number" min={1}
                              className="w-14 text-xs border rounded px-1.5 py-1 text-right"
                              value={createSupplyQtys[item.id] ?? '1'}
                              onChange={e => setCreateSupplyQtys(prev => ({ ...prev, [item.id]: e.target.value }))}
                              onClick={e => e.stopPropagation()}
                            />
                            <Button size="sm" className="h-6 px-2 text-xs" onClick={() => {
                              const qty = parseFloat(createSupplyQtys[item.id] ?? '1');
                              if (isNaN(qty) || qty <= 0) { toast.error('Enter a valid quantity'); return; }
                              const existing = createSupplies.find(s => s.inventoryItemId === item.id);
                              setCreateSupplies(existing
                                ? createSupplies.map(s => s.inventoryItemId === item.id ? { ...s, quantity: s.quantity + qty } : s)
                                : [...createSupplies, { inventoryItemId: item.id, name: item.name, quantity: qty, unit: item.unit ?? '' }]
                              );
                              setAddingCreateSupply(false);
                              setCreateSupplySearch('');
                            }}>Add</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {createSupplySearch && supplySearchItems?.length === 0 && (
                    <p className="text-xs text-muted-foreground">No items found for "{createSupplySearch}"</p>
                  )}
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setAddingCreateSupply(false)}>Cancel</Button>
                </div>
              )}
              {createSupplies.length > 0 && (
                <div className="rounded-lg border divide-y text-sm">
                  {createSupplies.map((s, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2">
                      <div>
                        <span className="font-medium">{s.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">{s.quantity} {s.unit}</span>
                      </div>
                      <button onClick={() => setCreateSupplies(createSupplies.filter((_, idx) => idx !== i))} className="text-muted-foreground/40 hover:text-destructive">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes</label>
              <Textarea rows={2} title="Internal notes or scope of work (not shown on the customer-facing estimate)" placeholder="Internal notes or scope..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            {/* Payment on acceptance */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-muted-foreground" />
                <label className="text-sm font-medium">Payment on acceptance</label>
              </div>
              <Select value={form.paymentRequirement} onValueChange={v => setForm(f => ({ ...f, paymentRequirement: v, depositValue: '' }))}>
                <SelectTrigger title="Choose what payment is required when the customer accepts this estimate">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None — accept without payment</SelectItem>
                  <SelectItem value="full">Full payment upfront</SelectItem>
                  <SelectItem value="deposit_pct">Deposit — % of total</SelectItem>
                  <SelectItem value="deposit_fixed">Deposit — fixed amount</SelectItem>
                </SelectContent>
              </Select>
              {(form.paymentRequirement === 'deposit_pct' || form.paymentRequirement === 'deposit_fixed') && (
                <div className="flex items-center gap-2">
                  {form.paymentRequirement === 'deposit_pct' && <span className="text-sm text-muted-foreground">%</span>}
                  {form.paymentRequirement === 'deposit_fixed' && <span className="text-sm text-muted-foreground">$</span>}
                  <Input
                    type="number"
                    min={0}
                    step={form.paymentRequirement === 'deposit_pct' ? 1 : 0.01}
                    max={form.paymentRequirement === 'deposit_pct' ? 100 : undefined}
                    placeholder={form.paymentRequirement === 'deposit_pct' ? 'e.g. 25' : 'e.g. 150.00'}
                    value={form.depositValue}
                    onChange={e => setForm(f => ({ ...f, depositValue: e.target.value }))}
                    className="flex-1"
                    title={form.paymentRequirement === 'deposit_pct' ? 'Percentage of estimate total due on acceptance' : 'Fixed dollar amount due on acceptance'}
                  />
                  <span className="text-xs text-muted-foreground">{form.paymentRequirement === 'deposit_pct' ? 'of total' : 'USD'}</span>
                </div>
              )}
              {form.paymentRequirement !== 'none' && (
                <p className="text-xs text-muted-foreground">
                  {form.paymentRequirement === 'full' && 'Customer will be prompted to pay the full estimate total when they accept.'}
                  {form.paymentRequirement === 'deposit_pct' && `Customer pays ${form.depositValue || '?'}% of the total as a deposit when accepting.`}
                  {form.paymentRequirement === 'deposit_fixed' && `Customer pays $${form.depositValue || '?'} as a deposit when accepting.`}
                  {' '}Requires Stripe to be enabled.
                </p>
              )}
            </div>

            <Separator />

            {/* Line items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-sm">Line Items</h3>
                <div className="flex items-center gap-2">
                  {/* Add plan as line item */}
                  {(catalogPlans ?? []).length > 0 && (
                    <Select
                      value=""
                      onValueChange={planId => {
                        const plan = catalogPlans?.find(p => String(p.id) === planId);
                        if (!plan) return;
                        setLineItems(items => [...items, {
                          ...emptyItem(),
                          description: plan.name + (plan.description ? ` — ${plan.description}` : ''),
                          unitPrice: plan.price,
                          planTemplateId: plan.id,
                          planTemplateName: plan.name,
                          planBillingCycle: plan.billingCycle,
                        }]);
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs gap-1 w-auto px-2.5" title="Add a service plan as a line item">
                        <Package className="w-3.5 h-3.5 shrink-0" />
                        <span>Add Plan</span>
                      </SelectTrigger>
                      <SelectContent>
                        {(catalogPlans ?? []).map(p => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            <span>{p.name}</span>
                            <span className="ml-2 text-muted-foreground">${p.price.toFixed(2)}/{p.billingCycle}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setLineItems(i => [...i, emptyItem()])}>
                    <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Item
                  </Button>
                </div>
              </div>

              {lineItems.map((item, idx) => {
                const isPlan = !!item.planTemplateId;
                const hasPrimary = !!item.serviceId;
                return (
                  <div key={item.id} className={`rounded-lg border p-4 space-y-3 ${item.isOptional ? 'border-dashed border-amber-300 bg-amber-50/50' : ''} ${isPlan ? 'border-violet-200 bg-violet-50/30' : ''} ${item.secondaryServiceId && !isPlan ? 'border-indigo-200 bg-indigo-50/20' : ''}`}>

                    {/* Catalog picker row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Primary service picker */}
                      <Select
                        value={item.serviceId ? String(item.serviceId) : '__custom__'}
                        onValueChange={v => {
                          if (v === '__custom__') {
                            updateLineItem(idx, { serviceId: undefined, serviceName: undefined, secondaryServiceId: undefined, secondaryServiceName: undefined });
                          } else {
                            const svc = catalogServices?.find(s => String(s.id) === v);
                            if (!svc) return;
                            const sec = item.secondaryServiceId ? catalogServices?.find(s => s.id === item.secondaryServiceId) : undefined;
                            const desc = sec ? `${svc.name} + ${sec.name}` : svc.name;
                            const price = svc.basePrice + (sec?.basePrice ?? 0);
                            updateLineItem(idx, { serviceId: svc.id, serviceName: svc.name, description: desc, unitPrice: price });
                          }
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs flex-1 min-w-[140px]" title="Pick a service from the catalog — auto-fills description and price">
                          <SelectValue placeholder="Custom / pick service..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__custom__">Custom line item</SelectItem>
                          {(catalogServices ?? []).map(s => (
                            <SelectItem key={s.id} value={String(s.id)}>
                              {s.name}
                              <span className="ml-2 text-muted-foreground">${s.basePrice.toFixed(2)}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Secondary (bundle) service picker — only shown when a primary is selected */}
                      {hasPrimary && (
                        <Select
                          value={item.secondaryServiceId ? String(item.secondaryServiceId) : '__none__'}
                          onValueChange={v => {
                            const svc1 = catalogServices?.find(s => s.id === item.serviceId);
                            if (v === '__none__') {
                              updateLineItem(idx, {
                                secondaryServiceId: undefined, secondaryServiceName: undefined,
                                description: svc1?.name ?? item.description,
                                unitPrice: svc1?.basePrice ?? item.unitPrice,
                              });
                            } else {
                              const svc2 = catalogServices?.find(s => String(s.id) === v);
                              if (!svc2) return;
                              updateLineItem(idx, {
                                secondaryServiceId: svc2.id,
                                secondaryServiceName: svc2.name,
                                description: `${svc1?.name ?? item.serviceName} + ${svc2.name}`,
                                unitPrice: (svc1?.basePrice ?? 0) + svc2.basePrice,
                              });
                            }
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs w-48" title="Bundle a second service into this line item — both services appear as one combined line">
                            <Layers className="w-3 h-3 mr-1 text-indigo-500 shrink-0" />
                            <SelectValue placeholder="+ Bundle service" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">No bundle</SelectItem>
                            {(catalogServices ?? []).filter(s => s.id !== item.serviceId).map(s => (
                              <SelectItem key={s.id} value={String(s.id)}>
                                + {s.name}
                                <span className="ml-1 text-muted-foreground">${s.basePrice.toFixed(2)}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}

                      {/* Badges */}
                      {item.secondaryServiceId && (
                        <Badge variant="outline" className="text-[10px] px-1.5 text-indigo-600 border-indigo-300 shrink-0">bundled</Badge>
                      )}
                      {isPlan && (
                        <Badge variant="outline" className="text-[10px] px-1.5 text-violet-600 border-violet-300 shrink-0 gap-0.5">
                          <Package className="w-2.5 h-2.5" /> plan
                        </Badge>
                      )}

                      <Button variant="ghost" size="sm" className="text-muted-foreground h-8 w-8 p-0 shrink-0 ml-auto" onClick={() => setLineItems(i => i.filter((_, j) => j !== idx))} disabled={lineItems.length === 1}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>

                    {/* Description */}
                    <Input title="Line item description shown to the customer" placeholder="Description" value={item.description} onChange={e => updateLineItem(idx, { description: e.target.value })} />

                    {/* Qty / Price / Markup / Discount */}
                    <div className="grid grid-cols-4 gap-2">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Qty</label>
                        <Input type="number" min={1} step={1} title="Number of units" value={item.qty} onChange={e => updateLineItem(idx, { qty: parseFloat(e.target.value) || 1 })} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Unit Price</label>
                        <Input type="number" min={0} step={0.01} title="Price per unit" value={item.unitPrice} onChange={e => updateLineItem(idx, { unitPrice: parseFloat(e.target.value) || 0 })} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Markup %</label>
                        <Input type="number" min={0} step={1} title="Markup percentage added on top of unit price" value={item.markup} onChange={e => updateLineItem(idx, { markup: parseFloat(e.target.value) || 0 })} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Discount %</label>
                        <Input type="number" min={0} step={1} title="Discount percentage subtracted from the marked-up price" value={item.discount} onChange={e => updateLineItem(idx, { discount: parseFloat(e.target.value) || 0 })} />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <input type="checkbox" checked={item.isOptional} onChange={e => updateLineItem(idx, { isOptional: e.target.checked })} className="rounded" />
                        Mark as Optional (Add-On)
                      </label>
                      <Select value={item.category ?? 'labor'} onValueChange={v => updateLineItem(idx, { category: v as LineItem['category'] })}>
                        <SelectTrigger className="h-7 text-xs w-36" title="Cost category shown in breakdown view">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="labor">Labor</SelectItem>
                          <SelectItem value="parts">Parts / Materials</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <span className="ml-auto text-sm font-medium" title={`Line total: $${calcItem(item).toFixed(2)}`}>${calcItem(item).toFixed(2)}</span>
                    </div>
                    {item.isOptional && (
                      <>
                        <Input title="Upsell pitch line shown to the customer when they view this estimate" placeholder="Pitch line (e.g. While we're there — trim your hedges for $45)" value={item.optionalPitchLine} onChange={e => updateLineItem(idx, { optionalPitchLine: e.target.value })} className="text-sm" />
                        <Input
                          title="Group name — add-ons sharing the same group name become mutually exclusive (radio buttons). Leave blank for an independent checkbox."
                          placeholder="Group name (e.g. Treatment frequency) — leave blank for independent toggle"
                          value={item.groupId ?? ''}
                          onChange={e => updateLineItem(idx, { groupId: e.target.value.trim() || undefined })}
                          className="text-sm"
                        />
                        {item.groupId && (
                          <p className="text-xs text-amber-700 flex items-center gap-1">
                            <span>⊙</span> Grouped with other "<strong>{item.groupId}</strong>" items — customer can only pick one
                          </p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}

              <div className="flex justify-end pt-2">
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Subtotal</p>
                  <p className="text-xl font-bold">${subtotal.toFixed(2)}</p>
                </div>
              </div>
            </div>

            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" title="Discard this new estimate" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button title="Create this estimate and open it for editing" onClick={handleCreate} disabled={createEstimate.isPending}>
                {createEstimate.isPending ? 'Creating...' : 'Create Estimate'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Estimate Detail Sheet */}
      <Sheet open={selectedId != null} onOpenChange={open => { if (!open) setSelectedId(null); }}>
        <SheetContent className="w-full sm:max-w-[66vw] overflow-y-auto">
          {selectedEstimate && (
            <>
              <SheetHeader className="pb-4">
                <div className="flex items-center justify-between gap-4">
                  <SheetTitle>Estimate #{selectedEstimate.id}</SheetTitle>
                  <Badge className={`capitalize ${STATUS_COLORS[selectedEstimate.status] ?? ''}`} variant="outline" title={`Estimate status: ${selectedEstimate.status}`}>
                    {selectedEstimate.status}
                  </Badge>
                </div>
                <SheetDescription>
                  <span title={format(new Date(selectedEstimate.createdAt), 'EEEE, MMMM d, yyyy')}>Created {format(new Date(selectedEstimate.createdAt), 'MMM d, yyyy')}</span> ·{' '}
                  {VISIT_MODE_LABELS[selectedEstimate.visitMode] ?? selectedEstimate.visitMode}
                  {(selectedEstimate as any).sentAt && (
                    <> · <span className="text-emerald-600">Sent {format(new Date((selectedEstimate as any).sentAt), 'MMM d, yyyy')}</span></>
                  )}
                  {(selectedEstimate as any).expiresAt && selectedEstimate.status === 'sent' && (() => {
                    const daysLeft = Math.ceil((new Date((selectedEstimate as any).expiresAt).getTime() - Date.now()) / 86400000);
                    return daysLeft <= 0
                      ? <> · <span className="text-destructive font-medium">Expired</span></>
                      : daysLeft <= 5
                        ? <> · <span className="text-amber-600 font-medium">Expires in {daysLeft}d</span></>
                        : null;
                  })()}
                </SheetDescription>
              </SheetHeader>

              {/* Business branding */}
              {settings && (settings.companyName || settings.logoUrl || settings.businessTagline || settings.businessPhone || settings.businessEmail || settings.businessWebsite || settings.businessAddress) && (
                <div className="mb-4 p-3 rounded-lg bg-muted/40 border border-border/60 text-center space-y-2">
                  {settings.logoUrl && (
                    <img
                      src={`${import.meta.env.BASE_URL}api/public/tenants/${settings.tenantId}/logo`}
                      alt="Company logo"
                      className="h-10 w-auto mx-auto object-contain"
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  {settings.companyName && <p className="font-semibold text-sm">{settings.companyName}</p>}
                  {settings.businessTagline && <p className="text-xs text-muted-foreground italic">{settings.businessTagline}</p>}
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {settings.businessPhone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{settings.businessPhone}</span>}
                    {settings.businessEmail && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{settings.businessEmail}</span>}
                    {settings.businessWebsite && <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{settings.businessWebsite}</span>}
                    {settings.businessAddress && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{settings.businessAddress}</span>}
                  </div>
                </div>
              )}

              <div className="space-y-5">
                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  {selectedEstimate.status === 'draft' && canManageOffice && (
                    <Button size="sm" variant="outline" className="gap-2" title="Send this estimate to the customer by email" onClick={() => openSendDialog(selectedEstimate)} disabled={sendEstimate.isPending}>
                      <Send className="w-3.5 h-3.5" /> Send to Customer
                    </Button>
                  )}
                  {selectedEstimate.status === 'approved' && !selectedEstimate.convertedToJobId && canManageOffice && (
                    <Button size="sm" className="gap-2" title="Schedule a job from this approved estimate" onClick={() => openScheduleDialog(selectedEstimate)}>
                      <Calendar className="w-3.5 h-3.5" /> Schedule Job
                    </Button>
                  )}
                  {selectedEstimate.convertedToJobId && (
                    <button
                      className="text-sm text-emerald-700 flex items-center gap-1 hover:underline"
                      title="View the job this estimate was converted to"
                      onClick={() => setLocation(`/schedule?jobId=${selectedEstimate.convertedToJobId}`)}
                    >
                      <CheckCircle2 className="w-4 h-4" /> Scheduled → Job #{selectedEstimate.convertedToJobId} →
                    </button>
                  )}
                  {(selectedEstimate.status === 'declined' || selectedEstimate.status === 'expired') && canManageOffice && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      title="Reset this estimate back to draft status"
                      disabled={updateEstimate.isPending}
                      onClick={() => updateEstimate.mutate(
                        { id: selectedEstimate.id, data: { status: 'draft' } as any },
                        { onSuccess: () => { toast.success('Estimate reset to draft'); qc.invalidateQueries({ queryKey: getListEstimatesQueryKey() }); } },
                      )}
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Reset to Draft
                    </Button>
                  )}
                  {selectedEstimate.status === 'sent' && canManageOffice && (
                    <>
                      <Button size="sm" variant="outline" className="gap-2" title="Resend the estimate email to the customer" onClick={() => handleResend(selectedEstimate.id)} disabled={resendEstimate.isPending}>
                        <Send className="w-3.5 h-3.5" /> {resendEstimate.isPending ? 'Resending…' : 'Resend Email'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                        title="Mark this estimate as approved by the customer"
                        disabled={updateEstimate.isPending}
                        onClick={() => updateEstimate.mutate(
                          { id: selectedEstimate.id, data: { status: 'approved' } as any },
                          { onSuccess: () => { toast.success('Estimate marked as approved'); qc.invalidateQueries({ queryKey: getListEstimatesQueryKey() }); } },
                        )}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> {updateEstimate.isPending ? 'Approving…' : 'Mark Approved'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/5"
                        title="Mark this estimate as declined by the customer"
                        disabled={updateEstimate.isPending}
                        onClick={() => updateEstimate.mutate(
                          { id: selectedEstimate.id, data: { status: 'declined' } as any },
                          { onSuccess: () => { toast.success('Estimate marked as declined'); qc.invalidateQueries({ queryKey: getListEstimatesQueryKey() }); } },
                        )}
                      >
                        <XCircle className="w-3.5 h-3.5" /> {updateEstimate.isPending ? 'Declining…' : 'Decline'}
                      </Button>
                    </>
                  )}
                  {canManageOffice && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      title="Create a copy of this estimate"
                      disabled={createEstimate.isPending}
                      onClick={() => {
                        const est = selectedEstimate;
                        createEstimate.mutate(
                          {
                            data: {
                              customerId: est.customerId,
                              propertyId: (est as any).propertyId,
                              visitMode: est.visitMode as any,
                              lineItems: ((est as any).lineItems ?? []).map((li: any) => ({
                                serviceId: li.serviceId, quantity: li.quantity, unitPrice: li.unitPrice, description: li.description,
                              })),
                            } as any,
                          },
                          {
                            onSuccess: (r: any) => {
                              toast.success(`Estimate #${r.id} created as copy`);
                              qc.invalidateQueries({ queryKey: getListEstimatesQueryKey() });
                              setSelectedId(r.id);
                            },
                            onError: () => toast.error('Failed to duplicate estimate'),
                          },
                        );
                      }}
                    >
                      <Copy className="w-3.5 h-3.5" /> {createEstimate.isPending ? 'Duplicating…' : 'Duplicate'}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="gap-2" title="Preview how this estimate looks to the customer" onClick={() => setPreviewOpen(true)}>
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </Button>
                  {selectedEstimate.approvalToken && selectedEstimate.status === 'sent' && (
                    <Button size="sm" variant="outline" className="gap-2" title="Open the customer-facing estimate approval page" asChild>
                      <a href={`/estimate/${selectedEstimate.approvalToken}`} target="_blank" rel="noopener noreferrer">
                        <Printer className="w-3.5 h-3.5" /> Customer View
                      </a>
                    </Button>
                  )}
                  {canManageOffice && (
                    <Button size="sm" variant="ghost" className="gap-2 text-destructive ml-auto" title="Permanently delete this estimate" onClick={() => setDeleteDialogId(selectedEstimate.id)}>
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </Button>
                  )}
                </div>

                <Separator />

                {/* Details */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {selectedEstimate.customerName && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Customer</p>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        {(selectedEstimate as any).customerId ? (
                          <button className="text-sm text-primary hover:underline" title={`View ${selectedEstimate.customerName}`} onClick={() => { setSelectedId(null); setLocation(`/customers/${(selectedEstimate as any).customerId}`); }}>{selectedEstimate.customerName}</button>
                        ) : selectedEstimate.customerName}
                      </div>
                    </div>
                  )}
                  {selectedEstimate.assigneeName && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Assignee</p>
                      <div className="flex items-center gap-2"><User className="w-4 h-4 text-muted-foreground" />{selectedEstimate.assigneeName}</div>
                    </div>
                  )}
                  {selectedEstimate.propertyAddress && (
                    <div className="col-span-2 space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Property</p>
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                        {(selectedEstimate as any).propertyId ? (
                          <button className="text-sm text-primary hover:underline text-left" title="View property details" onClick={() => { setSelectedId(null); setLocation(`/properties/${(selectedEstimate as any).propertyId}`); }}>{selectedEstimate.propertyAddress}</button>
                        ) : selectedEstimate.propertyAddress}
                      </div>
                    </div>
                  )}
                  {selectedEstimate.scheduledAt && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Scheduled</p>
                      <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-muted-foreground" /><span title={format(new Date(selectedEstimate.scheduledAt), 'EEEE, MMMM d, yyyy h:mm a')}>{format(new Date(selectedEstimate.scheduledAt), 'MMM d, yyyy h:mm a')}</span></div>
                    </div>
                  )}
                  {selectedEstimate.expiresAt && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Expires</p>
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span title={format(new Date(selectedEstimate.expiresAt), 'EEEE, MMMM d, yyyy')}>{format(new Date(selectedEstimate.expiresAt), 'MMM d, yyyy')}</span>
                        {selectedEstimate.status !== 'expired' && (() => {
                          const daysLeft = Math.ceil((new Date(selectedEstimate.expiresAt).getTime() - Date.now()) / 86400000);
                          if (daysLeft <= 0) return <span className="text-xs text-destructive ml-1">Expired</span>;
                          if (daysLeft <= 7) return <span className="text-xs text-amber-600 ml-1">{daysLeft}d left</span>;
                          return null;
                        })()}
                      </div>
                    </div>
                  )}
                  {selectedEstimate.sentAt && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Emailed</p>
                      <div className="flex items-center gap-2 text-emerald-700"><Mail className="w-4 h-4" /><span title={format(new Date(selectedEstimate.sentAt), 'EEEE, MMMM d, yyyy h:mm a')}>{format(new Date(selectedEstimate.sentAt), 'MMM d, yyyy h:mm a')}</span></div>
                    </div>
                  )}
                </div>

                {(selectedEstimate as typeof selectedEstimate & { templateName?: string | null }).templateName && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Template</p>
                    <p className="text-sm flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      Built from: <span className="font-medium">{(selectedEstimate as typeof selectedEstimate & { templateName?: string | null }).templateName}</span>
                    </p>
                  </div>
                )}

                {/* Payment requirement */}
                {(() => {
                  const req = (selectedEstimate as any).paymentRequirement as string | undefined;
                  const val = (selectedEstimate as any).depositValue as number | null | undefined;
                  const paidAt = (selectedEstimate as any).depositPaidAt as string | null | undefined;
                  if (!req || req === 'none') return null;
                  const label =
                    req === 'full' ? 'Full payment required on acceptance' :
                    req === 'deposit_pct' ? `${val ?? '?'}% deposit required on acceptance` :
                    req === 'deposit_fixed' ? `$${(val ?? 0).toFixed(2)} deposit required on acceptance` : null;
                  if (!label) return null;
                  return (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
                        <Receipt className="w-3.5 h-3.5" /> Payment Requirement
                      </p>
                      <div className="flex items-center gap-2 text-sm">
                        <span>{label}</span>
                        {paidAt ? (
                          <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-300 gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Deposit collected {format(new Date(paidAt), 'MMM d, yyyy')}
                          </Badge>
                        ) : selectedEstimate.status === 'sent' ? (
                          <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300">Pending payment</Badge>
                        ) : null}
                      </div>
                    </div>
                  );
                })()}

                {(selectedEstimate as any).estimatedDurationMin != null && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Estimated Duration</p>
                    <p className="text-sm flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      {(() => {
                        const mins = (selectedEstimate as any).estimatedDurationMin as number;
                        const h = Math.floor(mins / 60);
                        const m = mins % 60;
                        if (h === 0) return `${m} min`;
                        if (m === 0) return `${h} hr`;
                        return `${h} hr ${m} min`;
                      })()}
                    </p>
                  </div>
                )}

                {Array.isArray((selectedEstimate as any).suppliesNeeded) && (selectedEstimate as any).suppliesNeeded.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
                      <Package className="w-3.5 h-3.5" /> Supplies Needed
                    </p>
                    <div className="rounded-lg border divide-y text-sm">
                      {((selectedEstimate as any).suppliesNeeded as SupplyItem[]).map((s, i) => (
                        <div key={i} className="flex items-center justify-between px-3 py-2">
                          <span className="font-medium">{s.name}</span>
                          <span className="text-xs text-muted-foreground">{s.quantity} {s.unit}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Notes</p>
                    {canManageOffice && !editingNotes && (
                      <Button variant="ghost" size="sm" title="Edit estimate notes" className="h-6 text-xs gap-1" onClick={() => setEditingNotes(true)}>
                        <Edit2 className="w-3 h-3" /> Edit
                      </Button>
                    )}
                  </div>
                  {editingNotes ? (
                    <div className="space-y-2">
                      <Textarea value={notesVal} onChange={e => setNotesVal(e.target.value)} rows={3} className="text-sm" />
                      <div className="flex gap-2">
                        <Button size="sm" title="Save estimate notes" className="h-7 text-xs" disabled={updateEstimate.isPending} onClick={() => updateEstimate.mutate(
                          { id: selectedEstimate.id, data: { notes: notesVal } as any },
                          { onSuccess: () => { toast.success('Notes saved'); setEditingNotes(false); qc.invalidateQueries({ queryKey: getListEstimatesQueryKey() }); } },
                        )}>{updateEstimate.isPending ? 'Saving…' : 'Save'}</Button>
                        <Button size="sm" variant="ghost" title="Discard notes changes" className="h-7 text-xs" onClick={() => { setEditingNotes(false); setNotesVal(selectedEstimate.notes ?? ''); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm">{selectedEstimate.notes || <span className="text-muted-foreground italic">No notes.</span>}</p>
                  )}
                </div>

                {selectedEstimate.declineReason && (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                    <p className="text-xs text-red-600 font-semibold mb-1 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> Decline Reason</p>
                    <p className="text-sm text-red-700">{selectedEstimate.declineReason}</p>
                  </div>
                )}

                <Separator />

                {/* Line Items */}
                {editingLineItems ? (
                  // ── Edit mode ─────────────────────────────────────────────
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm">Services</h3>
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={cancelEditLineItems} disabled={updateEstimate.isPending}>Cancel</Button>
                        <Button size="sm" className="h-7 text-xs" onClick={saveEditLineItems} disabled={updateEstimate.isPending}>
                          {updateEstimate.isPending ? 'Saving…' : 'Save'}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {editLineItemsList.map((item, idx) => (
                        <div key={item.id} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <input
                              className="flex-1 border rounded-md px-2 py-1.5 text-sm bg-background"
                              value={item.description}
                              onChange={e => setEditLineItemsList(list => list.map((i, k) => k === idx ? { ...i, description: e.target.value } : i))}
                              placeholder="Description"
                              title="Line item description"
                            />
                            <input
                              type="number" min={0.01} step={0.01}
                              className="w-16 border rounded-md px-2 py-1.5 text-sm bg-background text-right"
                              value={item.qty}
                              onChange={e => setEditLineItemsList(list => list.map((i, k) => k === idx ? { ...i, qty: parseFloat(e.target.value) || 0 } : i))}
                              title="Quantity"
                            />
                            <span className="text-muted-foreground text-xs shrink-0">×</span>
                            <input
                              type="number" min={0} step={0.01}
                              className="w-24 border rounded-md px-2 py-1.5 text-sm bg-background text-right"
                              value={item.unitPrice}
                              onChange={e => setEditLineItemsList(list => list.map((i, k) => k === idx ? { ...i, unitPrice: parseFloat(e.target.value) || 0 } : i))}
                              title="Unit price ($)"
                            />
                            <span className="text-sm font-medium w-16 text-right shrink-0">${((item.qty || 0) * (item.unitPrice || 0)).toFixed(2)}</span>
                            <button
                              className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                              onClick={() => setEditLineItemsList(list => list.filter((_, k) => k !== idx))}
                              title="Remove this line item"
                            ><X className="w-3.5 h-3.5" /></button>
                          </div>
                          <select
                            className="text-xs border rounded px-1.5 py-0.5 bg-background text-muted-foreground w-36"
                            value={item.category ?? 'labor'}
                            onChange={e => setEditLineItemsList(list => list.map((i, k) => k === idx ? { ...i, category: e.target.value as LineItem['category'] } : i))}
                            title="Cost category for breakdown view"
                          >
                            <option value="labor">Labor</option>
                            <option value="parts">Parts / Materials</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                      ))}
                      <button
                        className="text-xs text-primary hover:underline flex items-center gap-1 mt-1"
                        onClick={() => setEditLineItemsList(list => [...list, emptyItem()])}
                      >
                        <Plus className="w-3 h-3" /> Add line item
                      </button>
                    </div>
                    <Separator />
                    <div className="flex justify-between text-sm font-semibold">
                      <span>Estimated Total</span>
                      <span>${editLineItemsList.reduce((s, i) => s + (i.qty || 0) * (i.unitPrice || 0), 0).toFixed(2)}</span>
                    </div>
                  </div>
                ) : (
                  // ── Read-only view ─────────────────────────────────────────
                  (() => {
                    const items = (selectedEstimate.lineItems ?? []) as LineItem[];
                    const required = items.filter(i => !i.isOptional);
                    const optional = items.filter(i => i.isOptional);
                    const grandTotal = selectedEstimate.total ?? 0;
                    const acceptedSubtotal = items
                      .filter(i => !i.isOptional || i.acceptedByCustomer)
                      .reduce((s, i) => s + calcItem(i), 0);
                    const taxAmt = Math.max(0, grandTotal - acceptedSubtotal);

                    // Category groups for breakdown view
                    const catGroups = (['labor', 'parts', 'other'] as const)
                      .map(key => ({ key, label: CATEGORY_LABELS[key], items: required.filter(i => getItemCategory(i) === key) }))
                      .filter(g => g.items.length > 0);

                    const OptionalRow = ({ item, indicator }: { item: LineItem; indicator: React.ReactNode }) => (
                      <div className={`flex items-start justify-between gap-4 text-sm rounded-md p-2 ${item.acceptedByCustomer ? 'bg-amber-50 border border-amber-200' : 'opacity-60'}`}>
                        <div className="flex-1 flex items-start gap-2">
                          <span className="mt-0.5 text-amber-600 shrink-0">{indicator}</span>
                          <div>
                            <p className="font-medium">{item.description || '—'}{item.acceptedByCustomer ? ' ✓' : ''}</p>
                            {item.optionalPitchLine && <p className="text-xs text-muted-foreground italic">{item.optionalPitchLine}</p>}
                            <p className="text-muted-foreground text-xs">Qty {item.qty} × ${item.unitPrice.toFixed(2)}</p>
                          </div>
                        </div>
                        <span className="font-medium shrink-0">${calcItem(item).toFixed(2)}</span>
                      </div>
                    );

                    const OptionalSection = () => {
                      const ungrouped = optional.filter(i => !i.groupId);
                      const grouped = optional.filter(i => !!i.groupId);
                      const groups = grouped.reduce<Record<string, LineItem[]>>((acc, item) => {
                        const g = item.groupId!;
                        if (!acc[g]) acc[g] = [];
                        acc[g].push(item);
                        return acc;
                      }, {});
                      return (
                        <>
                          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Add-On Services</p>
                          {ungrouped.map(item => <OptionalRow key={item.id} item={item} indicator="☐" />)}
                          {Object.entries(groups).map(([groupName, groupItems]) => (
                            <div key={groupName} className="rounded-md border border-dashed border-amber-300 bg-amber-50/30 p-2 space-y-1">
                              <p className="text-xs font-medium text-amber-700 flex items-center gap-1">
                                <span>⊙</span> {groupName} <span className="text-muted-foreground font-normal">(pick one)</span>
                              </p>
                              {groupItems.map(item => <OptionalRow key={item.id} item={item} indicator="○" />)}
                            </div>
                          ))}
                        </>
                      );
                    };

                    return (
                      <div className="space-y-4">
                        {/* Header */}
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-sm">Services</h3>
                          <div className="flex items-center gap-3">
                            <button
                              className="text-xs text-primary hover:underline flex items-center gap-1"
                              onClick={() => setShowBreakdown(v => !v)}
                              title={showBreakdown ? 'Collapse to total only' : 'Expand to see cost breakdown by category'}
                            >
                              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showBreakdown ? 'rotate-180' : ''}`} />
                              {showBreakdown ? 'Hide breakdown' : 'View breakdown'}
                            </button>
                            {canManageOffice && (
                              <button
                                className="text-xs text-primary hover:underline flex items-center gap-1"
                                onClick={startEditLineItems}
                                title="Edit line items on this estimate"
                              >
                                <Edit2 className="w-3 h-3" /> Edit items
                              </button>
                            )}
                          </div>
                        </div>

                        {showBreakdown ? (
                          /* Expanded: items grouped by category */
                          <div className="space-y-4">
                            {catGroups.map(cat => {
                              const catTotal = cat.items.reduce((s, i) => s + calcItem(i), 0);
                              return (
                                <div key={cat.key}>
                                  <div className="flex justify-between items-center mb-1.5">
                                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{cat.label}</span>
                                    <span className="text-xs font-semibold text-muted-foreground">${catTotal.toFixed(2)}</span>
                                  </div>
                                  <div className="pl-3 border-l-2 border-muted space-y-2">
                                    {cat.items.map(item => (
                                      <div key={item.id} className="flex items-start justify-between gap-4 text-sm">
                                        <div className="flex-1">
                                          <p className="font-medium" title={item.description || undefined}>
                                            {item.description || '—'}
                                            {(item as any).secondaryServiceId && (
                                              <Badge variant="outline" className="ml-1.5 text-[10px] px-1 text-indigo-600 border-indigo-300 align-middle">bundled</Badge>
                                            )}
                                            {(item as any).planTemplateId && (
                                              <Badge variant="outline" className="ml-1.5 text-[10px] px-1 text-violet-600 border-violet-300 align-middle gap-0.5">
                                                <Package className="w-2.5 h-2.5" /> plan
                                              </Badge>
                                            )}
                                          </p>
                                          <p className="text-muted-foreground text-xs">Qty {item.qty} × ${item.unitPrice.toFixed(2)}{item.markup > 0 && ` + ${item.markup}% markup`}{item.discount > 0 && ` − ${item.discount}% disc`}{(item as any).planBillingCycle && ` · ${(item as any).planBillingCycle}`}</p>
                                        </div>
                                        <span className="font-medium shrink-0">${calcItem(item).toFixed(2)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                            {optional.length > 0 && <OptionalSection />}
                            <Separator />
                            <div className="space-y-1.5 text-sm">
                              {taxAmt >= 0.01 && (
                                <div className="flex justify-between text-muted-foreground">
                                  <span>Tax</span>
                                  <span>${taxAmt.toFixed(2)}</span>
                                </div>
                              )}
                              <div className="flex justify-between items-center pt-1 border-t">
                                <span className="font-semibold">Total</span>
                                <span className="text-xl font-bold">${grandTotal.toFixed(2)}</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          /* Collapsed: just the total */
                          <div className="space-y-1.5 text-sm">
                            {taxAmt >= 0.01 && (
                              <div className="flex justify-between text-muted-foreground">
                                <span>Tax</span>
                                <span>${taxAmt.toFixed(2)}</span>
                              </div>
                            )}
                            <div className="flex justify-between items-center border-t pt-1">
                              <span className="font-semibold">Total</span>
                              <span className="text-xl font-bold" title={`Grand total: $${grandTotal.toFixed(2)}`}>${grandTotal.toFixed(2)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Estimate Preview */}
      {selectedEstimate && (
        <EstimatePreviewDialog
          estimate={selectedEstimate}
          settings={settings}
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {/* Delete Confirm */}
      <Dialog open={deleteDialogId != null} onOpenChange={open => { if (!open) setDeleteDialogId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Estimate</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This action cannot be undone. Delete Estimate #{deleteDialogId}?</p>
          <div className="flex gap-3 justify-end mt-4">
            <Button variant="outline" title="Keep this estimate — do not delete" onClick={() => setDeleteDialogId(null)}>Cancel</Button>
            <Button variant="destructive" title="Permanently delete this estimate" onClick={() => deleteDialogId && handleDelete(deleteDialogId)} disabled={deleteEstimate.isPending}>{deleteEstimate.isPending ? 'Deleting…' : 'Delete'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <SendDocumentDialog
        open={sendDialogId != null}
        onOpenChange={open => { if (!open) setSendDialogId(null); }}
        type="estimate"
        docNumber={String(sendDialogId ?? '')}
        customerName={(estimates?.find(e => e.id === sendDialogId) as any)?.customerName ?? null}
        onSendEmail={handleSendForDialog}
        isSendingEmail={sendEstimate.isPending}
      >
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Expiry Date</label>
          <Input
            type="date"
            title="The estimate link will stop accepting responses after this date"
            value={sendExpiresAt}
            onChange={e => setSendExpiresAt(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">The estimate link will stop accepting responses after this date.</p>
        </div>
      </SendDocumentDialog>

      {/* ── Schedule Job dialog (estimate → job conversion) ────────────────── */}
      <Dialog open={scheduleDialogOpen} onOpenChange={open => { if (!open && !converting) { setScheduleDialogOpen(false); setScheduleEstimateId(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule Job</DialogTitle>
            <DialogDescription>Convert this estimate to a scheduled job and choose when to invoice.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {/* Title */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Job Title</label>
              <Input
                value={scheduleForm.title}
                onChange={e => setScheduleForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Job title…"
              />
            </div>
            {/* Scheduled Date & Time */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Scheduled Date &amp; Time</label>
              <Input
                type="datetime-local"
                value={scheduleForm.scheduledAt}
                onChange={e => setScheduleForm(f => ({ ...f, scheduledAt: e.target.value }))}
              />
            </div>
            {/* Assignee */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Assign To</label>
              <Select value={scheduleForm.assigneeId} onValueChange={v => setScheduleForm(f => ({ ...f, assigneeId: v }))}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  {((users as any[]) ?? []).filter((u: any) => u.isActive !== false).map((u: any) => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Billing choice */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Billing</label>
              <div className="flex rounded-lg border overflow-hidden">
                <button
                  type="button"
                  className={`flex-1 px-3 py-2 text-sm transition-colors ${scheduleForm.invoiceNow ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-muted/50 text-muted-foreground'}`}
                  onClick={() => setScheduleForm(f => ({ ...f, invoiceNow: true }))}
                >
                  <Receipt className="w-3.5 h-3.5 inline mr-1.5" />Invoice Now
                </button>
                <button
                  type="button"
                  className={`flex-1 px-3 py-2 text-sm border-l transition-colors ${!scheduleForm.invoiceNow ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-muted/50 text-muted-foreground'}`}
                  onClick={() => setScheduleForm(f => ({ ...f, invoiceNow: false }))}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 inline mr-1.5" />Invoice After Job
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {scheduleForm.invoiceNow
                  ? 'A draft invoice will be created now for staff to review and send.'
                  : 'A draft invoice will be auto-created when the job is marked complete.'}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setScheduleDialogOpen(false); setScheduleEstimateId(null); }} disabled={converting}>Cancel</Button>
            <Button onClick={handleConvertWithSchedule} disabled={converting} className="gap-2">
              {converting
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Scheduling…</>
                : <><Calendar className="w-4 h-4" /> Schedule Job</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
