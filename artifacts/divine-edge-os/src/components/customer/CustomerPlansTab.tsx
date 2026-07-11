import React, { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import {
  useListCustomerPlans, getListCustomerPlansQueryKey,
  useListPlanTemplates, getListPlanTemplatesQueryKey,
  usePreviewCustomerPlan, useCreateCustomerPlan,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { CalendarClock, Plus, Repeat, MapPin, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

interface Property { id: number; address: string; }

const CYCLE_LABEL: Record<string, string> = { monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual', custom: 'Custom' };
const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  paused: 'bg-amber-100 text-amber-700 border-amber-200',
  cancelled: 'bg-muted text-muted-foreground',
  pending_renewal: 'bg-blue-100 text-blue-700 border-blue-200',
};

export default function CustomerPlansTab({ customerId, properties }: { customerId: number; properties: Property[] }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [sellOpen, setSellOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string>('');
  const [propertyId, setPropertyId] = useState<string>(properties[0] ? String(properties[0].id) : '');
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [autoRenew, setAutoRenew] = useState(true);

  const { data: plans, isLoading } = useListCustomerPlans(
    { customerId },
    { query: { queryKey: getListCustomerPlansQueryKey({ customerId }) } },
  );
  const { data: templates } = useListPlanTemplates({ query: { queryKey: getListPlanTemplatesQueryKey() } });
  const activeTemplates = useMemo(() => (templates ?? []).filter(t => t.isActive), [templates]);

  const previewMutation = usePreviewCustomerPlan();
  const createMutation = useCreateCustomerPlan();

  const openSell = () => {
    setTemplateId('');
    setPropertyId(properties[0] ? String(properties[0].id) : '');
    setStartDate(new Date().toISOString().slice(0, 10));
    setAutoRenew(true);
    previewMutation.reset();
    setSellOpen(true);
  };

  const runPreview = () => {
    if (!templateId || !propertyId) { toast.error('Choose a plan template and property'); return; }
    previewMutation.mutate({ data: { templateId: Number(templateId), propertyId: Number(propertyId), startDate } });
  };

  const confirmSale = () => {
    if (!templateId || !propertyId) return;
    const preview = previewMutation.data;
    createMutation.mutate({
      data: {
        templateId: Number(templateId),
        customerId,
        propertyId: Number(propertyId),
        startDate,
        autoRenew,
        visits: preview?.visits,
      },
    }, {
      onSuccess: () => {
        toast.success('Plan sold and visits scheduled');
        qc.invalidateQueries({ queryKey: getListCustomerPlansQueryKey({ customerId }) });
        setSellOpen(false);
      },
      onError: () => toast.error('Failed to sell plan'),
    });
  };

  const selectedTemplate = activeTemplates.find(t => String(t.id) === templateId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Recurring service plans sold to this customer, with automated visit scheduling and billing.</p>
        <Button size="sm" className="gap-2" onClick={openSell} disabled={properties.length === 0}>
          <Plus className="w-4 h-4" /> Sell a Plan
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading plans...</p>
      ) : (plans ?? []).length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          <Repeat className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="font-medium">No plans yet</p>
          <p className="text-sm mt-1">Sell this customer a recurring service plan to auto-schedule their visits.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {(plans ?? []).map(p => (
            <Card key={p.id} className="cursor-pointer hover:border-primary/40 transition-colors" onClick={() => navigate(`/plans/${p.id}`)}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{p.templateName}</p>
                    <Badge variant="outline" className={STATUS_STYLE[p.status] ?? ''}>{p.status.replace('_', ' ')}</Badge>
                    {p.autoRenew && <Badge variant="outline" className="text-xs">Auto-renew</Badge>}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{p.propertyAddress}</span>
                    <span className="flex items-center gap-1"><CalendarClock className="w-3 h-3" />Next billing {p.nextBillingDate}</span>
                    <span>${p.billingPrice.toFixed(2)} / {CYCLE_LABEL[p.billingCycle]}</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={sellOpen} onOpenChange={setSellOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sell a Service Plan</DialogTitle>
            <DialogDescription>Preview the auto-generated visit schedule before activating the plan.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Plan Template</label>
              <Select value={templateId} onValueChange={v => { setTemplateId(v); previewMutation.reset(); }}>
                <SelectTrigger><SelectValue placeholder="Choose a plan" /></SelectTrigger>
                <SelectContent>
                  {activeTemplates.map(t => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name} — ${t.price.toFixed(2)}/{CYCLE_LABEL[t.billingCycle]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Property</label>
              <Select value={propertyId} onValueChange={v => { setPropertyId(v); previewMutation.reset(); }}>
                <SelectTrigger><SelectValue placeholder="Choose a property" /></SelectTrigger>
                <SelectContent>
                  {properties.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.address}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Start Date</label>
                <Input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); previewMutation.reset(); }} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Auto-Renew</label>
                <div className="flex items-center h-9">
                  <Switch checked={autoRenew} onCheckedChange={setAutoRenew} />
                </div>
              </div>
            </div>

            <Button variant="outline" onClick={runPreview} disabled={previewMutation.isPending || !templateId || !propertyId} className="w-full">
              {previewMutation.isPending ? 'Building preview...' : 'Preview Schedule'}
            </Button>

            {previewMutation.data && (
              <>
                <Separator />
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  <p className="text-sm font-medium">{previewMutation.data.visits.length} visit(s) this period</p>
                  {previewMutation.data.visits.map((v, i) => (
                    <div key={i} className="flex items-center justify-between text-sm border rounded-md px-3 py-2">
                      <span>{v.serviceName}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{new Date(v.date).toLocaleDateString()}</span>
                        {v.clustered && <Badge variant="outline" className="text-xs">Clustered nearby</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSellOpen(false)}>Cancel</Button>
            <Button onClick={confirmSale} disabled={!previewMutation.data || createMutation.isPending}>
              {createMutation.isPending ? 'Activating...' : 'Confirm & Activate Plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
