import React, { useMemo, useState } from 'react';
import type { StaffMessageAudience } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Check, ChevronsUpDown, UserRound, UsersRound } from 'lucide-react';
import { cn } from '@/lib/utils';

const audienceKey = (audience: Pick<StaffMessageAudience, 'audienceType' | 'audienceId'>) =>
  `${audience.audienceType}:${audience.audienceId ?? 'all'}`;

interface StaffAudiencePickerProps {
  audiences: StaffMessageAudience[];
  selected: StaffMessageAudience | null;
  onSelect: (audience: StaffMessageAudience) => void;
  isLoading?: boolean;
  isError?: boolean;
  className?: string;
}

export function StaffAudiencePicker({
  audiences,
  selected,
  onSelect,
  isLoading = false,
  isError = false,
  className,
}: StaffAudiencePickerProps) {
  const [open, setOpen] = useState(false);
  const individuals = useMemo(
    () => audiences.filter(audience => audience.audienceType === 'staff'),
    [audiences],
  );
  const teams = useMemo(
    () => audiences.filter(audience => audience.audienceType !== 'staff'),
    [audiences],
  );

  const choose = (audience: StaffMessageAudience) => {
    if (!audience.canSend) return;
    onSelect(audience);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Choose a message recipient"
          data-testid="select-staff-message-audience"
          className={cn('w-full justify-between font-normal', className)}
          disabled={isLoading || isError}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected?.audienceType === 'staff'
              ? <UserRound className="h-4 w-4 shrink-0 text-primary" />
              : <UsersRound className="h-4 w-4 shrink-0 text-primary" />}
            <span className={cn('truncate', !selected && 'text-muted-foreground')}>
              {isLoading ? 'Loading recipients…' : isError ? 'Recipients unavailable' : selected?.label ?? 'Choose a person or team…'}
            </span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search people and teams…" />
          <CommandList>
            <CommandEmpty>No matching active staff or teams.</CommandEmpty>
            {individuals.length > 0 && (
              <CommandGroup heading="Individuals">
                {individuals.map(audience => (
                  <CommandItem
                    key={audienceKey(audience)}
                    value={`${audience.label} ${audience.description} individual staff`}
                    onSelect={() => choose(audience)}
                    disabled={!audience.canSend}
                  >
                    <UserRound className="h-4 w-4" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{audience.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{audience.description}</span>
                    </span>
                    <Check className={cn('h-4 w-4', selected && audienceKey(selected) === audienceKey(audience) ? 'opacity-100' : 'opacity-0')} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {individuals.length > 0 && teams.length > 0 && <CommandSeparator />}
            {teams.length > 0 && (
              <CommandGroup heading="Teams and groups">
                {teams.map(audience => (
                  <CommandItem
                    key={audienceKey(audience)}
                    value={`${audience.label} ${audience.description} ${audience.audienceType}`}
                    onSelect={() => choose(audience)}
                    disabled={!audience.canSend}
                  >
                    <UsersRound className="h-4 w-4" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{audience.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {audience.description} · {audience.memberCount} member{audience.memberCount === 1 ? '' : 's'}
                      </span>
                    </span>
                    <Check className={cn('h-4 w-4', selected && audienceKey(selected) === audienceKey(audience) ? 'opacity-100' : 'opacity-0')} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}