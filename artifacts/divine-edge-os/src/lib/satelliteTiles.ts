/** Esri World Imagery. The unofficial Google mt*.google.com tile URL returns 404, so a Maps key must not switch the map onto it. */
export const SATELLITE_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export const SATELLITE_TILE_ATTRIBUTION = 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics';

export type SatelliteStatus = 'loading' | 'loaded' | 'failed';

export function addSatelliteTileLayer(
  L: typeof import('leaflet'),
  map: import('leaflet').Map,
  onStatus?: (status: SatelliteStatus) => void,
) {
  let loaded = false;
  let errors = 0;
  const layer = L.tileLayer(SATELLITE_TILE_URL, {
    attribution: SATELLITE_TILE_ATTRIBUTION,
    maxZoom: 22,
    maxNativeZoom: 19,
  });
  layer.on('tileload', () => {
    if (loaded) return;
    loaded = true;
    onStatus?.('loaded');
  });
  layer.on('tileerror', () => {
    errors += 1;
    if (!loaded && errors >= 4) onStatus?.('failed');
  });
  layer.addTo(map);
  return layer;
}
