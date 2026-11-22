import React, { useMemo } from 'react';
import { MapPin } from 'lucide-react';
import {
  formatCurrency,
  formatDisplayDate,
  round1,
  round2,
  type MileageTrip,
  type TripPurpose,
} from '../types/mileage';

export interface DestinationStat {
  key: string;
  name: string;
  address: string;
  visitCount: number;
  totalMiles: number;
  totalReimbursement: number;
  lastVisited: string;
  topPurpose: TripPurpose;
}

export function analyzeTopDestinations(
  trips: MileageTrip[],
  limit: number = 5
): DestinationStat[] {
  const buckets: Record<
    string,
    {
      name: string;
      address: string;
      visitCount: number;
      totalMiles: number;
      totalReimbursement: number;
      lastVisited: string;
      purposeCounts: Record<string, number>;
    }
  > = {};

  for (const trip of trips) {
    const cleanName = trip.destinationName.trim();
    if (!cleanName) continue;
    const key = trip.destinationPlaceId || cleanName.toLowerCase();

    if (!buckets[key]) {
      buckets[key] = {
        name: cleanName,
        address: trip.destinationAddress,
        visitCount: 0,
        totalMiles: 0,
        totalReimbursement: 0,
        lastVisited: trip.tripDate,
        purposeCounts: {},
      };
    }

    const entry = buckets[key];
    entry.visitCount += 1;
    entry.totalMiles = round1(entry.totalMiles + trip.billableMiles);
    entry.totalReimbursement = round2(entry.totalReimbursement + trip.reimbursementAmount);
    if (trip.tripDate > entry.lastVisited) {
      entry.lastVisited = trip.tripDate;
    }
    entry.purposeCounts[trip.purpose] = (entry.purposeCounts[trip.purpose] ?? 0) + 1;
  }

  return Object.entries(buckets)
    .map(([key, b]) => {
      let topPurpose: TripPurpose = 'Other';
      let topCount = 0;
      for (const [purpose, count] of Object.entries(b.purposeCounts)) {
        if (count > topCount) {
          topCount = count;
          topPurpose = purpose as TripPurpose;
        }
      }
      return {
        key,
        name: b.name,
        address: b.address,
        visitCount: b.visitCount,
        totalMiles: b.totalMiles,
        totalReimbursement: b.totalReimbursement,
        lastVisited: b.lastVisited,
        topPurpose,
      };
    })
    .sort((a, b) => {
      if (b.visitCount !== a.visitCount) return b.visitCount - a.visitCount;
      return b.totalMiles - a.totalMiles;
    })
    .slice(0, limit);
}

interface TopDestinationsCardProps {
  trips: MileageTrip[];
  activeSearchQuery: string;
  onSelectDestination: (destinationName: string) => void;
}

export function TopDestinationsCard({
  trips,
  activeSearchQuery,
  onSelectDestination,
}: TopDestinationsCardProps) {
  const destinations = useMemo(() => analyzeTopDestinations(trips, 5), [trips]);
  const maxVisits = destinations[0]?.visitCount ?? 1;

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Top Trip Destinations
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Most frequently visited stops across all logged trips · Click a destination to filter
            the ledger
          </p>
        </div>
        {destinations.length > 0 && (
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Showing top {destinations.length} of{' '}
            {
              Object.keys(
                trips.reduce<Record<string, boolean>>((acc, t) => {
                  const k = t.destinationPlaceId || t.destinationName.trim().toLowerCase();
                  if (k) acc[k] = true;
                  return acc;
                }, {})
              ).length
            }{' '}
            locations
          </span>
        )}
      </div>

      {destinations.length === 0 ? (
        <div className="py-5 text-center border-t border-slate-100 dark:border-slate-800">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Destination insights will appear automatically once you log your first trip.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
          {destinations.map((dest, idx) => {
            const widthPct = Math.max(8, Math.round((dest.visitCount / maxVisits) * 100));
            const isFiltered =
              activeSearchQuery.trim().toLowerCase() === dest.name.toLowerCase();

            return (
              <button
                key={dest.key}
                type="button"
                onClick={() => onSelectDestination(isFiltered ? '' : dest.name)}
                className={`w-full text-left py-3 px-2 -mx-2 rounded-lg transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                  isFiltered
                    ? 'bg-blue-50/70 dark:bg-blue-950/50'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono tabular-nums text-xs text-slate-400 dark:text-slate-500 w-4 shrink-0">
                      {idx + 1}.
                    </span>
                    <MapPin className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400 shrink-0" />
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {dest.name}
                    </span>
                    {isFiltered && (
                      <span className="text-xs font-medium text-blue-700 dark:text-blue-400 shrink-0">
                        · Filtered
                      </span>
                    )}
                  </div>

                  {/* Proportional Visit Share Bar */}
                  <div className="pl-6 flex items-center gap-3">
                    <div className="h-1.5 flex-1 max-w-xs bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-700 dark:bg-blue-500 rounded-full"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {dest.topPurpose} · Last {formatDisplayDate(dest.lastVisited)}
                    </span>
                  </div>
                </div>

                <div className="pl-6 sm:pl-0 flex items-center gap-3 text-xs font-mono tabular-nums shrink-0">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {dest.visitCount} {dest.visitCount === 1 ? 'visit' : 'visits'}
                  </span>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                    ·
                  </span>
                  <span className="text-slate-600 dark:text-slate-400">
                    {dest.totalMiles.toFixed(1)} mi
                  </span>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                    ·
                  </span>
                  <span className="font-semibold text-blue-800 dark:text-blue-400">
                    {formatCurrency(dest.totalReimbursement)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
