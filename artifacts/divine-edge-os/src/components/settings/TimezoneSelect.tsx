import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';

const COMMON_US: { id: string; label: string }[] = [
  { id: 'America/New_York', label: 'Eastern Time' },
  { id: 'America/Chicago', label: 'Central Time' },
  { id: 'America/Denver', label: 'Mountain Time' },
  { id: 'America/Phoenix', label: 'Mountain Time — Arizona (no DST)' },
  { id: 'America/Los_Angeles', label: 'Pacific Time' },
  { id: 'America/Anchorage', label: 'Alaska Time' },
  { id: 'Pacific/Honolulu', label: 'Hawaii Time' },
];

function allZones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (fn) return fn('timeZone');
  } catch { /* older browsers */ }
  return COMMON_US.map(z => z.id);
}

function offsetLabel(tz: string): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName');
    return part?.value ?? '';
  } catch { return ''; }
}

/** Searchable IANA timezone picker. Value saved is always the IANA id. */
export function TimezoneSelect({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  const [open, setOpen] = useState(false);
  const zones = useMemo(() => {
    const list = allZones();
    const commonIds = new Set(COMMON_US.map(c => c.id));
    const rest = list.filter(z => !commonIds.has(z));
    // Keep a saved value visible even if this browser doesn't list it.
    if (value && !commonIds.has(value) && !list.includes(value)) rest.unshift(value);
    return rest;
  }, [value]);
  const common = COMMON_US.find(c => c.id === value);
  const display = value ? (common ? `${common.label} (${value})` : value.replace(/_/g, ' ')) : 'Select a timezone';

  const pick = (tz: string) => { onChange(tz); setOpen(false); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal" data-testid="select-timezone" title="Timezone used for scheduling and date display">
          <span className="truncate">{display}</span>
          <ChevronsUpDown className="w-4 h-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search city or region…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No timezone found.</CommandEmpty>
            <CommandGroup heading="United States">
              {COMMON_US.map(z => (
                <CommandItem key={z.id} value={`${z.label} ${z.id}`} onSelect={() => pick(z.id)}>
                  <Check className={cn('w-4 h-4 mr-2', value === z.id ? 'opacity-100' : 'opacity-0')} />
                  <span className="flex-1">{z.label}</span>
                  <span className="text-xs text-muted-foreground">{offsetLabel(z.id)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="All timezones">
              {zones.map(z => (
                <CommandItem key={z} value={z} onSelect={() => pick(z)}>
                  <Check className={cn('w-4 h-4 mr-2', value === z ? 'opacity-100' : 'opacity-0')} />
                  <span className="flex-1">{z.replace(/_/g, ' ')}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default TimezoneSelect;
