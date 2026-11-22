import { round1, round2 } from '../types/mileage';

export type TrafficSeverity = 'clear' | 'moderate' | 'heavy';
export type RoutePriority = 'fastest' | 'balanced' | 'shortest';

export interface SpeedSegmentBreakdown {
  normalPct: number;
  slowPct: number;
  jamPct: number;
}

export interface TrafficRouteOption {
  index: number;
  summary: string;
  oneWayMiles: number;
  distanceMeters: number;
  durationMinutes: number;
  durationMillis: number;
  staticDurationMinutes: number;
  trafficDelayMinutes: number;
  trafficSeverity: TrafficSeverity;
  speedBreakdown: SpeedSegmentBreakdown | null;
  routeLabels: string[];
  isFastest: boolean;
  isShortest: boolean;
  isRecommended: boolean;
  recommendationTag: string;
  timeSavedVsSlowestMin: number;
  extraMinutesVsFastest: number;
  extraMilesVsShortest: number;
  sampledPath: google.maps.LatLngLiteral[];
}

export interface RawRoutesApiRoute {
  description?: string | null;
  distanceMeters?: number;
  durationMillis?: number | null;
  staticDurationMillis?: number | null;
  routeLabels?: string[];
  viewport?: google.maps.LatLngBounds | null;
  speedPaths?: Array<{
    speed?: string | null;
    path?: Array<google.maps.LatLng | google.maps.LatLngAltitude>;
  }>;
  createPolylines: (options?: unknown) => google.maps.Polyline[];
}

const METERS_PER_MILE = 1609.344;

export function samplePolylinesPath(
  polylines: google.maps.Polyline[],
  maxPoints: number = 36
): google.maps.LatLngLiteral[] {
  const allPoints: google.maps.LatLngLiteral[] = [];
  for (const poly of polylines) {
    const path = poly.getPath();
    if (!path) continue;
    const len = path.getLength();
    for (let i = 0; i < len; i += 1) {
      const pt = path.getAt(i);
      allPoints.push({ lat: pt.lat(), lng: pt.lng() });
    }
  }
  if (allPoints.length <= maxPoints) return allPoints;

  const sampled: google.maps.LatLngLiteral[] = [];
  const step = (allPoints.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    sampled.push(allPoints[Math.round(i * step)]);
  }
  return sampled;
}

function computeSpeedBreakdown(
  speedPaths?: RawRoutesApiRoute['speedPaths']
): SpeedSegmentBreakdown | null {
  if (!speedPaths || speedPaths.length === 0) return null;

  let normalCount = 0;
  let slowCount = 0;
  let jamCount = 0;

  for (const sp of speedPaths) {
    const weight = Math.max(1, (sp.path?.length ?? 2) - 1);
    const speed = String(sp.speed ?? '').toUpperCase();
    if (speed === 'TRAFFIC_JAM') {
      jamCount += weight;
    } else if (speed === 'SLOW') {
      slowCount += weight;
    } else {
      normalCount += weight;
    }
  }

  const total = normalCount + slowCount + jamCount;
  if (total === 0) return null;

  const jamPct = Math.round((jamCount / total) * 100);
  const slowPct = Math.round((slowCount / total) * 100);
  const normalPct = Math.max(0, 100 - jamPct - slowPct);

  return { normalPct, slowPct, jamPct };
}

function classifyTrafficSeverity(
  delayMinutes: number,
  staticMinutes: number,
  speedBreakdown: SpeedSegmentBreakdown | null
): TrafficSeverity {
  const delayRatio = staticMinutes > 0 ? delayMinutes / staticMinutes : 0;
  const jamPct = speedBreakdown?.jamPct ?? 0;
  const slowPct = speedBreakdown?.slowPct ?? 0;

  if (delayMinutes >= 8 || delayRatio >= 0.35 || jamPct >= 20) {
    return 'heavy';
  }
  if (delayMinutes >= 3 || delayRatio >= 0.14 || slowPct + jamPct >= 22) {
    return 'moderate';
  }
  return 'clear';
}

/**
 * Evaluates all real-time traffic routes returned by Google Maps Routes API,
 * scores efficiency across traffic-adjusted time and distance, and marks the
 * recommended option according to the active priority mode.
 */
export function evaluateTrafficRoutes(
  rawRoutes: RawRoutesApiRoute[],
  sampledPaths: google.maps.LatLngLiteral[][],
  priority: RoutePriority = 'fastest'
): {
  options: TrafficRouteOption[];
  recommendedIndex: number;
} {
  if (rawRoutes.length === 0) {
    return { options: [], recommendedIndex: 0 };
  }

  const parsed = rawRoutes.map((route, idx) => {
    const distanceMeters = Math.max(0, route.distanceMeters ?? 0);
    const durationMillis = Math.max(0, route.durationMillis ?? 0);
    const staticDurationMillis = Math.max(0, route.staticDurationMillis ?? durationMillis);

    const oneWayMiles = round1(distanceMeters / METERS_PER_MILE);
    const durationMinutes = Math.max(1, Math.round(durationMillis / 60000));
    const staticDurationMinutes = Math.max(1, Math.round(staticDurationMillis / 60000));
    const trafficDelayMinutes = Math.max(0, durationMinutes - staticDurationMinutes);
    const speedBreakdown = computeSpeedBreakdown(route.speedPaths);
    const trafficSeverity = classifyTrafficSeverity(
      trafficDelayMinutes,
      staticDurationMinutes,
      speedBreakdown
    );
    const rawDesc = (route.description ?? '').trim();

    return {
      index: idx,
      summary: rawDesc ? `via ${rawDesc}` : `Route Option ${idx + 1}`,
      oneWayMiles,
      distanceMeters,
      durationMinutes,
      durationMillis,
      staticDurationMinutes,
      trafficDelayMinutes,
      trafficSeverity,
      speedBreakdown,
      routeLabels: route.routeLabels ?? [],
      sampledPath: sampledPaths[idx] ?? [],
    };
  });

  const minDurationMillis = Math.min(...parsed.map((r) => r.durationMillis));
  const maxDurationMinutes = Math.max(...parsed.map((r) => r.durationMinutes));
  const minDistanceMeters = Math.min(...parsed.map((r) => r.distanceMeters));
  const fastestMinutes = Math.min(...parsed.map((r) => r.durationMinutes));
  const shortestMiles = Math.min(...parsed.map((r) => r.oneWayMiles));

  // Score each route according to chosen efficiency priority
  const scores = parsed.map((r) => {
    const timeRatio = minDurationMillis > 0 ? r.durationMillis / minDurationMillis : 1;
    const distRatio = minDistanceMeters > 0 ? r.distanceMeters / minDistanceMeters : 1;
    if (priority === 'shortest') {
      return distRatio * 0.8 + timeRatio * 0.2;
    }
    if (priority === 'balanced') {
      return timeRatio * 0.6 + distRatio * 0.4;
    }
    // 'fastest': prioritize real-time traffic ETA first, break ties by shorter distance
    return timeRatio * 0.92 + distRatio * 0.08;
  });

  let recommendedIndex = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  scores.forEach((score, idx) => {
    if (score < bestScore) {
      bestScore = score;
      recommendedIndex = idx;
    }
  });

  const options: TrafficRouteOption[] = parsed.map((r, idx) => {
    const isFastest = r.durationMillis === minDurationMillis;
    const isShortest = r.distanceMeters === minDistanceMeters;
    const isRecommended = idx === recommendedIndex;
    const timeSavedVsSlowestMin = Math.max(0, maxDurationMinutes - r.durationMinutes);
    const extraMinutesVsFastest = Math.max(0, r.durationMinutes - fastestMinutes);
    const extraMilesVsShortest = round1(Math.max(0, r.oneWayMiles - shortestMiles));

    let recommendationTag = 'Alternative';
    if (isRecommended && isFastest && isShortest) {
      recommendationTag = 'Most Efficient';
    } else if (isRecommended && priority === 'shortest') {
      recommendationTag = 'Shortest Route';
    } else if (isRecommended && priority === 'balanced') {
      recommendationTag = 'Best Balance';
    } else if (isRecommended) {
      recommendationTag = 'Fastest in Traffic';
    } else if (isFastest) {
      recommendationTag = 'Fastest ETA';
    } else if (isShortest) {
      recommendationTag = 'Shortest Miles';
    } else if (r.routeLabels.includes('FUEL_EFFICIENT')) {
      recommendationTag = 'Fuel Efficient';
    }

    return {
      ...r,
      isFastest,
      isShortest,
      isRecommended,
      recommendationTag,
      timeSavedVsSlowestMin,
      extraMinutesVsFastest,
      extraMilesVsShortest,
    };
  });

  return { options, recommendedIndex };
}

export function estimateRouteReimbursement(oneWayMiles: number, ratePerMile: number): number {
  return round2(oneWayMiles * ratePerMile);
}
