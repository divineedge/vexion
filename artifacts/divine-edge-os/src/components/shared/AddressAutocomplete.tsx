import React, { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';
import { useDebounce } from '@/hooks/use-debounce';
import { Input } from '@/components/ui/input';

export type AddressSuggestion = {
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  label: string;
  distanceMiles: number | null;
};

type Props = Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'onSelect'> & {
  value: string;
  onChange: (value: string) => void;
  onSelect: (address: AddressSuggestion) => void;
};

/** Server-backed address suggestions; does not depend on the Google client script. */
export function AddressAutocomplete({ value, onChange, onSelect, ...inputProps }: Props) {
  const [focused, setFocused] = useState(false);
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [radiusApplied, setRadiusApplied] = useState<boolean | null>(null);
  const query = useDebounce(value, 300);

  useEffect(() => {
    if (!focused || query.trim().length < 2) { setItems([]); return; }
    let cancelled = false;
    setLoading(true);
    customFetch<{ items: AddressSuggestion[]; radiusApplied: boolean }>(`/api/address-suggestions?q=${encodeURIComponent(query.trim())}`)
      .then(result => {
        if (!cancelled) {
          setItems(result.items ?? []);
          setRadiusApplied(result.radiusApplied);
        }
      })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [focused, query]);

  return (
    <div className="relative">
      <Input
        {...inputProps}
        value={value}
        onChange={event => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {focused && (loading || items.length > 0) && (
        <div className="absolute z-[100] left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-lg">
          {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Searching nearby addresses…</div>}
          {!loading && radiusApplied === false && (
            <div className="border-b bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Business address is not configured, so results are not distance-limited.
            </div>
          )}
          {items.map((item, index) => (
            <button key={`${item.label}-${index}`} type="button" className="flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-accent"
              onMouseDown={() => { onSelect(item); setItems([]); setFocused(false); }}>
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span><span className="font-medium">{item.label}</span>{item.distanceMiles !== null && <span className="ml-1 text-xs text-muted-foreground">({item.distanceMiles.toFixed(1)} mi)</span>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}