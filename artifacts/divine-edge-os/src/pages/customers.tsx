import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { Search, Plus, Building, Phone, Mail, Save, X, User, Tag, FileText, Home, AlertTriangle, Filter, Zap, MapPin, CreditCard, DollarSign, Briefcase } from 'lucide-react';
import { useLocation } from 'wouter';
import { useDebounce } from '@/hooks/use-debounce';
import { toast } from 'sonner';
import { getActiveCustomerFields } from '@/lib/fieldConfig';
import { ImportExportControls } from '@/components/data-io/ImportExportControls';

/** A single address suggestion returned by the Photon geocoder (fallback). */
interface PhotonFeature {
  properties: {
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
    countrycode?: string;
  };
}

interface GoogleAddressParts { street: string; city: string; state: string; zip: string; }

/** Key is only present when the tenant has configured it. */
const GMAPS_KEY = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

/**
 * Attaches Google Places Autocomplete to `inputRef` when VITE_GOOGLE_MAPS_API_KEY
 * is set (calls `onSelect` on selection). Falls back to Photon OSM otherwise.
 * When Google is active, `suggestions` is always empty — Places renders its own dropdown.
 */
function useAddressAutocomplete(
  query: string,
  inputRef: React.RefObject<HTMLInputElement | null>,
  onGoogleSelect: (parts: GoogleAddressParts) => void,
) {
  const [suggestions, setSuggestions] = useState<PhotonFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounce(query, 350);

  // Keep callback in a ref so the Places listener never goes stale
  const onSelectRef = useRef(onGoogleSelect);
  useEffect(() => { onSelectRef.current = onGoogleSelect; }, [onGoogleSelect]);

  const acRef = useRef<unknown>(null);

  const attachPlaces = useCallback(() => {
    if (!inputRef.current || !(window as any).google?.maps?.places || acRef.current) return;
    const ac = new (window as any).google.maps.places.Autocomplete(inputRef.current, {
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
      onSelectRef.current({
        street: [get('street_number'), get('route')].filter(Boolean).join(' '),
        city: get('locality') || get('sublocality_level_1'),
        state: getS('administrative_area_level_1'),
        zip: get('postal_code'),
      });
    });
    acRef.current = ac;
  }, [inputRef]);

  // Load Google Maps script once, then attach
  useEffect(() => {
    if (!GMAPS_KEY) return undefined;
    if ((window as any).google?.maps?.places) { attachPlaces(); return undefined; }
    if (document.querySelector('#gmaps-script')) {
      const iv = setInterval(() => {
        if ((window as any).google?.maps?.places) { attachPlaces(); clearInterval(iv); }
      }, 150);
      return () => clearInterval(iv);
    }
    const script = document.createElement('script');
    script.id = 'gmaps-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&libraries=places&loading=async`;
    script.async = true;
    script.defer = true;
    script.onload = attachPlaces;
    document.head.appendChild(script);
    return undefined;
  }, [attachPlaces]);

  // Photon fallback — only used when Google key is absent
  useEffect(() => {
    if (GMAPS_KEY) return;
    if (!debounced || debounced.length < 3) { setSuggestions([]); return; }
    let cancelled = false;
    setLoading(true);
    fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(debounced)}&limit=10&lang=en&layer=house&layer=street`,
      { headers: { 'Accept-Language': 'en' } },
    )
      .then(r => r.json())
      .then((data: { features?: PhotonFeature[] }) => {
        if (cancelled) return;
        const us = (data.features ?? []).filter(
          f => !f.properties.countrycode || f.properties.countrycode.toUpperCase() === 'US',
        );
        setSuggestions(us.slice(0, 6));
      })
      .catch(() => { if (!cancelled) setSuggestions([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debounced]);

  return { suggestions, loading, clear: () => setSuggestions([]) };
}

/** Format a Photon feature's street address portion. */
function photonStreet(p: PhotonFeature['properties']): string {
  const parts = [p.housenumber, p.street ?? p.name].filter(Boolean);
  return parts.join(' ');
}

/** Map full US state names (as returned by Photon) to 2-letter USPS codes. */
const US_STATE_ABBR: Record<string, string> = {
  'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
  'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
  'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS',
  'Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA',
  'Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT',
  'Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM',
  'New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK',
  'Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
  'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
  'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY',
  'District of Columbia':'DC','Puerto Rico':'PR','Guam':'GU',
};

function toStateAbbr(state: string): string {
  if (state.length <= 2) return state.toUpperCase();
  return US_STATE_ABBR[state] ?? state.slice(0, 2).toUpperCase();
}

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
  const [openBalanceFilter, setOpenBalanceFilter] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('__all__');
  const [sortField, setSortField] = useState<'name' | 'totalSpend' | 'createdAt' | 'lastServiceDate'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormData>(BLANK);
  const [tagInput, setTagInput] = useState('');
  const addrInputRef = useRef<HTMLInputElement>(null);
  const [addrFocused, setAddrFocused] = useState(false);
  const handleGoogleAddressSelect = useCallback((parts: GoogleAddressParts) => {
    setForm(f => ({
      ...f,
      billingAddress: parts.street,
      billingCity: parts.city,
      billingState: parts.state,
      billingZip: parts.zip,
    }));
  }, []);

  const { suggestions: addrSuggestions, loading: addrLoading, clear: clearAddrSuggestions } = useAddressAutocomplete(
    addrFocused ? (form.billingAddress as string) : '',
    addrInputRef,
    handleGoogleAddressSelect,
  );

  // Open create sheet when arriving via quick-add shortcut (?action=create)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'create') {
      setCreating(true);
      setForm(BLANK);
      // Clean the URL without triggering a re-render loop
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const queryParams = {
    q: debouncedSearch || undefined,
    limit: 200,
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
    // Validate required fields according to the tenant's field configuration
    const missing = activeFields
      .filter(f => f.required && !(form[f.key] as string | undefined)?.trim())
      .map(f => f.label);
    // Name is always required as a hard minimum
    if (!(form.name as string | undefined)?.trim()) {
      toast.error('Customer name is required');
      return;
    }
    if (missing.length > 0) {
      toast.error(`Required: ${missing.join(', ')}`);
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
            exportQuery={{ q: debouncedSearch || undefined, hasReminderFailure: reminderFailureFilter ? 'true' : undefined, ...(typeFilter !== 'all' ? { customerType: typeFilter } : {}) }}
            onImportComplete={() => qc.invalidateQueries({ queryKey: getListCustomersQueryKey() })}
          />
          <Button title="Create a new customer" onClick={() => { setForm(f => ({ ...f, name: search.trim() || f.name })); setCreating(true); }} className="gap-2">
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
                title="Search by name, company, email, or phone"
                className="pl-9 pr-8"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && <button title="Clear search" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
            </div>
            {data?.total != null && (
              <span className="text-sm text-muted-foreground whitespace-nowrap" title="Customers matching current filters">{data.total.toLocaleString()} customer{data.total !== 1 ? 's' : ''}</span>
            )}
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-9 w-40 text-sm" title="Filter by customer type">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="residential">Residential</SelectItem>
                <SelectItem value="commercial">Commercial</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={reminderFailureFilter ? 'default' : 'outline'}
              size="sm"
              className="gap-2 shrink-0"
              title="Filter to customers with failed reminder emails"
              onClick={() => setReminderFailureFilter(v => !v)}
            >
              <AlertTriangle className="w-4 h-4" />
              Reminder Failures
              {reminderFailureFilter && data?.total != null && (
                <Badge variant="secondary" className="ml-1 bg-white/20 text-white border-0">{data.total}</Badge>
              )}
            </Button>
            <Button
              variant={openBalanceFilter ? 'default' : 'outline'}
              size="sm"
              className="gap-2 shrink-0"
              onClick={() => setOpenBalanceFilter(v => !v)}
              title="Show customers with unpaid invoices"
            >
              <DollarSign className="w-4 h-4" />
              Open Balance
            </Button>
            {(() => {
              const allTags = Array.from(new Set((data?.items ?? []).flatMap(c => (c as any).tags ?? []))).sort() as string[];
              return allTags.length > 0 ? (
                <Select value={tagFilter} onValueChange={setTagFilter}>
                  <SelectTrigger className="h-9 w-36 text-sm" title="Filter by customer tag">
                    <SelectValue placeholder="All tags" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All tags</SelectItem>
                    {allTags.map(tag => <SelectItem key={tag} value={tag}>{tag}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : null;
            })()}
            {(search || typeFilter !== 'all' || reminderFailureFilter || openBalanceFilter || tagFilter !== '__all__') && (
              <Button
                variant="ghost"
                size="sm"
                title="Reset all filters"
                className="gap-1.5 text-muted-foreground"
                onClick={() => { setSearch(''); setTypeFilter('all'); setReminderFailureFilter(false); setOpenBalanceFilter(false); setTagFilter('__all__'); }}
              >
                <X className="w-3.5 h-3.5" /> Clear filters
              </Button>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => { if (sortField === 'name') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField('name'); setSortDir('asc'); } }}>
                  Name {sortField === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Properties</TableHead>
                <TableHead className="text-right cursor-pointer select-none hover:text-foreground" onClick={() => { if (sortField === 'totalSpend') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField('totalSpend'); setSortDir('desc'); } }}>
                  Total Spend {sortField === 'totalSpend' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </TableHead>
                <TableHead className="text-right cursor-pointer select-none hover:text-foreground" onClick={() => { if (sortField === 'lastServiceDate') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField('lastServiceDate'); setSortDir('desc'); } }}>
                  Last Service {sortField === 'lastServiceDate' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </TableHead>
                <TableHead className="text-right cursor-pointer select-none hover:text-foreground" onClick={() => { if (sortField === 'createdAt') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField('createdAt'); setSortDir('desc'); } }}>
                  Joined {sortField === 'createdAt' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading customers...</TableCell></TableRow>
              ) : (data?.items ?? []).filter(c => typeFilter === 'all' || (c as any).customerType === typeFilter).filter(c => !openBalanceFilter || ((c as any).paymentStanding?.overdueAmount ?? 0) > 0).filter(c => tagFilter === '__all__' || ((c as any).tags ?? []).includes(tagFilter)).length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  {reminderFailureFilter ? 'No customers with reminder failures found.' : openBalanceFilter ? 'No customers with open balances found.' : (<span>No customers found.{!search && !tagFilter && typeFilter === 'all' && <> <button className="text-primary hover:underline" onClick={() => setCreating(true)}>Add one →</button></>}</span>)}
                </TableCell></TableRow>
              ) : (
                (data?.items ?? []).filter(c => typeFilter === 'all' || (c as any).customerType === typeFilter).filter(c => !openBalanceFilter || ((c as any).paymentStanding?.overdueAmount ?? 0) > 0).filter(c => tagFilter === '__all__' || ((c as any).tags ?? []).includes(tagFilter)).sort((a, b) => {
                  let cmp = 0;
                  if (sortField === 'name') cmp = a.name.localeCompare(b.name);
                  else if (sortField === 'totalSpend') cmp = ((a as any).totalSpend ?? 0) - ((b as any).totalSpend ?? 0);
                  else if (sortField === 'createdAt') cmp = new Date((a as any).createdAt ?? 0).getTime() - new Date((b as any).createdAt ?? 0).getTime();
                  else if (sortField === 'lastServiceDate') cmp = new Date((a as any).lastServiceDate ?? 0).getTime() - new Date((b as any).lastServiceDate ?? 0).getTime();
                  return sortDir === 'asc' ? cmp : -cmp;
                }).map(customer => {
                  const failure = (customer as any).lastReminderFailure as { channel: string; errorNote: string; failedAt: string } | null;
                  return (
                    <TableRow
                      key={customer.id}
                      className="cursor-pointer hover:bg-muted/50 group"
                      onClick={() => setLocation(`/customers/${customer.id}`)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="font-medium truncate max-w-[200px]" title={customer.name}>{customer.name}</div>
                          {customer.autoInvoiceOnCompletion && (
                            <Badge variant="outline" className="gap-1 text-emerald-700 border-emerald-300 bg-emerald-50 text-[10px] px-1.5 py-0 shrink-0" title="Auto-invoice on job completion">
                              <Zap className="w-3 h-3" /> Auto-Invoice
                            </Badge>
                          )}
                          {(customer as any).hasPaymentMethod && (
                            <Badge variant="outline" className="gap-1 text-blue-600 border-blue-200 bg-blue-50 text-[10px] px-1.5 py-0 shrink-0 cursor-default" title="Saved payment method on file">
                              <CreditCard className="w-3 h-3" /> Card on file
                            </Badge>
                          )}
                          {failure && (
                            <Badge variant="outline" className="gap-1 text-red-600 border-red-200 text-[10px] px-1.5 py-0 shrink-0" title={failure.errorNote ?? `Failed via ${failure.channel}`}>
                              <AlertTriangle className="w-3 h-3" /> Reminder failed · {failure.channel}
                            </Badge>
                          )}
                        </div>
                        {customer.company && <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5" title={`Company: ${customer.company}`}><Building className="w-3 h-3" />{customer.company}</div>}
                        {((customer as any).tags ?? []).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {((customer as any).tags as string[]).slice(0, 3).map((tag: string) => (
                              <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0 bg-violet-50 text-violet-700 border-violet-200 cursor-pointer hover:bg-violet-100" title={`Filter by tag: ${tag}`} onClick={e => { e.stopPropagation(); setTagFilter(tag); }}>{tag}</Badge>
                            ))}
                            {((customer as any).tags as string[]).length > 3 && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground" title={(customer as any).tags.slice(3).join(', ')}>+{((customer as any).tags as string[]).length - 3}</Badge>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm flex flex-col gap-0.5">
                          {customer.phone && <a href={`tel:${customer.phone}`} title={`Call ${customer.phone}`} className="flex items-center gap-2 text-muted-foreground hover:text-primary" onClick={e => e.stopPropagation()}><Phone className="w-3 h-3" />{customer.phone}</a>}
                          {customer.email && <a href={`mailto:${customer.email}`} title={`Email ${customer.email}`} className="flex items-center gap-2 text-muted-foreground hover:text-primary" onClick={e => e.stopPropagation()}><Mail className="w-3 h-3" />{customer.email}</a>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {(customer as { customerType?: string }).customerType ? (
                          <Badge variant="secondary" className="capitalize cursor-pointer hover:bg-secondary/70" title={`Filter by ${(customer as any).customerType}`} onClick={e => { e.stopPropagation(); setTypeFilter((customer as any).customerType); }}>{(customer as { customerType?: string }).customerType}</Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell><Badge variant="secondary" title={`${customer.propertyCount || 0} propert${(customer.propertyCount || 0) !== 1 ? 'ies' : 'y'}`}>{customer.propertyCount || 0}</Badge></TableCell>
                      <TableCell className="text-right font-medium" title={`Total spend: $${(customer.totalSpend ?? 0).toLocaleString()}`}>${(customer.totalSpend ?? 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap" title={(customer as any).lastServiceDate ? new Date((customer as any).lastServiceDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : undefined}>
                        {(customer as any).lastServiceDate ? new Date((customer as any).lastServiceDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap" title={customer.createdAt ? `Customer since ${new Date(customer.createdAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}` : undefined}>
                        {customer.createdAt ? new Date(customer.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '—'}
                      </TableCell>
                      <TableCell className="w-24 p-1">
                        <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            title="New job"
                            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                            onClick={e => { e.stopPropagation(); setLocation(`/schedule?action=create&customerId=${customer.id}`); }}
                          ><Briefcase className="w-3.5 h-3.5" /></button>
                          <button
                            title="New invoice"
                            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                            onClick={e => { e.stopPropagation(); setLocation(`/financials?action=create&customerId=${customer.id}`); }}
                          ><FileText className="w-3.5 h-3.5" /></button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          {data && data.items.length >= 200 && data.total > 200 && (
            <div className="px-4 py-3 border-t text-xs text-muted-foreground text-center">
              Showing 200 of {data.total.toLocaleString()} customers — refine your search to find others
            </div>
          )}
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
              <Field label="Full Name" required={activeFields.find(f => f.key === 'name')?.required ?? true}>
                <Input title="Customer's full name" value={form.name as string} onChange={e => setField('name', e.target.value)} placeholder="Jane Smith" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Email" required={activeFields.find(f => f.key === 'email')?.required ?? true}>
                  <Input type="email" title="Customer's email address for invoices and notifications" value={form.email as string} onChange={e => setField('email', e.target.value)} placeholder="jane@example.com" />
                </Field>
                <Field label="Phone" required={activeFields.find(f => f.key === 'phone')?.required ?? true}>
                  <Input title="Customer's primary phone number" value={form.phone as string} onChange={e => setField('phone', e.target.value)} placeholder="(555) 000-0000" />
                </Field>
              </div>
              {activeFields.filter(f => f.isBuiltIn && f.visible && f.key === 'secondaryPhone').map(f => (
                <Field key={f.key} label={f.label} required={f.required}>
                  <Input title="Customer's secondary or alternate phone number" value={form.secondaryPhone as string} onChange={e => setField('secondaryPhone', e.target.value)} placeholder="(555) 000-0001" />
                </Field>
              ))}
              {activeFields.filter(f => f.isBuiltIn && f.visible && f.key === 'company').map(f => (
                <Field key={f.key} label={f.label} required={f.required}>
                  <Input title="Customer's company or organization name" value={form.company as string} onChange={e => setField('company', e.target.value)} placeholder="Acme Corp" />
                </Field>
              ))}
              {activeFields.filter(f => f.isBuiltIn && f.visible && f.key === 'customerType').map(f => (
                <Field key={f.key} label={f.label} required={f.required}>
                  <Select value={form.customerType as string} onValueChange={v => setField('customerType', v)}>
                    <SelectTrigger title="Customer category (Residential, Commercial, HOA, etc.)"><SelectValue placeholder="Select type..." /></SelectTrigger>
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
                    <SelectTrigger title="How this customer found the business"><SelectValue placeholder="Select source..." /></SelectTrigger>
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
                  <div className="relative">
                    <Input
                      ref={addrInputRef}
                      title="Customer's billing street address"
                      value={form.billingAddress as string}
                      onChange={e => setField('billingAddress', e.target.value)}
                      onFocus={() => setAddrFocused(true)}
                      onBlur={() => setTimeout(() => setAddrFocused(false), 200)}
                      placeholder="123 Main St"
                    />
                    {addrFocused && (addrSuggestions.length > 0 || addrLoading) && (
                      <div className="absolute z-50 left-0 right-0 top-full mt-1 rounded-md border bg-popover shadow-lg overflow-hidden">
                        {addrLoading && (
                          <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
                            <MapPin className="w-3.5 h-3.5 animate-pulse" /> Searching…
                          </div>
                        )}
                        {addrSuggestions.map((s, idx) => {
                          const p = s.properties;
                          const street = photonStreet(p);
                          const city = p.city ?? p.county ?? '';
                          const state = p.state ?? '';
                          const zip = p.postcode ?? '';
                          return (
                            <button
                              key={idx}
                              type="button"
                              className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors border-b last:border-b-0"
                              onMouseDown={() => {
                                setField('billingAddress', street || (form.billingAddress as string));
                                setField('billingCity', city);
                                // Photon returns full state names; abbreviate to 2 chars if >2
                                setField('billingState', toStateAbbr(state));
                                setField('billingZip', zip.slice(0, 5));
                                clearAddrSuggestions();
                                setAddrFocused(false);
                              }}
                            >
                              <span className="font-medium">{street}</span>
                              {(city || state) && (
                                <span className="text-muted-foreground ml-1">{[city, state, zip].filter(Boolean).join(', ')}</span>
                              )}
                            </button>
                          );
                        })}
                        <div className="px-3 py-1 text-[10px] text-muted-foreground/60 border-t">Powered by OpenStreetMap</div>
                      </div>
                    )}
                  </div>
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
                <Textarea title="Internal notes about this customer (not visible to them)" value={form.notes as string} onChange={e => setField('notes', e.target.value)} placeholder="Internal notes about this customer..." className="min-h-[80px]" />
              </Section>
            )}

            {activeFields.some(f => f.key === 'tags' && f.visible) && (
              <Section title="Tags" icon={<Tag className="w-4 h-4" />}>
                <div className="flex flex-wrap gap-2 mb-2">
                  {((form.tags as string[]) ?? []).map(tag => (
                    <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                      {tag}
                      <button onClick={() => removeTag(tag)} title={`Remove tag "${tag}"`} className="ml-1 hover:text-destructive"><X className="w-3 h-3" /></button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input title="Type a tag and press Enter or click Add" placeholder="Add tag..." value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} className="flex-1" />
                  <Button variant="outline" size="sm" title="Add this tag to the customer" onClick={addTag} type="button">Add</Button>
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
