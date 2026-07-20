import React, { useState } from 'react';
import {
  useListCustomers, getListCustomersQueryKey,
  useCreateCustomer,
  useGetTenantSettings, getGetTenantSettingsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Search, Plus, Building, Phone, Mail, Save, X, User, Tag, FileText, Home, AlertTriangle, Filter } from 'lucide-react';
import { useLocation } from 'wouter';
import { useDebounce } from '@/hooks/use-debounce';
import { toast } from 'sonner';
import { getActiveCustomerFields } from '@/lib/fieldConfig';
import { ImportExportControls } from '@/components/data-io/ImportExportControls';

type FormData = Record<string, string | string[]>;

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

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-2 text-foreground/80">{icon}{title}</h3>
      {children}
    </div>
  );
}

const BLANK: FormData = {
  name: '', email: '', phone: '', secondaryPhone: '',
  company: '', customerType: '', referralSource: '',
  billingAddress: '', billingCity: '', billingState: '', billingZip: '',
  notes: '', tags: [],
};

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [reminderFailureFilter, setReminderFailureFilter] = useState(false);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormData>(BLANK);
  const [tagInput, setTagInput] = useState('');

  const queryParams = {
    q: debouncedSearch || undefined,
    limit: 50,
    hasReminderFailure: reminderFailureFilter ? true : undefined,
  };

  const { data, isLoading } = useListCustomers(
    queryParams,
    { query: { queryKey: getListCustomersQueryKey(queryParams) } },
  );
  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });

  const createCustomer = useCreateCustomer();
  const activeFields = getActiveCustomerFields(settings);

  const setField = (key: string, val: string) => setForm(f => ({ ...f, [key]: val }));

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    const cur = (form.tags as string[]) ?? [];
    if (!cur.includes(t)) setForm(f => ({ ...f, tags: [...cur, t] }));
    setTagInput('');
  };
  const removeTag = (tag: string) => setForm(f => ({ ...f, tags: ((f.tags as string[]) ?? []).filter(t => t !== tag) }));

  const handleCreate = () => {
    if (!form.name || !form.email || !form.phone) {
      toast.error('Name, email, and phone are required');
      return;
    }
    const customFieldValues: Record<string, string> = {};
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(form)) {
      if (k.startsWith('cf_')) customFieldValues[k.slice(3)] = v as string;
      else body[k] = v;
    }
    body.customFieldValues = customFieldValues;

    createCustomer.mutate(
      { data: body as unknown as Parameters<typeof createCustomer.mutate>[0]['data'] },
      {
        onSuccess: (customer) => {
          toast.success(`Customer "${customer.name}" created`);
          qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
          setCreating(false);
          setForm(BLANK);
          setLocation(`/customers/${customer.id}`);
        },
        onError: () => toast.error('Failed to create customer'),
      },
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
          <p className="text-muted-foreground mt-1">Manage your client base and their properties.</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportControls
            entity="customers"
            entityLabel="Customers"
            exportQuery={{ q: debouncedSearch || undefined }}
            onImportComplete={() => qc.invalidateQueries({ queryKey: getListCustomersQueryKey() })}
          />
          <Button onClick={() => setCreating(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Add Customer
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search customers..."
                className="pl-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <Button
              variant={reminderFailureFilter ? 'default' : 'outline'}
              size="sm"
              className="gap-2 shrink-0"
              onClick={() => setReminderFailureFilter(v => !v)}
            >
              <AlertTriangle className="w-4 h-4" />
              Reminder Failures
              {reminderFailureFilter && data?.total != null && (
                <Badge variant="secondary" className="ml-1 bg-white/20 text-white border-0">{data.total}</Badge>
              )}
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Properties</TableHead>
                <TableHead className="text-right">Total Spend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading customers...</TableCell></TableRow>
              ) : data?.items.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  {reminderFailureFilter ? 'No customers with reminder failures found.' : 'No customers found.'}
                </TableCell></TableRow>
              ) : (
                data?.items.map(customer => {
                  const failure = (customer as any).lastReminderFailure as { channel: string; errorNote: string; failedAt: string } | null;
                  return (
                    <TableRow
                      key={customer.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setLocation(`/customers/${customer.id}`)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="font-medium">{customer.name}</div>
                          {failure && (
                            <Badge variant="outline" className="gap-1 text-red-600 border-red-200 text-[10px] px-1.5 py-0 shrink-0">
                              <AlertTriangle className="w-3 h-3" /> Reminder failed
                            </Badge>
                          )}
                        </div>
                        {customer.company && <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Building className="w-3 h-3" />{customer.company}</div>}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm flex flex-col gap-0.5">
                          <div className="flex items-center gap-2 text-muted-foreground"><Phone className="w-3 h-3" />{customer.phone}</div>
                          <div className="flex items-center gap-2 text-muted-foreground"><Mail className="w-3 h-3" />{customer.email}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {(customer as { customerType?: string }).customerType ? (
                          <Badge variant="secondary" className="capitalize">{(customer as { customerType?: string }).customerType}</Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell><Badge variant="secondary">{customer.propertyCount || 0}</Badge></TableCell>
                      <TableCell className="text-right font-medium">${(customer.totalSpend ?? 0).toLocaleString()}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Customer Sheet */}
      <Sheet open={creating} onOpenChange={setCreating}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>Add New Customer</SheetTitle>
            <SheetDescription>Fill in the customer's details below.</SheetDescription>
          </SheetHeader>

          <div className="space-y-6 pb-6">
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

            {activeFields.some(f => f.key === 'notes' && f.visible) && (
              <Section title="Notes" icon={<FileText className="w-4 h-4" />}>
                <Textarea value={form.notes as string} onChange={e => setField('notes', e.target.value)} placeholder="Internal notes about this customer..." className="min-h-[80px]" />
              </Section>
            )}

            {activeFields.some(f => f.key === 'tags' && f.visible) && (
              <Section title="Tags" icon={<Tag className="w-4 h-4" />}>
                <div className="flex flex-wrap gap-2 mb-2">
                  {((form.tags as string[]) ?? []).map(tag => (
                    <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                      {tag}
                      <button onClick={() => removeTag(tag)} className="ml-1 hover:text-destructive"><X className="w-3 h-3" /></button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input placeholder="Add tag..." value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} className="flex-1" />
                  <Button variant="outline" size="sm" onClick={addTag} type="button">Add</Button>
                </div>
              </Section>
            )}

            {/* Custom fields */}
            {(() => {
              const customFields = activeFields.filter(f => !f.isBuiltIn && f.visible);
              if (!customFields.length) return null;
              return (
                <Section title="Additional Information">
                  {customFields.map(f => (
                    <Field key={f.key} label={f.label} required={f.required}>
                      {f.type === 'select' && f.options ? (
                        <Select value={form[`cf_${f.key}`] as string ?? ''} onValueChange={v => setField(`cf_${f.key}`, v)}>
                          <SelectTrigger><SelectValue placeholder={`Select ${f.label}...`} /></SelectTrigger>
                          <SelectContent>{f.options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : f.type === 'textarea' ? (
                        <Textarea value={form[`cf_${f.key}`] as string ?? ''} onChange={e => setField(`cf_${f.key}`, e.target.value)} />
                      ) : (
                        <Input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={form[`cf_${f.key}`] as string ?? ''} onChange={e => setField(`cf_${f.key}`, e.target.value)} />
                      )}
                    </Field>
                  ))}
                </Section>
              );
            })()}

            <Separator />
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createCustomer.isPending} className="gap-2">
                <Save className="w-4 h-4" />
                {createCustomer.isPending ? 'Creating...' : 'Create Customer'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
