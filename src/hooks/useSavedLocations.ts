import { useCallback, useMemo, useState } from 'react';
import {
  FIELD_LIMITS,
  generateDocId,
  haversineMiles,
  sanitizeStr,
  type SavedLocation,
  type SavedLocationInput,
  type StoreLocation,
} from '../types/mileage';

const LOCAL_LOCATIONS_STORAGE_KEY = 'miletrack_saved_locations_v1';

function loadLocalLocations(): SavedLocation[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_LOCATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedLocation =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.address === 'string'
    );
  } catch {
    return [];
  }
}

function saveLocalLocations(list: SavedLocation[]) {
  try {
    window.localStorage.setItem(LOCAL_LOCATIONS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Ignore storage quota or restricted context errors
  }
}

export function savedLocationToStoreLocation(loc: SavedLocation): StoreLocation {
  const shortName = loc.name.trim().slice(0, 32) || loc.address.slice(0, 32);
  return {
    id: loc.id,
    placeId: loc.placeId || `loc:${loc.id}`,
    name: loc.name,
    shortName,
    address: loc.address,
    lat: loc.hasCoordinates ? loc.lat : 0,
    lng: loc.hasCoordinates ? loc.lng : 0,
    hasCoordinates: loc.hasCoordinates,
    category: loc.category,
    isHome: loc.isHome,
    notes: loc.notes,
  };
}

/**
 * Local-storage backed Saved Locations hook used in guest mode before Google Sign-In.
 */
export function useLocalLocations() {
  const [locations, setLocations] = useState<SavedLocation[]>(() => loadLocalLocations());

  const addLocation = useCallback(async (input: SavedLocationInput) => {
    const newLoc: SavedLocation = {
      id: generateDocId('loc'),
      userId: 'local',
      name: sanitizeStr(input.name, FIELD_LIMITS.locationName),
      address: sanitizeStr(input.address, FIELD_LIMITS.locationAddress),
      placeId: sanitizeStr(input.placeId, FIELD_LIMITS.placeId),
      category: input.category,
      lat: input.hasCoordinates ? Math.min(90, Math.max(-90, input.lat)) : 0,
      lng: input.hasCoordinates ? Math.min(180, Math.max(-180, input.lng)) : 0,
      hasCoordinates: Boolean(input.hasCoordinates),
      isHome: Boolean(input.isHome),
      notes: sanitizeStr(input.notes, FIELD_LIMITS.locationNotes),
    };

    setLocations((prev) => {
      const base = newLoc.isHome ? prev.map((l) => ({ ...l, isHome: false })) : prev;
      const next = [newLoc, ...base];
      saveLocalLocations(next);
      return next;
    });
  }, []);

  const updateLocation = useCallback(
    async (locationId: string, input: SavedLocationInput) => {
      setLocations((prev) => {
        const next = prev.map((loc) => {
          if (loc.id === locationId) {
            return {
              ...loc,
              name: sanitizeStr(input.name, FIELD_LIMITS.locationName),
              address: sanitizeStr(input.address, FIELD_LIMITS.locationAddress),
              placeId: sanitizeStr(input.placeId, FIELD_LIMITS.placeId),
              category: input.category,
              lat: input.hasCoordinates ? Math.min(90, Math.max(-90, input.lat)) : 0,
              lng: input.hasCoordinates ? Math.min(180, Math.max(-180, input.lng)) : 0,
              hasCoordinates: Boolean(input.hasCoordinates),
              isHome: Boolean(input.isHome),
              notes: sanitizeStr(input.notes, FIELD_LIMITS.locationNotes),
            };
          }
          if (input.isHome && loc.isHome) {
            return { ...loc, isHome: false };
          }
          return loc;
        });
        saveLocalLocations(next);
        return next;
      });
    },
    []
  );

  const deleteLocation = useCallback(async (locationId: string) => {
    setLocations((prev) => {
      const next = prev.filter((l) => l.id !== locationId);
      saveLocalLocations(next);
      return next;
    });
  }, []);

  const setHomeLocation = useCallback(async (target: SavedLocation) => {
    setLocations((prev) => {
      const next = prev.map((l) => ({
        ...l,
        isHome: l.id === target.id,
      }));
      saveLocalLocations(next);
      return next;
    });
  }, []);

  return {
    locations,
    addLocation,
    updateLocation,
    deleteLocation,
    setHomeLocation,
  };
}

/**
 * Derives StoreLocation projections, nearest-location snapping, and a dynamic
 * map/autocomplete bias center from the user's saved locations.
 */
export function useLocationHelpers(savedLocations: SavedLocation[]) {
  const storeLocations = useMemo<StoreLocation[]>(() => {
    const sorted = [...savedLocations].sort((a, b) => {
      if (a.isHome && !b.isHome) return -1;
      if (!a.isHome && b.isHome) return 1;
      return a.name.localeCompare(b.name);
    });
    return sorted.map(savedLocationToStoreLocation);
  }, [savedLocations]);

  const primaryBiasCenter = useMemo<google.maps.LatLngLiteral | null>(() => {
    const homeMappable = storeLocations.find(
      (s) => s.isHome && s.hasCoordinates !== false
    );
    if (homeMappable) {
      return { lat: homeMappable.lat, lng: homeMappable.lng };
    }
    const firstMappable = storeLocations.find((s) => s.hasCoordinates !== false);
    if (firstMappable) {
      return { lat: firstMappable.lat, lng: firstMappable.lng };
    }
    return null;
  }, [storeLocations]);

  const findNearestStore = useCallback(
    (
      lat: number,
      lng: number,
      maxMiles = 1.5
    ): { store: StoreLocation; distanceMiles: number } | null => {
      let best: { store: StoreLocation; distanceMiles: number } | null = null;
      for (const store of storeLocations) {
        if (store.hasCoordinates === false) continue;
        const dist = haversineMiles(lat, lng, store.lat, store.lng);
        if (dist <= maxMiles && (!best || dist < best.distanceMiles)) {
          best = { store, distanceMiles: dist };
        }
      }
      return best;
    },
    [storeLocations]
  );

  return {
    storeLocations,
    primaryBiasCenter,
    findNearestStore,
  };
}
