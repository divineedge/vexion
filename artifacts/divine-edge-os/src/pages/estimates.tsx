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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ImportExportControls } from '@/components/data-io/ImportExportControls';
import {
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
} from '@workspace/api-client-react';
import { format } from 'date-fns';
import {
  Plus, FileText, DollarSign, TrendingUp, Send, Briefcase, Trash2,
  ChevronRight, Eye, Clock, User, MapPin, CheckCircle2, XCircle, Phone, Mail, Globe, Building2, Printer,
} from 'lucide-react';
import { Link, useSearch } from 'wouter';
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
}

function emptyItem(): LineItem {
  return { id: crypto.randomUUID(), description: '', qty: 1, unitPrice: 0, markup: 0, discount: 0, isOptional: false, optionalPitchLine: '', acceptedByCustomer: true };
}

function calcItem(item: LineItem) {
  const base = item.qty * item.unitPrice;
  const afterMarkup = base * (1 + item.markup / 100);
  return afterMarkup * (1 - item.discount / 100);
}

// ── Inline Estimate Preview ──────────────────────────────────────────────────
function EstimatePreviewDialog({ estimate, settings, open, onClose }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  estimate: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings: any;
  open: boolean;
  onClose: () => void;
}) {
  const items = (estimate?.lineItems ?? []) as LineItem[];
  const required = items.filter(i => !i.isOptional);
  const optional = items.filter(i => i.isOptional);
  const total = items.reduce((s, i) => s + calcItem(i), 0);
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
                  <p className="text-sm text-muted-foreground">Prepared {estimate.createdAt ? format(new Date(estimate.createdAt), 'MMMM d, yyyy') : ''}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[estimate.status] ?? ''}`}>{estimate.status}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {estimate.customerName && (
                  <div><p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Customer</p><p className="font-medium">{estimate.customerName}</p></div>
                )}
                {estimate.propertyAddress && (
                  <div><p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Property</p><p>{estimate.propertyAddress}</p></div>
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
            <div className="bg-white rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide">Service</th>
                    <th className="text-center px-3 py-2.5 font-semibold text-xs uppercase tracking-wide w-16">Qty</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-xs uppercase tracking-wide">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {required.map(item => (
                    <tr key={item.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{item.description || '—'}</p>
                        {(item.markup > 0 || item.discount > 0) && (
                          <p className="text-xs text-muted-foreground">
                            ${item.unitPrice.toFixed(2)} each{item.markup > 0 && ` + ${item.markup}% markup`}{item.discount > 0 && ` − ${item.discount}% off`}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center text-muted-foreground">{item.qty}</td>
                      <td className="px-4 py-3 text-right font-medium">${calcItem(item).toFixed(2)}</td>
                    </tr>
                  ))}
                  {optional.length > 0 && (
                    <>
                      <tr className="bg-amber-50/60">
                        <td colSpan={3} className="px-4 py-2 text-xs font-semibold text-amber-700 uppercase tracking-wide">Optional Add-Ons</td>
                      </tr>
                      {optional.map(item => (
                        <tr key={item.id} className="bg-amber-50/30">
                          <td className="px-4 py-3">
                            <p className="font-medium">{item.description || '—'}</p>
                            {item.optionalPitchLine && <p className="text-xs text-muted-foreground italic">{item.optionalPitchLine}</p>}
                          </td>
                          <td className="px-3 py-3 text-center text-muted-foreground">{item.qty}</td>
                          <td className="px-4 py-3 text-right font-medium">${calcItem(item).toFixed(2)}</td>
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
                <tfoot className="bg-muted/30 border-t-2">
                  <tr>
                    <td colSpan={2} className="px-4 py-3 font-bold text-right">Total</td>
                    <td className="px-4 py-3 text-right text-lg font-bold">${total.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="text-center text-xs text-muted-foreground pb-4">
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

  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

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
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [search]);

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
  });
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyItem()]);

  const listParams = statusFilter ? { status: statusFilter } : {};
  const { data: estimates, isLoading } = useListEstimates(listParams, {
    query: { queryKey: getListEstimatesQueryKey(listParams) },
  });
  const { data: pipeline } = useGetEstimatePipeline({ query: { queryKey: getGetEstimatePipelineQueryKey() } });
  const { data: selectedEstimate } = useGetEstimate(selectedId!, {
    query: { enabled: selectedId != null, queryKey: getGetEstimateQueryKey(selectedId!) },
  });
  const { data: customers } = useListCustomers({}, { query: { enabled: createOpen, queryKey: getListCustomersQueryKey({}) } });
  const { data: users } = useListUsers({ query: { enabled: createOpen, queryKey: getListUsersQueryKey() } });
  const { data: properties } = useListProperties({}, { query: { enabled: createOpen, queryKey: getListPropertiesQueryKey({}) } });
  const { data: templates } = useListEstimateTemplates({ query: { enabled: createOpen, queryKey: getListEstimateTemplatesQueryKey() } });
  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });

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
          acceptedByCustomer: !i.isOptional,
        })),
      },
    }, {
      onSuccess: (e) => {
        toast.success('Estimate created');
        invalidate();
        setCreateOpen(false);
        setLineItems([emptyItem()]);
        setForm({ customerId: '', propertyId: '', assigneeId: '', visitMode: 'scheduled', scheduledAt: '', expiresAt: '', notes: '', templateId: '' });
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
        invalidate();
      },
      onError: () => toast.error('Failed to send estimate'),
    });
  }

  function handleConvert(id: number) {
    convertToJob.mutate({ id }, {
      onSuccess: (r) => { toast.success(`Job #${r.jobId} created`); invalidate(); },
      onError: () => toast.error('Failed to convert estimate'),
    });
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
          <p className="text-muted-foreground mt-1">Manage price proposals and convert them to jobs.</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportControls
            entity="estimates"
            entityLabel="Estimates"
            exportQuery={{ status: statusFilter || undefined }}
            onImportComplete={() => qc.invalidateQueries({ queryKey: getListEstimatesQueryKey() })}
          />
          {canManageOffice && (
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
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
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={statusFilter || 'all'} onValueChange={v => setStatusFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="declined">Declined</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
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
              {estimates.map(est => (
                <div
                  key={est.id}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-muted/40 cursor-pointer transition-colors"
                  onClick={() => setSelectedId(est.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">Estimate #{est.id}</span>
                      <Badge className={`capitalize text-xs ${STATUS_COLORS[est.status] ?? ''}`} variant="outline">
                        {est.status}
                      </Badge>
                      <Badge variant="outline" className="text-xs text-muted-foreground border-muted">
                        {VISIT_MODE_LABELS[est.visitMode] ?? est.visitMode}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                      {est.customerName && <span className="flex items-center gap-1"><User className="w-3 h-3" />{est.customerName}</span>}
                      {est.propertyAddress && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{est.propertyAddress}</span>}
                      {est.scheduledAt && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{format(new Date(est.scheduledAt), 'MMM d, yyyy')}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold">${(est.total ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(est.createdAt), 'MMM d')}</p>
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
                  <SelectTrigger><SelectValue placeholder="No template" /></SelectTrigger>
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
                  <SelectTrigger><SelectValue placeholder="Select customer..." /></SelectTrigger>
                  <SelectContent>{(customers?.items ?? []).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Assign To</label>
                <Select value={form.assigneeId} onValueChange={v => setForm(f => ({ ...f, assigneeId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select assignee..." /></SelectTrigger>
                  <SelectContent>{(users ?? []).map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Visit Mode</label>
                <Select value={form.visitMode} onValueChange={v => setForm(f => ({ ...f, visitMode: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
                  <Input type="datetime-local" value={form.scheduledAt} onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Expires At</label>
              <Input type="date" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes</label>
              <Textarea rows={2} placeholder="Internal notes or scope..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            <Separator />

            {/* Line items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Line Items</h3>
                <Button variant="outline" size="sm" onClick={() => setLineItems(i => [...i, emptyItem()])}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Item
                </Button>
              </div>

              {lineItems.map((item, idx) => (
                <div key={item.id} className={`rounded-lg border p-4 space-y-3 ${item.isOptional ? 'border-dashed border-amber-300 bg-amber-50/50' : ''}`}>
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <Input placeholder="Description" value={item.description} onChange={e => updateLineItem(idx, { description: e.target.value })} />
                    </div>
                    <Button variant="ghost" size="sm" className="text-muted-foreground h-9 w-9 p-0 shrink-0" onClick={() => setLineItems(i => i.filter((_, j) => j !== idx))} disabled={lineItems.length === 1}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Qty</label>
                      <Input type="number" min={1} step={1} value={item.qty} onChange={e => updateLineItem(idx, { qty: parseFloat(e.target.value) || 1 })} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Unit Price</label>
                      <Input type="number" min={0} step={0.01} value={item.unitPrice} onChange={e => updateLineItem(idx, { unitPrice: parseFloat(e.target.value) || 0 })} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Markup %</label>
                      <Input type="number" min={0} step={1} value={item.markup} onChange={e => updateLineItem(idx, { markup: parseFloat(e.target.value) || 0 })} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Discount %</label>
                      <Input type="number" min={0} step={1} value={item.discount} onChange={e => updateLineItem(idx, { discount: parseFloat(e.target.value) || 0 })} />
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input type="checkbox" checked={item.isOptional} onChange={e => updateLineItem(idx, { isOptional: e.target.checked })} className="rounded" />
                      Mark as Optional (Add-On)
                    </label>
                    <span className="ml-auto text-sm font-medium">${calcItem(item).toFixed(2)}</span>
                  </div>
                  {item.isOptional && (
                    <Input placeholder="Pitch line (e.g. While we're there — trim your hedges for $45)" value={item.optionalPitchLine} onChange={e => updateLineItem(idx, { optionalPitchLine: e.target.value })} className="text-sm" />
                  )}
                </div>
              ))}

              <div className="flex justify-end pt-2">
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Subtotal</p>
                  <p className="text-xl font-bold">${subtotal.toFixed(2)}</p>
                </div>
              </div>
            </div>

            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createEstimate.isPending}>
                {createEstimate.isPending ? 'Creating...' : 'Create Estimate'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Estimate Detail Sheet */}
      <Sheet open={selectedId != null} onOpenChange={open => { if (!open) setSelectedId(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selectedEstimate && (
            <>
              <SheetHeader className="pb-4">
                <div className="flex items-center justify-between gap-4">
                  <SheetTitle>Estimate #{selectedEstimate.id}</SheetTitle>
                  <Badge className={`capitalize ${STATUS_COLORS[selectedEstimate.status] ?? ''}`} variant="outline">
                    {selectedEstimate.status}
                  </Badge>
                </div>
                <SheetDescription>
                  Created {format(new Date(selectedEstimate.createdAt), 'MMM d, yyyy')} ·{' '}
                  {VISIT_MODE_LABELS[selectedEstimate.visitMode] ?? selectedEstimate.visitMode}
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
                    <Button size="sm" variant="outline" className="gap-2" onClick={() => handleSend(selectedEstimate.id)} disabled={sendEstimate.isPending}>
                      <Send className="w-3.5 h-3.5" /> Send to Customer
                    </Button>
                  )}
                  {selectedEstimate.status === 'approved' && !selectedEstimate.convertedToJobId && canManageOffice && (
                    <Button size="sm" className="gap-2" onClick={() => handleConvert(selectedEstimate.id)} disabled={convertToJob.isPending}>
                      <Briefcase className="w-3.5 h-3.5" /> Convert to Job
                    </Button>
                  )}
                  {selectedEstimate.convertedToJobId && (
                    <span className="text-sm text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" /> Converted → Job #{selectedEstimate.convertedToJobId}
                    </span>
                  )}
                  {selectedEstimate.status === 'sent' && canManageOffice && (
                    <Button size="sm" variant="outline" className="gap-2" onClick={() => handleResend(selectedEstimate.id)} disabled={resendEstimate.isPending}>
                      <Send className="w-3.5 h-3.5" /> Resend Email
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="gap-2" onClick={() => setPreviewOpen(true)}>
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </Button>
                  {selectedEstimate.approvalToken && selectedEstimate.status === 'sent' && (
                    <Button size="sm" variant="outline" className="gap-2" asChild>
                      <a href={`/estimate/${selectedEstimate.approvalToken}`} target="_blank" rel="noopener noreferrer">
                        <Printer className="w-3.5 h-3.5" /> Customer View
                      </a>
                    </Button>
                  )}
                  {canManageOffice && (
                    <Button size="sm" variant="ghost" className="gap-2 text-destructive ml-auto" onClick={() => setDeleteDialogId(selectedEstimate.id)}>
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
                      <div className="flex items-center gap-2"><User className="w-4 h-4 text-muted-foreground" />{selectedEstimate.customerName}</div>
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
                      <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-muted-foreground shrink-0" />{selectedEstimate.propertyAddress}</div>
                    </div>
                  )}
                  {selectedEstimate.scheduledAt && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Scheduled</p>
                      <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-muted-foreground" />{format(new Date(selectedEstimate.scheduledAt), 'MMM d, yyyy h:mm a')}</div>
                    </div>
                  )}
                  {selectedEstimate.expiresAt && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Expires</p>
                      <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-muted-foreground" />{format(new Date(selectedEstimate.expiresAt), 'MMM d, yyyy')}</div>
                    </div>
                  )}
                  {selectedEstimate.sentAt && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Emailed</p>
                      <div className="flex items-center gap-2 text-emerald-700"><Mail className="w-4 h-4" />{format(new Date(selectedEstimate.sentAt), 'MMM d, yyyy h:mm a')}</div>
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

                {selectedEstimate.notes && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Notes</p>
                    <p className="text-sm">{selectedEstimate.notes}</p>
                  </div>
                )}

                {selectedEstimate.declineReason && (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                    <p className="text-xs text-red-600 font-semibold mb-1 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> Decline Reason</p>
                    <p className="text-sm text-red-700">{selectedEstimate.declineReason}</p>
                  </div>
                )}

                <Separator />

                {/* Line Items */}
                {(() => {
                  const items = (selectedEstimate.lineItems ?? []) as LineItem[];
                  const required = items.filter(i => !i.isOptional);
                  const optional = items.filter(i => i.isOptional);
                  return (
                    <div className="space-y-4">
                      <h3 className="font-semibold text-sm">Services</h3>
                      {required.map((item) => (
                        <div key={item.id} className="flex items-start justify-between gap-4 text-sm">
                          <div className="flex-1">
                            <p className="font-medium">{item.description || '—'}</p>
                            <p className="text-muted-foreground text-xs">Qty {item.qty} × ${item.unitPrice.toFixed(2)}{item.markup > 0 && ` + ${item.markup}% markup`}{item.discount > 0 && ` − ${item.discount}% disc`}</p>
                          </div>
                          <span className="font-medium shrink-0">${calcItem(item).toFixed(2)}</span>
                        </div>
                      ))}
                      {optional.length > 0 && (
                        <>
                          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mt-3">Add-On Services</p>
                          {optional.map((item) => (
                            <div key={item.id} className={`flex items-start justify-between gap-4 text-sm rounded-md p-2 ${item.acceptedByCustomer ? 'bg-amber-50 border border-amber-200' : 'opacity-60'}`}>
                              <div className="flex-1">
                                <p className="font-medium">{item.description || '—'}{item.acceptedByCustomer ? ' ✓' : ''}</p>
                                {item.optionalPitchLine && <p className="text-xs text-muted-foreground italic">{item.optionalPitchLine}</p>}
                                <p className="text-muted-foreground text-xs">Qty {item.qty} × ${item.unitPrice.toFixed(2)}</p>
                              </div>
                              <span className="font-medium shrink-0">${calcItem(item).toFixed(2)}</span>
                            </div>
                          ))}
                        </>
                      )}
                      <Separator />
                      <div className="flex justify-between items-center">
                        <span className="font-semibold">Total</span>
                        <span className="text-xl font-bold">${(selectedEstimate.total ?? 0).toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })()}
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
            <Button variant="outline" onClick={() => setDeleteDialogId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteDialogId && handleDelete(deleteDialogId)} disabled={deleteEstimate.isPending}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
