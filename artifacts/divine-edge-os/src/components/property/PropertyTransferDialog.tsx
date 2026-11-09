import React, { useEffect, useState } from 'react';
import { customFetch, useListCustomers, getListCustomersQueryKey } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useDebounce } from '@/hooks/use-debounce';

interface PropertyMatch {
  id: number;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  customerId: number;
  customerName: string | null;
  isArchived?: boolean;
  archivedAt?: string | null;
  serviceableAreaSqft?: number | null;
}

export default function PropertyTransferDialog({
  open,
  onOpenChange,
  presetCustomerId,
  presetCustomerName,
  onTransferred,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetCustomerId?: number;
  presetCustomerName?: string;
  onTransferred?: (propertyId: number) => void;
}) {
  const [address, setAddress] = useState('');
  const debouncedAddress = useDebounce(address, 300);
  const [matches, setMatches] = useState<PropertyMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);
  const [customerId, setCustomerId] = useState(presetCustomerId ? String(presetCustomerId) : '');
  const [customerSearch, setCustomerSearch] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: customers } = useListCustomers(
    { limit: 100 },
    { query: { enabled: open && !presetCustomerId, queryKey: getListCustomersQueryKey({ limit: 100 }) } },
  );

  useEffect(() => {
    if (!open) return;
    setCustomerId(presetCustomerId ? String(presetCustomerId) : '');
  }, [open, presetCustomerId]);

  useEffect(() => {
    if (!open || debouncedAddress.trim().length < 4) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    customFetch<PropertyMatch[]>(`/api/properties/check?address=${encodeURIComponent(debouncedAddress.trim())}`)
      .then(rows => { if (!cancelled) setMatches(rows); })
      .catch(() => { if (!cancelled) setMatches([]); })
      .finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [debouncedAddress, open]);

  const selected = matches.find(property => property.id === selectedPropertyId) ?? null;
  const filteredCustomers = (customers?.items ?? []).filter(customer => {
    const query = customerSearch.trim().toLowerCase();
    if (!query) return true;
    return customer.name.toLowerCase().includes(query) || (customer.company ?? '').toLowerCase().includes(query);
  });

  const submit = async () => {
    if (!selected) { toast.error('Choose a property'); return; }
    const nextCustomerId = presetCustomerId ?? Number(customerId);
    if (!nextCustomerId) { toast.error('Choose the customer who should receive this property'); return; }
    if (nextCustomerId === selected.customerId) { toast.error('That customer already owns this property'); return; }
    setBusy(true);
    try {
      await customFetch(`/api/properties/${selected.id}/transfer`, {
        method: 'POST',
        body: JSON.stringify({ newCustomerId: nextCustomerId, notes: notes || undefined }),
      });
      toast.success(`Transferred ${selected.address}. Measurements and service dates stayed with the property.`);
      onTransferred?.(selected.id);
      onOpenChange(false);
      setAddress('');
      setSelectedPropertyId(null);
      setNotes('');
    } catch (error) {
      const message = (error as { data?: { error?: string } }).data?.error;
      toast.error(message || 'Transfer failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Transfer Property</DialogTitle>
          <DialogDescription>
            Search by address, including archived properties. Satellite drawings, area, perimeter, and property notes stay with the land. Invoices, estimates, and the previous owner’s messages stay on their account. Completed service dates remain for the crew.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Property address</label>
            <Input
              title="Search active and archived properties by street address"
              placeholder="Start typing a street address"
              value={address}
              onChange={event => { setAddress(event.target.value); setSelectedPropertyId(null); }}
            />
            <div className="max-h-40 overflow-y-auto rounded-md border">
              {searching ? <p className="p-3 text-sm text-muted-foreground">Searching…</p> : matches.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">{debouncedAddress.trim().length < 4 ? 'Enter at least 4 characters.' : 'No matching properties.'}</p>
              ) : matches.map(property => {
                const archived = property.isArchived || !!property.archivedAt;
                const selectedRow = property.id === selectedPropertyId;
                return (
                  <button
                    key={property.id}
                    type="button"
                    className={`block w-full px-3 py-2 text-left text-sm hover:bg-muted ${selectedRow ? 'bg-muted' : ''}`}
                    onClick={() => setSelectedPropertyId(property.id)}
                  >
                    <span className="font-medium">{property.address}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {[property.city, property.state, property.zip].filter(Boolean).join(', ')}
                      {property.customerName ? ` · ${property.customerName}` : ''}
                    </span>
                    {archived && <Badge variant="outline" className="mt-1">Archived</Badge>}
                  </button>
                );
              })}
            </div>
          </div>
          {presetCustomerId ? (
            <p className="text-sm">Assign to <span className="font-medium">{presetCustomerName || 'this customer'}</span></p>
          ) : (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">New customer</label>
              <Input title="Filter the customer list" placeholder="Search customers" value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} />
              <div className="max-h-32 overflow-y-auto rounded-md border">
                {filteredCustomers.slice(0, 40).map(customer => (
                  <button
                    key={customer.id}
                    type="button"
                    className={`block w-full px-3 py-2 text-left text-sm hover:bg-muted ${customerId === String(customer.id) ? 'bg-muted' : ''}`}
                    onClick={() => setCustomerId(String(customer.id))}
                  >
                    {customer.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Notes</label>
            <Textarea title="Why this property is changing owners" value={notes} onChange={event => setNotes(event.target.value)} placeholder="Sold, new occupant, billing account change" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !selected}>{busy ? 'Transferring…' : 'Transfer Property'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
