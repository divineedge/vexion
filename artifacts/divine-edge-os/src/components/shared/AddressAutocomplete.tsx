import React, { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';
import { useDebounce } from '@/hooks/use-debounce';
import { Input } from '@/components/ui/input';
import {
  resolveAddressSuggestions,
  type AddressSuggestion,
  type SuggestionResponse,
} from '@/lib/addressAutocompleteLogic';

export type { AddressSuggestion } from '@/lib/addressAutocompleteLogic';

type Props = Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'onSelect'> & {
  value: string;
  onChange: (value: string) => void;
  onSelect: (address: AddressSuggestion) => void;
};

let googleMapsPromise: Promise<any> | null = null;

function loadGoogleMaps(): Promise<any> {
  const existing = (window as any).google?.maps?.places;
  if (existing) return Promise.resolve((window as any).google);
  if (googleMapsPromise) return googleMapsPromise;
  googleMapsPromise = new Promise((resolve, reject) => {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!key) { reject(new Error('Google Maps key is unavailable')); return; }
    const prior = document.querySelector<HTMLScriptElement>('script[src*="maps.googleapis.com/maps/api/js"]');
    if (prior) {
      const timer = window.setInterval(() => {
        if ((window as any).google?.maps?.places) {
          window.clearInterval(timer);
          resolve((window as any).google);
        }
      }, 100);
      window.setTimeout(() => { window.clearInterval(timer); reject(new Error('Google Maps did not load')); }, 8000);
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&loading=async`;
    script.async = true;
    script.onload = () => {
      const google = (window as any).google;
      if (google?.maps?.places) resolve(google);
      else reject(new Error('Google Places is unavailable'));
    };
    script.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(script);
  });
  return googleMapsPromise;
}

function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (degrees: number) => degrees * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function googleSuggestions(query: string, center: { lat: number; lng: number } | null): Promise<AddressSuggestion[]> {
  const google = await loadGoogleMaps();
  const service = new google.maps.places.AutocompleteService();
  const predictions: any[] = await new Promise((resolve, reject) => {
    service.getPlacePredictions({
      input: query,
      componentRestrictions: { country: 'us' },
      types: ['address'],
      ...(center ? { location: center, radius: 50000 } : {}),
    }, (results: any[], status: string) => {
      if (status === google.maps.places.PlacesServiceStatus.OK) resolve(results ?? []);
      else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) resolve([]);
      else reject(new Error(status));
    });
  });
  const geocoder = new google.maps.Geocoder();
  const results = await Promise.all(predictions.slice(0, 8).map((prediction: any) => new Promise<AddressSuggestion | null>(resolve => {
    geocoder.geocode({ placeId: prediction.place_id }, (matches: any[], status: string) => {
      const match = matches?.[0];
      if (status !== 'OK' || !match?.geometry?.location) { resolve(null); return; }
      const get = (type: string, short = false) => {
        const component = match.address_components?.find((part: any) => part.types.includes(type));
        return component ? (short ? component.short_name : component.long_name) : '';
      };
      const address = [get('street_number'), get('route')].filter(Boolean).join(' ');
      if (!address) { resolve(null); return; }
      const lat = match.geometry.location.lat();
      const lng = match.geometry.location.lng();
      const distance = center ? distanceMiles(center, { lat, lng }) : null;
      if (distance !== null && distance > 200) { resolve(null); return; }
      resolve({
        address,
        city: get('locality') || get('postal_town') || null,
        state: get('administrative_area_level_1', true) || null,
        zip: get('postal_code') || null,
        lat,
        lng,
        label: match.formatted_address ?? prediction.description,
        distanceMiles: distance,
        source: 'google',
      });
    });
  })));
  return results.filter((item): item is AddressSuggestion => item !== null);
}

/** Google-first address suggestions with a server fallback when the browser provider is unavailable. */
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
    customFetch<SuggestionResponse>(`/api/address-suggestions?q=${encodeURIComponent(query.trim())}`)
      .then(async result => {
        const resolved = await resolveAddressSuggestions(query.trim(), result, googleSuggestions);
        if (!cancelled) {
          setItems(resolved);
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
        <div className="absolute z-[1100] left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-lg">
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
              <span>
                <span className="font-medium">{item.label}</span>
                {item.distanceMiles !== null && <span className="ml-1 text-xs text-muted-foreground">({item.distanceMiles.toFixed(1)} mi)</span>}
                {(item.source === 'photon' || item.source === 'nominatim') && <span className="ml-1 text-xs text-amber-700">fallback result</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}