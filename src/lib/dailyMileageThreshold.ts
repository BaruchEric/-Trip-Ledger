import { round1, type MileageTrip } from '../types/mileage';

export const DEFAULT_SHIFT_COMMUTE_THRESHOLD_MILES = 50;
export const MIN_SHIFT_THRESHOLD_MILES = 10;
export const MAX_SHIFT_THRESHOLD_MILES = 500;
export const THRESHOLD_PRESETS = [35, 50, 75, 100] as const;

const APPROACHING_RATIO = 0.85;
const HIGH_ALERT_RATIO = 1.5;
const STORAGE_KEY = 'curacao_daily_mileage_threshold_mi';

export type DailyMileageSeverity = 'normal' | 'approaching' | 'exceeded' | 'high';

export interface DailyMileageEvaluation {
  tripDate: string;
  existingMiles: number;
  existingTripCount: number;
  pendingMiles: number;
  projectedMiles: number;
  thresholdMiles: number;
  overageMiles: number;
  percentOfThreshold: number;
  severity: DailyMileageSeverity;
  exceedsWithExistingOnly: boolean;
}

export function clampShiftThreshold(miles: number): number {
  if (!Number.isFinite(miles)) return DEFAULT_SHIFT_COMMUTE_THRESHOLD_MILES;
  return round1(Math.min(MAX_SHIFT_THRESHOLD_MILES, Math.max(MIN_SHIFT_THRESHOLD_MILES, miles)));
}

export function loadDailyMileageThreshold(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SHIFT_COMMUTE_THRESHOLD_MILES;
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_SHIFT_COMMUTE_THRESHOLD_MILES;
    return clampShiftThreshold(parsed);
  } catch {
    return DEFAULT_SHIFT_COMMUTE_THRESHOLD_MILES;
  }
}

export function saveDailyMileageThreshold(miles: number): number {
  const clamped = clampShiftThreshold(miles);
  try {
    window.localStorage.setItem(STORAGE_KEY, String(clamped));
  } catch {
    // Ignore storage errors in restricted browsing contexts
  }
  return clamped;
}

export function evaluateDailyMileageStatus(params: {
  trips: MileageTrip[];
  tripDate: string;
  pendingMiles: number;
  thresholdMiles: number;
}): DailyMileageEvaluation {
  const { trips, tripDate, pendingMiles, thresholdMiles } = params;
  const safeThreshold = clampShiftThreshold(thresholdMiles);
  const safePending = round1(Math.max(0, Number.isFinite(pendingMiles) ? pendingMiles : 0));

  let existingMilesSum = 0;
  let existingTripCount = 0;

  for (const trip of trips) {
    if (trip.tripDate === tripDate) {
      existingMilesSum += trip.billableMiles;
      existingTripCount += 1;
    }
  }

  const existingMiles = round1(existingMilesSum);
  const projectedMiles = round1(existingMiles + safePending);
  const overageMiles = round1(Math.max(0, projectedMiles - safeThreshold));
  const percentOfThreshold = safeThreshold > 0 ? Math.round((projectedMiles / safeThreshold) * 100) : 0;

  let severity: DailyMileageSeverity = 'normal';
  if (projectedMiles > safeThreshold * HIGH_ALERT_RATIO) {
    severity = 'high';
  } else if (projectedMiles > safeThreshold) {
    severity = 'exceeded';
  } else if (projectedMiles >= safeThreshold * APPROACHING_RATIO) {
    severity = 'approaching';
  }

  return {
    tripDate,
    existingMiles,
    existingTripCount,
    pendingMiles: safePending,
    projectedMiles,
    thresholdMiles: safeThreshold,
    overageMiles,
    percentOfThreshold,
    severity,
    exceedsWithExistingOnly: existingMiles > safeThreshold,
  };
}
