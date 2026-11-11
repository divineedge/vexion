import React, { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Mail, MessageSquare, Send } from 'lucide-react';

const CATEGORIES = [
  ['quick_reply', 'Quick customer replies'],
  ['appointment_reminder', 'Appointment reminders'],
  ['delay_notice', 'Delay notices'],
  ['pre_service', 'Pre-service instructions'],
  ['follow_up', 'Follow-ups'],
] as const;

interface CommunicationTemplate {
  id: number;
  name: string;
  channel: 'sms' | 'email';
  category: string;
  subject: string | null;
  body: string;
}

export interface AudienceFilter {
  customerIds?: number[];
  tag?: string;
  serviceId?: number;
  crewId?: number;
  routeId?: number;
  scheduledFrom?: string;
  scheduledTo?: string;
}

const blank = { name: '', channel: 'email' as const, category: 'quick_reply', subject: '', body: '' };

export function CommunicationTemplateManager() {
  const [rows, setRows] = useState<CommunicationTemplate[]>([]);
  const [form, setForm] = useState(blank);
  const load = () => customFetch<CommunicationTemplate[]>('/api/communication-templates').then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);
  const save = async () => {
    try {
      await customFetch('/api/communication-templates', { method: 'POST', body: JSON.stringify(form) });
      setForm(blank);
      toast.success('Communication template saved');
      load();
    } catch (error) {
      toast.error((error as { data?: { error?: string } })?.data?.error ?? 'Could not save the template');
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Communication templates</CardTitle>
        <CardDescription>Reusable email and SMS for replies, reminders, delays, pre-service notes, and follow-ups. Use {'{{customer_first_name}}'}, {'{{property_address}}'}, {'{{service_name}}'}, and {'{{company_name}}'}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Input placeholder="Template name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <Select value={form.category} onValueChange={category => setForm(f => ({ ...f, category }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={form.channel} onValueChange={channel => setForm(f => ({ ...f, channel: channel as 'email' | 'sms' }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="sms">SMS</SelectItem>
            </SelectContent>
          </Select>
          {form.channel === 'email' && <Input placeholder="Subject" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />}
        </div>
        <Textarea rows={4} placeholder="Message" value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
        <Button type="button" onClick={save}>Save template</Button>
        <div className="divide-y rounded-md border">
          {rows.map(row => (
            <div key={row.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div>
                <p className="font-medium">{row.name}</p>
                <p className="text-xs text-muted-foreground">{CATEGORIES.find(([value]) => value === row.category)?.[1]} · {row.channel}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={async () => { await customFetch(`/api/communication-templates/${row.id}`, { method: 'DELETE' }); load(); }}>Delete</Button>
            </div>
          ))}
          {rows.length === 0 && <p className="px-3 py-6 text-sm text-muted-foreground">No communication templates yet.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export function TemplateSendButton({ audience, label = 'Send template' }: { audience: AudienceFilter; label?: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CommunicationTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [local, setLocal] = useState<AudienceFilter>(audience);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => { if (open) { setLocal(audience); customFetch<CommunicationTemplate[]>('/api/communication-templates').then(setRows).catch(() => {}); } }, [open]);
  const selected = rows.find(row => String(row.id) === templateId);
  const preview = async () => {
    if (!selected) return;
    const result = await customFetch<{ count: number }>('/api/communication-templates/preview', { method: 'POST', body: JSON.stringify({ channel: selected.channel, audience: local }) });
    setCount(result.count);
  };
  const send = async () => {
    try {
      const result = await customFetch<{ sent: number; failed: number }>(`/api/communication-templates/${templateId}/send`, { method: 'POST', body: JSON.stringify({ audience: local }) });
      toast.success(`Sent ${result.sent}${result.failed ? `, ${result.failed} failed` : ''}`);
      setOpen(false);
    } catch (error) {
      toast.error((error as { data?: { error?: string } })?.data?.error ?? 'Could not send');
    }
  };
  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}><Send className="w-3.5 h-3.5" />{label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send a communication template</DialogTitle></DialogHeader>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger><SelectValue placeholder="Choose a template" /></SelectTrigger>
            <SelectContent>{rows.map(row => <SelectItem key={row.id} value={String(row.id)}>{row.channel === 'sms' ? 'SMS' : 'Email'} · {row.name}</SelectItem>)}</SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" value={local.scheduledFrom ?? ''} onChange={e => setLocal(f => ({ ...f, scheduledFrom: e.target.value || undefined }))} title="Customers scheduled from" />
            <Input type="date" value={local.scheduledTo ?? ''} onChange={e => setLocal(f => ({ ...f, scheduledTo: e.target.value || undefined }))} title="Customers scheduled through" />
            <Input placeholder="Tag" value={local.tag ?? ''} onChange={e => setLocal(f => ({ ...f, tag: e.target.value || undefined }))} />
            <Input placeholder="Service id" value={local.serviceId ?? ''} onChange={e => setLocal(f => ({ ...f, serviceId: e.target.value ? Number(e.target.value) : undefined }))} />
            <Input placeholder="Crew id" value={local.crewId ?? ''} onChange={e => setLocal(f => ({ ...f, crewId: e.target.value ? Number(e.target.value) : undefined }))} />
            <Input placeholder="Route id" value={local.routeId ?? ''} onChange={e => setLocal(f => ({ ...f, routeId: e.target.value ? Number(e.target.value) : undefined }))} />
          </div>
          {selected && <p className="text-xs text-muted-foreground flex items-center gap-1">{selected.channel === 'sms' ? <MessageSquare className="w-3 h-3" /> : <Mail className="w-3 h-3" />}{selected.body}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={preview} disabled={!selected}>Preview {count == null ? '' : `(${count})`}</Button>
            <Button onClick={send} disabled={!selected}>Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
