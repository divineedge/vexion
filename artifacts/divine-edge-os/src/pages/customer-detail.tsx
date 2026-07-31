import React, { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { loadStripe, type Stripe as StripeInstance } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import {
  useGetCustomer, getGetCustomerQueryKey,
  useUpdateCustomer,
  useListProperties, getListPropertiesQueryKey,
  useListJobs, getListJobsQueryKey,
  useListEstimates, getListEstimatesQueryKey,
  useListVisits, getListVisitsQueryKey,
  useGetTenantSettings, getGetTenantSettingsQueryKey,
  useGetCustomerPortalLink, getGetCustomerPortalLinkQueryKey,
  useListCustomerMessages, getListCustomerMessagesQueryKey,
  useSendMessage,
  useResumeCustomerService,
  useCreateEstimate,
  useGetCustomerPaymentMethod, getGetCustomerPaymentMethodQueryKey,
  useListInvoices, getListInvoicesQueryKey,
  useListCustomerPlans, getListCustomerPlansQueryKey,
  useListTags, getListTagsQueryKey,
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
  Save, X, User, FileText, Tag, DollarSign, Home, Briefcase, Megaphone, AlertTriangle, Link as LinkIcon,
  MessageSquare, Send, PhoneOff, MailMinus, ChevronRight, PlayCircle, ClipboardList, Eye, RefreshCw,
  MailWarning, CreditCard, Pencil,
} from 'lucide-react';
import { Link } from 'wouter';
import CustomerAvatar from '@/components/media/CustomerAvatar';
import PropertyThumbnail from '@/components/media/PropertyThumbnail';
import CustomerPlansTab from '@/components/customer/CustomerPlansTab';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import type { CustomerFieldConfig, TenantSettings } from '@/lib/fieldConfig';
import { getActiveCustomerFields } from '@/lib/fieldConfig';
import { useDebounce } from '@/hooks/use-debounce';

interface CardSetupInlineHandle {
  setupCard: (customerId: number) => Promise<void>;
  cardComplete: boolean;
}

const CardSetupInline = forwardRef<CardSetupInlineHandle, object>((_props, ref) => {
  const stripe = useStripe();
  const elements = useElements();
  const [cardComplete, setCardComplete] = useState(false);
  useImperativeHandle(ref, () => ({
    cardComplete,
    async setupCard(customerId: number) {
      if (!stripe || !elements) throw new Error('Stripe not ready');
      const cardEl = elements.getElement(CardElement);
      if (!cardEl) throw new Error('Card element not found');
      const si = await customFetch<{ clientSecret: string }>(
        `/api/customers/${customerId}/setup-intent`, { method: 'POST' },
      );
      const result = await stripe.confirmCardSetup(si.clientSecret, { payment_method: { card: cardEl } });
      if (result.error) throw new Error(result.error.message ?? 'Card setup failed');
      const pmId = result.setupIntent?.payment_method as string | undefined;
      if (!pmId) throw new Error('No payment method returned');
      await customFetch(`/api/customers/${customerId}/attach-payment-method`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentMethodId: pmId }),
      });
    },
  }), [stripe, elements, cardComplete]);
  return (
    <div className="border rounded-md bg-white p-3 shadow-sm">
      <CardElement onChange={e => setCardComplete(e.complete)}
        options={{ style: { base: { fontSize: '14px', color: '#1a1a1a', '::placeholder': { color: '#a0aec0' } } } }} />
    </div>
  );
});

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

function InlineNotesEditor({ customerId, initialNotes }: { customerId: number; initialNotes: string }) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(initialNotes);
  const updateCustomer = useUpdateCustomer();
  const qc = useQueryClient();

  React.useEffect(() => { setValue(initialNotes); }, [initialNotes]);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Notes</p>
        {!editing && (
          <button onClick={() => setEditing(true)} className="text-xs text-primary hover:underline" title={initialNotes ? 'Edit customer notes' : 'Add notes for this customer'}>
            {initialNotes ? 'Edit' : '+ Add'}
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={value}
            onChange={e => setValue(e.target.value)}
            rows={4}
            title="Internal notes about this customer"
            placeholder="Internal notes about this customer…"
            className="text-sm"
            autoFocus
            onBlur={() => {
              if (value !== initialNotes) {
                updateCustomer.mutate(
                  { id: customerId, data: { notes: value } as Parameters<typeof updateCustomer.mutate>[0]['data'] },
                  {
                    onSuccess: () => {
                      setEditing(false);
                      qc.invalidateQueries({ queryKey: ['customers', customerId] });
                      toast.success('Notes saved');
                    },
                    onError: () => toast.error('Failed to save notes'),
                  },
                );
              } else {
                setEditing(false);
              }
            }}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              title="Save customer notes"
              disabled={updateCustomer.isPending}
              onClick={() => {
                updateCustomer.mutate(
                  { id: customerId, data: { notes: value } as Parameters<typeof updateCustomer.mutate>[0]['data'] },
                  {
                    onSuccess: () => {
                      setEditing(false);
                      qc.invalidateQueries({ queryKey: ['customers', customerId] });
                      toast.success('Notes saved');
                    },
                    onError: () => toast.error('Failed to save notes'),
                  },
                );
              }}
            >
              {updateCustomer.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              title="Discard notes changes"
              onClick={() => { setValue(initialNotes); setEditing(false); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : initialNotes ? (
        <p className="whitespace-pre-wrap text-sm" title={initialNotes ?? undefined}>{initialNotes}</p>
      ) : (
        <p className="text-sm text-muted-foreground italic">No notes yet</p>
      )}
    </div>
  );
}

export default function CustomerDetailPage() {
  const params = useParams();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const { user, canManageOffice } = useAuth();
  const qc = useQueryClient();

  // Business tags library
  const { data: bizTags = [] } = useListTags({ query: { queryKey: getListTagsQueryKey() } });

  // Edit customer state
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormData>({});
  const [tagInput, setTagInput] = useState('');

  // Messaging state
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeChannel, setComposeChannel] = useState<'sms' | 'email'>('sms');
  const [composeBody, setComposeBody] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [resendingReminder, setResendingReminder] = useState(false);
  const [resendingInvoice, setResendingInvoice] = useState<number | null>(null);

  // Add property state
  const [addPropertyOpen, setAddPropertyOpen] = useState(false);
  const [propForm, setPropForm] = useState<PropertyForm>(BLANK_PROPERTY);
  const [duplicates, setDuplicates] = useState<DuplicateProperty[]>([]);
  const [transferTarget, setTransferTarget] = useState<DuplicateProperty | null>(null);
  const [addingProperty, setAddingProperty] = useState(false);
  const [custJobStatusFilter, setCustJobStatusFilter] = useState<'all' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'>('all');
  const [invSearch, setInvSearch] = useState('');
  const [invStatusFilter, setInvStatusFilter] = useState('all');
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'job' | 'estimate' | 'visit' | 'invoice'>('all');

  // Billing address autocomplete (Google Places when key is configured)
  const billingAddrRef = useRef<HTMLInputElement>(null);
  const billingAcRef = useRef<unknown>(null);
  const attachBillingPlaces = useCallback(() => {
    if (!billingAddrRef.current || !(window as any).google?.maps?.places || billingAcRef.current) return;
    const ac = new (window as any).google.maps.places.Autocomplete(billingAddrRef.current, {
      types: ['address'],
      componentRestrictions: { country: 'us' },
      fields: ['address_components'],
    });
    ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      const comps: Array<{ long_name: string; short_name: string; types: string[] }> =
        place.address_components ?? [];
      const get = (t: string) => comps.find(c => c.types.includes(t))?.long_name ?? '';
      const getS = (t: string) => comps.find(c => c.types.includes(t))?.short_name ?? '';
      setForm((f: Record<string, unknown>) => ({
        ...f,
        billingAddress: [get('street_number'), get('route')].filter(Boolean).join(' '),
        billingCity: get('locality') || get('sublocality_level_1'),
        billingState: getS('administrative_area_level_1'),
        billingZip: get('postal_code'),
      }));
    });
    billingAcRef.current = ac;
  }, []);
  useEffect(() => {
    const GMAPS_KEY = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
    if (!GMAPS_KEY) return undefined;
    if ((window as any).google?.maps?.places) { attachBillingPlaces(); return undefined; }
    if (document.querySelector('#gmaps-script')) {
      const iv = setInterval(() => {
        if ((window as any).google?.maps?.places) { attachBillingPlaces(); clearInterval(iv); }
      }, 150);
      return () => clearInterval(iv);
    }
    const script = document.createElement('script');
    script.id = 'gmaps-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&libraries=places&loading=async`;
    script.async = true;
    script.defer = true;
    script.onload = attachBillingPlaces;
    document.head.appendChild(script);
    return undefined;
  }, [attachBillingPlaces]);

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
  const { data: estimates } = useListEstimates(
    { customerId: id },
    { query: { enabled: !!id, queryKey: getListEstimatesQueryKey({ customerId: id }) } },
  );
  const { data: visits } = useListVisits(
    { customerId: id },
    { query: { enabled: !!id, queryKey: getListVisitsQueryKey({ customerId: id }) } },
  );
  const invParams = { customerId: id };
  const { data: custInvoices, isLoading: invLoading } = useListInvoices(
    invParams,
    { query: { enabled: !!id, queryKey: getListInvoicesQueryKey(invParams) } },
  );
  const { data: settings } = useGetTenantSettings({
    query: { queryKey: getGetTenantSettingsQueryKey() },
  });
  const { data: customerPlans } = useListCustomerPlans(
    { customerId: id } as Parameters<typeof useListCustomerPlans>[0],
    { query: { enabled: !!id, queryKey: getListCustomerPlansQueryKey({ customerId: id } as Parameters<typeof useListCustomerPlans>[0]) } },
  );
  const { data: campaigns } = useQuery<Campaign[]>({
    queryKey: ['marketing-campaigns-slim'],
    queryFn: () => customFetch<Campaign[]>('/api/marketing/campaigns'),
  });

  const { data: paymentMethodData } = useGetCustomerPaymentMethod(id, {
    query: {
      enabled: !!id && !!(customer as any)?.stripeDefaultPaymentMethodId,
      queryKey: getGetCustomerPaymentMethodQueryKey(id),
    },
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

  // Card-on-file inline setup
  const [showAddCard, setShowAddCard] = useState(false);
  const [stripePromise, setStripePromise] = useState<Promise<StripeInstance | null> | null>(null);
  const [addCardBusy, setAddCardBusy] = useState(false);
  const [cardLinkSending, setCardLinkSending] = useState(false);
  const [expiryReminderSending, setExpiryReminderSending] = useState(false);
  const cardSetupRef = useRef<CardSetupInlineHandle>(null);

  const openCardSetup = useCallback(async () => {
    if (!stripePromise) {
      const cfg = await customFetch<{ publishableKey: string | null }>('/api/stripe/config');
      if (cfg.publishableKey) setStripePromise(loadStripe(cfg.publishableKey));
    }
    setShowAddCard(true);
  }, [stripePromise]);

  const handleSaveCard = async () => {
    if (!cardSetupRef.current?.cardComplete) { toast.error('Please complete the card details'); return; }
    setAddCardBusy(true);
    try {
      await cardSetupRef.current.setupCard(id);
      toast.success('Card saved successfully');
      qc.invalidateQueries({ queryKey: getGetCustomerQueryKey(id) });
      qc.invalidateQueries({ queryKey: getGetCustomerPaymentMethodQueryKey(id) });
      setShowAddCard(false);
    } catch (e) {
      toast.error((e as Error).message ?? 'Failed to save card');
    } finally {
      setAddCardBusy(false);
    }
  };

  const handleSendExpiryReminder = async () => {
    setExpiryReminderSending(true);
    try {
      await customFetch(`/api/customers/${id}/send-expiry-reminder`, { method: 'POST' });
      toast.success('Card expiry reminder sent to customer');
    } catch {
      toast.error('Failed to send reminder');
    } finally {
      setExpiryReminderSending(false);
    }
  };

  const handleSendCardLink = async () => {
    if (!(customer as any).phone) { toast.error('Customer has no phone number on file'); return; }
    setCardLinkSending(true);
    try {
      await customFetch(`/api/customers/${id}/send-card-link`, { method: 'POST' });
      toast.success('Card setup link sent via text');
    } catch {
      toast.error('Failed to send SMS — check SMS provider settings');
    } finally {
      setCardLinkSending(false);
    }
  };
  const createEstimate = useCreateEstimate();

  const handleNewEstimate = () => {
    createEstimate.mutate(
      { data: { customerId: id } },
      {
        onSuccess: (e) => {
          toast.success('Draft estimate created');
          qc.invalidateQueries({ queryKey: getListEstimatesQueryKey({ customerId: id }) });
          setLocation(`/estimates?highlight=${e.id}`);
        },
        onError: () => toast.error('Failed to create estimate'),
      },
    );
  };
  const activeFields = getActiveCustomerFields(settings as TenantSettings | undefined);
  const { data: portalLink } = useGetCustomerPortalLink(id, {
    query: { enabled: !!id, queryKey: getGetCustomerPortalLinkQueryKey(id) },
  });
  const { data: messages, refetch: refetchMessages } = useListCustomerMessages(id, {
    query: { enabled: !!id, queryKey: getListCustomerMessagesQueryKey(id) },
  });
  const sendMessage = useSendMessage();

  type AutoInvoiceFailure = {
    id: number;
    kind: 'creation' | 'email';
    message: string;
    jobId: number | null;
    invoiceId: number | null;
    invoiceNumber?: string | null;
    createdAt: string;
  };
  const { data: autoInvoiceFailures, refetch: refetchFailures } = useQuery<AutoInvoiceFailure[]>({
    queryKey: ['auto-invoice-failures', id],
    queryFn: () => customFetch<AutoInvoiceFailure[]>(`/api/customers/${id}/auto-invoice-failures`),
    enabled: !!id,
  });

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
    const name = (form.name as string | undefined ?? '').trim();
    if (!name) { toast.error('Customer name is required.'); return; }
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
            {paymentMethodData?.paymentMethod ? (() => {
              const pm = paymentMethodData.paymentMethod;
              const cardExpiry = new Date(pm.expYear ?? 2099, pm.expMonth ?? 12, 0); // last day of exp month
              const daysLeft = Math.ceil((cardExpiry.getTime() - Date.now()) / 86_400_000);
              const expired = daysLeft < 0;
              const critical = !expired && daysLeft <= 30;
              const warning = !expired && !critical && daysLeft <= 60;
              const badgeCls = expired
                ? 'text-red-700 border-red-300 bg-red-50'
                : critical
                  ? 'text-red-600 border-red-200 bg-red-50'
                  : warning
                    ? 'text-amber-700 border-amber-200 bg-amber-50'
                    : 'text-emerald-700 border-emerald-200 bg-emerald-50';
              const hoverCls = expired || critical ? 'hover:bg-red-200' : warning ? 'hover:bg-amber-200' : 'hover:bg-emerald-200';
              const label = expired
                ? `Expired ${pm.expMonth}/${pm.expYear}`
                : (warning || critical)
                  ? `${pm.label} — exp. ${pm.expMonth}/${pm.expYear}`
                  : pm.label;
              return (
                <Badge variant="outline" className={`gap-1 pr-1 ${badgeCls}`}>
                  <CreditCard className="w-3 h-3" /> {label}
                  <button
                    onClick={async e => {
                      e.stopPropagation();
                      if (!confirm('Remove this saved card?')) return;
                      try {
                        await customFetch(`/api/customers/${id}/payment-method`, { method: 'DELETE' });
                        qc.invalidateQueries({ queryKey: getGetCustomerPaymentMethodQueryKey(id) });
                        qc.invalidateQueries({ queryKey: getGetCustomerQueryKey(id) });
                        toast.success('Saved card removed');
                      } catch {
                        toast.error('Failed to remove card');
                      }
                    }}
                    className={`ml-1 rounded-full p-0.5 transition-colors ${hoverCls}`}
                    title="Remove saved card"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </Badge>
              );
            })() : !(customer as any).noCardAlertSilenced ? (
              <Badge variant="outline" className="gap-1 text-amber-700 border-amber-200 bg-amber-50 pr-1" title="No payment method saved for this customer">
                <CreditCard className="w-3 h-3" /> No card on file
                <button
                  onClick={async e => {
                    e.stopPropagation();
                    try {
                      await customFetch(`/api/customers/${id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ noCardAlertSilenced: true }),
                      });
                      qc.invalidateQueries({ queryKey: getGetCustomerQueryKey(id) });
                      toast.success('Alert silenced for this customer');
                    } catch {
                      toast.error('Failed to silence alert');
                    }
                  }}
                  className="ml-1 rounded-full hover:bg-amber-200 p-0.5 transition-colors"
                  title="Silence this alert for this customer"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </Badge>
            ) : null}
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
                <Badge variant="outline" className={cls} title={`Payment standing: ${label}`}>{label}</Badge>
              );
            })()}
          </div>

          {/* Card-on-file action row */}
          {(() => {
            const pm = paymentMethodData?.paymentMethod;
            const daysLeft = pm ? Math.ceil((new Date(pm.expYear ?? 2099, pm.expMonth ?? 12, 0).getTime() - Date.now()) / 86_400_000) : null;
            const isExpiringSoon = daysLeft !== null && daysLeft <= 60;
            return (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7 px-2.5" onClick={openCardSetup}>
                  <CreditCard className="w-3 h-3" />
                  {(customer as any).hasPaymentMethod ? 'Update Card' : 'Add Card'}
                </Button>
                {isExpiringSoon && (
                  <Button size="sm" variant="outline"
                    className="gap-1.5 text-xs h-7 px-2.5 text-amber-700 border-amber-300 hover:bg-amber-50"
                    onClick={handleSendExpiryReminder} disabled={expiryReminderSending}
                    title="Email & text the customer to update their expiring card">
                    <Send className="w-3 h-3" />
                    {expiryReminderSending ? 'Sending…' : 'Send renewal reminder'}
                  </Button>
                )}
                <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7 px-2.5"
                  onClick={handleSendCardLink} disabled={cardLinkSending} title="Text the customer a link to add their card in the portal">
                  <Send className="w-3 h-3" />
                  {cardLinkSending ? 'Sending…' : 'Text card link'}
                </Button>
              </div>
            );
          })()}

          {/* Inline Stripe card setup form */}
          {showAddCard && stripePromise && (
            <div className="mt-3 p-3 border rounded-lg bg-muted/30 space-y-3 max-w-sm">
              <p className="text-xs font-medium text-foreground">Enter card details</p>
              <Elements stripe={stripePromise}>
                <CardSetupInline ref={cardSetupRef} />
              </Elements>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveCard} disabled={addCardBusy} className="gap-1.5">
                  <CreditCard className="w-3 h-3" />
                  {addCardBusy ? 'Saving…' : 'Save Card'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAddCard(false)}>Cancel</Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
            {customer.company && <span className="flex items-center gap-1" title={customer.company}><Building className="w-4 h-4" />{customer.company}</span>}
            <span className="flex items-center gap-1" title={customer.phone}><Phone className="w-4 h-4" />{customer.phone}</span>
            <span className="flex items-center gap-1" title={customer.email}><Mail className="w-4 h-4" />{customer.email}</span>
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
            <>
              <Button
                variant="outline"
                className="gap-2"
                title="Copy the customer portal link to clipboard"
                onClick={() => {
                  navigator.clipboard.writeText(portalLink.url);
                  toast.success('Portal link copied to clipboard');
                }}
              >
                <LinkIcon className="w-4 h-4" /> Copy Portal Link
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  const subject = encodeURIComponent('Your Customer Portal Access');
                  const body = encodeURIComponent(`Hi ${customer.name},\n\nHere is your link to access your customer portal:\n\n${portalLink.url}\n\nPlease let us know if you have any questions.`);
                  window.open(`mailto:${customer.email}?subject=${subject}&body=${body}`, '_blank');
                }}
                title="Open email client with portal link"
              >
                <Mail className="w-4 h-4" /> Send Invite
              </Button>
            </>
          )}
          {canManageOffice && customer.paymentStanding?.isServicePaused && (
            <Button
              variant="outline"
              className="gap-2 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
              title="Resume active service for this customer"
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
          <Button variant="outline" className="gap-2" title="View all invoices for this customer" onClick={() => setLocation(`/financials?customerIdFilter=${id}`)}>
            <FileText className="w-4 h-4" /> View Invoices
          </Button>
          <Button onClick={openEdit} className="gap-2" title="Edit this customer's information">
            <Edit className="w-4 h-4" /> Edit Customer
          </Button>
        </div>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'Lifetime Spend', value: `$${(customer.totalSpend ?? 0).toLocaleString()}`, icon: DollarSign, color: 'text-emerald-600' },
          ...(() => { const open = (custInvoices ?? []).filter(i => i.status !== 'paid' && i.status !== 'cancelled').reduce((s, i) => s + i.total, 0); return open > 0 ? [{ label: 'Open Balance', value: `$${open.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: DollarSign, color: 'text-destructive' }] : []; })(),
          ...(() => { const yrs = (Date.now() - new Date(customer.createdAt).getTime()) / (365.25 * 86400000); const avg = yrs >= 0.5 && (customer.totalSpend ?? 0) > 0 ? Math.round((customer.totalSpend ?? 0) / yrs) : null; return avg != null ? [{ label: 'Yearly Avg', value: `$${avg.toLocaleString()}`, icon: DollarSign, color: 'text-sky-600' }] : []; })(),
          { label: `${new Date().getFullYear()} Spend`, value: (customer as any).thisYearSpend != null ? `${(customer as any).thisYearSpend.toLocaleString()}` : '—', icon: DollarSign, color: 'text-teal-600' },
          { label: `${new Date().getFullYear() - 1} Spend`, value: (customer as any).lastYearSpend != null ? `${(customer as any).lastYearSpend.toLocaleString()}` : '—', icon: DollarSign, color: 'text-cyan-600' },
          { label: 'Properties', value: String(properties?.length ?? 0), icon: Home, color: 'text-blue-600' },
          { label: 'Total Jobs', value: String(jobs?.length ?? 0), icon: Briefcase, color: 'text-violet-600' },
          ...(() => { const openJobs = (jobs ?? []).filter(j => j.status === 'scheduled' || j.status === 'in_progress').length; return openJobs > 0 ? [{ label: 'Open Jobs', value: String(openJobs), icon: Briefcase, color: 'text-orange-600' }] : []; })(),
          { label: 'Completed', value: String(completedJobs), icon: Calendar, color: 'text-amber-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-muted ${color}`}><Icon className="w-5 h-5" /></div>
              <div>
                <p className="text-2xl font-bold" title={`${label}: ${value}`}>{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="overview" title="Customer overview, contact info, and notes">Overview</TabsTrigger>
          <TabsTrigger value="timeline" title="Activity timeline for this customer">Timeline</TabsTrigger>
          <TabsTrigger value="properties" title="Properties associated with this customer">Properties ({properties?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="jobs" title="Job history for this customer">Jobs ({jobs?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="invoices" title="Invoices and billing history">Invoices {custInvoices && custInvoices.length > 0 ? `(${custInvoices.filter(i => i.status !== 'paid' && i.status !== 'cancelled').length > 0 ? `${custInvoices.filter(i => i.status !== 'paid' && i.status !== 'cancelled').length} open` : custInvoices.length})` : ''}</TabsTrigger>
          <TabsTrigger value="messages" title="SMS and email message history">Messages ({messages?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="plans" title="Active and past service plans">Plans {customerPlans && customerPlans.length > 0 ? `(${customerPlans.filter(p => p.status === 'active').length} active)` : ''}</TabsTrigger>
        </TabsList>

        {/* Overview tab */}
        <TabsContent value="overview" className="space-y-4 focus-visible:outline-none">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><User className="w-4 h-4" />Contact Information</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row label="Name" value={customer.name} />
                {customer.email
                  ? <div className="flex justify-between"><span className="text-muted-foreground">Email</span><a href={`mailto:${customer.email}`} title={`Send email to ${customer.email}`} className="hover:underline text-primary">{customer.email}</a></div>
                  : <Row label="Email" value={customer.email} />}
                {customer.phone
                  ? <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><a href={`tel:${customer.phone}`} title={`Call ${customer.phone}`} className="hover:underline text-primary">{customer.phone}</a></div>
                  : <Row label="Phone" value={customer.phone} />}
                {customer.secondaryPhone && <div className="flex justify-between"><span className="text-muted-foreground">Secondary Phone</span><a href={`tel:${customer.secondaryPhone}`} title={`Call ${customer.secondaryPhone}`} className="hover:underline text-primary">{customer.secondaryPhone}</a></div>}
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
                      title="Unlink this marketing campaign"
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
                        <SelectTrigger className="w-full" title="Associate this customer with a marketing campaign">
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
              <InlineNotesEditor customerId={customer.id} initialNotes={customer.notes ?? ''} />
            </CardContent>
          </Card>

          {/* Tags */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><Tag className="w-4 h-4" />Tags</CardTitle>
                {canManageOffice && (
                  <Button variant="ghost" size="sm" title="Edit customer tags" className="h-7 text-xs gap-1" onClick={() => setEditing(true)}>
                    <Pencil className="w-3 h-3" /> Edit
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {(customer.tags ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No tags.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(customer.tags ?? []).map(tag => {
                    const canonical = bizTags.find(t => t.name === tag);
                    return (
                      <span
                        key={tag}
                        title={`Tag: ${tag}`}
                        className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border"
                        style={canonical ? { backgroundColor: canonical.color + '22', borderColor: canonical.color + '66', color: canonical.color } : undefined}
                      >
                        {canonical && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: canonical.color }} />}
                        {tag}
                      </span>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

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

        {/* Timeline tab */}
        <TabsContent value="timeline" className="focus-visible:outline-none">
          {(() => {
            type TimelineItem =
              | { kind: 'job'; date: Date; id: number; title: string; status: string; amount: number | null; propertyAddress: string | null }
              | { kind: 'estimate'; date: Date; id: number; status: string; total: number | null; sentAt: string | null; approvedAt: string | null; propertyAddress: string | null }
              | { kind: 'visit'; date: Date; id: number; purpose: string; completedAt: string | null; outcomeNotes: string | null; propertyAddress: string | null }
              | { kind: 'invoice'; date: Date; id: number; invoiceNumber: string; status: string; total: number | null };

            const allItems: TimelineItem[] = [
              ...(jobs ?? []).map(j => ({
                kind: 'job' as const,
                date: new Date(j.scheduledAt),
                id: j.id,
                title: j.title,
                status: j.status,
                amount: j.totalAmount ?? null,
                propertyAddress: (j as any).propertyAddress ?? null,
              })),
              ...(estimates ?? []).map(e => ({
                kind: 'estimate' as const,
                date: new Date(e.sentAt ?? e.createdAt),
                id: e.id,
                status: e.status,
                total: e.total ?? null,
                sentAt: e.sentAt ?? null,
                approvedAt: e.approvedAt ?? null,
                propertyAddress: (e as any).propertyAddress ?? null,
              })),
              ...(visits ?? []).map(v => ({
                kind: 'visit' as const,
                date: new Date((v as any).scheduledAt ?? v.createdAt),
                id: v.id,
                purpose: v.purpose,
                completedAt: (v as any).completedAt ?? null,
                outcomeNotes: (v as any).outcomeNotes ?? null,
                propertyAddress: (v as any).propertyAddress ?? null,
              })),
              ...(custInvoices ?? []).map(inv => ({
                kind: 'invoice' as const,
                date: new Date((inv as any).issuedAt ?? (inv as any).createdAt ?? inv.dueDate ?? new Date()),
                id: inv.id,
                invoiceNumber: (inv as any).invoiceNumber ?? `#${inv.id}`,
                status: inv.status,
                total: inv.total ?? null,
              })),
            ].sort((a, b) => b.date.getTime() - a.date.getTime());

            const items = timelineFilter === 'all' ? allItems : allItems.filter(i => i.kind === timelineFilter);

            const ESTIMATE_STATUS_COLORS: Record<string, string> = {
              draft: 'bg-gray-100 text-gray-600 border-transparent',
              sent: 'bg-blue-100 text-blue-700 border-transparent',
              approved: 'bg-emerald-100 text-emerald-700 border-transparent',
              declined: 'bg-red-100 text-red-600 border-transparent',
              expired: 'bg-amber-100 text-amber-700 border-transparent',
            };
            const VISIT_STATUS_COLORS: Record<string, string> = {
              completed: 'bg-emerald-100 text-emerald-700 border-transparent',
              pending: 'bg-amber-100 text-amber-700 border-transparent',
            };

            const filterOptions = [
              { value: 'all' as const, label: 'All' },
              { value: 'job' as const, label: 'Jobs' },
              { value: 'estimate' as const, label: 'Estimates' },
              { value: 'visit' as const, label: 'Visits' },
              { value: 'invoice' as const, label: 'Invoices' },
            ];

            if (!items.length && timelineFilter === 'all') {
              return (
                <Card>
                  <CardContent className="py-16 text-center text-muted-foreground">
                    <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p>No activity recorded for this customer yet.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 gap-2"
                      disabled={createEstimate.isPending}
                      onClick={handleNewEstimate}
                    >
                      <Plus className="w-4 h-4" /> New Estimate
                    </Button>
                  </CardContent>
                </Card>
              );
            }

            return (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <div className="space-y-2">
                    <div>
                      <CardTitle className="text-base">Customer Timeline</CardTitle>
                      <CardDescription>All jobs, estimates, and visits in chronological order.</CardDescription>
                    </div>
                    <div className="flex gap-1">
                      {filterOptions.map(opt => (
                        <Button
                          key={opt.value}
                          variant={timelineFilter === opt.value ? 'default' : 'ghost'}
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={() => setTimelineFilter(opt.value)}
                        >
                          {opt.label}
                          {opt.value !== 'all' && (
                            <span className="ml-1 text-[10px] opacity-70">
                              {allItems.filter(i => i.kind === opt.value).length}
                            </span>
                          )}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="gap-2"
                    disabled={createEstimate.isPending}
                    onClick={handleNewEstimate}
                  >
                    <Plus className="w-4 h-4" />
                    {createEstimate.isPending ? 'Creating...' : 'New Estimate'}
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="relative">
                    {items.map((item, idx) => (
                      <div key={`${item.kind}-${item.id}`} className="flex gap-4 px-6 py-4 hover:bg-muted/30 transition-colors border-b last:border-b-0">
                        {/* Icon column */}
                        <div className="shrink-0 flex flex-col items-center gap-1 pt-0.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                            item.kind === 'job' ? 'bg-violet-100 text-violet-600' :
                            item.kind === 'estimate' ? 'bg-blue-100 text-blue-600' :
                            item.kind === 'invoice' ? 'bg-emerald-100 text-emerald-600' :
                            'bg-amber-100 text-amber-600'
                          }`}>
                            {item.kind === 'job' && <Briefcase className="w-4 h-4" />}
                            {item.kind === 'estimate' && <ClipboardList className="w-4 h-4" />}
                            {item.kind === 'visit' && <Eye className="w-4 h-4" />}
                            {item.kind === 'invoice' && <FileText className="w-4 h-4" />}
                          </div>
                          {idx < items.length - 1 && <div className="w-px flex-1 bg-border mt-1" style={{ minHeight: 16 }} />}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 pb-1">
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                {item.kind === 'job' ? 'Job' : item.kind === 'estimate' ? 'Estimate' : item.kind === 'invoice' ? 'Invoice' : 'Visit'}
                              </span>
                              {item.kind === 'job' && (
                                <Badge className={`capitalize text-xs ${STATUS_COLORS[item.status] ?? ''}`} title={`Job status: ${item.status.replace(/_/g, ' ')}`}>
                                  {item.status.replace(/_/g, ' ')}
                                </Badge>
                              )}
                              {item.kind === 'estimate' && (
                                <Badge className={`capitalize text-xs ${ESTIMATE_STATUS_COLORS[item.status] ?? ''}`} title={`Estimate status: ${item.status}`}>
                                  {item.status}
                                </Badge>
                              )}
                              {item.kind === 'visit' && (
                                <Badge className={`text-xs ${item.completedAt ? VISIT_STATUS_COLORS.completed : VISIT_STATUS_COLORS.pending}`} title={item.completedAt ? `Completed ${new Date(item.completedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}` : 'Visit not yet completed'}>
                                  {item.completedAt ? 'Completed' : 'Pending'}
                                </Badge>
                              )}
                              {item.kind === 'invoice' && (
                                <Badge className={`capitalize text-xs ${item.status === 'paid' ? 'bg-emerald-100 text-emerald-700 border-transparent' : item.status === 'overdue' ? 'bg-red-100 text-red-700 border-transparent' : 'bg-muted text-muted-foreground border-transparent'}`} title={`Invoice status: ${item.status}`}>
                                  {item.status}
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0" title={item.date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}>
                              {item.date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                            </span>
                          </div>

                          <p className="text-sm font-medium mt-0.5 truncate">
                            {item.kind === 'job' && <button title={item.title} className="hover:underline text-primary" onClick={() => setLocation(`/schedule?jobId=${item.id}`)}>{item.title}</button>}
                            {item.kind === 'estimate' && (
                              <Link href={`/estimates?highlight=${item.id}`} title={`View Estimate #${item.id}`} className="hover:underline text-primary">
                                Estimate #{item.id}{item.total != null ? ` — $${item.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : ''}
                              </Link>
                            )}
                            {item.kind === 'visit' && item.purpose}
                            {item.kind === 'invoice' && (
                              <span>Invoice {item.invoiceNumber}{item.total != null ? ` — $${item.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : ''}</span>
                            )}
                          </p>

                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            {'propertyAddress' in item && (item as any).propertyAddress && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1" title={(item as any).propertyAddress}>
                                <MapPin className="w-3 h-3" />{(item as any).propertyAddress}
                              </span>
                            )}
                            {item.kind === 'estimate' && item.sentAt && (
                              <span className="text-xs text-muted-foreground">
                                Sent {new Date(item.sentAt).toLocaleDateString()}
                              </span>
                            )}
                            {item.kind === 'estimate' && item.approvedAt && (
                              <span className="text-xs text-emerald-600">
                                Approved {new Date(item.approvedAt).toLocaleDateString()}
                              </span>
                            )}
                            {item.kind === 'job' && item.amount != null && (
                              <span className="text-xs font-medium text-muted-foreground" title={`Job total: $${item.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}>
                                ${item.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                            )}
                            {item.kind === 'visit' && item.outcomeNotes && (
                              <span className="text-xs text-muted-foreground truncate max-w-xs" title={item.outcomeNotes}>
                                {item.outcomeNotes}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Link button */}
                        <div className="shrink-0 flex items-center">
                          {item.kind === 'job' && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setLocation(`/jobs/${item.id}`)}>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {item.kind === 'estimate' && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setLocation(`/estimates?customerId=${id}`)}>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {item.kind === 'visit' && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setLocation(`/visits?customerId=${id}`)}>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
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
              <Button size="sm" className="gap-2" title="Link a new property to this customer" onClick={openAddProperty}>
                <Plus className="w-4 h-4" /> Add Property
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {!properties?.length ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Home className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No properties linked to this customer.</p>
                  <Button variant="outline" size="sm" className="mt-3 gap-2" title="Link a new property to this customer" onClick={openAddProperty}>
                    <Plus className="w-4 h-4" /> Add First Property
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Address</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead>Geofence</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {properties.map(p => (
                      <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/properties/${p.id}`)}>
                        <TableCell>
                          <div className="flex items-start gap-2">
                            <PropertyThumbnail profilePhotoUrl={(p as any).profilePhotoUrl} />
                            <div>
                              <div className="font-medium" title={p.address}>{p.address}</div>
                              <div className="text-xs text-muted-foreground">{[p.city, p.state, p.zip].filter(Boolean).join(', ')}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{p.type ? <Badge variant="secondary" className="capitalize" title={`Property type: ${p.type}`}>{p.type}</Badge> : '-'}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground" title={(p as any).serviceableAreaSqft ? `Serviceable area: ${((p as any).serviceableAreaSqft as number).toLocaleString()} sqft` : 'No area data'}>
                          {(p as any).serviceableAreaSqft ? `${((p as any).serviceableAreaSqft as number).toLocaleString()} sqft` : '—'}
                        </TableCell>
                        <TableCell>
                          {p.geofenceLat ? (
                            <span className="text-xs text-emerald-600 font-medium" title={`Geofence set — radius: ${p.geofenceRadius}m`}>Set ({p.geofenceRadius}m)</span>
                          ) : <span className="text-xs text-muted-foreground" title="No geofence configured">Not set</span>}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" title="View property details" onClick={e => { e.stopPropagation(); setLocation(`/properties/${p.id}`); }}>
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

                  // Find the most recent failed reminder message so we know jobId + reminderType
                  const failedMsg = (messages ?? []).find(
                    m => m.status === 'failed' &&
                         ((m as any).messageType === 'reminder_7d' || (m as any).messageType === 'reminder_24h'),
                  ) as (typeof messages extends (infer T)[] | undefined ? T : never) & { messageType?: string; jobId?: number | null } | undefined;

                  const jobId = failedMsg?.jobId ?? null;
                  const reminderType: '7d' | '24h' | null =
                    failedMsg?.messageType === 'reminder_7d' ? '7d' :
                    failedMsg?.messageType === 'reminder_24h' ? '24h' : null;

                  return (
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-red-600 border-red-200 gap-1 text-xs" title={`${failure.channel.toUpperCase()} failed: ${failure.errorNote}`}>
                        <AlertTriangle className="w-3 h-3" /> Last reminder failed ({failure.channel.toUpperCase()})
                      </Badge>
                      {canManageOffice && jobId && reminderType && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs gap-1 text-red-700 border-red-200 hover:bg-red-50"
                          disabled={resendingReminder}
                          onClick={async () => {
                            setResendingReminder(true);
                            try {
                              const result = await customFetch<{ sent: boolean; channels: string[]; failures: string[] }>(
                                `/api/jobs/${jobId}/resend-reminder`,
                                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reminderType }) },
                              );
                              if (result.channels.length > 0) {
                                toast.success(`Reminder re-sent via ${result.channels.join(', ')}`);
                              } else if (result.failures.length > 0) {
                                toast.error(`Re-send failed: ${result.failures.join('; ')}`);
                              } else {
                                toast.warning('No channels available to re-send (check opt-out settings)');
                              }
                              qc.invalidateQueries({ queryKey: getListCustomerMessagesQueryKey(id) });
                              qc.invalidateQueries({ queryKey: getGetCustomerQueryKey(id) });
                            } catch {
                              toast.error('Failed to re-send reminder');
                            } finally {
                              setResendingReminder(false);
                            }
                          }}
                        >
                          <RefreshCw className={`w-3 h-3 ${resendingReminder ? 'animate-spin' : ''}`} />
                          {resendingReminder ? 'Sending...' : 'Re-send'}
                        </Button>
                      )}
                    </div>
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
                <Button size="sm" className="gap-2" title="Send SMS or email to this customer" onClick={() => setComposeOpen(true)}>
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
                          <span className="text-xs font-medium text-muted-foreground capitalize flex items-center gap-1" title={`${msg.direction === 'outbound' ? 'Sent' : 'Received'} via ${msg.channel.toUpperCase()}`}>
                            {msg.channel === 'sms' ? <Phone className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
                            {msg.direction} · {msg.channel.toUpperCase()}
                          </span>
                          {msg.subject && <span className="text-xs text-muted-foreground">· {msg.subject}</span>}
                          <Badge
                            variant="outline"
                            title={`Message status: ${msg.status}`}
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
                        <p className="text-xs text-muted-foreground mt-1" title={new Date(msg.createdAt).toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}>
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
        <TabsContent value="jobs" className="space-y-4 focus-visible:outline-none">
          {/* Auto-invoice failure alerts */}
          {(autoInvoiceFailures ?? []).length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
              <div className="flex items-center gap-2 text-red-700">
                <MailWarning className="w-4 h-4 shrink-0" />
                <p className="text-sm font-semibold">
                  {(autoInvoiceFailures ?? []).length === 1
                    ? '1 auto-invoice issue requires attention'
                    : `${(autoInvoiceFailures ?? []).length} auto-invoice issues require attention`}
                </p>
              </div>
              <div className="space-y-2">
                {(autoInvoiceFailures ?? []).map(f => (
                  <div key={f.id} className="flex items-start justify-between gap-3 rounded-md bg-white border border-red-100 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-red-800">
                        {f.kind === 'creation' ? 'Invoice not created' : `Email delivery failed${f.invoiceNumber ? ` — ${f.invoiceNumber}` : ''}`}
                      </p>
                      <p className="text-xs text-red-600 mt-0.5 truncate" title={f.message}>{f.message}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">{new Date(f.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {f.kind === 'email' && f.invoiceId != null && canManageOffice && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs gap-1 text-red-700 border-red-200 hover:bg-red-50"
                          disabled={resendingInvoice === f.invoiceId}
                          onClick={async () => {
                            setResendingInvoice(f.invoiceId!);
                            try {
                              await customFetch(`/api/invoices/${f.invoiceId}/resend-email`, { method: 'POST' });
                              toast.success('Invoice email re-queued for delivery');
                              refetchFailures();
                            } catch {
                              toast.error('Failed to resend invoice email');
                            } finally {
                              setResendingInvoice(null);
                            }
                          }}
                        >
                          <RefreshCw className={`w-3 h-3 ${resendingInvoice === f.invoiceId ? 'animate-spin' : ''}`} />
                          {resendingInvoice === f.invoiceId ? 'Sending...' : 'Resend Email'}
                        </Button>
                      )}
                      {f.jobId != null && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => setLocation(`/jobs/${f.jobId}`)}
                        >
                          View Job <ChevronRight className="w-3 h-3 ml-0.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle>Job History</CardTitle>
                <CardDescription>All jobs associated with this customer.</CardDescription>
              </div>
              {canManageOffice && (
                <div className="flex gap-1.5 mr-2">
                  <Button size="sm" variant="outline" className="gap-1.5" title="Create a new job for this customer" onClick={() => setLocation(`/schedule?action=create&customerId=${customer.id}`)}>
                    <Plus className="w-3.5 h-3.5" /> New Job
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5" title="Create a new estimate for this customer" onClick={() => setLocation(`/estimates?action=create&customerId=${customer.id}`)}>
                    <Plus className="w-3.5 h-3.5" /> New Estimate
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5" title="Log a completed visit for this customer" onClick={() => setLocation(`/visits?customerId=${customer.id}`)}>
                    <Plus className="w-3.5 h-3.5" /> Log Visit
                  </Button>
                </div>
              )}
              <div className="flex items-center gap-1.5 ml-auto">
                {(['all', 'scheduled', 'in_progress', 'completed', 'cancelled'] as const).map(s => (
                  <button
                    key={s}
                    title={s === 'all' ? 'Show all jobs' : s === 'in_progress' ? 'Show in-progress jobs' : `Show ${s} jobs`}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${custJobStatusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                    onClick={() => setCustJobStatusFilter(s)}
                  >
                    {s === 'all' ? 'All' : s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
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
                  {(jobs ?? []).filter(j => custJobStatusFilter === 'all' || j.status === custJobStatusFilter).map(job => (
                    <TableRow key={job.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/schedule?jobId=${job.id}`)}>
                      <TableCell className="font-medium" title={job.title}>{job.title}</TableCell>
                      <TableCell>
                        <Badge className={`capitalize ${STATUS_COLORS[job.status] ?? ''}`} title={`Job status: ${job.status.replace(/_/g, ' ')}`}>
                          {job.status.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm" title={new Date(job.scheduledAt).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}>
                        {new Date(job.scheduledAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground" title={job.propertyAddress ?? undefined}>{job.propertyAddress ?? '-'}</TableCell>
                      <TableCell className="text-right font-medium" title={`Job total: $${(job.totalAmount ?? 0).toLocaleString()}`}>${(job.totalAmount ?? 0).toLocaleString()}</TableCell>
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

        {/* Invoices tab */}
        <TabsContent value="invoices" className="focus-visible:outline-none">
          {(() => {
            const INVOICE_STATUS_COLORS: Record<string, string> = {
              paid: 'bg-emerald-100 text-emerald-700 border-transparent',
              overdue: 'bg-red-100 text-red-700 border-transparent',
              sent: 'bg-blue-100 text-blue-700 border-transparent',
              draft: 'bg-gray-100 text-gray-600 border-transparent',
              cancelled: 'bg-gray-200 text-gray-500 border-transparent',
            };
            const filteredInvoices = (custInvoices ?? []).filter(inv => {
              if (invStatusFilter !== 'all' && inv.status !== invStatusFilter) return false;
              if (invSearch) {
                const q = invSearch.toLowerCase();
                return (inv.invoiceNumber ?? '').toLowerCase().includes(q) || inv.status.includes(q);
              }
              return true;
            });
            return (
              <Card>
                <CardHeader className="pb-3 flex flex-row items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="w-4 h-4" /> Invoice History
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Input
                      title="Search by invoice number or status"
                      placeholder="Search invoices…"
                      value={invSearch}
                      onChange={e => setInvSearch(e.target.value)}
                      className="h-8 text-sm w-40"
                    />
                    <Select value={invStatusFilter} onValueChange={setInvStatusFilter}>
                      <SelectTrigger className="h-8 text-sm w-32" title="Filter invoices by status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="sent">Sent</SelectItem>
                        <SelectItem value="overdue">Overdue</SelectItem>
                        <SelectItem value="draft">Draft</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="gap-1.5 shrink-0" title="Create a new invoice for this customer" onClick={() => setLocation(`/financials?action=create&customerId=${customer.id}`)}>
                      <Plus className="w-3.5 h-3.5" /> New Invoice
                    </Button>
                  </div>
                </CardHeader>
                {(() => {
                  const outstanding = (custInvoices ?? []).filter(i => i.status !== 'paid' && i.status !== 'cancelled').reduce((s, i) => s + i.total, 0);
                  const overdue = (custInvoices ?? []).filter(i => i.status === 'overdue').reduce((s, i) => s + i.total, 0);
                  if (!outstanding && !overdue) return null;
                  return (
                    <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-4 text-xs">
                      {outstanding > 0 && <span className="text-muted-foreground">Outstanding: <span className="font-semibold text-foreground">${outstanding.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></span>}
                      {overdue > 0 && <span className="text-destructive font-medium">Overdue: ${overdue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>}
                    </div>
                  );
                })()}
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Issued</TableHead>
                        <TableHead>Due</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Days Overdue</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invLoading ? (
                        <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                      ) : !filteredInvoices.length ? (
                        <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">{custInvoices?.length ? 'No invoices match your filters.' : 'No invoices yet.'}</TableCell></TableRow>
                      ) : (
                        filteredInvoices.map(inv => (
                          <TableRow key={inv.id} className="text-sm cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/financials?invoiceId=${inv.id}`)}>
                            <TableCell className="font-mono font-medium" title={`Invoice ${inv.invoiceNumber}`}>{inv.invoiceNumber}</TableCell>
                            <TableCell>
                              <Badge className={`capitalize text-xs ${INVOICE_STATUS_COLORS[inv.status] ?? ''}`} variant="outline" title={`Invoice status: ${inv.status}`}>
                                {inv.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground" title={new Date(inv.createdAt).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}>{new Date(inv.createdAt).toLocaleDateString()}</TableCell>
                            <TableCell className={`${(inv as any).dueDate && inv.status !== 'paid' && new Date((inv as any).dueDate) < new Date() ? 'text-destructive font-medium' : 'text-muted-foreground'}`} title={(inv as any).dueDate ? `Due: ${new Date((inv as any).dueDate).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}` : 'No due date'}>
                              {(inv as any).dueDate ? new Date((inv as any).dueDate).toLocaleDateString() : '—'}
                            </TableCell>
                            <TableCell className="text-right font-medium" title={`Invoice total: $${inv.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}>${inv.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                            <TableCell className="text-right text-xs">
                              {(inv as any).dueDate && inv.status !== 'paid' && new Date((inv as any).dueDate) < new Date()
                                ? <span className="text-destructive font-medium" title={`${Math.floor((Date.now() - new Date((inv as any).dueDate).getTime()) / 86400000)} days overdue`}>{Math.floor((Date.now() - new Date((inv as any).dueDate).getTime()) / 86400000)}d</span>
                                : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>
                              <span className="text-xs text-primary whitespace-nowrap" title="Open this invoice">View →</span>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })()}
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
                  title="Email subject line"
                  placeholder="Subject..."
                  value={composeSubject}
                  onChange={e => setComposeSubject(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Message</label>
              <Textarea
                title={composeChannel === 'sms' ? 'SMS message content (max 1600 characters)' : 'Email message body'}
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
                <Input title="Customer's full name" value={form.name as string} onChange={e => setField('name', e.target.value)} placeholder="Jane Smith" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Email" required>
                  <Input type="email" title="Customer's email address" value={form.email as string} onChange={e => setField('email', e.target.value)} placeholder="jane@example.com" />
                </Field>
                <Field label="Phone" required>
                  <Input title="Customer's primary phone number" value={form.phone as string} onChange={e => setField('phone', e.target.value)} placeholder="(555) 000-0000" />
                </Field>
              </div>
              {activeFields.filter(f => f.isBuiltIn && f.visible && f.key === 'secondaryPhone').map(f => (
                <Field key={f.key} label={f.label} required={f.required}>
                  <Input title="Customer's secondary phone number" value={form.secondaryPhone as string} onChange={e => setField('secondaryPhone', e.target.value)} placeholder="(555) 000-0001" />
                </Field>
              ))}
              {activeFields.filter(f => f.isBuiltIn && f.visible && f.key === 'company').map(f => (
                <Field key={f.key} label={f.label} required={f.required}>
                  <Input title="Company or organization name" value={form.company as string} onChange={e => setField('company', e.target.value)} placeholder="Acme Corp" />
                </Field>
              ))}
              {activeFields.filter(f => f.isBuiltIn && f.visible && f.key === 'customerType').map(f => (
                <Field key={f.key} label={f.label} required={f.required}>
                  <Select value={form.customerType as string} onValueChange={v => setField('customerType', v)}>
                    <SelectTrigger title="Customer type (residential, commercial, etc.)"><SelectValue placeholder="Select type..." /></SelectTrigger>
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
                    <SelectTrigger title="How this customer originally found you"><SelectValue placeholder="Select source..." /></SelectTrigger>
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
                  <Input ref={billingAddrRef} title="Customer's billing street address" value={form.billingAddress as string} onChange={e => setField('billingAddress', e.target.value)} placeholder="123 Main St" />
                </Field>
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-1">
                    <Field label="City">
                      <Input title="City" value={form.billingCity as string} onChange={e => setField('billingCity', e.target.value)} placeholder="Los Angeles" />
                    </Field>
                  </div>
                  <Field label="State">
                    <Input title="2-letter state code" value={form.billingState as string} onChange={e => setField('billingState', e.target.value)} placeholder="CA" maxLength={2} />
                  </Field>
                  <Field label="ZIP">
                    <Input title="ZIP/postal code" value={form.billingZip as string} onChange={e => setField('billingZip', e.target.value)} placeholder="90210" />
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
                <div className="flex flex-wrap gap-2 mb-3">
                  {((form.tags as string[]) ?? []).map(tag => {
                    const canonical = bizTags.find(t => t.name === tag);
                    return (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border"
                        style={canonical ? { backgroundColor: canonical.color + '22', borderColor: canonical.color + '66', color: canonical.color } : undefined}
                      >
                        {canonical && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: canonical.color }} />}
                        {tag}
                        <button onClick={() => removeTag(tag)} className="ml-0.5 hover:opacity-70" title={`Remove tag "${tag}"`}>
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
                {bizTags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {bizTags.filter(t => !((form.tags as string[]) ?? []).includes(t.name)).map(t => (
                      <button
                        key={t.id}
                        type="button"
                        title={`Add tag "${t.name}"`}
                        onClick={() => { const cur = (form.tags as string[]) ?? []; if (!cur.includes(t.name)) setForm(f => ({ ...f, tags: [...cur, t.name] })); }}
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-dashed hover:border-solid transition-all"
                        style={{ borderColor: t.color + '88', color: t.color + 'cc' }}
                      >
                        <Plus className="w-2.5 h-2.5" /> {t.name}
                      </button>
                    ))}
                    {bizTags.every(t => ((form.tags as string[]) ?? []).includes(t.name)) && (
                      <p className="text-xs text-muted-foreground">All tags applied</p>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input placeholder="Add tag…" value={tagInput} onChange={e => setTagInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} className="flex-1" />
                    <Button variant="outline" size="sm" onClick={addTag} type="button">Add</Button>
                  </div>
                )}
                {bizTags.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Manage your tag library in <button type="button" className="underline" onClick={() => window.location.href = '/settings?tab=tags'}>Settings → Tags</button>.
                  </p>
                )}
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
              <Button title="Save changes to this customer's profile" onClick={handleSave} disabled={updateCustomer.isPending} className="gap-2">
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
