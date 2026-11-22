import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, MapPin, Route as RouteIcon } from 'lucide-react';
import { buildRouteStaticMapUrl } from '../lib/staticMapUrlBuilder';
import type { PlaceSelection } from '../types/mileage';

interface StaticRouteThumbnailProps {
  origin: PlaceSelection;
  destination: PlaceSelection;
  routePath?: Array<{ lat: number; lng: number }>;
  oneWayMiles: number;
  durationMinutes: number;
  isRoundTrip: boolean;
  darkMode?: boolean;
}

export function StaticRouteThumbnail({
  origin,
  destination,
  routePath,
  oneWayMiles,
  durationMinutes,
  isRoundTrip,
  darkMode = false,
}: StaticRouteThumbnailProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const staticMapUrl = useMemo(
    () =>
      buildRouteStaticMapUrl({
        origin,
        destination,
        routePath,
        darkMode,
      }),
    [origin, destination, routePath, darkMode]
  );

  useEffect(() => {
    setImageLoaded(false);
    setImageFailed(false);
  }, [staticMapUrl]);

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden bg-slate-50/60 dark:bg-slate-800/50">
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          Route Confirmation Preview
        </span>
        <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
          {oneWayMiles > 0 ? `${oneWayMiles.toFixed(1)} mi` : 'Pending'}
          {isRoundTrip ? ' × 2' : ''}
          {durationMinutes > 0 ? ` · ${durationMinutes} min` : ''}
        </span>
      </div>

      {/* Static Google Map Thumbnail */}
      <div className="relative h-[132px] w-full bg-slate-100 dark:bg-slate-900 overflow-hidden">
        {staticMapUrl && !imageFailed ? (
          <>
            {!imageLoaded && (
              <div className="absolute inset-0 bg-slate-100 dark:bg-slate-800 animate-pulse" />
            )}
            <img
              src={staticMapUrl}
              alt={`Static route map from ${origin.name} to ${destination.name}`}
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageFailed(true)}
              className={`w-full h-full object-cover transition-opacity duration-200 ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </>
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center px-4 text-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <RouteIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {origin.name} → {destination.name}
            </span>
            <span className="text-[11px]">
              Verify origin and destination addresses below before logging.
            </span>
          </div>
        )}
      </div>

      {/* Confirmed Origin & Destination Address Readout */}
      <div className="px-3 py-2.5 space-y-1.5 text-[11px] bg-white dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-700">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 w-4 h-4 rounded-full bg-emerald-700 text-white text-[9px] font-bold flex items-center justify-center shrink-0">
            A
          </span>
          <div className="min-w-0 flex-1 truncate">
            <span className="font-semibold text-slate-900 dark:text-slate-100">{origin.name}</span>
            {origin.address && (
              <span className="text-slate-500 dark:text-slate-400"> · {origin.address}</span>
            )}
          </div>
        </div>
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 w-4 h-4 rounded-full bg-amber-600 text-white text-[9px] font-bold flex items-center justify-center shrink-0">
            B
          </span>
          <div className="min-w-0 flex-1 truncate">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {destination.name}
            </span>
            {destination.address && (
              <span className="text-slate-500 dark:text-slate-400"> · {destination.address}</span>
            )}
          </div>
        </div>
        <div className="pt-0.5 flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
          <MapPin className="w-3 h-3 shrink-0" />
          <span>Confirm addresses above before saving your trip</span>
        </div>
      </div>
    </div>
  );
}
