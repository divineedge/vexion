import React, { useEffect, useMemo, useState } from 'react';
import {
  useCreateRecurringTemplate, useUpdateRecurringTemplate, getListRecurringTemplatesQueryKey,
  useListInvoiceTemplates, getListInvoiceTemplatesQueryKey,
  useListServices, getListServicesQueryKey,
  useGetTenantSettings, getGetTenantSettingsQueryKey,
  type RecurringInvoiceTemplate, type BillingLineItem,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Users, Briefcase } from 'lucide-react';
import { PreviewActions, SAMPLE_NOTICE } from '@/components/documents/PreviewActions';
import { InvoiceDocument, businessProfileFromSettings } from '@/components/documents/InvoiceDocument';
import { buildInvoicePrintDocument } from '@/lib/printUtils';
import { buildPreviewInvoice, settingsTaxRate, normalizeWording } from '@/lib/documentPreview';
import { WordingField } from '@/components/documents/WordingField';

interface Row { description: string; quantity: number; unitPrice: number }
const ALL = '__all__';
const LAYOUT_DEFAULT = '__default__';

/**
 * Recurring billing template editor.
 * - completed_work: customer and service are optional. Leaving both on "All"
 *   makes a reusable template that bills completed work for every customer.
 * - static: a customer is required so a fixed amount is never billed to everyone.
 * Wording: termsText null inherits the company default, '' suppresses it.
 */
export function RecurringTemplateSheet({ open, onClose, editing, customers }: {
  open: boolean;
  onClose: () => void;
  editing: RecurringInvoiceTemplate | null;
  customers: Array<{ id: number; name: string }>;
}) {
  const qc = useQueryClient();
  const createTmpl = useCreateRecurringTemplate();
  const updateTmpl = useUpdateRecurringTemplate();
  const isPending = createTmpl.isPending || updateTmpl.isPending;
  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const { data: designTemplates } = useListInvoiceTemplates({ query: { queryKey: getListInvoiceTemplatesQueryKey() } });
  const { data: servicesRaw } = useListServices(undefined, { query: { queryKey: getListServicesQueryKey() } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const services = useMemo(() => ((Array.isArray(servicesRaw) ? servicesRaw : (servicesRaw as any)?.items ?? []) as Array<{ id: number; name: string }>), [servicesRaw]);

  const [name, setName] = useState('');
  const [customerId, setCustomerId] = useState(ALL);
  const [customerSearch, setCustomerSearch] = useState('');
  const [serviceId, setServiceId] = useState(ALL);
  const [billingMode, setBillingMode] = useState<'static' | 'completed_work'>('completed_work');
  const [cycleType, setCycleType] = useState<'daily' | 'weekly' | 'monthly' | 'bi_monthly'>('monthly');
  const [cycleDay, setCycleDay] = useState('1');
  const [nextBillingDate, setNextBillingDate] = useState('');
  const [notes, setNotes] = useState('');
  const [termsText, setTermsText] = useState<string | null>(null);
  const [designId, setDesignId] = useState(LAYOUT_DEFAULT);
  const [isActive, setIsActive] = useState(true);
  const [rows, setRows] = useState<Row[]>([{ description: '', quantity: 1, unitPrice: 0 }]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = editing as any;
    if (e) {
      setName(e.name ?? '');
      setCustomerId(e.customerId ? String(e.customerId) : ALL);
      setServiceId(e.serviceId ? String(e.serviceId) : ALL);
      setBillingMode(e.billingMode === 'static' ? 'static' : 'completed_work');
      setCycleType(e.billingCycleType ?? 'monthly');
      setCycleDay(String(e.billingCycleDay ?? 1));
      setNextBillingDate(e.nextBillingDate ? String(e.nextBillingDate).slice(0, 10) : '');
      setNotes(e.notes ?? '');
      setTermsText(e.termsText === undefined ? null : e.termsText);
      setDesignId(e.invoiceTemplateId ? String(e.invoiceTemplateId) : LAYOUT_DEFAULT);
      setIsActive(e.isActive ?? true);
      const li: BillingLineItem[] = Array.isArray(e.lineItems) ? e.lineItems : [];
      setRows(li.length ? li.map(l => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice })) : [{ description: '', quantity: 1, unitPrice: 0 }]);
    } else {
      const d = new Date(); d.setMonth(d.getMonth() + 1, 1);
      setName(''); setCustomerId(ALL); setServiceId(ALL); setCustomerSearch('');
      setBillingMode('completed_work'); setCycleType('monthly'); setCycleDay('1');
      setNextBillingDate(d.toISOString().slice(0, 10));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setNotes((settings?.defaultInvoiceNotes as string | null) ?? '');
      setTermsText(null);
      setDesignId(LAYOUT_DEFAULT); setIsActive(true);
      setRows([{ description: '', quantity: 1, unitPrice: 0 }]);
    }
    // settings intentionally read once on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const design = (designTemplates ?? []).find(t => String(t.id) === designId) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const defaultTerms = (design?.termsText ?? settings?.defaultInvoiceTerms ?? '') as string;
  const effectiveTerms = termsText === null ? defaultTerms : termsText;
  const subtotal = rows.reduce((s, r) => s + r.quantity * r.unitPrice, 0);
  const isStatic = billingMode === 'static';
  const customerName = customerId !== ALL ? customers.find(c => String(c.id) === customerId)?.name : undefined;
  const scopeLabel = isStatic
    ? (customerName ?? 'Choose a customer')
    : `${customerName ?? 'All customers'} · ${serviceId !== ALL ? services.find(s => String(s.id) === serviceId)?.name ?? 'Service' : 'All services'}`;

  const previewInvoice = () => buildPreviewInvoice({
    lines: isStatic ? rows : (rows.some(r => r.description.trim()) ? rows : [{ description: 'Completed visit (example)', quantity: 1, unitPrice: 85 }]),
    notes, termsText: effectiveTerms,
    layout: design?.layout ?? 'clean',
    lateFeeEnabled: design?.lateFeeEnabled, lateFeeType: design?.lateFeeType, lateFeeAmount: design?.lateFeeAmount, lateFeeDaysGrace: design?.lateFeeDaysGrace,
    customerName: customerName ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dueDays: (settings as any)?.invoiceDueDays ?? 30,
    taxRatePct: settingsTaxRate(settings),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tenantId: (settings as any)?.tenantId ?? null,
  });

  const handleSave = () => {
    if (!name.trim()) { toast.error('Give the template a name'); return; }
    if (isStatic && customerId === ALL) { toast.error('Fixed-amount templates need a specific customer'); return; }
    if (!nextBillingDate) { toast.error('Choose the next billing date'); return; }
    const validRows = rows.filter(r => r.description.trim() !== '');
    if (isStatic && validRows.length === 0) { toast.error('Add at least one line item'); return; }
    const payload = {
      name: name.trim(),
      customerId: customerId === ALL ? null : Number(customerId),
      serviceId: serviceId === ALL ? null : Number(serviceId),
      billingMode,
      billingCycleType: cycleType,
      billingCycleDay: Math.max(1, Math.min(31, parseInt(cycleDay, 10) || 1)),
      nextBillingDate,
      isActive,
      notes,
      termsText: normalizeWording(termsText), // null inherits default, '' suppresses
      invoiceTemplateId: designId === LAYOUT_DEFAULT ? null : Number(designId),
      lineItems: validRows.map(r => ({ description: r.description, quantity: r.quantity, unitPrice: r.unitPrice })),
    };
    const done = (msg: string) => { toast.success(msg); qc.invalidateQueries({ queryKey: getListRecurringTemplatesQueryKey() }); onClose(); };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fail = (err: any) => toast.error(err?.data?.error ?? err?.response?.data?.error ?? 'Failed to save template');
    if (editing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateTmpl.mutate({ id: editing.id, data: payload as any }, { onSuccess: () => done('Template updated'), onError: fail });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createTmpl.mutate({ data: { ...payload, customerId: payload.customerId ?? undefined, serviceId: payload.serviceId ?? undefined } as any }, { onSuccess: () => done('Template created'), onError: fail });
    }
  };

  const setRow = (i: number, patch: Partial<Row>) => setRows(p => p.map((r, j) => j === i ? { ...r, ...patch } : r));

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-[66vw] overflow-y-auto">
        <SheetHeader className="pb-3">
          <SheetTitle>{editing ? 'Edit Recurring Billing' : 'New Recurring Billing'}</SheetTitle>
          <SheetDescription>Reusable billing rule. Completed-work templates can cover every customer and service.</SheetDescription>
        </SheetHeader>

        <div className="sticky top-0 z-10 -mx-6 px-6 py-2 mb-3 bg-background/95 backdrop-blur border-b flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground truncate">Scope: <span className="font-medium text-foreground">{scopeLabel}</span></span>
          <PreviewActions
            title="Recurring invoice preview"
            sampleNotice={customerName ? 'Preview using current unsaved form values. Not saved and not sent.' : SAMPLE_NOTICE}
            renderCustomerView={() => <InvoiceDocument invoice={previewInvoice()} businessProfile={businessProfileFromSettings(settings)} preview />}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            buildPrintDocument={() => buildInvoicePrintDocument(previewInvoice() as any, (settings ?? {}) as Record<string, unknown>)}
            testIdPrefix="recurring-preview"
          />
        </div>

        <div className="space-y-4 pb-6">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="rt-name">Name <span className="text-destructive">*</span></label>
            <Input id="rt-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Monthly completed work" />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Billing mode</label>
            <div role="radiogroup" className="grid sm:grid-cols-2 gap-2">
              {([['completed_work', 'Completed work', 'Bills jobs finished during each cycle. Customer and service optional.'], ['static', 'Fixed amount', 'Same line items every cycle. Requires one customer.']] as const).map(([v, label, help]) => (
                <button key={v} type="button" role="radio" aria-checked={billingMode === v} onClick={() => setBillingMode(v)}
                  className={`rounded-md border p-3 text-left transition-colors ${billingMode === v ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{help}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />Customer {isStatic && <span className="text-destructive">*</span>}</label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <div className="px-2 pb-1"><input className="w-full text-sm border-b border-border bg-transparent py-1 outline-none placeholder:text-muted-foreground" placeholder="Search…" onChange={e => setCustomerSearch(e.target.value)} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} /></div>
                  {!isStatic && <SelectItem value={ALL}>All customers</SelectItem>}
                  {isStatic && customerId === ALL && <SelectItem value={ALL} disabled>Select a customer</SelectItem>}
                  {customers.filter(c => !customerSearch || c.name.toLowerCase().includes(customerSearch.toLowerCase())).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" />Service</label>
              <Select value={serviceId} onValueChange={setServiceId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All services</SelectItem>
                  {services.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Cycle</label>
              <Select value={cycleType} onValueChange={v => setCycleType(v as typeof cycleType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="bi_monthly">Twice a month</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="rt-day">Cycle day</label>
              <Input id="rt-day" type="number" min={1} max={31} value={cycleDay} onChange={e => setCycleDay(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="rt-next">Next billing date <span className="text-destructive">*</span></label>
              <Input id="rt-next" type="date" value={nextBillingDate} onChange={e => setNextBillingDate(e.target.value)} />
            </div>
          </div>

          <Separator />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">{isStatic ? 'Line items' : 'Extra line items (optional)'}</label>
              <Button type="button" variant="ghost" size="sm" className="text-xs gap-1" onClick={() => setRows(p => [...p, { description: '', quantity: 1, unitPrice: 0 }])}>
                <Plus className="w-3 h-3" /> Add line
              </Button>
            </div>
            {!isStatic && <p className="text-xs text-muted-foreground">Completed jobs are billed at their own prices. Lines here are added on top.</p>}
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-12 gap-1.5 items-center text-sm">
                <Input className="col-span-5 h-8 text-xs" placeholder="Description" value={r.description} onChange={e => setRow(i, { description: e.target.value })} />
                <Input className="col-span-2 h-8 text-xs" type="number" min={0} value={r.quantity} onChange={e => setRow(i, { quantity: parseFloat(e.target.value) || 0 })} />
                <Input className="col-span-3 h-8 text-xs" type="number" min={0} step={0.01} value={r.unitPrice} onChange={e => setRow(i, { unitPrice: parseFloat(e.target.value) || 0 })} />
                <span className="col-span-1 text-xs text-right font-medium tabular-nums">${(r.quantity * r.unitPrice).toFixed(0)}</span>
                <Button type="button" variant="ghost" size="icon" className="col-span-1 h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setRows(p => p.filter((_, j) => j !== i))} disabled={rows.length === 1}><Trash2 className="w-3 h-3" /></Button>
              </div>
            ))}
            <div className="flex justify-end text-sm font-semibold pr-8 tabular-nums">Subtotal: ${subtotal.toFixed(2)}</div>
          </div>

          <Separator />
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Invoice design</label>
            <Select value={designId} onValueChange={setDesignId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={LAYOUT_DEFAULT}>Default (clean layout)</SelectItem>
                {(designTemplates ?? []).map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name} · {t.layout}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Layout, late fees and default terms come from the chosen invoice template.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="rt-notes">Notes</label>
            <Textarea id="rt-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Shown on every generated invoice" />
          </div>

          <WordingField
            label="Terms"
            value={termsText}
            onChange={setTermsText}
            defaultText={defaultTerms}
            defaultSource={design ? `invoice template "${design.name}"` : 'company default (Settings, Invoicing)'}
          />

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div><p className="text-sm font-medium">Active</p><p className="text-xs text-muted-foreground">Paused templates are skipped by the scheduler</p></div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
          <Button className="w-full" onClick={handleSave} disabled={isPending}>
            {isPending ? 'Saving...' : editing ? 'Save changes' : 'Create template'}
          </Button>
          <p className="text-xs text-muted-foreground text-center">Changes apply to future invoices only. Invoices already generated keep their wording.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
