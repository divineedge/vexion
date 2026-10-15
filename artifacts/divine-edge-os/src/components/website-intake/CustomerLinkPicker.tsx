import { useEffect, useState } from 'react';
import { useGetWebsiteCustomerChoices, type GetWebsiteCustomerChoices200 } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';

export interface CustomerLinkChoice {
  customerId?: number;
  propertyId?: number;
  confirmCustomerChoice: boolean;
}
type CustomerChoice = GetWebsiteCustomerChoices200['customers'][number];
type PropertyChoice = GetWebsiteCustomerChoices200['properties'][number];

export default function CustomerLinkPicker({ id, address, corrections, onChange, onReady }: {
  id: number; address: string;
  corrections?: { name?: string; email?: string; phone?: string; address?: string };
  onChange: (choice: CustomerLinkChoice) => void;
  onReady: (ready: boolean) => void;
}) {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [search, setSearch] = useState('');
  const rawParams = JSON.stringify({ search, name: corrections?.name, email: corrections?.email, phone: corrections?.phone, address: corrections?.address });
  const [params, setParams] = useState(rawParams);
  const [selected, setSelected] = useState<CustomerChoice | null>(null);
  const [selectedProperties, setSelectedProperties] = useState<PropertyChoice[]>([]);
  const [propertyId, setPropertyId] = useState<number>();
  const [confirmed, setConfirmed] = useState(false);
  const q = useGetWebsiteCustomerChoices(id, JSON.parse(params));
  useEffect(() => { const timer = setTimeout(() => setParams(rawParams), 250); return () => clearTimeout(timer); }, [rawParams]);
  const identity = JSON.stringify(corrections ?? {});
  useEffect(() => { setConfirmed(false); }, [identity]);
  const needsConfirmation = mode === 'existing' || !!q.data?.possibleMatches.length;
  useEffect(() => {
    onChange({ customerId: mode === 'existing' ? selected?.id : undefined, propertyId: mode === 'existing' ? propertyId : undefined, confirmCustomerChoice: confirmed });
    onReady(params === rawParams && !!q.data && !q.isError && !q.isFetching && (mode === 'new' || !!selected) && (!needsConfirmation || confirmed));
  }, [mode, selected, propertyId, confirmed, q.data, q.isError, q.isFetching, needsConfirmation, onChange, onReady, params, rawParams]);
  const choose = (customer: CustomerChoice) => {
    setMode('existing'); setSelected(customer); setPropertyId(undefined); setConfirmed(false);
    setSelectedProperties(q.data?.properties.filter(p => p.customerId === customer.id) ?? []);
  };
  const card = (customer: CustomerChoice) => (
    <button type="button" key={customer.id} onClick={() => choose(customer)}
      data-testid={`choose-customer-${customer.id}`} aria-pressed={selected?.id === customer.id && mode === 'existing'}
      className={`w-full text-left rounded border p-2 text-sm ${selected?.id === customer.id && mode === 'existing' ? 'border-primary bg-primary/5' : 'bg-background'}`}>
      <span className="font-medium">{customer.name || 'Unnamed customer'} · #{customer.id}</span>
      <span className="block text-xs">{[customer.email, customer.phone, customer.address].filter(Boolean).join(' · ')}</span>
      {!!customer.reasons.length && <span className="block text-xs text-amber-700 dark:text-amber-400">Possible duplicate: {customer.reasons.join(', ')}</span>}
    </button>
  );
  const properties = selectedProperties;
  return (
    <section className="space-y-3" aria-label="Customer and property choice">
      <h4 className="text-sm font-semibold">Customer and property</h4>
      <p className="text-xs text-muted-foreground">Matches are suggestions only. Email addresses never link records automatically.</p>
      {q.data && q.data.possibleMatches.length > 0 && <div className="space-y-2 rounded border border-amber-400 p-3" data-testid="possible-duplicates">
        <p className="text-sm font-medium">Possible existing customers — confirm before approving</p>
        {q.data.possibleMatches.map(card)}
        {q.data.matchesTruncated && <p className="text-xs">More matches exist. Search to narrow the results.</p>}
      </div>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={mode === 'new' ? 'default' : 'outline'} onClick={() => { setMode('new'); setConfirmed(false); }} data-testid="customer-mode-new">Create a new customer</Button>
        <Button type="button" size="sm" variant={mode === 'existing' ? 'default' : 'outline'} onClick={() => { setMode('existing'); setConfirmed(false); }} data-testid="customer-mode-existing">Link existing customer</Button>
      </div>
      {mode === 'existing' && <div className="space-y-2">
        <Input aria-label="Search existing customers" placeholder="Search name, email, phone or property address" maxLength={200} value={search} onChange={e => setSearch(e.target.value)} data-testid="customer-search" />
        <div className="max-h-52 overflow-y-auto space-y-2">{q.data?.customers.map(card)}</div>
        {q.data?.hasMore && <p className="text-xs">Showing the first 50 customers. Refine your search.</p>}
        {q.data && !q.data.customers.length && <p className="text-xs">No customers match this search.</p>}
        {selected && <div className="rounded border p-3 space-y-2">
          <p className="text-sm font-medium">Selected: {selected.name} · #{selected.id}</p>
          <label className="block text-xs space-y-1">Property
            <select className="w-full rounded border bg-background p-2 text-sm" value={propertyId ?? ''} data-testid="existing-property-picker"
              onChange={e => { setPropertyId(e.target.value ? Number(e.target.value) : undefined); setConfirmed(false); }}>
              <option value="">{address ? `Create property from submission: ${address}` : 'No property (no address submitted)'}</option>
              {properties.map(p => <option key={p.id} value={p.id}>{[p.address, p.city, p.state, p.zip].filter(Boolean).join(', ')} · #{p.id}</option>)}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">Existing contact details, marketing preferences, property measurements and acquisition history will not be changed.</p>
        </div>}
      </div>}
      {q.isFetching && <p className="text-xs">Checking customer records…</p>}
      {q.isError && <p className="text-xs text-destructive">Could not check customer records. <button type="button" className="underline" onClick={() => q.refetch()}>Retry</button></p>}
      {needsConfirmation && <label className="flex gap-2 text-sm items-start">
        <Checkbox checked={confirmed} onCheckedChange={v => setConfirmed(v === true)} data-testid="confirm-customer-choice" />
        {mode === 'existing' ? 'I confirm this is the correct customer and property choice.' : 'I reviewed the possible matches and intend to create a separate new customer.'}
      </label>}
    </section>
  );
}
