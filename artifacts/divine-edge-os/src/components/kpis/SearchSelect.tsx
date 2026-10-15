import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';

export interface SearchOption { value: string; label: string }
export function SearchSelect({ label, value, options, onChange, testId }: { label: string; value: string; options: SearchOption[]; onChange: (v: string) => void; testId: string }) {
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.value === value)?.label ?? options[0]?.label ?? '';
  return (
    <div className="min-w-0">
      <label className="text-[11px] text-muted-foreground block">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" role="combobox" aria-expanded={open} aria-label={label} className="h-8 w-full sm:w-[220px] justify-between font-normal" data-testid={testId}>
            <span className="truncate">{current}</span><ChevronsUpDown className="w-3.5 h-3.5 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[260px]" align="start">
          <Command>
            <CommandInput placeholder={`Search ${label.toLowerCase()}…`} />
            <CommandList>
              <CommandEmpty>No matches.</CommandEmpty>
              <CommandGroup>
                {options.map(o => (
                  <CommandItem key={o.value} value={`${o.label} ${o.value}`} onSelect={() => { onChange(o.value); setOpen(false); }} data-testid={`${testId}-option-${o.value}`}>
                    <Check className={`w-3.5 h-3.5 mr-2 ${o.value === value ? 'opacity-100' : 'opacity-0'}`} />{o.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
