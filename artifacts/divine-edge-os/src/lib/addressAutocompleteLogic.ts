export type AddressSuggestion = {
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  label: string;
  distanceMiles: number | null;
  source: 'business' | 'google' | 'photon' | 'nominatim';
};

export type SuggestionResponse = {
  items: AddressSuggestion[];
  radiusApplied: boolean;
  center: { lat: number; lng: number } | null;
};

export async function resolveAddressSuggestions(
  query: string,
  result: SuggestionResponse,
  googleProvider: (query: string, center: { lat: number; lng: number } | null) => Promise<AddressSuggestion[]>,
): Promise<AddressSuggestion[]> {
  try {
    const googleItems = await googleProvider(query, result.center);
    if (googleItems.length > 0) return googleItems;
  } catch {
    // Server-provided Photon/Nominatim results keep address entry usable.
  }
  return result.items ?? [];
}