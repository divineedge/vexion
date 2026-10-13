import { useState } from 'react';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { useGetCustomer, useListCustomers, getGetCustomerQueryKey, getListCustomersQueryKey } from '@workspace/api-client-react';
import { useDebounce } from '@/hooks/use-debounce';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

/** Server-side search keeps customers beyond the first page selectable. */
export function EstimateCustomerPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search.trim(), 250);
  const params = { q: debounced || undefined, page, limit: 50 };
  const { data, isFetching, isError, refetch } = useListCustomers(
    params,
    { query: { enabled: open, queryKey: getListCustomersQueryKey(params) } },
  );
  const { data: selected } = useGetCustomer(Number(value), { query: { enabled: !!value, queryKey: getGetCustomerQueryKey(Number(value)) } });
  const waiting = isFetching || search.trim() !== debounced;
  const label = (customer: { id: number; name: string; company?: string | null; email?: string | null }) =>
    customer.name?.trim() || customer.company?.trim() || customer.email?.trim() || `Customer #${customer.id}`;
  const selectedOption = selected && String(selected.id) === value ? selected : data?.items.find(customer => String(customer.id) === value);

  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); if (next) { setSearch(''); setPage(1); } }} modal>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} aria-label="Customer"
          className="w-full justify-between font-normal" data-testid="estimate-customer-picker">
          <span className="truncate">{selectedOption ? label(selectedOption) : value ? 'Loading customer…' : 'Select customer…'}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search name, company, email or phone…" value={search}
            onValueChange={next => { setSearch(next); setPage(1); }} data-testid="estimate-customer-search" />
          {waiting && <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Searching customers…</div>}
          {isError ? <div className="p-3 text-sm" role="alert">Customers could not be loaded.
            <Button type="button" variant="link" onClick={() => void refetch()}>Retry</Button>
          </div> : (
            <CommandList className="max-h-64">
              {!waiting && <CommandEmpty>No matching customers.</CommandEmpty>}
              <CommandGroup>
                {(data?.items ?? []).map(customer => (
                  <CommandItem key={customer.id} value={String(customer.id)} disabled={waiting}
                    data-testid={`estimate-customer-option-${customer.id}`}
                    onSelect={() => { onChange(String(customer.id)); setOpen(false); }}>
                    <Check className={`mr-2 h-4 w-4 shrink-0 ${String(customer.id) === value ? 'opacity-100' : 'opacity-0'}`} />
                    <span className="min-w-0"><span className="block truncate">{label(customer)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[customer.company, customer.email, customer.phone].filter(Boolean).join(' · ')}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          )}
        </Command>
        {!!data?.total && <div className="flex items-center justify-between border-t p-2 text-xs text-muted-foreground">
          <Button type="button" variant="ghost" size="sm" disabled={waiting || page === 1} onClick={() => setPage(current => current - 1)}>Previous</Button>
          <span>Page {page} · {data.total} customers</span>
          <Button type="button" variant="ghost" size="sm" disabled={waiting || page * 50 >= data.total} onClick={() => setPage(current => current + 1)}>Next</Button>
        </div>}
      </PopoverContent>
    </Popover>
  );
}
