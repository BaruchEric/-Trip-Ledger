import { useCallback, useEffect, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { haversineMiles, type StoreLocation } from '../types/mileage';

const LA_CENTER = { lat: 34.0522, lng: -118.2437 };

function deriveShortStoreName(displayName: string, formattedAddress: string): string {
  // Extract city from US formatted address (e.g. "1605 W Olympic Blvd, Los Angeles, CA 90015, USA")
  const parts = formattedAddress.split(',').map((p) => p.trim());
  const city = parts.length >= 2 ? parts[1] : '';
  const cleanBrand = displayName.replace(/\s+/g, ' ').trim();
  if (city && !cleanBrand.toLowerCase().includes(city.toLowerCase())) {
    return `${cleanBrand} — ${city}`;
  }
  return cleanBrand || 'Curacao Store';
}

export interface UseCuracaoStoresReturn {
  stores: StoreLocation[];
  loading: boolean;
  error: string | null;
  refreshStores: () => void;
  findNearestStore: (
    lat: number,
    lng: number,
    maxMiles?: number
  ) => { store: StoreLocation; distanceMiles: number } | null;
}

/**
 * Dynamically discovers Curacao retail locations in Greater Los Angeles
 * via Google Maps Places API (New) Place.searchByText.
 * Zero hardcoded store addresses or coordinates.
 */
export function useCuracaoStores(): UseCuracaoStoresReturn {
  const placesLib = useMapsLibrary('places');
  const [stores, setStores] = useState<StoreLocation[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!placesLib) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchStores = async () => {
      try {
        const request = {
          textQuery: 'Curacao department store Los Angeles',
          fields: ['id', 'displayName', 'formattedAddress', 'location', 'businessStatus'],
          locationBias: LA_CENTER,
          language: 'en-US',
          region: 'us',
          maxResultCount: 16,
          internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
        };

        const { places } = await placesLib.Place.searchByText(request);
        if (cancelled) return;

        const seenIds: Record<string, boolean> = {};
        const parsed: StoreLocation[] = [];

        for (const place of places ?? []) {
          const id = place.id;
          const loc = place.location;
          const name = place.displayName ?? '';
          const address = place.formattedAddress ?? '';

          if (!id || !loc || seenIds[id]) continue;
          // Keep operational Curacao retail locations in Southern California
          if (!name.toLowerCase().includes('curacao') && !name.toLowerCase().includes('curaçao')) {
            continue;
          }
          if (place.businessStatus === 'CLOSED_PERMANENTLY') {
            continue;
          }

          seenIds[id] = true;
          parsed.push({
            placeId: id,
            name,
            shortName: deriveShortStoreName(name, address),
            address,
            lat: loc.lat(),
            lng: loc.lng(),
            businessStatus: place.businessStatus ?? undefined,
          });
        }

        // Sort by distance from Downtown LA so the flagship & central branches appear first
        parsed.sort(
          (a, b) =>
            haversineMiles(LA_CENTER.lat, LA_CENTER.lng, a.lat, a.lng) -
            haversineMiles(LA_CENTER.lat, LA_CENTER.lng, b.lat, b.lng)
        );

        setStores(parsed);
        setLoading(false);
      } catch (err: unknown) {
        if (cancelled) return;
        console.error('Error discovering Curacao stores:', err);
        setError('Unable to load Curacao LA store locations. You can still search any address.');
        setLoading(false);
      }
    };

    void fetchStores();

    return () => {
      cancelled = true;
    };
  }, [placesLib, reloadTick]);

  const refreshStores = useCallback(() => {
    setReloadTick((t) => t + 1);
  }, []);

  const findNearestStore = useCallback(
    (lat: number, lng: number, maxMiles = 100) => {
      let best: { store: StoreLocation; distanceMiles: number } | null = null;
      for (const store of stores) {
        const dist = haversineMiles(lat, lng, store.lat, store.lng);
        if (dist <= maxMiles && (!best || dist < best.distanceMiles)) {
          best = { store, distanceMiles: dist };
        }
      }
      return best;
    },
    [stores]
  );

  return {
    stores,
    loading,
    error,
    refreshStores,
    findNearestStore,
  };
}
