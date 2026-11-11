import React, { useEffect, useState } from 'react';
import { customFetch, useListServices, getListServicesQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import { HIRING_FIELDS, QUOTE_FIELDS, type TemplateField } from '@/lib/formVisibility';

interface FormTemplate {
  id: number;
  name: string;
  slug: string;
  purpose: 'quote' | 'hiring';
  serviceId: number | null;
  published: boolean;
  publicPath: string;
  iframe: string;
  fields: TemplateField[];
}

export default function FormTemplateLibrary() {
  const services = (useListServices({ activeOnly: true }, { query: { queryKey: getListServicesQueryKey({ activeOnly: true }) } }).data ?? []).map(service => ({ id: service.id, name: service.name }));
  const [rows, setRows] = useState<FormTemplate[]>([]);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState<'quote' | 'hiring'>('quote');
  const [serviceId, setServiceId] = useState('');
  const [extraLabel, setExtraLabel] = useState('');
  const load = () => customFetch<FormTemplate[]>('/api/website-form-templates').then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);
  const create = async () => {
    const base = purpose === 'hiring' ? HIRING_FIELDS : QUOTE_FIELDS;
    const extra: TemplateField[] = extraLabel.trim() && serviceId
      ? [{ id: 'service_detail', label: extraLabel.trim(), type: 'text', required: false, options: [], serviceId: Number(serviceId), condition: null }]
      : [];
    try {
      await customFetch('/api/website-form-templates', {
        method: 'POST',
        body: JSON.stringify({ name, purpose, serviceId: serviceId ? Number(serviceId) : null, published: true, fields: [...base, ...extra] }),
      });
      setName(''); setExtraLabel('');
      toast.success('Form template published');
      load();
    } catch (error) {
      toast.error((error as { data?: { error?: string } })?.data?.error ?? 'Could not save the form');
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Service and hiring form templates</CardTitle>
        <CardDescription>Each form has its own link, iframe, and API token. A question tied to one service stays hidden for every other service. Quote submissions become a customer lead and a draft estimate. Hiring submissions open an application in Hiring.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-2">
          <Input placeholder="Mowing Quote Form" value={name} onChange={e => setName(e.target.value)} />
          <Select value={purpose} onValueChange={value => setPurpose(value as 'quote' | 'hiring')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="quote">Service estimate</SelectItem>
              <SelectItem value="hiring">Employment application</SelectItem>
            </SelectContent>
          </Select>
          {purpose === 'quote' && (
            <Select value={serviceId || 'any'} onValueChange={value => setServiceId(value === 'any' ? '' : value)}>
              <SelectTrigger><SelectValue placeholder="Tied service" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any service</SelectItem>
                {services.map(service => <SelectItem key={service.id} value={String(service.id)}>{service.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {purpose === 'quote' && serviceId && <Input placeholder="Question only this service should ask" value={extraLabel} onChange={e => setExtraLabel(e.target.value)} />}
        </div>
        <Button type="button" onClick={create} disabled={!name.trim()}>Publish form</Button>
        <div className="space-y-3">
          {rows.map(row => (
            <div key={row.id} className="rounded-md border p-3 text-sm space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{row.name}</span>
                <Badge variant="outline">{row.purpose === 'hiring' ? 'Hiring' : 'Estimate'}</Badge>
                {!row.published && <Badge variant="secondary">Unpublished</Badge>}
              </div>
              <p className="text-xs text-muted-foreground break-all">Direct link {row.publicPath}</p>
              <p className="text-xs text-muted-foreground break-all">API /api/public/form-templates/…</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-1" onClick={() => { navigator.clipboard.writeText(row.iframe); toast.success('Iframe copied'); }}><Copy className="w-3.5 h-3.5" />Copy iframe</Button>
                <Button variant="ghost" size="sm" onClick={async () => { await customFetch(`/api/website-form-templates/${row.id}`, { method: 'PATCH', body: JSON.stringify({ published: !row.published }) }); load(); }}>{row.published ? 'Unpublish' : 'Publish'}</Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
