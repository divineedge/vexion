import React, { useState } from 'react';
import {
  useGetCustomer, getGetCustomerQueryKey,
  useUpdateCustomer,
  useListProperties, getListPropertiesQueryKey,
  useListJobs, getListJobsQueryKey,
  useGetTenantSettings, getGetTenantSettingsQueryKey,
} from '@workspace/api-client-react';
import { useParams, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft, Building, Phone, Mail, Edit, Plus, Calendar, MapPin,
  Save, X, User, FileText, Tag, DollarSign, Home, Briefcase, GitMerge,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import type { CustomerFieldConfig, TenantSettings } from '@/lib/fieldConfig';
import { getActiveCustomerFields, BUILT_IN_CUSTOMER_FIELDS } from '@/lib/fieldConfig';

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-emerald-500/10 text-emerald-700 border-transparent',
  in_progress: 'bg-blue-500/10 text-blue-700 border-transparent',
  scheduled: 'bg-amber-500/10 text-amber-700 border-transparent',
  on_hold: 'bg-gray-200 text-gray-600 border-transparent',
  cancelled: 'bg-red-500/10 text-red-600 border-transparent',
};
const INV_STATUS_COLORS: Record<string, string> = {
  paid: 'bg-emerald-500/10 text-emerald-700 border-transparent',
  sent: 'bg-blue-500/10 text-blue-700 border-transparent',
  draft: 'bg-gray-200 text-gray-600 border-transparent',
  overdue: 'bg-red-500/10 text-red-600 border-transparent',
};

type FormData = Record<string, string | string[]>;

export default function CustomerDetailPage() {
  const params = useParams();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormData>({});
  const [tagInput, setTagInput] = useState('');

  const { data: customer, isLoading } = useGetCustomer(id, {
    query: { enabled: !!id, queryKey: getGetCustomerQueryKey(id) },
  });
  const { data: properties } = useListProperties(
    { customerId: id },
    { query: { enabled: !!id, queryKey: getListPropertiesQueryKey({ customerId: id }) } },
  );
  const { data: jobs } = useListJobs(
    { customerId: id },
    { query: { enabled: !!id, queryKey: getListJobsQueryKey({ customerId: id }) } },
  );
  const { data: settings } = useGetTenantSettings({
    query: { queryKey: getGetTenantSettingsQueryKey() },
  });

  const updateCustomer = useUpdateCustomer();
  const activeFields = getActiveCustomerFields(settings as TenantSettings | undefined);

  const openEdit = () => {
    if (!customer) return;
    const cf = (customer.customFieldValues as Record<string, string>) ?? {};
    setForm({
      name: customer.name ?? '',
      email: customer.email ?? '',
      phone: customer.phone ?? '',
      secondaryPhone: customer.secondaryPhone ?? '',
      company: customer.company ?? '',
      customerType: customer.customerType ?? '',
      referralSource: customer.referralSource ?? '',
      billingAddress: customer.billingAddress ?? '',
      billingCity: customer.billingCity ?? '',
      billingState: customer.billingState ?? '',
      billingZip: customer.billingZip ?? '',
      notes: customer.notes ?? '',
      tags: customer.tags ?? [],
      ...Object.fromEntries(Object.entries(cf).map(([k, v]) => [`cf_${k}`, v])),
    });
    setEditing(true);
  };

  const handleSave = () => {
    const customFieldValues: Record<string, string> = {};
    const body: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(form)) {
      if (k.startsWith('cf_')) {
        customFieldValues[k.slice(3)] = v as string;
      } else {
        body[k] = v;
      }
    }
    body.customFieldValues = customFieldValues;

    updateCustomer.mutate(
      { id, data: body as Parameters<typeof updateCustomer.mutate>[0]['data'] },
      {
        onSuccess: () => {
          toast.success('Customer updated');
          qc.invalidateQueries({ queryKey: getGetCustomerQueryKey(id) });
          setEditing(false);
        },
        onError: () => toast.error('Failed to update customer'),
      },
    );
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    const cur = (form.tags as string[]) ?? [];
    if (!cur.includes(t)) setForm(f => ({ ...f, tags: [...cur, t] }));
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setForm(f => ({ ...f, tags: ((f.tags as string[]) ?? []).filter(t => t !== tag) }));
  };

  const setField = (key: string, val: string) => setForm(f => ({ ...f, [key]: val }));

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  if (!customer) return <div className="p-8 text-center text-muted-foreground">Customer not found.</div>;

  const totalJobValue = (jobs ?? []).reduce((s, j) => s + (j.totalAmount ?? 0), 0);
  const completedJobs = (jobs ?? []).filter(j => j.status === 'completed').length;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation('/customers')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight">{customer.name}</h1>
            {customer.customerType && (
              <Badge variant="secondary" className="capitalize">{customer.customerType}</Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
            {customer.company && <span className="flex items-center gap-1"><Building className="w-4 h-4" />{customer.company}</span>}
            <span className="flex items-center gap-1"><Phone className="w-4 h-4" />{customer.phone}</span>
            <span className="flex items-center gap-1"><Mail className="w-4 h-4" />{customer.email}</span>
          </div>
        </div>
        <Button onClick={openEdit} className="gap-2 shrink-0">
          <Edit className="w-4 h-4" /> Edit Customer
        </Button>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Spend', value: `$${(customer.totalSpend ?? 0).toLocaleString()}`, icon: DollarSign, color: 'text-emerald-600' },
          { label: 'Properties', value: String(properties?.length ?? 0), icon: Home, color: 'text-blue-600' },
          { label: 'Total Jobs', value: String(jobs?.length ?? 0), icon: Briefcase, color: 'text-violet-600' },
          { label: 'Completed', value: String(completedJobs), icon: Calendar, color: 'text-amber-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-muted ${color}`}><Icon className="w-5 h-5" /></div>
              <div>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="properties">Properties ({properties?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="jobs">Jobs ({jobs?.length ?? 0})</TabsTrigger>
        </TabsList>

        {/* Overview tab */}
        <TabsContent value="overview" className="space-y-4 focus-visible:outline-none">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><User className="w-4 h-4" />Contact Information</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row label="Name" value={customer.name} />
                <Row label="Email" value={customer.email} />
                <Row label="Phone" value={customer.phone} />
                {customer.secondaryPhone && <Row label="Secondary Phone" value={customer.secondaryPhone} />}
                {customer.company && <Row label="Company" value={customer.company} />}
                {customer.customerType && <Row label="Customer Type" value={customer.customerType} />}
                {customer.referralSource && <Row label="Referral Source" value={customer.referralSource} />}
              </CardContent>
            </Card>

            {(customer.billingAddress || customer.notes) && (
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" />Billing & Notes</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {customer.billingAddress && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Billing Address</p>
                      <p>{customer.billingAddress}</p>
                      {(customer.billingCity || customer.billingState) && (
                        <p className="text-muted-foreground">{[customer.billingCity, customer.billingState, customer.billingZip].filter(Boolean).join(', ')}</p>
                      )}
                    </div>
                  )}
                  {customer.notes && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
                      <p className="whitespace-pre-wrap">{customer.notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Tags */}
          {(customer.tags ?? []).length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Tag className="w-4 h-4" />Tags</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {(customer.tags ?? []).map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Custom fields */}
          {(() => {
            const cfVals = (customer.customFieldValues as Record<string, string>) ?? {};
            const customFields = activeFields.filter(f => !f.isBuiltIn && Object.keys(cfVals).includes(f.key));
            if (!customFields.length) return null;
            return (
              <Card>
                <CardHeader><CardTitle className="text-base">Additional Information</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {customFields.map(f => cfVals[f.key] && <Row key={f.key} label={f.label} value={cfVals[f.key]} />)}
                </CardContent>
              </Card>
            );
          })()}
        </TabsContent>

        {/* Properties tab */}
        <TabsContent value="properties" className="focus-visible:outline-none">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle>Properties</CardTitle>
                <CardDescription>Properties currently associated with this customer.</CardDescription>
              </div>
              <Button size="sm" className="gap-2" onClick={() => setLocation('/properties/new')}>
                <Plus className="w-4 h-4" /> Add Property
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {!properties?.length ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Home className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No properties linked to this customer.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Address</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Geofence</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {properties.map(p => (
                      <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/properties/${p.id}`)}>
                        <TableCell>
                          <div className="flex items-start gap-2">
                            <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                            <div>
                              <div className="font-medium">{p.address}</div>
                              <div className="text-xs text-muted-foreground">{[p.city, p.state, p.zip].filter(Boolean).join(', ')}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{p.type ? <Badge variant="secondary" className="capitalize">{p.type}</Badge> : '-'}</TableCell>
                        <TableCell>
                          {p.geofenceLat ? (
                            <span className="text-xs text-emerald-600 font-medium">Set ({p.geofenceRadius}m)</span>
                          ) : <span className="text-xs text-muted-foreground">Not set</span>}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); setLocation(`/properties/${p.id}`); }}>
                            View →
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Jobs tab */}
        <TabsContent value="jobs" className="focus-visible:outline-none">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle>Job History</CardTitle>
                <CardDescription>All jobs associated with this customer.</CardDescription>
              </div>
              <Button size="sm" variant="outline" className="gap-2">
                <Plus className="w-4 h-4" /> New Job
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(jobs ?? []).map(job => (
                    <TableRow key={job.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell className="font-medium">{job.title}</TableCell>
                      <TableCell>
                        <Badge className={`capitalize ${STATUS_COLORS[job.status] ?? ''}`}>
                          {job.status.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(job.scheduledAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{job.propertyAddress ?? '-'}</TableCell>
                      <TableCell className="text-right font-medium">${(job.totalAmount ?? 0).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {!jobs?.length && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                        <Briefcase className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        No jobs found for this customer.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Sheet */}
      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>Edit Customer</SheetTitle>
            <SheetDescription>Update customer information. Changes are saved immediately.</SheetDescription>
          </SheetHeader>

          <div className="space-y-6 pb-6">
            {/* Core fields always shown */}
            <Section title="Contact Information" icon={<User className="w-4 h-4" />}>
              <Field label="Full Name" required>
                <Input value={form.name as string} onChange={e => setField('name', e.target.value)} placeholder="Jane Smith" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Email" required>
                  <Input type="email" value={form.email as string} onChange={e => setField('email', e.target.value)} placeholder="jane@example.com" />
                </Field>
                <Field label="Phone" required>
                  <Input value={form.phone as string} onChange={e => setField('phone', e.target.value)} placeholder="(555) 000-0000" />
                </Field>
              </div>

              {/* Built-in configurable fields */}
              {activeFields.filter(f => f.isBuiltIn && f.visible && f.key === 'secondaryPhone').map(f => (
                <Field key={f.key} label={f.label} required={f.required}>
                  <Input value={form.secondaryPhone as string} onChange={e => setField('secondaryPhone', e.target.value)} placeholder="(555) 000-0001" />
                </Field>
              ))}
              {activeFields.filter(f => f.isBuiltIn && f.visible && f.key === 'company').map(f => (
                <Field key={f.key} label={f.label} required={f.required}>
                  <Input value={form.company as string} onChange={e => setField('company', e.target.value)} placeholder="Acme Corp" />
                </Field>
              ))}
              {activeFields.filter(f => f.isBuiltIn && f.visible && f.key === 'customerType').map(f => (
                <Field key={f.key} label={f.label} required={f.required}>
                  <Select value={form.customerType as string} onValueChange={v => setField('customerType', v)}>
                    <SelectTrigger><SelectValue placeholder="Select type..." /></SelectTrigger>
                    <SelectContent>
                      {['residential', 'commercial', 'hoa', 'government', 'other'].map(t => (
                        <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ))}
              {activeFields.filter(f => f.isBuiltIn && f.visible && f.key === 'referralSource').map(f => (
                <Field key={f.key} label={f.label} required={f.required}>
                  <Select value={form.referralSource as string} onValueChange={v => setField('referralSource', v)}>
                    <SelectTrigger><SelectValue placeholder="Select source..." /></SelectTrigger>
                    <SelectContent>
                      {['Google', 'Word of Mouth', 'Flyer', 'Repeat Customer', 'Social Media', 'Referral', 'Other'].map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ))}
            </Section>

            {/* Billing address */}
            {activeFields.some(f => f.key === 'billingAddress' && f.visible) && (
              <Section title="Billing Address" icon={<Home className="w-4 h-4" />}>
                <Field label="Street Address" required={activeFields.find(f => f.key === 'billingAddress')?.required}>
                  <Input value={form.billingAddress as string} onChange={e => setField('billingAddress', e.target.value)} placeholder="123 Main St" />
                </Field>
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-1">
                    <Field label="City">
                      <Input value={form.billingCity as string} onChange={e => setField('billingCity', e.target.value)} placeholder="Los Angeles" />
                    </Field>
                  </div>
                  <Field label="State">
                    <Input value={form.billingState as string} onChange={e => setField('billingState', e.target.value)} placeholder="CA" maxLength={2} />
                  </Field>
                  <Field label="ZIP">
                    <Input value={form.billingZip as string} onChange={e => setField('billingZip', e.target.value)} placeholder="90210" />
                  </Field>
                </div>
              </Section>
            )}

            {/* Notes */}
            {activeFields.some(f => f.key === 'notes' && f.visible) && (
              <Section title="Notes" icon={<FileText className="w-4 h-4" />}>
                <Textarea
                  value={form.notes as string}
                  onChange={e => setField('notes', e.target.value)}
                  placeholder="Internal notes about this customer..."
                  className="min-h-[100px]"
                />
              </Section>
            )}

            {/* Tags */}
            {activeFields.some(f => f.key === 'tags' && f.visible) && (
              <Section title="Tags" icon={<Tag className="w-4 h-4" />}>
                <div className="flex flex-wrap gap-2 mb-2">
                  {((form.tags as string[]) ?? []).map(tag => (
                    <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                      {tag}
                      <button onClick={() => removeTag(tag)} className="ml-1 hover:text-destructive">
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Add tag..."
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                    className="flex-1"
                  />
                  <Button variant="outline" size="sm" onClick={addTag} type="button">Add</Button>
                </div>
              </Section>
            )}

            {/* Custom fields from settings */}
            {(() => {
              const customFields = activeFields.filter(f => !f.isBuiltIn && f.visible);
              if (!customFields.length) return null;
              return (
                <Section title="Additional Information" icon={<Briefcase className="w-4 h-4" />}>
                  {customFields.map(f => (
                    <Field key={f.key} label={f.label} required={f.required}>
                      {f.type === 'select' && f.options ? (
                        <Select value={form[`cf_${f.key}`] as string ?? ''} onValueChange={v => setField(`cf_${f.key}`, v)}>
                          <SelectTrigger><SelectValue placeholder={`Select ${f.label}...`} /></SelectTrigger>
                          <SelectContent>
                            {f.options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : f.type === 'textarea' ? (
                        <Textarea value={form[`cf_${f.key}`] as string ?? ''} onChange={e => setField(`cf_${f.key}`, e.target.value)} />
                      ) : (
                        <Input
                          type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                          value={form[`cf_${f.key}`] as string ?? ''}
                          onChange={e => setField(`cf_${f.key}`, e.target.value)}
                        />
                      )}
                    </Field>
                  ))}
                </Section>
              );
            })()}

            <Separator />
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={updateCustomer.isPending} className="gap-2">
                <Save className="w-4 h-4" />
                {updateCustomer.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground min-w-[140px] shrink-0">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-2 text-foreground/80">
        {icon}{title}
      </h3>
      {children}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">
        {label}{required && <span className="text-destructive ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}
