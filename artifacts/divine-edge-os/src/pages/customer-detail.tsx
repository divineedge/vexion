import React, { useState } from 'react';
import {
  useGetCustomer, getGetCustomerQueryKey,
  useUpdateCustomer,
  useListProperties, getListPropertiesQueryKey,
  useListJobs, getListJobsQueryKey,
  useGetTenantSettings, getGetTenantSettingsQueryKey,
  useGetCustomerPortalLink, getGetCustomerPortalLinkQueryKey,
  useListCustomerMessages, getListCustomerMessagesQueryKey,
  useSendMessage,
  useResumeCustomerService,
} from '@workspace/api-client-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useParams, useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  ArrowLeft, Building, Phone, Mail, Edit, Plus, Calendar, MapPin,
  Save, X, User, FileText, Tag, DollarSign, Home, Briefcase, Megaphone, AlertTriangle, Link,
  MessageSquare, Send, PhoneOff, MailMinus, ChevronRight, PlayCircle,
} from 'lucide-react';
import CustomerAvatar from '@/components/media/CustomerAvatar';
import CustomerPlansTab from '@/components/customer/CustomerPlansTab';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import type { CustomerFieldConfig, TenantSettings } from '@/lib/fieldConfig';
import { getActiveCustomerFields } from '@/lib/fieldConfig';
import { useDebounce } from '@/hooks/use-debounce';

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-emerald-500/10 text-emerald-700 border-transparent',
  in_progress: 'bg-blue-500/10 text-blue-700 border-transparent',
  scheduled: 'bg-amber-500/10 text-amber-700 border-transparent',
  on_hold: 'bg-gray-200 text-gray-600 border-transparent',
  cancelled: 'bg-red-500/10 text-red-600 border-transparent',
};

type FormData = Record<string, string | string[]>;

type PropertyForm = {
  address: string;
  city: string;
  state: string;
  zip: string;
  type: string;
  notes: string;
};

const BLANK_PROPERTY: PropertyForm = { address: '', city: '', state: '', zip: '', type: '', notes: '' };

interface DuplicateProperty {
  id: number;
  address: string;
  city: string | null;
  state: string | null;
  customerId: number;
  customerName: string | null;
}

interface Campaign {
  id: number;
  name: string;
}

export default function CustomerDetailPage() {
  const params = useParams();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const { user, canManageOffice } = useAuth();
  const qc = useQueryClient();

  // Edit customer state
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormData>({});
  const [tagInput, setTagInput] = useState('');

  // Messaging state
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeChannel, setComposeChannel] = useState<'sms' | 'email'>('sms');
  const [composeBody, setComposeBody] = useState('');
  const [composeSubject, setComposeSubject] = useState('');

  // Add property state
  const [addPropertyOpen, setAddPropertyOpen] = useState(false);
  const [propForm, setPropForm] = useState<PropertyForm>(BLANK_PROPERTY);
  const [duplicates, setDuplicates] = useState<DuplicateProperty[]>([]);
  const [transferTarget, setTransferTarget] = useState<DuplicateProperty | null>(null);
  const [addingProperty, setAddingProperty] = useState(false);

  const debouncedAddress = useDebounce(propForm.address, 500);

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
  const { data: campaigns } = useQuery<Campaign[]>({
    queryKey: ['marketing-campaigns-slim'],
    queryFn: () => customFetch<Campaign[]>('/api/marketing/campaigns'),
  });

  // Check for duplicate properties whenever address changes
  const { data: duplicateCheck } = useQuery<DuplicateProperty[]>({
    queryKey: ['property-check', debouncedAddress],
    queryFn: () =>
      debouncedAddress.trim().length >= 4
        ? customFetch<DuplicateProperty[]>(`/api/properties/check?address=${encodeURIComponent(debouncedAddress)}`)
        : Promise.resolve([]),
    enabled: addPropertyOpen && debouncedAddress.trim().length >= 4,
  });

  // Filter out properties already belonging to THIS customer
  const externalDuplicates = (duplicateCheck ?? []).filter(d => d.customerId !== id);

  const updateCustomer = useUpdateCustomer();
  const resumeService = useResumeCustomerService();
  const activeFields = getActiveCustomerFields(settings as TenantSettings | undefined);
  const { data: portalLink } = useGetCustomerPortalLink(id, {
    query: { enabled: !!id, queryKey: getGetCustomerPortalLinkQueryKey(id) },
  });
  const { data: messages, refetch: refetchMessages } = useListCustomerMessages(id, {
    query: { enabled: !!id, queryKey: getListCustomerMessagesQueryKey(id) },
  });
  const sendMessage = useSendMessage();

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
      acquiredFromCampaignId: String((customer as any).acquiredFromCampaignId ?? ''),
      ...Object.fromEntries(Object.entries(cf).map(([k, v]) => [`cf_${k}`, v])),
    });
    setEditing(true);
  };

  const handleSave = () => {
    const customFieldValues: Record<string, string> = {};
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(form)) {
      if (k.startsWith('cf_')) customFieldValues[k.slice(3)] = v as string;
      else body[k] = v;
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
  const removeTag = (tag: string) => setForm(f => ({ ...f, tags: ((f.tags as string[]) ?? []).filter(t => t !== tag) }));
  const setField = (key: string, val: string) => setForm(f => ({ ...f, [key]: val }));

  const openAddProperty = () => {
    setPropForm(BLANK_PROPERTY);
    setDuplicates([]);
    setAddPropertyOpen(true);
  };

  const handleAddProperty = async () => {
    if (!propForm.address.trim()) { toast.error('Address is required'); return; }
    setAddingProperty(true);
    try {
      await customFetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: id,
          address: propForm.address,
          city: propForm.city || undefined,
          state: propForm.state || undefined,
          zip: propForm.zip || undefined,
          type: propForm.type || undefined,
          notes: propForm.notes || undefined,
        }),
      });
      toast.success('Property added');
      qc.invalidateQueries({ queryKey: getListPropertiesQueryKey({ customerId: id }) });
      qc.invalidateQueries({ queryKey: getGetCustomerQueryKey(id) });
      setAddPropertyOpen(false);
      setPropForm(BLANK_PROPERTY);
    } catch {
      toast.error('Failed to add property');
    } finally {
      setAddingProperty(false);
    }
  };

  const handleTransferProperty = async (dup: DuplicateProperty) => {
    try {
      await customFetch(`/api/properties/${dup.id}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newCustomerId: id }),
      });
      toast.success(`Property transferred from ${dup.customerName ?? 'previous customer'}`);
      qc.invalidateQueries({ queryKey: getListPropertiesQueryKey({ customerId: id }) });
      qc.invalidateQueries({ queryKey: getGetCustomerQueryKey(id) });
      setTransferTarget(null);
      setAddPropertyOpen(false);
      setPropForm(BLANK_PROPERTY);
    } catch {
      toast.error('Failed to transfer property');
    }
  };

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  if (!customer) return <div className="p-8 text-center text-muted-foreground">Customer not found.</div>;

  const totalJobValue = (jobs ?? []).reduce((s, j) => s + (j.totalAmount ?? 0), 0);
  const completedJobs = (jobs ?? []).filter(j => j.status === 'completed').length;
  const linkedCampaign = campaigns?.find(c => c.id === (customer as any).acquiredFromCampaignId);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation('/customers')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <CustomerAvatar
          customerId={id}
          name={customer.name}
          profilePhotoUrl={(customer as any).profilePhotoUrl}
          size="lg"
          onUpdated={() => { /* react-query cache is updated via customFetch */ }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight">{customer.name}</h1>
            {customer.customerType && (
              <Badge variant="secondary" className="capitalize">{customer.customerType}</Badge>
            )}
            {linkedCampaign && (
              <Badge variant="outline" className="gap-1 text-violet-700 border-violet-200 bg-violet-50">
                <Megaphone className="w-3 h-3" /> {linkedCampaign.name}
              </Badge>
            )}
            {customer.paymentStanding && (() => {
              const ps = customer.paymentStanding;
              const label =
                ps.status === 'current'  ? 'Current' :
                ps.status === 'reminded' ? 'Reminder sent' :
                ps.status === 'overdue'  ? `Overdue — ${ps.daysOverdue ?? 0}d, ${(ps.overdueAmount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}` :
                ps.status === 'flagged'  ? 'Flagged for stop-service' :
                ps.status === 'paused'   ? 'Service paused' : '';
              const cls =
                ps.status === 'current'  ? 'bg-emerald-100 text-emerald-800 border-transparent' :
                ps.status === 'reminded' ? 'bg-amber-100 text-amber-800 border-transparent' :
                ps.status === 'overdue'  ? 'bg-orange-100 text-orange-800 border-transparent' :
                ps.status === 'flagged'  ? 'bg-red-100 text-red-800 border-transparent' :
                ps.status === 'paused'   ? 'bg-red-100 text-red-700 border-transparent' : '';
              return (
                <Badge variant="outline" className={cls}>{label}</Badge>
              );
            })()}
          </div>
          <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
            {customer.company && <span className="flex items-center gap-1"><Building className="w-4 h-4" />{customer.company}</span>}
            <span className="flex items-center gap-1"><Phone className="w-4 h-4" />{customer.phone}</span>
            <span className="flex items-center gap-1"><Mail className="w-4 h-4" />{customer.email}</span>
            {customer.paymentStanding && (customer.paymentStanding.overdueAmount ?? 0) > 0 && customer.paymentStanding.status !== 'overdue' && (
              <span className="flex items-center gap-1 text-orange-600">
                <AlertTriangle className="w-3.5 h-3.5" />
                {customer.paymentStanding.daysOverdue ?? 0}d overdue · ${(customer.paymentStanding.overdueAmount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {portalLink && (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                navigator.clipboard.writeText(portalLink.url);
                toast.success('Portal link copied to clipboard');
              }}
            >
              <Link className="w-4 h-4" /> Copy Portal Link
            </Button>
          )}
          {canManageOffice && customer.paymentStanding?.isServicePaused && (
            <Button
              variant="outline"
              className="gap-2 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
              disabled={resumeService.isPending}
              onClick={() => {
                resumeService.mutate(
                  { id },
                  {
                    onSuccess: () => {
                      toast.success('Service resumed');
                      qc.invalidateQueries({ queryKey: getGetCustomerQueryKey(id) });
                    },
                    onError: () => toast.error('Failed to resume service'),
                  },
                );
              }}
            >
              <PlayCircle className="w-4 h-4" />
              {resumeService.isPending ? 'Resuming...' : 'Resume Service'}
            </Button>
          )}
          <Button onClick={openEdit} className="gap-2">
            <Edit className="w-4 h-4" /> Edit Customer
          </Button>
        </div>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'Lifetime Spend', value: `${(customer.totalSpend ?? 0).toLocaleString()}`, icon: DollarSign, color: 'text-emerald-600' },
          { label: `${new Date().getFullYear()} Spend`, value: (customer as any).thisYearSpend != null ? `${(customer as any).thisYearSpend.toLocaleString()}` : '—', icon: DollarSign, color: 'text-teal-600' },
          { label: `${new Date().getFullYear() - 1} Spend`, value: (customer as any).lastYearSpend != null ? `${(customer as any).lastYearSpend.toLocaleString()}` : '—', icon: DollarSign, color: 'text-cyan-600' },
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
          <TabsTrigger value="messages">Messages ({messages?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="plans">Plans</TabsTrigger>
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

            {/* Marketing Campaign Card */}
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Megaphone className="w-4 h-4" />Marketing Campaign</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {linkedCampaign ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{linkedCampaign.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Acquired via this campaign</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        updateCustomer.mutate(
                          { id, data: { acquiredFromCampaignId: null } as any },
                          {
                            onSuccess: () => { toast.success('Campaign unlinked'); qc.invalidateQueries({ queryKey: getGetCustomerQueryKey(id) }); },
                          },
                        );
                      }}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-muted-foreground text-sm">No campaign linked to this customer.</p>
                    {(campaigns ?? []).length > 0 && (
                      <Select
                        value=""
                        onValueChange={v => {
                          if (!v) return;
                          updateCustomer.mutate(
                            { id, data: { acquiredFromCampaignId: v } as any },
                            {
                              onSuccess: () => { toast.success('Campaign linked'); qc.invalidateQueries({ queryKey: getGetCustomerQueryKey(id) }); },
                            },
                          );
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Link to a campaign..." />
                        </SelectTrigger>
                        <SelectContent>
                          {(campaigns ?? []).map(c => (
                            <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

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
              <Button size="sm" className="gap-2" onClick={openAddProperty}>
                <Plus className="w-4 h-4" /> Add Property
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {!properties?.length ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Home className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No properties linked to this customer.</p>
                  <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={openAddProperty}>
                    <Plus className="w-4 h-4" /> Add First Property
                  </Button>
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

        {/* Messages tab */}
        <TabsContent value="messages" className="focus-visible:outline-none">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle>Conversation Thread</CardTitle>
                <CardDescription>All sent and received SMS/email messages with this customer.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {(() => {
                  const failure = (customer as any).lastReminderFailure as { channel: string; errorNote: string; failedAt: string } | null;
                  if (!failure) return null;
                  return (
                    <Badge variant="outline" className="text-red-600 border-red-200 gap-1 text-xs" title={`${failure.channel.toUpperCase()} failed: ${failure.errorNote}`}>
                      <AlertTriangle className="w-3 h-3" /> Last reminder failed ({failure.channel.toUpperCase()})
                    </Badge>
                  );
                })()}
                {(customer as any).smsOptOut && (
                  <Badge variant="outline" className="text-orange-600 border-orange-300 gap-1 text-xs">
                    <PhoneOff className="w-3 h-3" /> SMS opt-out
                  </Badge>
                )}
                {(customer as any).emailOptOut && (
                  <Badge variant="outline" className="text-orange-600 border-orange-300 gap-1 text-xs">
                    <MailMinus className="w-3 h-3" /> Email opt-out
                  </Badge>
                )}
                <Button size="sm" className="gap-2" onClick={() => setComposeOpen(true)}>
                  <MessageSquare className="w-4 h-4" /> Send Message
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {!messages?.length ? (
                <div className="text-center py-12 text-muted-foreground">
                  <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No messages yet.</p>
                  <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={() => setComposeOpen(true)}>
                    <Send className="w-4 h-4" /> Send First Message
                  </Button>
                </div>
              ) : (
                <div className="divide-y">
                  {(messages ?? []).map(msg => (
                    <div key={msg.id} className={`flex gap-3 px-6 py-4 ${msg.direction === 'outbound' ? 'bg-muted/20' : ''}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                        msg.direction === 'outbound' ? 'bg-primary/10 text-primary' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {msg.direction === 'outbound' ? 'US' : customer.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs font-medium text-muted-foreground capitalize">
                            {msg.direction} · {msg.channel.toUpperCase()}
                          </span>
                          {msg.subject && <span className="text-xs text-muted-foreground">· {msg.subject}</span>}
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 ml-auto ${
                              msg.status === 'sent' || msg.status === 'delivered' ? 'text-emerald-600 border-emerald-200' :
                              msg.status === 'received' ? 'text-blue-600 border-blue-200' :
                              msg.status === 'failed' ? 'text-red-600 border-red-200' : 'text-muted-foreground'
                            }`}
                          >
                            {msg.status}
                          </Badge>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(msg.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
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

        {/* Plans tab */}
        <TabsContent value="plans" className="focus-visible:outline-none">
          <CustomerPlansTab customerId={id} properties={(properties ?? []).map(p => ({ id: p.id, address: p.address }))} />
        </TabsContent>
      </Tabs>

      {/* Compose Message Sheet */}
      <Sheet open={composeOpen} onOpenChange={open => { if (!open) { setComposeOpen(false); setComposeBody(''); setComposeSubject(''); } }}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader className="pb-4">
            <SheetTitle>Send Message to {customer.name}</SheetTitle>
            <SheetDescription>Choose SMS or Email and compose your message.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 pb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Channel</label>
              <div className="flex rounded-md border bg-muted/50 p-1 gap-1 w-fit">
                <button
                  type="button"
                  onClick={() => setComposeChannel('sms')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${composeChannel === 'sms' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Phone className="w-3.5 h-3.5" /> SMS
                </button>
                <button
                  type="button"
                  onClick={() => setComposeChannel('email')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${composeChannel === 'email' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Mail className="w-3.5 h-3.5" /> Email
                </button>
              </div>
            </div>

            {composeChannel === 'sms' && (customer as any).smsOptOut && (
              <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-800 flex items-start gap-2">
                <PhoneOff className="w-4 h-4 shrink-0 mt-0.5" />
                <p>This customer has opted out of SMS. Remove the opt-out flag on their record before sending.</p>
              </div>
            )}
            {composeChannel === 'email' && (customer as any).emailOptOut && (
              <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-800 flex items-start gap-2">
                <MailMinus className="w-4 h-4 shrink-0 mt-0.5" />
                <p>This customer has opted out of email. Remove the opt-out flag on their record before sending.</p>
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              To: <span className="font-medium text-foreground">{composeChannel === 'sms' ? customer.phone : customer.email}</span>
            </div>

            {composeChannel === 'email' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Subject</label>
                <Input
                  placeholder="Subject..."
                  value={composeSubject}
                  onChange={e => setComposeSubject(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Message</label>
              <Textarea
                placeholder={composeChannel === 'sms' ? 'Type your SMS message...' : 'Type your email body...'}
                rows={composeChannel === 'sms' ? 4 : 8}
                value={composeBody}
                onChange={e => setComposeBody(e.target.value)}
                maxLength={composeChannel === 'sms' ? 1600 : undefined}
              />
              {composeChannel === 'sms' && (
                <p className="text-xs text-muted-foreground text-right">{composeBody.length}/1600</p>
              )}
            </div>

            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setComposeOpen(false)}>Cancel</Button>
              <Button
                disabled={!composeBody.trim() || sendMessage.isPending}
                onClick={() => {
                  sendMessage.mutate(
                    {
                      data: {
                        customerId: id,
                        channel: composeChannel,
                        body: composeBody.trim(),
                        ...(composeChannel === 'email' && composeSubject ? { subject: composeSubject } : {}),
                      },
                    },
                    {
                      onSuccess: () => {
                        toast.success('Message sent');
                        setComposeOpen(false);
                        setComposeBody('');
                        setComposeSubject('');
                        qc.invalidateQueries({ queryKey: getListCustomerMessagesQueryKey(id) });
                      },
                      onError: (err: any) => {
                        const msg = err?.message ?? 'Failed to send message';
                        toast.error(msg.includes('opted out') ? 'Customer has opted out' : msg);
                      },
                    }
                  );
                }}
                className="gap-2"
              >
                <Send className="w-4 h-4" />
                {sendMessage.isPending ? 'Sending...' : `Send ${composeChannel.toUpperCase()}`}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Add Property Sheet */}
      <Sheet open={addPropertyOpen} onOpenChange={open => { if (!open) { setAddPropertyOpen(false); setPropForm(BLANK_PROPERTY); } }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>Add Property</SheetTitle>
            <SheetDescription>Add a property for {customer.name}. We'll check for duplicates automatically.</SheetDescription>
          </SheetHeader>

          <div className="space-y-4 pb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Street Address <span className="text-destructive">*</span></label>
              <Input
                placeholder="123 Main St"
                value={propForm.address}
                onChange={e => setPropForm(f => ({ ...f, address: e.target.value }))}
              />
            </div>

            {/* Duplicate warning */}
            {externalDuplicates.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Duplicate address detected</p>
                    <p className="text-xs text-amber-700 mt-0.5">This address already exists under another customer. You can transfer it here instead.</p>
                  </div>
                </div>
                {externalDuplicates.map(dup => (
                  <div key={dup.id} className="flex items-center justify-between bg-white rounded border border-amber-200 px-3 py-2">
                    <div>
                      <p className="text-xs font-medium">{dup.address}</p>
                      <p className="text-xs text-muted-foreground">Currently: {dup.customerName ?? 'Unknown customer'}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 border-amber-300 text-amber-700 hover:bg-amber-50"
                      onClick={() => setTransferTarget(dup)}
                    >
                      Transfer Here
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1 space-y-1.5">
                <label className="text-sm font-medium">City</label>
                <Input placeholder="Austin" value={propForm.city} onChange={e => setPropForm(f => ({ ...f, city: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">State</label>
                <Input placeholder="TX" maxLength={2} value={propForm.state} onChange={e => setPropForm(f => ({ ...f, state: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">ZIP</label>
                <Input placeholder="78701" value={propForm.zip} onChange={e => setPropForm(f => ({ ...f, zip: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Property Type</label>
              <Select value={propForm.type} onValueChange={v => setPropForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue placeholder="Select type..." /></SelectTrigger>
                <SelectContent>
                  {['residential', 'commercial', 'hoa', 'industrial', 'other'].map(t => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                placeholder="Access codes, gate info, special instructions..."
                rows={3}
                value={propForm.notes}
                onChange={e => setPropForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>

            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setAddPropertyOpen(false)}>Cancel</Button>
              <Button onClick={handleAddProperty} disabled={addingProperty}>
                {addingProperty ? 'Adding...' : 'Add Property'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Transfer confirmation dialog */}
      <Dialog open={!!transferTarget} onOpenChange={open => { if (!open) setTransferTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer Property</DialogTitle>
            <DialogDescription>
              This will move <strong>{transferTarget?.address}</strong> from{' '}
              <strong>{transferTarget?.customerName ?? 'its current owner'}</strong> to{' '}
              <strong>{customer.name}</strong>. The property's job and invoice history will remain intact.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferTarget(null)}>Cancel</Button>
            <Button onClick={() => transferTarget && handleTransferProperty(transferTarget)}>
              Confirm Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Customer Sheet */}
      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>Edit Customer</SheetTitle>
            <SheetDescription>Update customer information. Changes are saved immediately.</SheetDescription>
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

            {/* Marketing Campaign */}
            {(campaigns ?? []).length > 0 && (
              <Section title="Marketing Campaign" icon={<Megaphone className="w-4 h-4" />}>
                <Field label="Acquired Via Campaign">
                  <Select
                    value={form.acquiredFromCampaignId as string || '__none__'}
                    onValueChange={v => setField('acquiredFromCampaignId', v === '__none__' ? '' : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Select campaign..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No campaign</SelectItem>
                      {(campaigns ?? []).map(c => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </Section>
            )}

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
                <Textarea
                  value={form.notes as string}
                  onChange={e => setField('notes', e.target.value)}
                  placeholder="Internal notes about this customer..."
                  className="min-h-[100px]"
                />
              </Section>
            )}

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

            {/* Opt-out preferences */}
            <Section title="Communication Preferences" icon={<MessageSquare className="w-4 h-4" />}>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <PhoneOff className="w-3.5 h-3.5 text-muted-foreground" /> SMS Opt-Out
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Customer will not receive any SMS messages</p>
                  </div>
                  <Switch
                    checked={!!(form.smsOptOut ?? (customer as any).smsOptOut)}
                    onCheckedChange={v => setField('smsOptOut', v as any)}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <MailMinus className="w-3.5 h-3.5 text-muted-foreground" /> Email Opt-Out
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Customer will not receive any email messages</p>
                  </div>
                  <Switch
                    checked={!!(form.emailOptOut ?? (customer as any).emailOptOut)}
                    onCheckedChange={v => setField('emailOptOut', v as any)}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3 bg-primary/5">
                  <div>
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      Auto-Invoice on Job Completion
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Automatically create and email an invoice when a job is marked complete
                    </p>
                  </div>
                  <Switch
                    checked={!!(form.autoInvoiceOnCompletion ?? (customer as any).autoInvoiceOnCompletion)}
                    onCheckedChange={v => setField('autoInvoiceOnCompletion', v as any)}
                  />
                </div>
              </div>
            </Section>

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
