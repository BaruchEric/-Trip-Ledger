import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildSimulatedDriveSamples,
  computeSampleSpeedMph,
  loadAutoDriveSettings,
  loadSessionDetectedDrives,
  MAX_ACCEPTABLE_ACCURACY_METERS,
  MPS_TO_MPH,
  PARKED_SPEED_THRESHOLD_MPH,
  saveAutoDriveSettings,
  saveSessionDetectedDrives,
  type AutoDrivePhase,
  type AutoDriveSettings,
  type DetectedDrive,
  type MotionSample,
} from '../lib/driveDetection';
import { generateDocId, round1, type StoreLocation } from '../types/mileage';
import type { GpsPoint } from './useLiveGpsTracker';

export interface UseAutoDriveDetectorReturn {
  phase: AutoDrivePhase;
  isEnabled: boolean;
  isSimulating: boolean;
  settings: AutoDriveSettings;
  currentSpeedMph: number;
  gpsAccuracyMeters: number | null;
  activeMiles: number;
  activeElapsedSeconds: number;
  parkedCountdownSeconds: number | null;
  activePoints: GpsPoint[];
  detectedDrives: DetectedDrive[];
  detectorError: string | null;
  enableAutoDetect: () => void;
  disableAutoDetect: () => void;
  toggleAutoDetect: () => void;
  updateSettings: (patch: Partial<AutoDriveSettings>) => void;
  finishActiveDriveNow: () => DetectedDrive | null;
  discardActiveDrive: () => void;
  removeDetectedDrive: (driveId: string) => void;
  clearDetectedDrives: () => void;
  runSimulatedDrive: (fromStore: StoreLocation, toStore: StoreLocation) => void;
  stopSimulatedDrive: () => void;
}

/**
 * Explicit user-consented Automated Driving Detection hook.
 * Strictly OFF by default — only starts navigator.geolocation.watchPosition
 * when the user explicitly toggles Auto-Detect Drives ON, and releases GPS
 * immediately when toggled OFF.
 */
export function useAutoDriveDetector(): UseAutoDriveDetectorReturn {
  const [phase, setPhase] = useState<AutoDrivePhase>('off');
  const [isSimulating, setIsSimulating] = useState(false);
  const [settings, setSettings] = useState<AutoDriveSettings>(() => loadAutoDriveSettings());
  const [currentSpeedMph, setCurrentSpeedMph] = useState(0);
  const [gpsAccuracyMeters, setGpsAccuracyMeters] = useState<number | null>(null);
  const [activeMiles, setActiveMiles] = useState(0);
  const [activeElapsedSeconds, setActiveElapsedSeconds] = useState(0);
  const [parkedCountdownSeconds, setParkedCountdownSeconds] = useState<number | null>(null);
  const [activePoints, setActivePoints] = useState<GpsPoint[]>([]);
  const [detectedDrives, setDetectedDrives] = useState<DetectedDrive[]>(() =>
    loadSessionDetectedDrives()
  );
  const [detectorError, setDetectorError] = useState<string | null>(null);

  const settingsRef = useRef<AutoDriveSettings>(settings);
  settingsRef.current = settings;

  const phaseRef = useRef<AutoDrivePhase>(phase);
  phaseRef.current = phase;

  const watchIdRef = useRef<number | null>(null);
  const simTimersRef = useRef<number[]>([]);
  const isSimulatingRef = useRef(false);

  const lastSampleRef = useRef<MotionSample | null>(null);
  const preTriggerBufferRef = useRef<GpsPoint[]>([]);
  const consecutiveDrivingTicksRef = useRef<number>(0);

  const driveStartTimeRef = useRef<number | null>(null);
  const drivePointsRef = useRef<GpsPoint[]>([]);
  const driveMilesRef = useRef<number>(0);
  const driveMaxSpeedRef = useRef<number>(0);
  const parkedSinceRef = useRef<number | null>(null);

  // Persist detected drives within current browser session only
  useEffect(() => {
    saveSessionDetectedDrives(detectedDrives);
  }, [detectedDrives]);

  const clearSimTimers = useCallback(() => {
    for (const id of simTimersRef.current) {
      window.clearTimeout(id);
    }
    simTimersRef.current = [];
    isSimulatingRef.current = false;
    setIsSimulating(false);
  }, []);

  const clearWatcher = useCallback(() => {
    if (watchIdRef.current !== null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const resetActiveDriveBuffers = useCallback(() => {
    driveStartTimeRef.current = null;
    drivePointsRef.current = [];
    driveMilesRef.current = 0;
    driveMaxSpeedRef.current = 0;
    parkedSinceRef.current = null;
    consecutiveDrivingTicksRef.current = 0;
    setActiveMiles(0);
    setActiveElapsedSeconds(0);
    setParkedCountdownSeconds(null);
    setActivePoints([]);
  }, []);

  const finalizeActiveDrive = useCallback(
    (forceInclude = false, simulated = false): DetectedDrive | null => {
      const pts = drivePointsRef.current;
      const miles = round1(driveMilesRef.current);
      const startedAt = driveStartTimeRef.current ?? pts[0]?.timestamp ?? Date.now();
      const endedAt = Date.now();
      const durationMinutes = Math.max(1, Math.round((endedAt - startedAt) / 60000));
      const maxSpeed = round1(driveMaxSpeedRef.current);

      const meetsMinDistance = forceInclude
        ? pts.length >= 2 && miles >= 0.1
        : pts.length >= 2 && miles >= settingsRef.current.minTripMiles;

      let created: DetectedDrive | null = null;
      if (meetsMinDistance) {
        created = {
          id: generateDocId('autdrv'),
          startedAt,
          endedAt,
          startPoint: pts[0],
          endPoint: pts[pts.length - 1],
          milesDriven: miles,
          durationMinutes: simulated ? Math.max(durationMinutes, Math.max(4, Math.round(miles * 2.4))) : durationMinutes,
          maxSpeedMph: maxSpeed,
          points: pts,
          isSimulated: simulated,
        };
        setDetectedDrives((prev) => [created!, ...prev].slice(0, 12));
      }

      resetActiveDriveBuffers();
      if (phaseRef.current !== 'off') {
        phaseRef.current = 'monitoring';
        setPhase('monitoring');
      }
      return created;
    },
    [resetActiveDriveBuffers]
  );

  const ingestSample = useCallback(
    (sample: MotionSample, simulated = false) => {
      if (phaseRef.current === 'off') return;

      setGpsAccuracyMeters(Math.round(sample.accuracyMeters));

      // Ignore noisy readings once we have an initial lock
      if (
        lastSampleRef.current !== null &&
        sample.accuracyMeters > MAX_ACCEPTABLE_ACCURACY_METERS
      ) {
        return;
      }

      const { speedMph, deltaMiles, isSpike } = computeSampleSpeedMph(
        lastSampleRef.current,
        sample
      );
      if (isSpike) return;

      lastSampleRef.current = sample;
      setCurrentSpeedMph(speedMph);

      const gpsPoint: GpsPoint = {
        lat: sample.lat,
        lng: sample.lng,
        timestamp: sample.timestamp,
      };

      const { startSpeedMph } = settingsRef.current;

      if (phaseRef.current === 'monitoring') {
        // Keep a rolling departure buffer so the true start location isn't lost
        preTriggerBufferRef.current = [...preTriggerBufferRef.current.slice(-4), gpsPoint];

        if (speedMph >= startSpeedMph) {
          consecutiveDrivingTicksRef.current += 1;
        } else {
          consecutiveDrivingTicksRef.current = 0;
        }

        // Confirm sustained driving (2 consecutive ticks, or clear highway/arterial speed >= startSpeed + 6)
        const confirmedDriving =
          consecutiveDrivingTicksRef.current >= 2 || speedMph >= startSpeedMph + 6;

        if (confirmedDriving) {
          const buffered = preTriggerBufferRef.current;
          const initialPoints = buffered.length > 0 ? buffered : [gpsPoint];
          let initialMiles = 0;
          for (let i = 1; i < initialPoints.length; i++) {
            const seg = Math.max(
              0,
              computeSampleSpeedMph(
                { ...initialPoints[i - 1], accuracyMeters: 10, speedMph: null },
                { ...initialPoints[i], accuracyMeters: 10, speedMph: null }
              ).deltaMiles
            );
            if (seg >= 0.01) initialMiles += seg;
          }

          driveStartTimeRef.current = initialPoints[0].timestamp;
          drivePointsRef.current = initialPoints;
          driveMilesRef.current = round1(initialMiles);
          driveMaxSpeedRef.current = speedMph;
          parkedSinceRef.current = null;
          preTriggerBufferRef.current = [];

          phaseRef.current = 'driving';
          setPhase('driving');
          setActivePoints(initialPoints);
          setActiveMiles(driveMilesRef.current);
          setActiveElapsedSeconds(
            Math.max(0, Math.floor((Date.now() - driveStartTimeRef.current) / 1000))
          );
          setParkedCountdownSeconds(null);
        }
        return;
      }

      // Currently in 'driving' or 'parked_cooldown'
      if (deltaMiles >= 0.01) {
        driveMilesRef.current = round1(driveMilesRef.current + deltaMiles);
        drivePointsRef.current = [...drivePointsRef.current, gpsPoint];
        setActiveMiles(driveMilesRef.current);
        setActivePoints(drivePointsRef.current);
      }

      if (speedMph > driveMaxSpeedRef.current) {
        driveMaxSpeedRef.current = speedMph;
      }

      if (speedMph >= PARKED_SPEED_THRESHOLD_MPH) {
        // Vehicle is moving again (e.g., green light or LA traffic clearing)
        parkedSinceRef.current = null;
        if (phaseRef.current !== 'driving') {
          phaseRef.current = 'driving';
          setPhase('driving');
          setParkedCountdownSeconds(null);
        }
      } else {
        // Vehicle stopped / parked
        if (phaseRef.current === 'driving') {
          parkedSinceRef.current = Date.now();
          phaseRef.current = 'parked_cooldown';
          setPhase('parked_cooldown');
          const cooldown = simulated ? 2 : settingsRef.current.stopCooldownSeconds;
          setParkedCountdownSeconds(cooldown);
        }
      }
    },
    []
  );

  // 1-second ticker for active drive elapsed time and automatic stop-cooldown finalization
  useEffect(() => {
    if (phase !== 'driving' && phase !== 'parked_cooldown') return;

    const timer = window.setInterval(() => {
      if (driveStartTimeRef.current) {
        setActiveElapsedSeconds(Math.max(0, Math.floor((Date.now() - driveStartTimeRef.current) / 1000)));
      }

      if (phaseRef.current === 'parked_cooldown' && parkedSinceRef.current) {
        const targetCooldown = isSimulatingRef.current
          ? 2
          : settingsRef.current.stopCooldownSeconds;
        const elapsedParked = Math.floor((Date.now() - parkedSinceRef.current) / 1000);
        const remaining = Math.max(0, targetCooldown - elapsedParked);
        setParkedCountdownSeconds(remaining);

        if (remaining <= 0) {
          const wasSim = isSimulatingRef.current;
          if (wasSim) {
            clearSimTimers();
          }
          finalizeActiveDrive(false, wasSim);
        }
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [phase, finalizeActiveDrive, clearSimTimers]);

  const startLiveWatcher = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setDetectorError('Geolocation is not supported in this browser.');
      return false;
    }

    clearWatcher();
    setDetectorError(null);
    lastSampleRef.current = null;
    preTriggerBufferRef.current = [];
    consecutiveDrivingTicksRef.current = 0;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        if (isSimulatingRef.current) return;
        const rawSpeed = position.coords.speed;
        const speedMph =
          typeof rawSpeed === 'number' && Number.isFinite(rawSpeed) && rawSpeed >= 0
            ? rawSpeed * MPS_TO_MPH
            : null;

        ingestSample({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          timestamp: position.timestamp || Date.now(),
          accuracyMeters: position.coords.accuracy ?? 25,
          speedMph,
        });
      },
      (err) => {
        if (isSimulatingRef.current) return;
        console.error('Auto-drive geolocation error:', err);
        setDetectorError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied. Allow browser location access to enable automated driving detection.'
            : 'Waiting for a clearer GPS signal. Auto-detection stays on standby until lock resumes.'
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2500,
        timeout: 15000,
      }
    );

    return true;
  }, [clearWatcher, ingestSample]);

  const enableAutoDetect = useCallback(() => {
    clearSimTimers();
    resetActiveDriveBuffers();
    phaseRef.current = 'monitoring';
    setPhase('monitoring');
    setCurrentSpeedMph(0);
    setGpsAccuracyMeters(null);
    const started = startLiveWatcher();
    if (!started) {
      phaseRef.current = 'off';
      setPhase('off');
    }
  }, [clearSimTimers, resetActiveDriveBuffers, startLiveWatcher]);

  const disableAutoDetect = useCallback(() => {
    clearSimTimers();
    clearWatcher();
    resetActiveDriveBuffers();
    lastSampleRef.current = null;
    preTriggerBufferRef.current = [];
    setCurrentSpeedMph(0);
    setGpsAccuracyMeters(null);
    setDetectorError(null);
    phaseRef.current = 'off';
    setPhase('off');
  }, [clearSimTimers, clearWatcher, resetActiveDriveBuffers]);

  const toggleAutoDetect = useCallback(() => {
    if (phaseRef.current === 'off') {
      enableAutoDetect();
    } else {
      disableAutoDetect();
    }
  }, [enableAutoDetect, disableAutoDetect]);

  const updateSettings = useCallback((patch: Partial<AutoDriveSettings>) => {
    setSettings((prev) => {
      const next: AutoDriveSettings = { ...prev, ...patch };
      saveAutoDriveSettings(next);
      return next;
    });
  }, []);

  const finishActiveDriveNow = useCallback((): DetectedDrive | null => {
    const wasSim = isSimulatingRef.current;
    if (wasSim) clearSimTimers();
    return finalizeActiveDrive(true, wasSim);
  }, [clearSimTimers, finalizeActiveDrive]);

  const discardActiveDrive = useCallback(() => {
    if (isSimulatingRef.current) clearSimTimers();
    resetActiveDriveBuffers();
    if (phaseRef.current !== 'off') {
      phaseRef.current = 'monitoring';
      setPhase('monitoring');
    }
  }, [clearSimTimers, resetActiveDriveBuffers]);

  const removeDetectedDrive = useCallback((driveId: string) => {
    setDetectedDrives((prev) => prev.filter((d) => d.id !== driveId));
  }, []);

  const clearDetectedDrives = useCallback(() => {
    setDetectedDrives([]);
  }, []);

  const stopSimulatedDrive = useCallback(() => {
    clearSimTimers();
    resetActiveDriveBuffers();
    setCurrentSpeedMph(0);
    if (phaseRef.current !== 'off') {
      phaseRef.current = 'monitoring';
      setPhase('monitoring');
    }
  }, [clearSimTimers, resetActiveDriveBuffers]);

  const runSimulatedDrive = useCallback(
    (fromStore: StoreLocation, toStore: StoreLocation) => {
      clearSimTimers();
      resetActiveDriveBuffers();
      setDetectorError(null);

      // Ensure detector is active in monitoring mode (without forcing browser GPS permission during desktop preview)
      if (phaseRef.current === 'off') {
        phaseRef.current = 'monitoring';
        setPhase('monitoring');
      }

      isSimulatingRef.current = true;
      setIsSimulating(true);
      lastSampleRef.current = null;
      preTriggerBufferRef.current = [];

      const samples = buildSimulatedDriveSamples(fromStore, toStore);
      let cumulativeDelay = 0;

      samples.forEach((step) => {
        cumulativeDelay += step.stepDelayMs;
        const timerId = window.setTimeout(() => {
          if (!isSimulatingRef.current) return;
          ingestSample(
            {
              lat: step.lat,
              lng: step.lng,
              timestamp: Date.now(),
              accuracyMeters: step.accuracyMeters,
              speedMph: step.speedMph,
            },
            true
          );
        }, cumulativeDelay);
        simTimersRef.current.push(timerId);
      });
    },
    [clearSimTimers, resetActiveDriveBuffers, ingestSample]
  );

  // Release GPS & timers cleanly on unmount
  useEffect(() => {
    return () => {
      clearSimTimers();
      clearWatcher();
    };
  }, [clearSimTimers, clearWatcher]);

  return {
    phase,
    isEnabled: phase !== 'off',
    isSimulating,
    settings,
    currentSpeedMph,
    gpsAccuracyMeters,
    activeMiles,
    activeElapsedSeconds,
    parkedCountdownSeconds,
    activePoints,
    detectedDrives,
    detectorError,
    enableAutoDetect,
    disableAutoDetect,
    toggleAutoDetect,
    updateSettings,
    finishActiveDriveNow,
    discardActiveDrive,
    removeDetectedDrive,
    clearDetectedDrives,
    runSimulatedDrive,
    stopSimulatedDrive,
  };
}
