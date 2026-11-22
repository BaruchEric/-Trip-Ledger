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
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Crosshair,
  FileDown,
  Loader2,
  MapPin,
  Pencil,
  Receipt,
  Route as RouteIcon,
  X,
} from 'lucide-react';
import {
  formatCurrency,
  formatDisplayDate,
  round1,
  type MileageTrip,
  type StoreLocation,
  type TripExpense,
} from '../types/mileage';

const LA_DEFAULT_CENTER = { lat: 34.0407, lng: -118.2468 };
const METERS_PER_MILE = 1609.344;

interface TripRouteMiniMapProps {
  trip: MileageTrip;
  expenses?: TripExpense[];
  stores: StoreLocation[];
  reportNumber?: string;
  stage?: 'ready' | 'submitted' | 'reimbursed';
  tripIndex: number;
  totalTrips: number;
  pdfDownloaded?: boolean;
  onDownloadPdf?: () => void;
  onAddExpense?: () => void;
  onEditTrip?: () => void;
  onDuplicateTrip?: () => void;
  onPrevTrip?: () => void;
  onNextTrip?: () => void;
  onOpenReport?: (reportId: string) => void;
  onClose: () => void;
}

interface ResolvedEndpoints {
  origin: google.maps.LatLngLiteral | null;
  destination: google.maps.LatLngLiteral | null;
  computedMiles: number | null;
  computedMinutes: number | null;
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

function resolveTripWaypoint(
  placeId: string,
  address: string,
  name: string,
  stores: StoreLocation[]
): {
  waypoint: string | google.maps.LatLngLiteral;
  knownLatLng: google.maps.LatLngLiteral | null;
} {
  if (placeId) {
    const matched = stores.find((s) => s.placeId === placeId);
    if (matched) {
      const coords = { lat: matched.lat, lng: matched.lng };
      return { waypoint: coords, knownLatLng: coords };
    }
  }

  const parsedAddressCoords = parseCoordinateString(address);
  if (parsedAddressCoords) {
    return { waypoint: parsedAddressCoords, knownLatLng: parsedAddressCoords };
  }

  return {
    waypoint: address.trim() || name.trim(),
    knownLatLng: null,
  };
}

interface MiniMapRouteControllerProps {
  trip: MileageTrip;
  stores: StoreLocation[];
  recenterNonce: number;
  onRouteStateChange: (state: {
    loading: boolean;
    error: string | null;
    endpoints: ResolvedEndpoints;
  }) => void;
}

function MiniMapRouteController({
  trip,
  stores,
  recenterNonce,
  onRouteStateChange,
}: MiniMapRouteControllerProps) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');

  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const lastViewportRef = useRef<google.maps.LatLngBounds | null>(null);
  const onRouteStateChangeRef = useRef(onRouteStateChange);
  onRouteStateChangeRef.current = onRouteStateChange;

  useEffect(() => {
    if (recenterNonce > 0 && map && lastViewportRef.current) {
      map.fitBounds(lastViewportRef.current, 44);
    }
  }, [map, recenterNonce]);

  useEffect(() => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
    lastViewportRef.current = null;

    if (!map || !routesLib) return;

    const originResolved = resolveTripWaypoint(
      trip.originPlaceId,
      trip.originAddress,
      trip.originName,
      stores
    );
    const destResolved = resolveTripWaypoint(
      trip.destinationPlaceId,
      trip.destinationAddress,
      trip.destinationName,
      stores
    );

    if (!originResolved.waypoint || !destResolved.waypoint) {
      onRouteStateChangeRef.current({
        loading: false,
        error: 'Origin or destination address is incomplete for this trip.',
        endpoints: {
          origin: originResolved.knownLatLng,
          destination: destResolved.knownLatLng,
          computedMiles: null,
          computedMinutes: null,
        },
      });
      return;
    }

    // Handle same-location trips cleanly without an unnecessary route call
    if (
      trip.originPlaceId &&
      trip.destinationPlaceId &&
      trip.originPlaceId === trip.destinationPlaceId
    ) {
      if (originResolved.knownLatLng) {
        map.panTo(originResolved.knownLatLng);
        map.setZoom(14);
      }
      onRouteStateChangeRef.current({
        loading: false,
        error: null,
        endpoints: {
          origin: originResolved.knownLatLng,
          destination: destResolved.knownLatLng,
          computedMiles: 0,
          computedMinutes: 0,
        },
      });
      return;
    }

    let cancelled = false;
    onRouteStateChangeRef.current({
      loading: true,
      error: null,
      endpoints: {
        origin: originResolved.knownLatLng,
        destination: destResolved.knownLatLng,
        computedMiles: null,
        computedMinutes: null,
      },
    });

    // Modern Routes API SDK wrapper (replaces disabled DirectionsService)
    // Docs: https://developers.google.com/maps/documentation/javascript/routes?utm_campaign=gmp_mcp_codeassist_v1_aistudio
    const RouteClass = (
      routesLib as unknown as {
        Route?: {
          computeRoutes: (req: unknown) => Promise<{
            routes?: Array<{
              distanceMeters?: number;
              durationMillis?: number;
              viewport?: google.maps.LatLngBounds;
              createPolylines: () => google.maps.Polyline[];
            }>;
          }>;
        };
      }
    ).Route;

    if (!RouteClass?.computeRoutes) {
      onRouteStateChangeRef.current({
        loading: false,
        error: 'Routes service is still initializing. Please try again in a moment.',
        endpoints: {
          origin: originResolved.knownLatLng,
          destination: destResolved.knownLatLng,
          computedMiles: null,
          computedMinutes: null,
        },
      });
      return;
    }

    RouteClass.computeRoutes({
      origin: originResolved.waypoint,
      destination: destResolved.waypoint,
      travelMode: 'DRIVING',
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport', 'legs'],
    })
      .then((res) => {
        if (cancelled) return;
        const primaryRoute = res.routes?.[0];
        if (!primaryRoute) {
          onRouteStateChangeRef.current({
            loading: false,
            error: 'No driving route path could be resolved for these addresses.',
            endpoints: {
              origin: originResolved.knownLatLng,
              destination: destResolved.knownLatLng,
              computedMiles: null,
              computedMinutes: null,
            },
          });
          return;
        }

        const polylines = primaryRoute.createPolylines();
        let startLatLng = originResolved.knownLatLng;
        let endLatLng = destResolved.knownLatLng;

        polylines.forEach((polyline, idx) => {
          polyline.setOptions({
            strokeColor: '#1d4ed8',
            strokeOpacity: 0.92,
            strokeWeight: 5,
          });
          polyline.setMap(map);

          const path = polyline.getPath();
          if (path && path.getLength() > 0) {
            if (idx === 0 && !startLatLng) {
              const first = path.getAt(0);
              startLatLng = { lat: first.lat(), lng: first.lng() };
            }
            if (idx === polylines.length - 1 && !endLatLng) {
              const last = path.getAt(path.getLength() - 1);
              endLatLng = { lat: last.lat(), lng: last.lng() };
            }
          }
        });
        polylinesRef.current = polylines;

        if (primaryRoute.viewport) {
          lastViewportRef.current = primaryRoute.viewport;
          map.fitBounds(primaryRoute.viewport, 44);
        }

        const distanceMeters = primaryRoute.distanceMeters ?? 0;
        const durationMillis = primaryRoute.durationMillis ?? 0;
        onRouteStateChangeRef.current({
          loading: false,
          error: null,
          endpoints: {
            origin: startLatLng,
            destination: endLatLng,
            computedMiles: distanceMeters > 0 ? round1(distanceMeters / METERS_PER_MILE) : null,
            computedMinutes:
              durationMillis > 0 ? Math.max(1, Math.round(durationMillis / 60000)) : null,
          },
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('TripRouteMiniMap Route.computeRoutes error:', err);
        onRouteStateChangeRef.current({
          loading: false,
          error: 'Unable to load route path. Please check your network or trip addresses.',
          endpoints: {
            origin: originResolved.knownLatLng,
            destination: destResolved.knownLatLng,
            computedMiles: null,
            computedMinutes: null,
          },
        });
      });

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [
    map,
    routesLib,
    trip.id,
    trip.originPlaceId,
    trip.originAddress,
    trip.originName,
    trip.destinationPlaceId,
    trip.destinationAddress,
    trip.destinationName,
    stores,
  ]);

  return null;
}

export function TripRouteMiniMap({
  trip,
  expenses = [],
  stores,
  reportNumber,
  stage,
  tripIndex,
  totalTrips,
  pdfDownloaded = false,
  onDownloadPdf,
  onAddExpense,
  onEditTrip,
  onDuplicateTrip,
  onPrevTrip,
  onNextTrip,
  onOpenReport,
  onClose,
}: TripRouteMiniMapProps) {
  const [routeLoading, setRouteLoading] = useState(true);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [endpoints, setEndpoints] = useState<ResolvedEndpoints>({
    origin: null,
    destination: null,
    computedMiles: null,
    computedMinutes: null,
  });
  const [activePin, setActivePin] = useState<'origin' | 'destination' | null>(null);
  const [recenterNonce, setRecenterNonce] = useState(0);

  useEffect(() => {
    setActivePin(null);
  }, [trip.id]);

  const handleRouteStateChange = useCallback(
    (state: { loading: boolean; error: string | null; endpoints: ResolvedEndpoints }) => {
      setRouteLoading(state.loading);
      setRouteError(state.error);
      setEndpoints(state.endpoints);
    },
    []
  );

  const displayDuration = useMemo(() => {
    if (trip.durationMinutes > 0) return trip.durationMinutes;
    return endpoints.computedMinutes;
  }, [trip.durationMinutes, endpoints.computedMinutes]);

  const captureLabel = useMemo(() => {
    switch (trip.captureMethod) {
      case 'gps_live':
        return 'Live GPS';
      case 'template':
        return 'Saved Template';
      case 'manual':
        return 'Manual Entry';
      default:
        return 'Auto-Routed';
    }
  }, [trip.captureMethod]);

  return (
    <section
      aria-label="Selected trip route preview"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
    >
      {/* Panel Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-900/70">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            <span>{formatDisplayDate(trip.tripDate)}</span>
            <span aria-hidden="true">·</span>
            <span>{trip.purpose}</span>
            <span aria-hidden="true">·</span>
            <span>{trip.isRoundTrip ? 'Round Trip' : 'One-Way'}</span>
          </div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate mt-0.5">
            {trip.originName} → {trip.destinationName}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {totalTrips > 1 && (
            <div className="inline-flex items-center gap-1 mr-1">
              <button
                type="button"
                onClick={onPrevTrip}
                disabled={!onPrevTrip || tripIndex <= 0}
                aria-label="Previous trip route"
                className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-md transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 px-1">
                {tripIndex + 1}/{totalTrips}
              </span>
              <button
                type="button"
                onClick={onNextTrip}
                disabled={!onNextTrip || tripIndex >= totalTrips - 1}
                aria-label="Next trip route"
                className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-md transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {onEditTrip && (
            <button
              type="button"
              onClick={onEditTrip}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap"
            >
              <Pencil className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              Edit
            </button>
          )}

          {onDuplicateTrip && (
            <button
              type="button"
              onClick={onDuplicateTrip}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap"
            >
              <Copy className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              Duplicate
            </button>
          )}

          {onAddExpense && (
            <button
              type="button"
              onClick={onAddExpense}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap"
            >
              <Receipt className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" />
              Add Expense
            </button>
          )}

          {onDownloadPdf && (
            <button
              type="button"
              onClick={onDownloadPdf}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap"
            >
              {pdfDownloaded ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Receipt Saved
                </>
              ) : (
                <>
                  <FileDown className="w-3.5 h-3.5" />
                  Download as PDF
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => setRecenterNonce((n) => n + 1)}
            disabled={routeLoading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
          >
            <Crosshair className="w-3.5 h-3.5" />
            Recenter
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close route preview"
            className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-md transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Horizontal Split: Interactive Mini-Map + Trip Route Details */}
      <div className="grid grid-cols-1 lg:grid-cols-12">
        {/* Interactive Google Map Canvas (explicit height per CF2) */}
        <div className="lg:col-span-7 relative h-[280px] sm:h-[310px] w-full bg-slate-100 dark:bg-slate-950 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800">
          <GoogleMap
            mapId="DEMO_MAP_ID"
            defaultCenter={LA_DEFAULT_CENTER}
            defaultZoom={11}
            gestureHandling="greedy"
            streetViewControl={false}
            mapTypeControl={false}
            fullscreenControl={true}
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            className="w-full h-full"
          >
            <MiniMapRouteController
              trip={trip}
              stores={stores}
              recenterNonce={recenterNonce}
              onRouteStateChange={handleRouteStateChange}
            />

            {endpoints.origin && (
              <AdvancedMarker
                position={endpoints.origin}
                title={`Origin: ${trip.originName}`}
                onClick={() => setActivePin('origin')}
              >
                <Pin
                  background="#15803d"
                  borderColor="#14532d"
                  glyphColor="#ffffff"
                  glyphText="A"
                />
              </AdvancedMarker>
            )}

            {endpoints.destination && (
              <AdvancedMarker
                position={endpoints.destination}
                title={`Destination: ${trip.destinationName}`}
                onClick={() => setActivePin('destination')}
              >
                <Pin
                  background="#d97706"
                  borderColor="#92400e"
                  glyphColor="#ffffff"
                  glyphText="B"
                />
              </AdvancedMarker>
            )}

            {activePin === 'origin' && endpoints.origin && (
              <InfoWindow position={endpoints.origin} onCloseClick={() => setActivePin(null)}>
                <div className="p-1 max-w-[220px]">
                  <div className="text-xs font-semibold text-emerald-800">Origin (A)</div>
                  <div className="text-xs font-semibold text-slate-900 mt-0.5">
                    {trip.originName}
                  </div>
                  {trip.originAddress && (
                    <div className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                      {trip.originAddress}
                    </div>
                  )}
                </div>
              </InfoWindow>
            )}

            {activePin === 'destination' && endpoints.destination && (
              <InfoWindow position={endpoints.destination} onCloseClick={() => setActivePin(null)}>
                <div className="p-1 max-w-[220px]">
                  <div className="text-xs font-semibold text-amber-800">Destination (B)</div>
                  <div className="text-xs font-semibold text-slate-900 mt-0.5">
                    {trip.destinationName}
                  </div>
                  {trip.destinationAddress && (
                    <div className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                      {trip.destinationAddress}
                    </div>
                  )}
                </div>
              </InfoWindow>
            )}
          </GoogleMap>

          {routeLoading && (
            <div className="absolute inset-0 bg-white/65 dark:bg-slate-950/70 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm text-xs font-medium text-slate-700 dark:text-slate-200">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700 dark:text-blue-400" />
                Loading route path...
              </div>
            </div>
          )}

          {routeError && !routeLoading && (
            <div
              role="alert"
              className="absolute left-3 right-3 bottom-3 px-3 py-2 bg-amber-50 dark:bg-amber-950/90 border border-amber-300 dark:border-amber-800 rounded-lg text-xs text-amber-950 dark:text-amber-100 shadow-sm"
            >
              {routeError}
            </div>
          )}
        </div>

        {/* Route Breakdown & Trip Metadata */}
        <div className="lg:col-span-5 p-4 flex flex-col justify-between gap-4">
          <div className="space-y-3.5">
            {/* Key Metrics Row */}
            <div className="grid grid-cols-3 gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Billable Miles</div>
                <div className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {trip.billableMiles.toFixed(1)} mi
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {expenses.length > 0 ? 'Total Reimb.' : 'Reimbursement'}
                </div>
                <div className="text-base font-bold font-mono tabular-nums text-blue-800 dark:text-blue-400 mt-0.5">
                  {formatCurrency(
                    trip.reimbursementAmount + expenses.reduce((sum, e) => sum + e.amount, 0)
                  )}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Est. Drive</div>
                <div className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {displayDuration ? `${displayDuration} min` : '—'}
                </div>
              </div>
            </div>

            {/* Origin A & Destination B Addresses */}
            <div className="space-y-2.5 text-xs">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 w-5 h-5 rounded-full bg-emerald-700 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                  A
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {trip.originName}
                  </div>
                  {trip.originAddress && (
                    <div className="text-slate-500 dark:text-slate-400 leading-snug mt-0.5 break-words">
                      {trip.originAddress}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 w-5 h-5 rounded-full bg-amber-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                  B
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {trip.destinationName}
                  </div>
                  {trip.destinationAddress && (
                    <div className="text-slate-500 dark:text-slate-400 leading-snug mt-0.5 break-words">
                      {trip.destinationAddress}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Calculation & Capture Metadata */}
            <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono tabular-nums">
                <span className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-200">
                  <RouteIcon className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" />
                  {trip.oneWayMiles.toFixed(1)} mi one-way
                </span>
                {endpoints.computedMiles !== null &&
                  Math.abs(endpoints.computedMiles - trip.oneWayMiles) >= 0.3 && (
                    <>
                      <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                        ·
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        Map path {endpoints.computedMiles.toFixed(1)} mi
                      </span>
                    </>
                  )}
                {trip.commuteDeductionMiles > 0 && (
                  <>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                      ·
                    </span>
                    <span>−{trip.commuteDeductionMiles.toFixed(1)} mi commute</span>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-500 dark:text-slate-400">
                <span className="font-mono tabular-nums">${trip.ratePerMile.toFixed(2)}/mi</span>
                <span aria-hidden="true">·</span>
                <span>{captureLabel}</span>
                {displayDuration && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                      <Clock className="w-3 h-3" />
                      {displayDuration} min one-way
                    </span>
                  </>
                )}
              </div>

              {trip.notes && (
                <p className="text-slate-700 dark:text-slate-300 pt-1 leading-snug">
                  <span className="text-slate-500 dark:text-slate-400">Notes: </span>
                  {trip.notes}
                </p>
              )}

              {expenses.length > 0 && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1">
                  <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    Associated Expenses ({expenses.length})
                  </div>
                  {expenses.map((exp) => (
                    <div
                      key={exp.id}
                      className="flex items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300"
                    >
                      <span className="truncate">
                        {exp.category} — {exp.description}
                      </span>
                      <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                        {formatCurrency(exp.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Quiet Footer Row */}
          <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <MapPin className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" />
              Click pins A or B for stop details
            </span>
            {trip.status === 'submitted' && reportNumber && onOpenReport ? (
              <button
                type="button"
                onClick={() => onOpenReport(trip.reportId)}
                className={`font-mono font-semibold hover:underline whitespace-nowrap ${
                  stage === 'reimbursed'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-blue-700 dark:text-blue-400'
                }`}
              >
                {stage === 'reimbursed' ? 'Reimbursed · ' : 'Report '}
                {reportNumber}
              </button>
            ) : (
              <span className="font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
                {stage === 'reimbursed'
                  ? 'Reimbursed'
                  : trip.status === 'ready'
                    ? 'Ready to Submit'
                    : 'Submitted'}
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
