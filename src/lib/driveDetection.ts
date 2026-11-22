import { haversineMiles, round1, type StoreLocation } from '../types/mileage';

export type AutoDrivePhase = 'off' | 'monitoring' | 'driving' | 'parked_cooldown';

export interface AutoDriveSettings {
  startSpeedMph: number;
  stopCooldownSeconds: number;
  minTripMiles: number;
}

export interface MotionSample {
  lat: number;
  lng: number;
  timestamp: number;
  accuracyMeters: number;
  speedMph: number | null;
}

export interface DetectedDrive {
  id: string;
  startedAt: number;
  endedAt: number;
  startPoint: { lat: number; lng: number; timestamp: number };
  endPoint: { lat: number; lng: number; timestamp: number };
  milesDriven: number;
  durationMinutes: number;
  maxSpeedMph: number;
  points: Array<{ lat: number; lng: number; timestamp: number }>;
  isSimulated?: boolean;
}

export const DEFAULT_AUTO_DRIVE_SETTINGS: AutoDriveSettings = {
  startSpeedMph: 12,
  stopCooldownSeconds: 120,
  minTripMiles: 0.3,
};

export const START_SPEED_PRESETS = [8, 12, 18] as const;
export const STOP_COOLDOWN_PRESETS = [
  { seconds: 30, label: '30s' },
  { seconds: 60, label: '1m' },
  { seconds: 120, label: '2m' },
  { seconds: 180, label: '3m' },
] as const;
export const MIN_TRIP_MILES_PRESETS = [0.2, 0.3, 0.5] as const;

const SETTINGS_STORAGE_KEY = 'curacao_auto_drive_settings_v1';
const PENDING_DRIVES_SESSION_KEY = 'curacao_detected_drives_session_v1';

export const MPS_TO_MPH = 2.23693629;
export const MAX_PLAUSIBLE_SPEED_MPH = 110;
export const MAX_ACCEPTABLE_ACCURACY_METERS = 100;
export const PARKED_SPEED_THRESHOLD_MPH = 3.5;

export function loadAutoDriveSettings(): AutoDriveSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_AUTO_DRIVE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AutoDriveSettings>;
    return {
      startSpeedMph:
        typeof parsed.startSpeedMph === 'number' &&
        parsed.startSpeedMph >= 5 &&
        parsed.startSpeedMph <= 40
          ? parsed.startSpeedMph
          : DEFAULT_AUTO_DRIVE_SETTINGS.startSpeedMph,
      stopCooldownSeconds:
        typeof parsed.stopCooldownSeconds === 'number' &&
        parsed.stopCooldownSeconds >= 15 &&
        parsed.stopCooldownSeconds <= 600
          ? parsed.stopCooldownSeconds
          : DEFAULT_AUTO_DRIVE_SETTINGS.stopCooldownSeconds,
      minTripMiles:
        typeof parsed.minTripMiles === 'number' &&
        parsed.minTripMiles >= 0.1 &&
        parsed.minTripMiles <= 5
          ? parsed.minTripMiles
          : DEFAULT_AUTO_DRIVE_SETTINGS.minTripMiles,
    };
  } catch {
    return DEFAULT_AUTO_DRIVE_SETTINGS;
  }
}

export function saveAutoDriveSettings(settings: AutoDriveSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadSessionDetectedDrives(): DetectedDrive[] {
  try {
    const raw = window.sessionStorage.getItem(PENDING_DRIVES_SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DetectedDrive[]) : [];
  } catch {
    return [];
  }
}

export function saveSessionDetectedDrives(drives: DetectedDrive[]): void {
  try {
    window.sessionStorage.setItem(PENDING_DRIVES_SESSION_KEY, JSON.stringify(drives.slice(0, 12)));
  } catch {
    // Ignore sessionStorage errors
  }
}

/**
 * Computes vehicle speed in mph using hardware GPS velocity when present,
 * falling back to Haversine displacement over elapsed time.
 */
export function computeSampleSpeedMph(
  prev: MotionSample | null,
  curr: MotionSample
): { speedMph: number; deltaMiles: number; isSpike: boolean } {
  const deltaMiles = prev ? haversineMiles(prev.lat, prev.lng, curr.lat, curr.lng) : 0;

  let computedMph = 0;
  if (typeof curr.speedMph === 'number' && Number.isFinite(curr.speedMph) && curr.speedMph >= 0) {
    computedMph = curr.speedMph;
  } else if (prev && curr.timestamp > prev.timestamp) {
    const deltaHours = (curr.timestamp - prev.timestamp) / 3600000;
    if (deltaHours > 0) {
      computedMph = deltaMiles / deltaHours;
    }
  }

  // Reject impossible GPS teleport jumps
  const isSpike = computedMph > MAX_PLAUSIBLE_SPEED_MPH;
  return {
    speedMph: isSpike ? 0 : round1(computedMph),
    deltaMiles: isSpike ? 0 : deltaMiles,
    isSpike,
  };
}

/**
 * Generates realistic GPS motion samples between two dynamically discovered
 * Curacao store locations so users can preview the automated driving state
 * machine (Monitoring -> Driving -> Parked Cooldown -> Auto-Captured) from a desk.
 */
export function buildSimulatedDriveSamples(
  fromStore: StoreLocation,
  toStore: StoreLocation
): Array<{ lat: number; lng: number; speedMph: number; accuracyMeters: number; stepDelayMs: number }> {
  const totalSteps = 12;
  const samples: Array<{
    lat: number;
    lng: number;
    speedMph: number;
    accuracyMeters: number;
    stepDelayMs: number;
  }> = [];

  // Subtle curved arc offset so the simulated GPS trail looks like a real road corridor
  const midOffsetLat = (toStore.lng - fromStore.lng) * 0.06;
  const midOffsetLng = -(toStore.lat - fromStore.lat) * 0.06;

  for (let i = 0; i <= totalSteps; i++) {
    const t = i / totalSteps;
    const curve = Math.sin(Math.PI * t);
    const lat = fromStore.lat + (toStore.lat - fromStore.lat) * t + midOffsetLat * curve;
    const lng = fromStore.lng + (toStore.lng - fromStore.lng) * t + midOffsetLng * curve;

    // Realistic speed envelope: parked -> accelerating -> cruising -> slowing -> parked
    let speedMph = 0;
    if (i === 0) speedMph = 1.5;
    else if (i === 1) speedMph = 14.5;
    else if (i === 2) speedMph = 24.0;
    else if (i >= 3 && i <= 8) speedMph = 31 + ((i % 3) * 4.5);
    else if (i === 9) speedMph = 18.5;
    else if (i === 10) speedMph = 6.5;
    else speedMph = 0.4;

    samples.push({
      lat,
      lng,
      speedMph: round1(speedMph),
      accuracyMeters: 10,
      stepDelayMs: i === 0 ? 150 : 520,
    });
  }

  // Add one extra stationary sample at destination to trigger parked cooldown
  samples.push({
    lat: toStore.lat,
    lng: toStore.lng,
    speedMph: 0,
    accuracyMeters: 9,
    stepDelayMs: 650,
  });

  return samples;
}
