import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, RotateCcw } from 'lucide-react';
import {
  DEFAULT_RATE_PER_MILE,
  formatCurrency,
  haversineMiles,
  round1,
  round2,
  type MileageTrip,
  type StoreLocation,
  type UserProfile,
} from '../types/mileage';

interface CommuteSavingsCardProps {
  profile: UserProfile | null;
  trips: MileageTrip[];
  stores: StoreLocation[];
}

const DEFAULT_FALLBACK_COMMUTE_MILES = 12.0;
const DEFAULT_WEEKLY_BUSINESS_MILES = 35.0;
const DEFAULT_OPERATING_COST_PER_MILE = 0.28; // Typical LA gas + routine maintenance
const DEFAULT_SHIFTS_PER_WEEK = 5;
const DEFAULT_WEEKS_PER_YEAR = 50;
const ROAD_CIRCUITY_FACTOR = 1.25;

function computeAverageCuracaoStoreSpacing(stores: StoreLocation[]): number | null {
  if (stores.length < 2) return null;
  let totalDist = 0;
  let pairs = 0;
  for (let i = 0; i < stores.length; i += 1) {
    for (let j = i + 1; j < stores.length; j += 1) {
      const straight = haversineMiles(
        stores[i].lat,
        stores[i].lng,
        stores[j].lat,
        stores[j].lng
      );
      totalDist += straight * ROAD_CIRCUITY_FACTOR;
      pairs += 1;
    }
  }
  if (pairs === 0) return null;
  return round1(Math.min(40, Math.max(4, totalDist / pairs)));
}

function estimateWeeklyBusinessMilesFromTrips(trips: MileageTrip[]): {
  weeklyMiles: number | null;
  tripCount: number;
} {
  if (trips.length === 0) return { weeklyMiles: null, tripCount: 0 };

  const totalMiles = trips.reduce((sum, t) => sum + t.billableMiles, 0);
  if (totalMiles <= 0) return { weeklyMiles: null, tripCount: trips.length };

  const dates = trips
    .map((t) => t.tripDate)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  if (dates.length < 2) {
    return { weeklyMiles: round1(totalMiles), tripCount: trips.length };
  }

  const firstMs = new Date(`${dates[0]}T00:00:00`).getTime();
  const lastMs = new Date(`${dates[dates.length - 1]}T00:00:00`).getTime();
  const spanDays = Math.max(7, Math.round((lastMs - firstMs) / (1000 * 60 * 60 * 24)) + 1);
  const spanWeeks = Math.max(1, spanDays / 7);

  return {
    weeklyMiles: round1(totalMiles / spanWeeks),
    tripCount: trips.length,
  };
}

export function CommuteSavingsCard({ profile, trips, stores }: CommuteSavingsCardProps) {
  const storeNetworkAvgCommute = useMemo(
    () => computeAverageCuracaoStoreSpacing(stores),
    [stores]
  );
  const tripWeeklyEstimate = useMemo(() => estimateWeeklyBusinessMilesFromTrips(trips), [trips]);

  const seededCommuteMiles = useMemo(() => {
    if (profile && profile.normalCommuteMiles > 0) return round1(profile.normalCommuteMiles);
    if (storeNetworkAvgCommute !== null) return storeNetworkAvgCommute;
    return DEFAULT_FALLBACK_COMMUTE_MILES;
  }, [profile, storeNetworkAvgCommute]);

  const seededWeeklyBusinessMiles = useMemo(() => {
    if (tripWeeklyEstimate.weeklyMiles !== null) return tripWeeklyEstimate.weeklyMiles;
    return DEFAULT_WEEKLY_BUSINESS_MILES;
  }, [tripWeeklyEstimate.weeklyMiles]);

  const seededRate = profile?.ratePerMile ?? DEFAULT_RATE_PER_MILE;

  const [commuteOneWayMiles, setCommuteOneWayMiles] = useState<number>(seededCommuteMiles);
  const [shiftsPerWeek, setShiftsPerWeek] = useState<number>(DEFAULT_SHIFTS_PER_WEEK);
  const [weeklyBusinessMiles, setWeeklyBusinessMiles] = useState<number>(
    seededWeeklyBusinessMiles
  );
  const [ratePerMile, setRatePerMile] = useState<number>(seededRate);
  const [operatingCostPerMile, setOperatingCostPerMile] = useState<number>(
    DEFAULT_OPERATING_COST_PER_MILE
  );
  const [weeksPerYear, setWeeksPerYear] = useState<number>(DEFAULT_WEEKS_PER_YEAR);
  const [hasEditedManually, setHasEditedManually] = useState(false);

  // Sync defaults from profile, discovered LA Curacao stores, and logged trips until user edits
  useEffect(() => {
    if (hasEditedManually) return;
    setCommuteOneWayMiles(seededCommuteMiles);
    setWeeklyBusinessMiles(seededWeeklyBusinessMiles);
    setRatePerMile(seededRate);
  }, [hasEditedManually, seededCommuteMiles, seededWeeklyBusinessMiles, seededRate]);

  const handleResetToActuals = () => {
    setCommuteOneWayMiles(seededCommuteMiles);
    setShiftsPerWeek(DEFAULT_SHIFTS_PER_WEEK);
    setWeeklyBusinessMiles(seededWeeklyBusinessMiles);
    setRatePerMile(seededRate);
    setOperatingCostPerMile(DEFAULT_OPERATING_COST_PER_MILE);
    setWeeksPerYear(DEFAULT_WEEKS_PER_YEAR);
    setHasEditedManually(false);
  };

  const metrics = useMemo(() => {
    const safeCommute = Math.max(0, commuteOneWayMiles);
    const safeShifts = Math.max(1, Math.min(7, shiftsPerWeek));
    const safeBizWeekly = Math.max(0, weeklyBusinessMiles);
    const safeRate = Math.max(0.01, ratePerMile);
    const safeOpCost = Math.max(0, operatingCostPerMile);
    const safeWeeks = Math.max(1, Math.min(52, weeksPerYear));

    const annualCommuteMiles = round1(safeCommute * 2 * safeShifts * safeWeeks);
    const annualBusinessMiles = round1(safeBizWeekly * safeWeeks);
    const totalAnnualWorkMiles = round1(annualCommuteMiles + annualBusinessMiles);

    const annualReimbursement = round2(annualBusinessMiles * safeRate);
    const monthlyReimbursement = round2(annualReimbursement / 12);

    const annualBusinessFuelCost = round2(annualBusinessMiles * safeOpCost);
    const annualCommuteFuelCost = round2(annualCommuteMiles * safeOpCost);

    // Net annual savings after covering fuel & routine wear on the business miles themselves
    const netAnnualSavings = round2(annualReimbursement - annualBusinessFuelCost);
    // Out-of-pocket commute cost reduced by net mileage reimbursement surplus
    const effectiveCommuteCost = round2(Math.max(0, annualCommuteFuelCost - Math.max(0, netAnnualSavings)));
    const commuteOffsetPct =
      annualCommuteFuelCost > 0
        ? Math.min(999, Math.round((Math.max(0, netAnnualSavings) / annualCommuteFuelCost) * 100))
        : 0;

    const reimbursableSharePct =
      totalAnnualWorkMiles > 0
        ? Math.round((annualBusinessMiles / totalAnnualWorkMiles) * 100)
        : 0;
    const commuteSharePct = Math.max(0, 100 - reimbursableSharePct);

    return {
      annualCommuteMiles,
      annualBusinessMiles,
      totalAnnualWorkMiles,
      annualReimbursement,
      monthlyReimbursement,
      annualBusinessFuelCost,
      annualCommuteFuelCost,
      netAnnualSavings,
      effectiveCommuteCost,
      commuteOffsetPct,
      reimbursableSharePct,
      commuteSharePct,
    };
  }, [
    commuteOneWayMiles,
    shiftsPerWeek,
    weeklyBusinessMiles,
    ratePerMile,
    operatingCostPerMile,
    weeksPerYear,
  ]);

  const commuteSourceHint =
    profile && profile.normalCommuteMiles > 0
      ? 'Prefilled from your saved Profile commute'
      : storeNetworkAvgCommute !== null
        ? `Based on avg. distance between ${stores.length} LA Curacao stores`
        : 'LA retail shift baseline';

  const businessSourceHint =
    tripWeeklyEstimate.weeklyMiles !== null
      ? `Estimated from your ${tripWeeklyEstimate.tripCount} logged ${
          tripWeeklyEstimate.tripCount === 1 ? 'trip' : 'trips'
        }`
      : 'Typical LA inter-store runs';

  return (
    <section
      aria-label="Commute Savings Calculator"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Calculator className="w-4 h-4 text-blue-700 dark:text-blue-400 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Commute Savings Calculator
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Estimate annual mileage reimbursement and commute fuel offset comparing your average
            Curacao store commute against reimbursable business miles.
          </p>
        </div>

        <button
          type="button"
          onClick={handleResetToActuals}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset to My Data
        </button>
      </div>

      {/* Main Content Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800">
        {/* Left: Interactive Inputs */}
        <div className="lg:col-span-5 p-5 space-y-4">
          {/* Avg Commute Distance */}
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label
                htmlFor="calc-commute-mi"
                className="text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Avg. Curacao Store Commute (one-way)
              </label>
              <span className="text-xs font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                {commuteOneWayMiles.toFixed(1)} mi
              </span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="50"
                step="0.5"
                aria-label="Average Curacao store commute slider"
                value={Math.min(50, commuteOneWayMiles)}
                onChange={(e) => {
                  setCommuteOneWayMiles(parseFloat(e.target.value) || 0);
                  setHasEditedManually(true);
                }}
                className="flex-1 accent-blue-700 dark:accent-blue-500"
              />
              <input
                id="calc-commute-mi"
                type="number"
                min="0"
                max="150"
                step="0.5"
                value={commuteOneWayMiles}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setCommuteOneWayMiles(Number.isFinite(val) && val >= 0 ? val : 0);
                  setHasEditedManually(true);
                }}
                className="w-20 px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">{commuteSourceHint}</div>
          </div>

          {/* Weekly Reimbursable Business Miles */}
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label
                htmlFor="calc-biz-mi"
                className="text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Reimbursable Business Miles / Week
              </label>
              <span className="text-xs font-mono tabular-nums font-semibold text-blue-800 dark:text-blue-400">
                {weeklyBusinessMiles.toFixed(1)} mi/wk
              </span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="200"
                step="1"
                aria-label="Weekly reimbursable business miles slider"
                value={Math.min(200, weeklyBusinessMiles)}
                onChange={(e) => {
                  setWeeklyBusinessMiles(parseFloat(e.target.value) || 0);
                  setHasEditedManually(true);
                }}
                className="flex-1 accent-blue-700 dark:accent-blue-500"
              />
              <input
                id="calc-biz-mi"
                type="number"
                min="0"
                max="1000"
                step="1"
                value={weeklyBusinessMiles}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setWeeklyBusinessMiles(Number.isFinite(val) && val >= 0 ? val : 0);
                  setHasEditedManually(true);
                }}
                className="w-20 px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {businessSourceHint}
            </div>
          </div>

          {/* Shifts per Week Segmented Control */}
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Retail Shifts / Week
            </span>
            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              {[3, 4, 5, 6].map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => {
                    setShiftsPerWeek(cnt);
                    setHasEditedManually(true);
                  }}
                  className={`py-1.5 text-xs font-mono tabular-nums font-medium rounded-md transition-colors whitespace-nowrap ${
                    shiftsPerWeek === cnt
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {cnt} days
                </button>
              ))}
            </div>
          </div>

          {/* Rate, Operating Cost, Weeks */}
          <div className="grid grid-cols-3 gap-2.5 pt-1">
            <div>
              <label
                htmlFor="calc-rate"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Reimb. Rate
              </label>
              <input
                id="calc-rate"
                type="number"
                min="0.01"
                max="5"
                step="0.01"
                value={ratePerMile}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setRatePerMile(Number.isFinite(val) && val > 0 ? val : DEFAULT_RATE_PER_MILE);
                  setHasEditedManually(true);
                }}
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label
                htmlFor="calc-opcost"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Fuel/Wear $/mi
              </label>
              <input
                id="calc-opcost"
                type="number"
                min="0"
                max="3"
                step="0.01"
                value={operatingCostPerMile}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setOperatingCostPerMile(Number.isFinite(val) && val >= 0 ? val : 0);
                  setHasEditedManually(true);
                }}
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label
                htmlFor="calc-weeks"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Weeks / Year
              </label>
              <input
                id="calc-weeks"
                type="number"
                min="1"
                max="52"
                step="1"
                value={weeksPerYear}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setWeeksPerYear(Number.isFinite(val) && val >= 1 ? Math.min(52, val) : 50);
                  setHasEditedManually(true);
                }}
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>
        </div>

        {/* Right: Annual Savings Projection & Commute Comparison */}
        <div className="lg:col-span-7 p-5 flex flex-col justify-between gap-5">
          {/* Primary Annual Savings Figures */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Est. Annual Reimbursement
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-blue-800 dark:text-blue-400 mt-1">
                {formatCurrency(metrics.annualReimbursement)}
              </div>
              <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
                {formatCurrency(metrics.monthlyReimbursement)} / mo avg
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Net Annual Savings</div>
              <div
                className={`text-2xl font-bold font-mono tabular-nums mt-1 ${
                  metrics.netAnnualSavings >= 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-700 dark:text-red-400'
                }`}
              >
                {formatCurrency(metrics.netAnnualSavings)}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                After ${operatingCostPerMile.toFixed(2)}/mi business fuel
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Commute Fuel Offset</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                {metrics.commuteOffsetPct}%
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
                {metrics.annualCommuteFuelCost > 0
                  ? `${formatCurrency(metrics.effectiveCommuteCost)} net commute/yr`
                  : 'Zero daily commute'}
              </div>
            </div>
          </div>

          {/* Commute vs Reimbursable Business Mileage Split Bar */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                Annual Work Driving Breakdown ({metrics.totalAnnualWorkMiles.toLocaleString()} mi/yr)
              </span>
              <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                {metrics.reimbursableSharePct}% reimbursable · {metrics.commuteSharePct}% commute
              </span>
            </div>

            <div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
              <div
                className="h-full bg-blue-700 dark:bg-blue-500 transition-all duration-200"
                style={{ width: `${metrics.reimbursableSharePct}%` }}
                title={`Reimbursable business miles: ${metrics.annualBusinessMiles.toLocaleString()} mi/yr`}
              />
              <div
                className="h-full bg-slate-300 dark:bg-slate-600 transition-all duration-200"
                style={{ width: `${metrics.commuteSharePct}%` }}
                title={`Store commute miles: ${metrics.annualCommuteMiles.toLocaleString()} mi/yr`}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-xs">
              <div className="flex items-start justify-between gap-2 py-2 border-b sm:border-b-0 sm:border-r border-slate-100 dark:border-slate-800 sm:pr-3">
                <div className="space-y-0.5">
                  <div className="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-sm bg-blue-700 dark:bg-blue-500 shrink-0"
                      aria-hidden="true"
                    />
                    Reimbursable Business Miles
                  </div>
                  <div className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    {metrics.annualBusinessMiles.toLocaleString()} mi/yr · Fuel{' '}
                    {formatCurrency(metrics.annualBusinessFuelCost)}
                  </div>
                </div>
                <span className="font-mono tabular-nums font-semibold text-blue-800 dark:text-blue-400 whitespace-nowrap">
                  +{formatCurrency(metrics.annualReimbursement)}
                </span>
              </div>

              <div className="flex items-start justify-between gap-2 py-2 sm:pl-1">
                <div className="space-y-0.5">
                  <div className="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-sm bg-slate-300 dark:bg-slate-600 shrink-0"
                      aria-hidden="true"
                    />
                    Regular Store Commute
                  </div>
                  <div className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    {metrics.annualCommuteMiles.toLocaleString()} mi/yr ({commuteOneWayMiles.toFixed(1)}{' '}
                    mi × 2 × {shiftsPerWeek}d)
                  </div>
                </div>
                <span className="font-mono tabular-nums font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                  −{formatCurrency(metrics.annualCommuteFuelCost)}
                </span>
              </div>
            </div>
          </div>

          {/* Quiet Formula Footnote */}
          <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800 leading-relaxed">
            Net Annual Savings equals reimbursable mileage payouts ({formatCurrency(metrics.annualReimbursement)})
            minus estimated fuel and wear on those business trips ({formatCurrency(metrics.annualBusinessFuelCost)}),
            showing how much your Curacao mileage reimbursements offset your regular Los Angeles
            store commuting costs.
          </p>
        </div>
      </div>
    </section>
  );
}
