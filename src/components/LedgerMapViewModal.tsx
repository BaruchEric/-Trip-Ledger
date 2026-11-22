import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  Calendar,
  Crosshair,
  Loader2,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  Route as RouteIcon,
  X,
} from 'lucide-react';
import { useI18n } from '../lib/i18n';
import {
  formatCurrency,
  formatDateISO,
  type MileageTrip,
  type StoreLocation,
  type TripExpense,
} from '../types/mileage';

const FALLBACK_MAP_CENTER = { lat: 39.8283, lng: -98.5795 };
const MAX_ALL_ROAD_LEGS = 8;

interface LedgerMapViewModalProps {
  isOpen: boolean;
  trips: MileageTrip[];
  expenses: TripExpense[];
  stores: StoreLocation[];
  onClose: () => void;
}

interface ResolvedTripLeg {
  trip: MileageTrip;
  chronologicalIndex: number;
  origin: google.maps.LatLngLiteral | null;
  destination: google.maps.LatLngLiteral | null;
  roadPath: google.maps.LatLngLiteral[] | null;
}

interface AggregatedStopPin {
  key: string;
  position: google.maps.LatLngLiteral;
  name: string;
  address: string;
  firstOrder: number;
  isFirstOrigin: boolean;
  isFinalDestination: boolean;
  visits: Array<{
    trip: MileageTrip;
    role: 'Origin' | 'Destination';
    chronologicalIndex: number;
  }>;
}

function parseCoordinateString(value: string): google.maps.LatLngLiteral | null {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function offsetDaysISO(daysOffset: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + daysOffset);
  return formatDateISO(dt);
}

function startOfMonthISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function makeCoordKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function makeLookupKey(placeId: string, address: string, name: string): string {
  if (placeId.trim()) return `pid:${placeId.trim()}`;
  if (address.trim()) return `addr:${address.trim().toLowerCase()}`;
  return `name:${name.trim().toLowerCase()}`;
}

interface PeriodMapControllerProps {
  legs: ResolvedTripLeg[];
  selectedTripId: string | null;
  recenterNonce: number;
}

function PeriodMapController({
  legs,
  selectedTripId,
  recenterNonce,
}: PeriodMapControllerProps) {
  const map = useMap();
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  const fitBoundsForLegs = useCallback(
    (targetLegs: ResolvedTripLeg[]) => {
      if (!map || targetLegs.length === 0) return;
      const bounds = new google.maps.LatLngBounds();
      let pointCount = 0;

      for (const leg of targetLegs) {
        if (leg.roadPath && leg.roadPath.length > 0) {
          for (const pt of leg.roadPath) {
            bounds.extend(pt);
            pointCount += 1;
          }
        } else {
          if (leg.origin) {
            bounds.extend(leg.origin);
            pointCount += 1;
          }
          if (leg.destination) {
            bounds.extend(leg.destination);
            pointCount += 1;
          }
        }
      }

      if (pointCount === 0) return;
      if (pointCount === 1) {
        const single = targetLegs[0].origin ?? targetLegs[0].destination;
        if (single) {
          map.panTo(single);
          map.setZoom(13);
        }
      } else {
        map.fitBounds(bounds, { top: 56, right: 56, bottom: 72, left: 56 });
      }
    },
    [map]
  );

  // Draw chronological overall travel path + directional arrows
  useEffect(() => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
    if (!map || legs.length === 0) return;

    const created: google.maps.Polyline[] = [];
    const arrowSymbol: google.maps.Symbol = {
      path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
      scale: 3,
      strokeColor: '#ffffff',
      strokeWeight: 1,
      fillColor: '#1d4ed8',
      fillOpacity: 1,
    };

    const dimmedArrowSymbol: google.maps.Symbol = {
      path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
      scale: 2.5,
      strokeColor: '#ffffff',
      strokeWeight: 0.8,
      fillColor: '#60a5fa',
      fillOpacity: 0.85,
    };

    // Optional subtle dashed connectors between consecutive trip endpoints when different
    for (let i = 0; i < legs.length - 1; i += 1) {
      const prevEnd = legs[i].destination;
      const nextStart = legs[i + 1].origin;
      if (!prevEnd || !nextStart) continue;
      if (makeCoordKey(prevEnd.lat, prevEnd.lng) === makeCoordKey(nextStart.lat, nextStart.lng)) {
        continue;
      }

      const connector = new google.maps.Polyline({
        path: [prevEnd, nextStart],
        geodesic: true,
        strokeOpacity: 0,
        icons: [
          {
            icon: {
              path: 'M 0,-1 0,1',
              strokeOpacity: selectedTripId ? 0.25 : 0.45,
              strokeColor: '#64748b',
              scale: 2.5,
            },
            offset: '0',
            repeat: '12px',
          },
        ],
        zIndex: 1,
        map,
      });
      created.push(connector);
    }

    // Driven business trip legs in chronological order
    for (const leg of legs) {
      if (!leg.origin || !leg.destination) continue;
      const pathPoints =
        leg.roadPath && leg.roadPath.length >= 2 ? leg.roadPath : [leg.origin, leg.destination];
      const isSelected = selectedTripId === leg.trip.id;
      const hasFocus = Boolean(selectedTripId);

      const line = new google.maps.Polyline({
        path: pathPoints,
        geodesic: !(leg.roadPath && leg.roadPath.length >= 2),
        strokeColor: isSelected ? '#1d4ed8' : hasFocus ? '#93c5fd' : '#2563eb',
        strokeOpacity: isSelected ? 0.96 : hasFocus ? 0.45 : 0.82,
        strokeWeight: isSelected ? 5.5 : 3.5,
        zIndex: isSelected ? 20 : 10,
        icons: [
          {
            icon: isSelected || !hasFocus ? arrowSymbol : dimmedArrowSymbol,
            offset: '50%',
          },
        ],
        map,
      });
      created.push(line);
    }

    polylinesRef.current = created;

    return () => {
      created.forEach((p) => p.setMap(null));
    };
  }, [map, legs, selectedTripId]);

  // Fit bounds when selected trip changes or recenter is requested
  useEffect(() => {
    if (!map || legs.length === 0) return;
    if (selectedTripId) {
      const focused = legs.filter((l) => l.trip.id === selectedTripId);
      if (focused.length > 0) {
        fitBoundsForLegs(focused);
        return;
      }
    }
    fitBoundsForLegs(legs);
  }, [map, legs, selectedTripId, recenterNonce, fitBoundsForLegs]);

  return null;
}

export function LedgerMapViewModal({
  isOpen,
  trips,
  expenses,
  stores,
  onClose,
}: LedgerMapViewModalProps) {
  const { t, tPurpose, formatLocalizedDate } = useI18n();
  const placesLib = useMapsLibrary('places');
  const routesLib = useMapsLibrary('routes');

  // Compute natural full-span dates across all trips
  const tripDateBounds = useMemo(() => {
    if (trips.length === 0) {
      return { min: offsetDaysISO(-30), max: formatDateISO() };
    }
    const sortedDates = trips.map((t) => t.tripDate).sort();
    return {
      min: sortedDates[0],
      max: sortedDates[sortedDates.length - 1],
    };
  }, [trips]);

  const [startDate, setStartDate] = useState<string>(tripDateBounds.min);
  const [endDate, setEndDate] = useState<string>(tripDateBounds.max);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [activePinKey, setActivePinKey] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [showRoadRoutes, setShowRoadRoutes] = useState<boolean>(true);
  const [recenterNonce, setRecenterNonce] = useState<number>(0);

  // Session-only in-memory caches (never written to localStorage or Firestore per GMP ToS)
  const coordCacheRef = useRef<Map<string, google.maps.LatLngLiteral>>(new Map());
  const roadPathCacheRef = useRef<Map<string, google.maps.LatLngLiteral[]>>(new Map());

  const [resolvedLegs, setResolvedLegs] = useState<ResolvedTripLeg[]>([]);
  const [isResolving, setIsResolving] = useState<boolean>(false);

  // Reset date range to full span whenever modal opens
  useEffect(() => {
    if (!isOpen) return;
    setStartDate(tripDateBounds.min);
    setEndDate(tripDateBounds.max);
    setSelectedTripId(null);
    setActivePinKey(null);
  }, [isOpen, tripDateBounds.min, tripDateBounds.max]);

  // Esc key closes full-screen Map View
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Chronologically ordered trips within [startDate, endDate]
  const rangeTrips = useMemo(() => {
    const low = startDate && endDate && startDate > endDate ? endDate : startDate;
    const high = startDate && endDate && startDate > endDate ? startDate : endDate;

    return trips
      .filter((t) => {
        if (low && t.tripDate < low) return false;
        if (high && t.tripDate > high) return false;
        return true;
      })
      .sort((a, b) => {
        const cmp = a.tripDate.localeCompare(b.tripDate);
        if (cmp !== 0) return cmp;
        return (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0);
      });
  }, [trips, startDate, endDate]);

  // Associated expenses by tripId for quick period totals
  const expenseTotalByTripId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const exp of expenses) {
      if (exp.tripId) {
        map[exp.tripId] = (map[exp.tripId] ?? 0) + exp.amount;
      }
    }
    return map;
  }, [expenses]);

  const periodTotals = useMemo(() => {
    const miles = rangeTrips.reduce((sum, t) => sum + t.billableMiles, 0);
    const mileageAmount = rangeTrips.reduce((sum, t) => sum + t.reimbursementAmount, 0);
    const tripIds = new Set(rangeTrips.map((t) => t.id));
    const low = startDate && endDate && startDate > endDate ? endDate : startDate;
    const high = startDate && endDate && startDate > endDate ? startDate : endDate;

    const expenseAmount = expenses
      .filter((e) => {
        if (e.tripId && tripIds.has(e.tripId)) return true;
        if (!e.tripId) {
          if (low && e.expenseDate < low) return false;
          if (high && e.expenseDate > high) return false;
          return true;
        }
        return false;
      })
      .reduce((sum, e) => sum + e.amount, 0);

    return {
      miles,
      mileageAmount,
      expenseAmount,
      grandTotal: mileageAmount + expenseAmount,
    };
  }, [rangeTrips, expenses, startDate, endDate]);

  // Resolve coordinates (via stores -> GPS -> Places API New) and optional road-snapped paths
  useEffect(() => {
    if (!isOpen) return;
    if (rangeTrips.length === 0) {
      setResolvedLegs([]);
      setIsResolving(false);
      return;
    }

    let cancelled = false;
    setIsResolving(true);

    const resolveSingleLocation = async (
      placeId: string,
      address: string,
      name: string
    ): Promise<google.maps.LatLngLiteral | null> => {
      // 1. Match saved locations by placeId (zero API calls)
      if (placeId) {
        const matched = stores.find((s) => s.placeId === placeId && s.hasCoordinates !== false);
        if (matched) return { lat: matched.lat, lng: matched.lng };
      }

      // 2. Parse direct GPS coordinate string ("lat, lng")
      const parsedCoords = parseCoordinateString(address);
      if (parsedCoords) return parsedCoords;

      // 3. Match saved locations by name (zero API calls)
      const lowerName = name.trim().toLowerCase();
      if (lowerName) {
        const matchedByName = stores.find(
          (s) =>
            s.hasCoordinates !== false &&
            (s.shortName.toLowerCase() === lowerName ||
              s.name.toLowerCase() === lowerName)
        );
        if (matchedByName) return { lat: matchedByName.lat, lng: matchedByName.lng };
      }

      // 4. Session-only in-memory cache
      const key = makeLookupKey(placeId, address, name);
      const cached = coordCacheRef.current.get(key);
      if (cached) return cached;

      if (!placesLib) return null;

      // 5. Modern Places API (New): Place.fetchFields by placeId
      if (placeId && placesLib.Place) {
        try {
          const place = new placesLib.Place({ id: placeId });
          await place.fetchFields({ fields: ['location'] });
          if (place.location) {
            const coords = { lat: place.location.lat(), lng: place.location.lng() };
            coordCacheRef.current.set(key, coords);
            return coords;
          }
        } catch {
          // Fall through to text search below
        }
      }

      // 6. Modern Places API (New): Place.searchByText fallback (replaces legacy Geocoder)
      const queryText = address.trim() || name.trim();
      if (queryText && placesLib.Place?.searchByText) {
        try {
          const { places } = await placesLib.Place.searchByText({
            textQuery: queryText,
            fields: ['location'],
            maxResultCount: 1,
          });
          const loc = places?.[0]?.location;
          if (loc) {
            const coords = { lat: loc.lat(), lng: loc.lng() };
            coordCacheRef.current.set(key, coords);
            return coords;
          }
        } catch {
          return null;
        }
      }

      return null;
    };

    const computeRoadPath = async (
      tripId: string,
      origin: google.maps.LatLngLiteral,
      destination: google.maps.LatLngLiteral
    ): Promise<google.maps.LatLngLiteral[] | null> => {
      const cachedPath = roadPathCacheRef.current.get(tripId);
      if (cachedPath) return cachedPath;

      if (!routesLib) return null;
      const RouteClass = (
        routesLib as unknown as {
          Route?: {
            computeRoutes: (req: unknown) => Promise<{
              routes?: Array<{
                createPolylines: () => google.maps.Polyline[];
              }>;
            }>;
          };
        }
      ).Route;

      if (!RouteClass?.computeRoutes) return null;

      try {
        const res = await RouteClass.computeRoutes({
          origin,
          destination,
          travelMode: 'DRIVING',
          fields: ['path'],
        });
        const primary = res.routes?.[0];
        if (!primary) return null;
        const polylines = primary.createPolylines();
        const pts: google.maps.LatLngLiteral[] = [];
        for (const poly of polylines) {
          const p = poly.getPath();
          for (let i = 0; i < p.getLength(); i += 1) {
            const ll = p.getAt(i);
            pts.push({ lat: ll.lat(), lng: ll.lng() });
          }
        }
        if (pts.length >= 2) {
          roadPathCacheRef.current.set(tripId, pts);
          return pts;
        }
      } catch {
        return null;
      }
      return null;
    };

    const run = async () => {
      // Resolve all endpoints in parallel
      const baseLegs: ResolvedTripLeg[] = await Promise.all(
        rangeTrips.map(async (trip, idx) => {
          const [origin, destination] = await Promise.all([
            resolveSingleLocation(trip.originPlaceId, trip.originAddress, trip.originName),
            resolveSingleLocation(
              trip.destinationPlaceId,
              trip.destinationAddress,
              trip.destinationName
            ),
          ]);
          return {
            trip,
            chronologicalIndex: idx + 1,
            origin,
            destination,
            roadPath: roadPathCacheRef.current.get(trip.id) ?? null,
          };
        })
      );

      if (cancelled) return;
      setResolvedLegs(baseLegs);

      // Snap legs to real roads via modern Route.computeRoutes()
      // When showRoadRoutes is on and <= MAX_ALL_ROAD_LEGS, snap all legs; otherwise snap only the selected leg
      const legsNeedingRoads = baseLegs.filter((leg) => {
        if (!leg.origin || !leg.destination) return false;
        if (makeCoordKey(leg.origin.lat, leg.origin.lng) === makeCoordKey(leg.destination.lat, leg.destination.lng)) {
          return false;
        }
        if (leg.roadPath) return false;
        if (selectedTripId && leg.trip.id === selectedTripId) return true;
        return showRoadRoutes && baseLegs.length <= MAX_ALL_ROAD_LEGS;
      });

      if (legsNeedingRoads.length > 0 && routesLib) {
        const updatedMap = new Map<string, google.maps.LatLngLiteral[]>();
        await Promise.all(
          legsNeedingRoads.map(async (leg) => {
            if (!leg.origin || !leg.destination) return;
            const pts = await computeRoadPath(leg.trip.id, leg.origin, leg.destination);
            if (pts) updatedMap.set(leg.trip.id, pts);
          })
        );

        if (!cancelled && updatedMap.size > 0) {
          setResolvedLegs((prev) =>
            prev.map((leg) =>
              updatedMap.has(leg.trip.id)
                ? { ...leg, roadPath: updatedMap.get(leg.trip.id) ?? leg.roadPath }
                : leg
            )
          );
        }
      }

      if (!cancelled) {
        setIsResolving(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [isOpen, rangeTrips, stores, placesLib, routesLib, showRoadRoutes, selectedTripId]);

  // Aggregate pins so stops visited multiple times don't overlap invisibly
  const stopPins = useMemo<AggregatedStopPin[]>(() => {
    const byKey = new Map<string, AggregatedStopPin>();
    let orderCounter = 0;

    const addStop = (
      pos: google.maps.LatLngLiteral,
      name: string,
      address: string,
      trip: MileageTrip,
      role: 'Origin' | 'Destination',
      chronologicalIndex: number,
      isFirstOrigin: boolean,
      isFinalDestination: boolean
    ) => {
      const key = makeCoordKey(pos.lat, pos.lng);
      const existing = byKey.get(key);
      if (existing) {
        existing.visits.push({ trip, role, chronologicalIndex });
        if (isFirstOrigin) existing.isFirstOrigin = true;
        if (isFinalDestination) existing.isFinalDestination = true;
      } else {
        orderCounter += 1;
        byKey.set(key, {
          key,
          position: pos,
          name,
          address,
          firstOrder: orderCounter,
          isFirstOrigin,
          isFinalDestination,
          visits: [{ trip, role, chronologicalIndex }],
        });
      }
    };

    resolvedLegs.forEach((leg, idx) => {
      if (leg.origin) {
        addStop(
          leg.origin,
          leg.trip.originName,
          leg.trip.originAddress,
          leg.trip,
          'Origin',
          leg.chronologicalIndex,
          idx === 0,
          false
        );
      }
      if (leg.destination) {
        addStop(
          leg.destination,
          leg.trip.destinationName,
          leg.trip.destinationAddress,
          leg.trip,
          'Destination',
          leg.chronologicalIndex,
          false,
          idx === resolvedLegs.length - 1
        );
      }
    });

    return Array.from(byKey.values());
  }, [resolvedLegs]);

  const activePin = useMemo(
    () => stopPins.find((p) => p.key === activePinKey) ?? null,
    [stopPins, activePinKey]
  );

  if (!isOpen) return null;

  const applyPreset = (preset: 'all' | '7d' | '30d' | 'month') => {
    setSelectedTripId(null);
    setActivePinKey(null);
    if (preset === 'all') {
      setStartDate(tripDateBounds.min);
      setEndDate(tripDateBounds.max);
    } else if (preset === '7d') {
      setStartDate(offsetDaysISO(-6));
      setEndDate(formatDateISO());
    } else if (preset === '30d') {
      setStartDate(offsetDaysISO(-29));
      setEndDate(formatDateISO());
    } else {
      setStartDate(startOfMonthISO());
      setEndDate(formatDateISO());
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
      role="dialog"
      aria-modal="true"
      aria-label="Full-Screen Trip Ledger Map View"
    >
      {/* Top Full-Screen Control Bar */}
      <header className="shrink-0 px-4 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setSidebarOpen((prev) => !prev)}
            aria-label={sidebarOpen ? 'Hide trip timeline panel' : 'Show trip timeline panel'}
            className="p-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors shrink-0"
          >
            {sidebarOpen ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" />
            )}
          </button>
          <div className="min-w-0">
            <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
              {t('mapView.title')}
            </h2>
            <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
              {rangeTrips.length}{' '}
              {rangeTrips.length === 1 ? t('nav.tripSingular') : t('nav.tripPlural')} ·{' '}
              <span dir="ltr">
                {periodTotals.miles.toFixed(1)} {t('common.mi')}
              </span>{' '}
              · <span dir="ltr">{formatCurrency(periodTotals.grandTotal)}</span>
              {periodTotals.expenseAmount > 0 && (
                <span>
                  {' '}
                  (+{formatCurrency(periodTotals.expenseAmount)} {t('nav.expShort')})
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Date Range Picker & Quick Presets */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="date"
                aria-label="Map start date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setSelectedTripId(null);
                }}
                className="ps-8 pe-2 py-1.5 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>
            <span className="text-xs text-slate-400 dark:text-slate-500">{t('mapView.to')}</span>
            <input
              type="date"
              aria-label="Map end date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setSelectedTripId(null);
              }}
              className="px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <div className="inline-flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
            {(
              [
                ['all', t('mapView.all')],
                ['7d', '7D'],
                ['30d', '30D'],
                ['month', t('mapView.thisMonth')],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                className="px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white rounded-md transition-colors whitespace-nowrap"
              >
                {label}
              </button>
            ))}
          </div>

          {rangeTrips.length > 0 && rangeTrips.length <= MAX_ALL_ROAD_LEGS && (
            <button
              type="button"
              onClick={() => setShowRoadRoutes((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                showRoadRoutes
                  ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300'
                  : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              <RouteIcon className="w-3.5 h-3.5" />
              {t('mapView.roadPaths')}
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setSelectedTripId(null);
              setRecenterNonce((n) => n + 1);
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap"
          >
            <Crosshair className="w-3.5 h-3.5" />
            {t('mapView.fitAll')}
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 rounded-lg transition-colors whitespace-nowrap"
          >
            <X className="w-3.5 h-3.5" />
            {t('common.close')}
          </button>
        </div>
      </header>

      {/* Main Full-Screen Split: Timeline Sidebar + Interactive Map */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Chronological Trip Path Drawer */}
        {sidebarOpen && (
          <aside className="w-full lg:w-80 xl:w-96 max-h-[38vh] lg:max-h-none shrink-0 bg-white dark:bg-slate-900 border-b lg:border-b-0 lg:border-e border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {t('mapView.timelineTitle', { count: rangeTrips.length })}
              </span>
              {selectedTripId && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTripId(null);
                    setRecenterNonce((n) => n + 1);
                  }}
                  className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap"
                >
                  {t('mapView.showAllLegs')}
                </button>
              )}
            </div>

            {rangeTrips.length === 0 ? (
              <div className="p-6 text-center space-y-3 my-auto">
                <MapPin className="w-6 h-6 text-slate-400 dark:text-slate-500 mx-auto" />
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {t('mapView.noTripsRange')}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('mapView.noTripsRangeDesc')}
                </p>
                {trips.length > 0 && (
                  <button
                    type="button"
                    onClick={() => applyPreset('all')}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap"
                  >
                    {t('mapView.resetAllDates')}
                  </button>
                )}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {rangeTrips.map((trip, idx) => {
                  const isSelected = selectedTripId === trip.id;
                  const tripExp = expenseTotalByTripId[trip.id] ?? 0;
                  return (
                    <button
                      key={trip.id}
                      type="button"
                      onClick={() => {
                        setActivePinKey(null);
                        setSelectedTripId((prev) => (prev === trip.id ? null : trip.id));
                      }}
                      className={`w-full text-start px-4 py-3 transition-colors ${
                        isSelected
                          ? 'bg-blue-50/85 dark:bg-blue-950/55'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`mt-0.5 w-5 h-5 rounded-full text-[10px] font-bold font-mono flex items-center justify-center shrink-0 ${
                            isSelected
                              ? 'bg-blue-700 text-white'
                              : idx === 0
                                ? 'bg-emerald-700 text-white'
                                : idx === rangeTrips.length - 1
                                  ? 'bg-amber-600 text-white'
                                  : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                            <span>{formatLocalizedDate(trip.tripDate)}</span>
                            <span
                              className="font-semibold text-slate-900 dark:text-slate-100"
                              dir="ltr"
                            >
                              {trip.billableMiles.toFixed(1)} {t('common.mi')} ·{' '}
                              {formatCurrency(trip.reimbursementAmount + tripExp)}
                            </span>
                          </div>
                          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 mt-0.5 leading-snug">
                            {trip.originName} → {trip.destinationName}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                            {tPurpose(trip.purpose)} ·{' '}
                            {trip.isRoundTrip ? t('common.roundTrip') : t('common.oneWay')}
                            {tripExp > 0
                              ? ` · +${formatCurrency(tripExp)} ${t('nav.expShort')}`
                              : ''}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>
        )}

        {/* Full-Height Interactive Google Map Canvas */}
        <div className="relative flex-1 min-h-[340px] lg:min-h-0 w-full h-full bg-slate-100 dark:bg-slate-950">
          <GoogleMap
            mapId="DEMO_MAP_ID"
            defaultCenter={(() => {
              const firstMappable = stores.find((s) => s.hasCoordinates !== false);
              return firstMappable
                ? { lat: firstMappable.lat, lng: firstMappable.lng }
                : FALLBACK_MAP_CENTER;
            })()}
            defaultZoom={10}
            gestureHandling="greedy"
            streetViewControl={false}
            mapTypeControl={false}
            fullscreenControl={false}
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            className="w-full h-full"
          >
            <PeriodMapController
              legs={resolvedLegs}
              selectedTripId={selectedTripId}
              recenterNonce={recenterNonce}
            />

            {stopPins.map((pin) => {
              const isSelectedEndpoint =
                selectedTripId !== null &&
                pin.visits.some((v) => v.trip.id === selectedTripId);

              const bg = pin.isFirstOrigin
                ? '#15803d'
                : pin.isFinalDestination
                  ? '#d97706'
                  : isSelectedEndpoint
                    ? '#1d4ed8'
                    : '#2563eb';
              const border = pin.isFirstOrigin
                ? '#14532d'
                : pin.isFinalDestination
                  ? '#92400e'
                  : '#1e3a8a';

              return (
                <AdvancedMarker
                  key={pin.key}
                  position={pin.position}
                  title={`${pin.name} (${pin.visits.length} ${pin.visits.length === 1 ? 'stop' : 'stops'})`}
                  zIndex={isSelectedEndpoint ? 30 : pin.isFirstOrigin || pin.isFinalDestination ? 20 : 10}
                  onClick={() => setActivePinKey(pin.key)}
                >
                  <Pin
                    background={bg}
                    borderColor={border}
                    glyphColor="#ffffff"
                    glyphText={String(pin.firstOrder)}
                    scale={isSelectedEndpoint ? 1.15 : 1}
                  />
                </AdvancedMarker>
              );
            })}

            {activePin && (
              <InfoWindow
                position={activePin.position}
                onCloseClick={() => setActivePinKey(null)}
              >
                <div className="p-1 max-w-[260px] space-y-1.5 text-slate-900">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 leading-snug">
                      {activePin.name}
                    </span>
                    <span className="text-[10px] font-mono font-semibold text-blue-800 bg-blue-50 px-1.5 py-0.5 rounded shrink-0">
                      Stop #{activePin.firstOrder}
                    </span>
                  </div>
                  {activePin.address && (
                    <div className="text-[11px] text-slate-600 leading-snug">
                      {activePin.address}
                    </div>
                  )}
                  <div className="pt-1.5 border-t border-slate-200 space-y-1 max-h-36 overflow-y-auto">
                    {activePin.visits.map((v, idx) => (
                      <button
                        key={`${v.trip.id}-${v.role}-${idx}`}
                        type="button"
                        onClick={() => {
                          setSelectedTripId(v.trip.id);
                          setActivePinKey(null);
                        }}
                        className="w-full text-start px-1.5 py-1 rounded hover:bg-slate-100 transition-colors"
                      >
                        <div className="text-[11px] font-mono text-slate-500">
                          #{v.chronologicalIndex} · {formatLocalizedDate(v.trip.tripDate)} ·{' '}
                          {v.role}
                        </div>
                        <div className="text-[11px] font-medium text-slate-900 truncate">
                          {v.trip.originName} → {v.trip.destinationName}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </InfoWindow>
            )}
          </GoogleMap>

          {/* Resolving Indicator */}
          {isResolving && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 pointer-events-none">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700 dark:text-blue-400" />
              {t('mapView.plotting')}
            </div>
          )}

          {/* Compact Map Legend Overlay */}
          <div className="absolute start-3 bottom-3 px-3 py-2 bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-700 dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-700" />
              {t('mapView.firstStart')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
              {t('mapView.routeStop')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-600" />
              {t('mapView.finalStop')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-0.5 bg-blue-600 inline-block" />
              {t('mapView.drivenPath')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
