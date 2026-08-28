import React, { useState } from 'react';
import { Check, ChevronsUpDown, UserRound } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';

export const CUSTOMER_REFERRAL_SOURCE = 'customer_referral';

type CustomerChoice = { id: number; name: string; email: string };
type CustomerListResponse = { items: CustomerChoice[] };

export function ReferringCustomerPicker({
  value,
  selectedName,
  excludeCustomerId,
  onChange,
}: {
  value: number | null;
  selectedName?: string | null;
  excludeCustomerId?: number;
  onChange: (customer: CustomerChoice | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);
  const { data, isFetching } = useQuery({
    queryKey: ['referring-customer-options', debouncedSearch],
    queryFn: () => customFetch<CustomerListResponse>(
      `/api/customers?limit=100${debouncedSearch ? `&q=${encodeURIComponent(debouncedSearch)}` : ''}`,
    ),
    enabled: open,
  });
  const choices = (data?.items ?? []).filter((customer) => customer.id !== excludeCustomerId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {value ? selectedName || `Customer #${value}` : 'Select referring customer...'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search customers..." value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{isFetching ? 'Searching...' : 'No customers found.'}</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem value="clear" onSelect={() => { onChange(null); setOpen(false); }}>
                  Clear selection
                </CommandItem>
              )}
              {choices.map((customer) => (
                <CommandItem
                  key={customer.id}
                  value={String(customer.id)}
                  onSelect={() => { onChange(customer); setOpen(false); }}
                >
                  <Check className={cn('h-4 w-4', value === customer.id ? 'opacity-100' : 'opacity-0')} />
                  <UserRound className="h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate">{customer.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{customer.email}</p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}