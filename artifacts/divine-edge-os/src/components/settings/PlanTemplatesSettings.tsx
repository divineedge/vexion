import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useListPlanTemplates, getListPlanTemplatesQueryKey,
  useCreatePlanTemplate, useUpdatePlanTemplate, useDeletePlanTemplate,
  customFetch,
} from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Plus, Trash2, Repeat } from 'lucide-react';

interface ServiceRuleForm { serviceId: string; serviceName: string; frequencyDays: string; }

const CYCLE_LABEL: Record<string, string> = { monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual', custom: 'Custom' };

const EMPTY = {
  name: '', description: '', visitCount: '4', billingCycle: 'monthly', customCycleDays: '',
  price: '', autoRenewDefault: true, isActive: true,
};

export default function PlanTemplatesSettings() {
  const qc = useQueryClient();
  const [sheetMode, setSheetMode] = useState<'create' | 'edit' | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [rules, setRules] = useState<ServiceRuleForm[]>([{ serviceId: '', serviceName: '', frequencyDays: '7' }]);

  const { data: templates, isLoading } = useListPlanTemplates({ query: { queryKey: getListPlanTemplatesQueryKey() } });
  const { data: services } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['services'],
    queryFn: () => customFetch('/api/services'),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListPlanTemplatesQueryKey() });
  const createMutation = useCreatePlanTemplate();
  const updateMutation = useUpdatePlanTemplate();
  const deleteMutation = useDeletePlanTemplate();

  const openCreate = () => {
    setForm(EMPTY);
    setRules([{ serviceId: '', serviceName: '', frequencyDays: '7' }]);
    setSelectedId(null);
    setSheetMode('create');
  };

  const openEdit = (t: NonNullable<typeof templates>[number]) => {
    setForm({
      name: t.name, description: t.description ?? '', visitCount: String(t.visitCount),
      billingCycle: t.billingCycle, customCycleDays: t.customCycleDays ? String(t.customCycleDays) : '',
      price: String(t.price), autoRenewDefault: t.autoRenewDefault, isActive: t.isActive,
    });
    setRules((t.services as any[]).map(s => ({ serviceId: String(s.serviceId), serviceName: s.serviceName, frequencyDays: String(s.frequencyDays) })));
    setSelectedId(t.id);
    setSheetMode('edit');
  };

  const setRuleServiceId = (idx: number, serviceId: string) => {
    const svc = (services ?? []).find(s => String(s.id) === serviceId);
    setRules(rs => rs.map((r, i) => i === idx ? { ...r, serviceId, serviceName: svc?.name ?? r.serviceName } : r));
  };

  const handleSave = () => {
    const validRules = rules.filter(r => r.serviceId && r.frequencyDays);
    if (!form.name || validRules.length === 0) { toast.error('Name and at least one service rule are required'); return; }

    const payload = {
      name: form.name,
      description: form.description || undefined,
      services: validRules.map(r => ({ serviceId: Number(r.serviceId), serviceName: r.serviceName, frequencyDays: Number(r.frequencyDays) })),
      visitCount: Number(form.visitCount) || validRules.length,
      billingCycle: form.billingCycle as 'monthly' | 'quarterly' | 'annual' | 'custom',
      customCycleDays: form.billingCycle === 'custom' ? Number(form.customCycleDays) || 30 : undefined,
      price: Number(form.price) || 0,
      autoRenewDefault: form.autoRenewDefault,
      isActive: form.isActive,
    };

    if (sheetMode === 'create') {
      createMutation.mutate({ data: payload }, {
        onSuccess: () => { toast.success('Plan template created'); invalidate(); setSheetMode(null); },
        onError: () => toast.error('Failed to create plan template'),
      });
    } else if (sheetMode === 'edit' && selectedId) {
      updateMutation.mutate({ id: selectedId, data: payload }, {
        onSuccess: () => { toast.success('Plan template updated'); invalidate(); setSheetMode(null); },
        onError: () => toast.error('Failed to update plan template'),
      });
    }
  };

  const handleDelete = () => {
    if (!selectedId) return;
    deleteMutation.mutate({ id: selectedId }, {
      onSuccess: () => { toast.success('Plan template deleted'); invalidate(); setSheetMode(null); },
      onError: (err: any) => toast.error(err?.data?.error ?? 'Failed to delete plan template'),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Plan Templates</h3>
          <p className="text-sm text-muted-foreground">Define sellable recurring service plans — the services included, how often each runs, and the price.</p>
        </div>
        <Button size="sm" className="gap-2" onClick={openCreate}><Plus className="w-4 h-4" /> Add Plan Template</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Services</TableHead>
                <TableHead className="text-right">Visits/Period</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : (templates ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                  <Repeat className="w-8 h-8 mx-auto mb-2 opacity-30" />No plan templates yet.
                </TableCell></TableRow>
              ) : (templates ?? []).map(t => (
                <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openEdit(t)}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{(t.services as any[]).map(s => s.serviceName).join(', ')}</TableCell>
                  <TableCell className="text-right">{t.visitCount}</TableCell>
                  <TableCell className="text-right font-medium">${t.price.toFixed(2)} / {CYCLE_LABEL[t.billingCycle]}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={t.isActive ? 'default' : 'secondary'} className={t.isActive ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : ''}>
                      {t.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={sheetMode !== null} onOpenChange={open => { if (!open) setSheetMode(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>{sheetMode === 'create' ? 'Add Plan Template' : 'Edit Plan Template'}</SheetTitle>
            <SheetDescription>Configure the services, cadence, and price for this plan.</SheetDescription>
          </SheetHeader>

          <div className="space-y-4 pb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Plan Name <span className="text-destructive">*</span></label>
              <Input placeholder="e.g. 12-Visit Lawn Program" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            <Separator />
            <label className="text-sm font-medium">Included Services</label>
            {rules.map((r, idx) => (
              <div key={idx} className="flex gap-2 items-end">
                <div className="flex-1 space-y-1">
                  <Select value={r.serviceId} onValueChange={v => setRuleServiceId(idx, v)}>
                    <SelectTrigger><SelectValue placeholder="Service" /></SelectTrigger>
                    <SelectContent>
                      {(services ?? []).map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-28 space-y-1">
                  <Input type="number" min={1} placeholder="Days" value={r.frequencyDays}
                    onChange={e => setRules(rs => rs.map((rr, i) => i === idx ? { ...rr, frequencyDays: e.target.value } : rr))} />
                </div>
                <Button variant="ghost" size="icon" onClick={() => setRules(rs => rs.filter((_, i) => i !== idx))} disabled={rules.length === 1}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setRules(rs => [...rs, { serviceId: '', serviceName: '', frequencyDays: '7' }])}>
              <Plus className="w-3.5 h-3.5" /> Add Service Rule
            </Button>
            <p className="text-xs text-muted-foreground">Frequency is days between visits of that service (e.g. 7 = weekly, 42 = every 6 weeks).</p>

            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Visits per Period</label>
                <Input type="number" min={1} value={form.visitCount} onChange={e => setForm(f => ({ ...f, visitCount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Price ($)</label>
                <Input type="number" step="0.01" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Billing Cycle</label>
                <Select value={form.billingCycle} onValueChange={v => setForm(f => ({ ...f, billingCycle: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="annual">Annual</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.billingCycle === 'custom' && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Cycle Length (days)</label>
                  <Input type="number" min={1} value={form.customCycleDays} onChange={e => setForm(f => ({ ...f, customCycleDays: e.target.value }))} />
                </div>
              )}
            </div>

            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Auto-Renew by Default</p>
                <p className="text-xs text-muted-foreground">Plans sold from this template default to auto-renew (can be overridden per customer).</p>
              </div>
              <Switch checked={form.autoRenewDefault} onCheckedChange={v => setForm(f => ({ ...f, autoRenewDefault: v }))} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Inactive templates can't be sold to new customers.</p>
              </div>
              <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
            </div>

            <Separator />
            {sheetMode === 'edit' && selectedId && (
              <Button variant="ghost" className="text-destructive hover:text-destructive w-full gap-2" onClick={handleDelete} disabled={deleteMutation.isPending}>
                <Trash2 className="w-4 h-4" /> Delete Plan Template
              </Button>
            )}
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setSheetMode(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending ? 'Saving...' : sheetMode === 'create' ? 'Create Template' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
