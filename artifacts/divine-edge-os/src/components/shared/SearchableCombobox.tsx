import * as React from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';

export interface ComboOption {
  value: string;
  label: string;
  /** Extra searchable text, e.g. SKU / part number */
  keywords?: string[];
  /** Right-aligned hint (price, stock) */
  hint?: React.ReactNode;
  /** Secondary line under label */
  sub?: React.ReactNode;
  disabled?: boolean;
}

interface Props {
  options: ComboOption[];
  value?: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
  /** Optional leading item (e.g. "Custom line item"), always shown */
  leadingOption?: ComboOption;
  triggerIcon?: React.ReactNode;
  /** Render trigger label override */
  displayLabel?: React.ReactNode;
  ariaLabel?: string;
  title?: string;
}

/**
 * Accessible searchable picker built on Popover + Command.
 * Search matches label and keywords (SKU, part number). Content marks itself with
 * data-picker-portal so parent Sheets/Dialogs can ignore outside-interactions from it.
 */
export function SearchableCombobox({
  options, value, onChange, placeholder = 'Select...', searchPlaceholder = 'Search...',
  emptyText = 'No matches found.', className, contentClassName, disabled, leadingOption,
  triggerIcon, displayLabel, ariaLabel, title,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const selected = React.useMemo(
    () => [leadingOption, ...options].find(o => o && o.value === value),
    [options, leadingOption, value],
  );
  const pick = (v: string) => { onChange(v); setOpen(false); };
  const render = (o: ComboOption) => (
    <CommandItem
      key={o.value}
      value={`${o.label} ${(o.keywords ?? []).join(' ')} ::${o.value}`}
      disabled={o.disabled}
      onSelect={() => pick(o.value)}
      className="text-xs"
    >
      <Check className={cn('mr-2 h-3.5 w-3.5 shrink-0', value === o.value ? 'opacity-100' : 'opacity-0')} />
      <div className="flex-1 min-w-0">
        <div className="truncate">{o.label}</div>
        {o.sub && <div className="text-[10px] text-muted-foreground truncate">{o.sub}</div>}
      </div>
      {o.hint && <span className="ml-2 text-muted-foreground shrink-0 tabular-nums">{o.hint}</span>}
    </CommandItem>
  );
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel ?? placeholder}
          title={title}
          disabled={disabled}
          className={cn(
            'flex h-8 items-center gap-1 rounded-md border border-input bg-background px-2.5 text-xs text-left',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed',
            className,
          )}
        >
          {triggerIcon}
          <span className={cn('flex-1 truncate', !selected && !displayLabel && 'text-muted-foreground')}>
            {displayLabel ?? selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        data-picker-portal=""
        className={cn('p-0 w-[min(340px,90vw)]', contentClassName)}
        align="start"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="text-xs" />
          <CommandList className="max-h-64">
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">{emptyText}</CommandEmpty>
            {leadingOption && <CommandGroup>{render(leadingOption)}</CommandGroup>}
            <CommandGroup>{options.map(render)}</CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Use in a Sheet/Dialog onInteractOutside / onPointerDownOutside to ignore picker portals. */
export function isFromPickerPortal(e: { target: EventTarget | null; preventDefault: () => void }) {
  const t = e.target as HTMLElement | null;
  if (t && typeof t.closest === 'function' &&
      t.closest('[data-picker-portal],[data-radix-popper-content-wrapper],[cmdk-root],[role="listbox"]')) {
    e.preventDefault();
    return true;
  }
  return false;
}
