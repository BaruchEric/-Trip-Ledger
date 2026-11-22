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
  Activity,
  Building2,
  Check,
  Clock,
  Layers,
  Loader2,
  Navigation,
  RefreshCw,
  Route as RouteIcon,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type { GpsPoint } from '../hooks/useLiveGpsTracker';
import {
  estimateRouteReimbursement,
  evaluateTrafficRoutes,
  samplePolylinesPath,
  type RawRoutesApiRoute,
  type RoutePriority,
  type TrafficRouteOption,
} from '../lib/trafficRouteAdvisor';
import { useI18n } from '../lib/i18n';
import {
  DEFAULT_RATE_PER_MILE,
  formatCurrency,
  type PlaceSelection,
  type StoreLocation,
} from '../types/mileage';

const LA_DEFAULT_CENTER = { lat: 34.0407, lng: -118.2468 };

export interface ComputedRouteMetrics {
  oneWayMiles: number;
  durationMinutes: number;
  sampledPath?: google.maps.LatLngLiteral[];
  routeSummary?: string;
  trafficDelayMinutes?: number;
  trafficSeverity?: 'clear' | 'moderate' | 'heavy';
  userSelected?: boolean;
}

interface RouteMapPanelProps {
  stores: StoreLocation[];
  storesLoading: boolean;
  storesError: string | null;
  onRefreshStores: () => void;
  origin: PlaceSelection | null;
  destination: PlaceSelection | null;
  homeStorePlaceId?: string;
  ratePerMile?: number;
  gpsPoints: GpsPoint[];
  onSetOrigin: (place: PlaceSelection) => void;
  onSetDestination: (place: PlaceSelection) => void;
  onRouteComputed: (metrics: ComputedRouteMetrics | null, errorMsg?: string | null) => void;
}

interface RouteOverlayControllerProps {
  origin: PlaceSelection | null;
  destination: PlaceSelection | null;
  gpsPoints: GpsPoint[];
  showTrafficLayer: boolean;
  avoidTolls: boolean;
  avoidHighways: boolean;
  priority: RoutePriority;
  selectedRouteIndex: number | null;
  refreshNonce: number;
  onSelectRouteIndex: (idx: number, userTriggered: boolean) => void;
  onRoutesEvaluated: (payload: {
    loading: boolean;
    error: string | null;
    options: TrafficRouteOption[];
    recommendedIndex: number;
    updatedAt: Date | null;
  }) => void;
}

function toRouteWaypoint(place: PlaceSelection): string | google.maps.LatLngLiteral {
  if (typeof place.lat === 'number' && typeof place.lng === 'number') {
    return { lat: place.lat, lng: place.lng };
  }
  return place.address || place.name;
}

function createTrafficStyledPolylines(
  rawRoute: RawRoutesApiRoute,
  isSelected: boolean
): google.maps.Polyline[] {
  if (!isSelected) {
    // Draw unselected alternative route as a single clean clickable polyline
    const polys = rawRoute.createPolylines({
      polylineOptions: {
        strokeColor: '#64748b',
        strokeOpacity: 0.52,
        strokeWeight: 4.5,
        zIndex: 5,
      },
    });
    polys.forEach((p) => {
      p.setOptions({
        strokeColor: '#64748b',
        strokeOpacity: 0.52,
        strokeWeight: 4.5,
        zIndex: 5,
        clickable: true,
      });
    });
    return polys;
  }

  // Selected route: if speedPaths are available, style intervals by real-time traffic speed
  if (rawRoute.speedPaths && rawRoute.speedPaths.length > 0) {
    const speedPolys = rawRoute.createPolylines({
      speedReadingPolylineOptions: {
        NORMAL: {
          strokeColor: '#1d4ed8',
          strokeOpacity: 0.94,
          strokeWeight: 6,
          zIndex: 20,
        },
        SLOW: {
          strokeColor: '#f59e0b',
          strokeOpacity: 0.96,
          strokeWeight: 6,
          zIndex: 22,
        },
        TRAFFIC_JAM: {
          strokeColor: '#dc2626',
          strokeOpacity: 0.98,
          strokeWeight: 6.5,
          zIndex: 24,
        },
      },
    });
    if (speedPolys.length > 0) {
      return speedPolys;
    }
  }

  const fallbackPolys = rawRoute.createPolylines();
  fallbackPolys.forEach((p) => {
    p.setOptions({
      strokeColor: '#1d4ed8',
      strokeOpacity: 0.94,
      strokeWeight: 5.5,
      zIndex: 20,
    });
  });
  return fallbackPolys;
}

function RouteOverlayController({
  origin,
  destination,
  gpsPoints,
  showTrafficLayer,
  avoidTolls,
  avoidHighways,
  priority,
  selectedRouteIndex,
  refreshNonce,
  onSelectRouteIndex,
  onRoutesEvaluated,
}: RouteOverlayControllerProps) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const mapsLib = useMapsLibrary('maps');

  const rawRoutesRef = useRef<RawRoutesApiRoute[]>([]);
  const sampledPathsRef = useRef<google.maps.LatLngLiteral[][]>([]);
  const renderedPolylinesRef = useRef<google.maps.Polyline[]>([]);
  const trafficLayerRef = useRef<google.maps.TrafficLayer | null>(null);
  const gpsPolylineRef = useRef<google.maps.Polyline | null>(null);

  const onRoutesEvaluatedRef = useRef(onRoutesEvaluated);
  onRoutesEvaluatedRef.current = onRoutesEvaluated;
  const onSelectRouteIndexRef = useRef(onSelectRouteIndex);
  onSelectRouteIndexRef.current = onSelectRouteIndex;

  // Manage Google Maps Live Traffic Layer overlay
  useEffect(() => {
    if (!map || !mapsLib) return;
    if (showTrafficLayer) {
      if (!trafficLayerRef.current) {
        trafficLayerRef.current = new mapsLib.TrafficLayer();
      }
      trafficLayerRef.current.setMap(map);
    } else if (trafficLayerRef.current) {
      trafficLayerRef.current.setMap(null);
    }

    return () => {
      if (trafficLayerRef.current) {
        trafficLayerRef.current.setMap(null);
      }
    };
  }, [map, mapsLib, showTrafficLayer]);

  // Helper to draw all routes onto the map with the active index highlighted on top
  const renderRoutesOnMap = useCallback(
    (activeIdx: number, fitViewport: boolean) => {
      renderedPolylinesRef.current.forEach((p) => p.setMap(null));
      renderedPolylinesRef.current = [];

      if (!map || rawRoutesRef.current.length === 0) return;

      const created: google.maps.Polyline[] = [];

      // Draw unselected alternatives first (clickable)
      rawRoutesRef.current.forEach((rawRoute, idx) => {
        if (idx === activeIdx) return;
        const polys = createTrafficStyledPolylines(rawRoute, false);
        polys.forEach((poly) => {
          poly.addListener('click', () => {
            onSelectRouteIndexRef.current(idx, true);
          });
          poly.setMap(map);
          created.push(poly);
        });
      });

      // Draw selected route on top with real-time traffic speed colors
      const activeRaw = rawRoutesRef.current[activeIdx] ?? rawRoutesRef.current[0];
      if (activeRaw) {
        const activePolys = createTrafficStyledPolylines(activeRaw, true);
        activePolys.forEach((poly) => {
          poly.setMap(map);
          created.push(poly);
        });

        if (fitViewport && activeRaw.viewport) {
          map.fitBounds(activeRaw.viewport, 60);
        }
      }

      renderedPolylinesRef.current = created;
    },
    [map]
  );

  // Fetch real-time traffic-aware routes + alternatives via modern Routes API (Route.computeRoutes)
  useEffect(() => {
    renderedPolylinesRef.current.forEach((p) => p.setMap(null));
    renderedPolylinesRef.current = [];
    rawRoutesRef.current = [];
    sampledPathsRef.current = [];

    if (!map || !routesLib || !origin || !destination) {
      return;
    }

    // Avoid redundant self-to-self route computation
    if (
      origin.placeId &&
      destination.placeId &&
      origin.placeId === destination.placeId
    ) {
      onRoutesEvaluatedRef.current({
        loading: false,
        error: null,
        options: [],
        recommendedIndex: 0,
        updatedAt: new Date(),
      });
      return;
    }

    let cancelled = false;

    const RouteClass = (
      routesLib as unknown as {
        Route?: {
          computeRoutes: (req: unknown) => Promise<{ routes?: RawRoutesApiRoute[] }>;
        };
      }
    ).Route;

    if (!RouteClass?.computeRoutes) {
      onRoutesEvaluatedRef.current({
        loading: false,
        error: 'Routes service is initializing...',
        options: [],
        recommendedIndex: 0,
        updatedAt: null,
      });
      return;
    }

    onRoutesEvaluatedRef.current({
      loading: true,
      error: null,
      options: [],
      recommendedIndex: 0,
      updatedAt: null,
    });

    const waypointOrigin = toRouteWaypoint(origin);
    const waypointDest = toRouteWaypoint(destination);
    const routeModifiers =
      avoidTolls || avoidHighways ? { avoidTolls, avoidHighways } : undefined;

    // 1. Primary call: TRAFFIC_AWARE_OPTIMAL + alternative routes + live speed polylines
    const optimalRequest = {
      origin: waypointOrigin,
      destination: waypointDest,
      travelMode: 'DRIVING',
      routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
      computeAlternativeRoutes: true,
      extraComputations: ['TRAFFIC_ON_POLYLINE'],
      ...(routeModifiers ? { routeModifiers } : {}),
      fields: [
        'path',
        'distanceMeters',
        'durationMillis',
        'staticDurationMillis',
        'viewport',
        'description',
        'routeLabels',
        'speedPaths',
        'travelAdvisory',
      ],
    };

    const runCompute = async (): Promise<RawRoutesApiRoute[]> => {
      try {
        const res = await RouteClass.computeRoutes(optimalRequest);
        if (res.routes && res.routes.length > 0) return res.routes;
      } catch (primaryErr) {
        console.warn('TRAFFIC_AWARE_OPTIMAL fallback to TRAFFIC_AWARE:', primaryErr);
      }

      // 2. Fallback: TRAFFIC_AWARE without extraComputations
      try {
        const fallbackRes = await RouteClass.computeRoutes({
          origin: waypointOrigin,
          destination: waypointDest,
          travelMode: 'DRIVING',
          routingPreference: 'TRAFFIC_AWARE',
          computeAlternativeRoutes: true,
          ...(routeModifiers ? { routeModifiers } : {}),
          fields: [
            'path',
            'distanceMeters',
            'durationMillis',
            'staticDurationMillis',
            'viewport',
            'description',
            'routeLabels',
          ],
        });
        if (fallbackRes.routes && fallbackRes.routes.length > 0) return fallbackRes.routes;
      } catch (secondaryErr) {
        console.warn('TRAFFIC_AWARE fallback to standard driving route:', secondaryErr);
      }

      // 3. Final fallback: standard driving route
      const basicRes = await RouteClass.computeRoutes({
        origin: waypointOrigin,
        destination: waypointDest,
        travelMode: 'DRIVING',
        fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
      });
      return basicRes.routes ?? [];
    };

    runCompute()
      .then((routes) => {
        if (cancelled) return;
        if (routes.length === 0) {
          onRoutesEvaluatedRef.current({
            loading: false,
            error: 'No driving route found between these locations.',
            options: [],
            recommendedIndex: 0,
            updatedAt: null,
          });
          return;
        }

        // Keep up to 3 alternative routes for crisp side-by-side comparison
        const capped = routes.slice(0, 3);
        rawRoutesRef.current = capped;

        // Pre-sample paths for StaticRouteThumbnail preview
        const sampledList = capped.map((r) => samplePolylinesPath(r.createPolylines(), 36));
        sampledPathsRef.current = sampledList;

        const { options, recommendedIndex } = evaluateTrafficRoutes(
          capped,
          sampledList,
          priority
        );

        renderRoutesOnMap(recommendedIndex, true);
        onRoutesEvaluatedRef.current({
          loading: false,
          error: null,
          options,
          recommendedIndex,
          updatedAt: new Date(),
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('Route.computeRoutes error:', err);
        onRoutesEvaluatedRef.current({
          loading: false,
          error:
            'Unable to calculate live traffic route. Please verify the addresses or enter mileage manually.',
          options: [],
          recommendedIndex: 0,
          updatedAt: null,
        });
      });

    return () => {
      cancelled = true;
      renderedPolylinesRef.current.forEach((p) => p.setMap(null));
      renderedPolylinesRef.current = [];
    };
  }, [
    map,
    routesLib,
    origin?.placeId,
    origin?.address,
    origin?.lat,
    origin?.lng,
    destination?.placeId,
    destination?.address,
    destination?.lat,
    destination?.lng,
    avoidTolls,
    avoidHighways,
    refreshNonce,
    // priority is handled without re-fetching below
    renderRoutesOnMap,
  ]);

  // Re-evaluate priority ranking cleanly in memory when priority changes without extra API calls
  useEffect(() => {
    if (rawRoutesRef.current.length === 0) return;
    const { options, recommendedIndex } = evaluateTrafficRoutes(
      rawRoutesRef.current,
      sampledPathsRef.current,
      priority
    );
    renderRoutesOnMap(recommendedIndex, false);
    onRoutesEvaluatedRef.current({
      loading: false,
      error: null,
      options,
      recommendedIndex,
      updatedAt: new Date(),
    });
  }, [priority, renderRoutesOnMap]);

  // Re-render polylines whenever the user picks a different alternative route
  useEffect(() => {
    if (selectedRouteIndex === null || rawRoutesRef.current.length === 0) return;
    renderRoutesOnMap(selectedRouteIndex, true);
  }, [selectedRouteIndex, renderRoutesOnMap]);

  // Render live GPS breadcrumb path if actively recording
  useEffect(() => {
    if (gpsPolylineRef.current) {
      gpsPolylineRef.current.setMap(null);
      gpsPolylineRef.current = null;
    }

    if (!map || !mapsLib || gpsPoints.length < 2) return;

    const path = gpsPoints.map((pt) => ({ lat: pt.lat, lng: pt.lng }));
    const poly = new mapsLib.Polyline({
      path,
      strokeColor: '#dc2626',
      strokeOpacity: 0.9,
      strokeWeight: 4,
      zIndex: 30,
      map,
    });
    gpsPolylineRef.current = poly;

    const latest = path[path.length - 1];
    map.panTo(latest);

    return () => {
      poly.setMap(null);
    };
  }, [map, mapsLib, gpsPoints]);

  return null;
}

export function RouteMapPanel({
  stores,
  storesLoading,
  storesError,
  onRefreshStores,
  origin,
  destination,
  homeStorePlaceId,
  ratePerMile = DEFAULT_RATE_PER_MILE,
  gpsPoints,
  onSetOrigin,
  onSetDestination,
  onRouteComputed,
}: RouteMapPanelProps) {
  const { t, formatLocalizedClock } = useI18n();
  const [selectedStore, setSelectedStore] = useState<StoreLocation | null>(null);
  const [routeOptions, setRouteOptions] = useState<TrafficRouteOption[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [routesLoading, setRoutesLoading] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [trafficUpdatedAt, setTrafficUpdatedAt] = useState<Date | null>(null);

  // Live traffic preferences
  const [showTrafficLayer, setShowTrafficLayer] = useState<boolean>(true);
  const [avoidTolls, setAvoidTolls] = useState<boolean>(false);
  const [avoidHighways, setAvoidHighways] = useState<boolean>(false);
  const [priority, setPriority] = useState<RoutePriority>('fastest');
  const [refreshNonce, setRefreshNonce] = useState<number>(0);

  const onRouteComputedRef = useRef(onRouteComputed);
  onRouteComputedRef.current = onRouteComputed;

  const emitSelectedOption = useCallback(
    (option: TrafficRouteOption | null, userSelected: boolean, errMsg: string | null = null) => {
      if (!option) {
        onRouteComputedRef.current(null, errMsg);
        return;
      }
      onRouteComputedRef.current(
        {
          oneWayMiles: option.oneWayMiles,
          durationMinutes: option.durationMinutes,
          sampledPath: option.sampledPath,
          routeSummary: option.summary,
          trafficDelayMinutes: option.trafficDelayMinutes,
          trafficSeverity: option.trafficSeverity,
          userSelected,
        },
        null
      );
    },
    []
  );

  const handleRoutesEvaluated = useCallback(
    (payload: {
      loading: boolean;
      error: string | null;
      options: TrafficRouteOption[];
      recommendedIndex: number;
      updatedAt: Date | null;
    }) => {
      setRoutesLoading(payload.loading);
      setRouteError(payload.error);
      setRouteOptions(payload.options);
      setSelectedIndex(payload.recommendedIndex);
      if (payload.updatedAt) {
        setTrafficUpdatedAt(payload.updatedAt);
      }

      if (!payload.loading) {
        if (payload.error) {
          emitSelectedOption(null, false, payload.error);
        } else if (payload.options.length > 0) {
          const chosen = payload.options[payload.recommendedIndex] ?? payload.options[0];
          emitSelectedOption(chosen, false, null);
        } else if (
          origin?.placeId &&
          destination?.placeId &&
          origin.placeId === destination.placeId
        ) {
          onRouteComputedRef.current({ oneWayMiles: 0, durationMinutes: 0 }, null);
        }
      }
    },
    [emitSelectedOption, origin?.placeId, destination?.placeId]
  );

  const handleSelectRoute = useCallback(
    (idx: number, userTriggered: boolean) => {
      const option = routeOptions[idx];
      if (!option) return;
      setSelectedIndex(idx);
      emitSelectedOption(option, userTriggered, null);
    },
    [routeOptions, emitSelectedOption]
  );

  useEffect(() => {
    if (!origin || !destination) {
      setRouteOptions([]);
      setSelectedIndex(0);
      setRoutesLoading(false);
      setRouteError(null);
      setTrafficUpdatedAt(null);
    }
  }, [origin, destination]);

  const activeRoute = useMemo(
    () => routeOptions[selectedIndex] ?? routeOptions[0] ?? null,
    [routeOptions, selectedIndex]
  );

  const updatedTimeLabel = useMemo(() => {
    if (!trafficUpdatedAt) return '';
    return formatLocalizedClock(trafficUpdatedAt.getTime());
  }, [trafficUpdatedAt, formatLocalizedClock]);

  const showCustomOriginMarker =
    origin &&
    typeof origin.lat === 'number' &&
    typeof origin.lng === 'number' &&
    !stores.some((s) => s.placeId === origin.placeId);

  const showCustomDestMarker =
    destination &&
    typeof destination.lat === 'number' &&
    typeof destination.lng === 'number' &&
    !stores.some((s) => s.placeId === destination.placeId);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
      {/* Compact Map Header Bar */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t('routeMap.title')}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {storesLoading
              ? t('routeMap.loadingStores')
              : storesError
                ? storesError
                : t('routeMap.storesSummary', { count: stores.length })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {activeRoute && (
            <div
              className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-200 font-mono tabular-nums me-1"
              dir="ltr"
            >
              <span className="inline-flex items-center gap-1 font-semibold text-blue-800 dark:text-blue-400">
                <RouteIcon className="w-3.5 h-3.5" />
                {activeRoute.oneWayMiles.toFixed(1)} {t('common.mi')}
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                ·
              </span>
              <span className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-200 font-semibold">
                <Clock className="w-3.5 h-3.5" />
                {activeRoute.durationMinutes} {t('common.min')}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowTrafficLayer((prev) => !prev)}
            aria-pressed={showTrafficLayer}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
              showTrafficLayer
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-300'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            {t('routeMap.liveTraffic')}
          </button>

          <button
            type="button"
            onClick={onRefreshStores}
            disabled={storesLoading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${storesLoading ? 'animate-spin' : ''}`} />
            {t('routeMap.stores')}
          </button>
        </div>
      </div>

      {routeError && (
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/60 border-b border-amber-200 dark:border-amber-800/80 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          <span>{routeError}</span>
        </div>
      )}

      {/* Interactive Google Map Canvas (explicit height to satisfy CF2) */}
      <div className="relative flex-1 min-h-[360px] w-full">
        <GoogleMap
          mapId="DEMO_MAP_ID"
          defaultCenter={LA_DEFAULT_CENTER}
          defaultZoom={10}
          gestureHandling="greedy"
          streetViewControl={false}
          mapTypeControl={false}
          fullscreenControl={true}
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          className="w-full h-full"
        >
          <RouteOverlayController
            origin={origin}
            destination={destination}
            gpsPoints={gpsPoints}
            showTrafficLayer={showTrafficLayer}
            avoidTolls={avoidTolls}
            avoidHighways={avoidHighways}
            priority={priority}
            selectedRouteIndex={routeOptions.length > 0 ? selectedIndex : null}
            refreshNonce={refreshNonce}
            onSelectRouteIndex={handleSelectRoute}
            onRoutesEvaluated={handleRoutesEvaluated}
          />

          {/* Live-discovered Curacao LA Store Advanced Markers */}
          {stores.map((store) => {
            const isOrigin = origin?.placeId === store.placeId;
            const isDest = destination?.placeId === store.placeId;
            const isHome = homeStorePlaceId === store.placeId;

            const bg = isOrigin
              ? '#15803d'
              : isDest
                ? '#d97706'
                : isHome
                  ? '#1e3a8a'
                  : '#1d4ed8';
            const border = isOrigin
              ? '#14532d'
              : isDest
                ? '#92400e'
                : '#1e3a8a';

            return (
              <AdvancedMarker
                key={store.placeId}
                position={{ lat: store.lat, lng: store.lng }}
                title={store.shortName}
                onClick={() => setSelectedStore(store)}
              >
                <Pin
                  background={bg}
                  borderColor={border}
                  glyphColor="#ffffff"
                  glyphText={isOrigin ? 'A' : isDest ? 'B' : 'C'}
                />
              </AdvancedMarker>
            );
          })}

          {/* Custom non-Curacao Origin Pin */}
          {showCustomOriginMarker && origin && (
            <AdvancedMarker
              position={{ lat: origin.lat!, lng: origin.lng! }}
              title={origin.name}
            >
              <Pin
                background="#15803d"
                borderColor="#14532d"
                glyphColor="#ffffff"
                glyphText="A"
              />
            </AdvancedMarker>
          )}

          {/* Custom non-Curacao Destination Pin */}
          {showCustomDestMarker && destination && (
            <AdvancedMarker
              position={{ lat: destination.lat!, lng: destination.lng! }}
              title={destination.name}
            >
              <Pin
                background="#d97706"
                borderColor="#92400e"
                glyphColor="#ffffff"
                glyphText="B"
              />
            </AdvancedMarker>
          )}

          {/* InfoWindow on clicked Curacao Store */}
          {selectedStore && (
            <InfoWindow
              position={{ lat: selectedStore.lat, lng: selectedStore.lng }}
              onCloseClick={() => setSelectedStore(null)}
            >
              <div className="p-1 max-w-[240px] space-y-2.5">
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                    <Building2 className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                    <span>{selectedStore.shortName}</span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5 leading-snug">
                    {selectedStore.address}
                  </p>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      onSetOrigin({
                        name: selectedStore.shortName,
                        address: selectedStore.address,
                        placeId: selectedStore.placeId,
                        lat: selectedStore.lat,
                        lng: selectedStore.lng,
                      });
                      setSelectedStore(null);
                    }}
                    className="flex-1 px-2.5 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded transition-colors whitespace-nowrap"
                  >
                    {t('routeMap.setOrigin')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSetDestination({
                        name: selectedStore.shortName,
                        address: selectedStore.address,
                        placeId: selectedStore.placeId,
                        lat: selectedStore.lat,
                        lng: selectedStore.lng,
                      });
                      setSelectedStore(null);
                    }}
                    className="flex-1 px-2.5 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded transition-colors whitespace-nowrap"
                  >
                    {t('routeMap.setDest')}
                  </button>
                </div>
              </div>
            </InfoWindow>
          )}
        </GoogleMap>

        {routesLoading && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 pointer-events-none">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700 dark:text-blue-400" />
            {t('routeMap.analyzing')}
          </div>
        )}
      </div>

      {/* Real-Time Traffic Route Advisor Panel */}
      {origin && destination && (
        <section
          aria-label={t('routeMap.advisorTitle')}
          className="border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 space-y-3"
        >
          {/* Advisor Header & Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-md bg-blue-50 dark:bg-blue-950/70 border border-blue-200 dark:border-blue-800/80 text-blue-700 dark:text-blue-400 flex items-center justify-center shrink-0">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {t('routeMap.advisorTitle')}
                  </h3>
                  {updatedTimeLabel && (
                    <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {t('routeMap.updated', { time: updatedTimeLabel })}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {routesLoading
                    ? t('routeMap.comparing')
                    : activeRoute
                      ? activeRoute.summary
                      : ''}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              {/* Priority Mode Segmented Control */}
              <div
                role="group"
                aria-label={t('routeMap.advisorTitle')}
                className="inline-flex items-center p-0.5 bg-slate-200/75 dark:bg-slate-800 rounded-md"
              >
                {(
                  [
                    ['fastest', t('routeMap.fastest')],
                    ['balanced', t('routeMap.balanced')],
                    ['shortest', t('routeMap.shortest')],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPriority(mode)}
                    className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                      priority === mode
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Route Modifiers */}
              <button
                type="button"
                onClick={() => setAvoidTolls((prev) => !prev)}
                aria-pressed={avoidTolls}
                className={`px-2 py-1 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap ${
                  avoidTolls
                    ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-300'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {t('routeMap.avoidTolls')}
              </button>

              <button
                type="button"
                onClick={() => setAvoidHighways((prev) => !prev)}
                aria-pressed={avoidHighways}
                className={`px-2 py-1 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap ${
                  avoidHighways
                    ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-300'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {t('routeMap.noFreeways')}
              </button>

              <button
                type="button"
                disabled={routesLoading}
                onClick={() => setRefreshNonce((n) => n + 1)}
                aria-label="Refresh real-time traffic"
                className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 rounded-md transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${routesLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Route Option Comparison Cards */}
          {routesLoading && routeOptions.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
              {[1, 2].map((n) => (
                <div
                  key={n}
                  className="h-[104px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg animate-pulse"
                />
              ))}
            </div>
          ) : routeOptions.length > 0 ? (
            <div
              className={`grid grid-cols-1 gap-2.5 ${
                routeOptions.length === 2
                  ? 'sm:grid-cols-2'
                  : routeOptions.length >= 3
                    ? 'sm:grid-cols-3'
                    : ''
              }`}
            >
              {routeOptions.map((opt) => {
                const isSelected = opt.index === selectedIndex;
                const estReimb = estimateRouteReimbursement(opt.oneWayMiles, ratePerMile);
                const trafficColor =
                  opt.trafficSeverity === 'heavy'
                    ? 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-900/70'
                    : opt.trafficSeverity === 'moderate'
                      ? 'text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800/70'
                      : 'text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/70';

                return (
                  <button
                    key={opt.index}
                    type="button"
                    onClick={() => handleSelectRoute(opt.index, true)}
                    aria-pressed={isSelected}
                    className={`text-start p-3 rounded-lg border transition-all flex flex-col justify-between gap-2 ${
                      isSelected
                        ? 'bg-white dark:bg-slate-900 border-blue-600 dark:border-blue-500 ring-1 ring-blue-600/25 dark:ring-blue-500/30'
                        : 'bg-white/80 dark:bg-slate-900/70 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-1.5">
                      {/* Top Tag + Active Indicator */}
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded border whitespace-nowrap ${
                            opt.isRecommended
                              ? 'bg-blue-50 dark:bg-blue-950/70 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300'
                              : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {opt.recommendationTag}
                        </span>
                        {isSelected && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-blue-700 dark:text-blue-400 whitespace-nowrap">
                            <Check className="w-3 h-3" />
                            {t('routeMap.selected')}
                          </span>
                        )}
                      </div>

                      {/* Corridor Name */}
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {opt.summary}
                      </div>

                      {/* Real-Time ETA & Traffic Condition */}
                      <div className="flex flex-wrap items-baseline justify-between gap-1.5">
                        <div className="flex items-baseline gap-1.5 font-mono tabular-nums" dir="ltr">
                          <span className="text-base font-bold text-slate-900 dark:text-slate-100">
                            {opt.durationMinutes} {t('common.min')}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {opt.oneWayMiles.toFixed(1)} {t('common.mi')}
                          </span>
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono tabular-nums font-semibold rounded border whitespace-nowrap ${trafficColor}`}
                        >
                          <Activity className="w-2.5 h-2.5 shrink-0" />
                          {opt.trafficDelayMinutes > 0
                            ? t('logger.trafficDelay', { min: opt.trafficDelayMinutes })
                            : t('logger.clearTraffic')}
                        </span>
                      </div>
                    </div>

                    {/* Speed Flow Micro-Bar & Mileage Value */}
                    <div className="space-y-1.5 pt-1">
                      {opt.speedBreakdown && (
                        <div
                          className="h-1.5 w-full rounded-full overflow-hidden flex bg-slate-200 dark:bg-slate-800"
                          title={`Traffic flow: ${opt.speedBreakdown.normalPct}% normal, ${opt.speedBreakdown.slowPct}% slow, ${opt.speedBreakdown.jamPct}% heavy`}
                        >
                          {opt.speedBreakdown.normalPct > 0 && (
                            <div
                              className="h-full bg-blue-600 dark:bg-blue-500"
                              style={{ width: `${opt.speedBreakdown.normalPct}%` }}
                            />
                          )}
                          {opt.speedBreakdown.slowPct > 0 && (
                            <div
                              className="h-full bg-amber-500"
                              style={{ width: `${opt.speedBreakdown.slowPct}%` }}
                            />
                          )}
                          {opt.speedBreakdown.jamPct > 0 && (
                            <div
                              className="h-full bg-red-600"
                              style={{ width: `${opt.speedBreakdown.jamPct}%` }}
                            />
                          )}
                        </div>
                      )}
                      <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        <span>
                          {opt.extraMinutesVsFastest > 0
                            ? `+${opt.extraMinutesVsFastest} min vs fastest`
                            : opt.extraMilesVsShortest > 0
                              ? `+${opt.extraMilesVsShortest.toFixed(1)} mi vs shortest`
                              : 'Optimal path'}
                        </span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {formatCurrency(estReimb)}/way
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>
      )}

      {/* Quiet Map Legend Footer */}
      <div className="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-700" aria-hidden="true" />
            {t('miniMap.originA')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-600" aria-hidden="true" />
            {t('miniMap.destB')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-1 rounded-full bg-blue-700" aria-hidden="true" />
            {t('routeMap.normal')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-1 rounded-full bg-amber-500" aria-hidden="true" />
            {t('routeMap.slow')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-1 rounded-full bg-red-600" aria-hidden="true" />
            {t('routeMap.heavy')}
          </span>
        </div>
        <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
          <Navigation className="w-3 h-3" />
          {t('routeMap.poweredBy')}
        </span>
      </div>
    </div>
  );
}
