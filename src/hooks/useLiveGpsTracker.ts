import { useCallback, useEffect, useRef, useState } from 'react';
import { haversineMiles, round1 } from '../types/mileage';

export interface GpsPoint {
  lat: number;
  lng: number;
  timestamp: number;
}

export interface FinishedGpsDrive {
  startPoint: GpsPoint;
  endPoint: GpsPoint;
  milesDriven: number;
  durationMinutes: number;
  points: GpsPoint[];
}

export interface UseLiveGpsTrackerReturn {
  isTracking: boolean;
  points: GpsPoint[];
  milesDriven: number;
  elapsedSeconds: number;
  gpsError: string | null;
  startTracking: () => void;
  stopTracking: () => FinishedGpsDrive | null;
  cancelTracking: () => void;
}

/**
 * Explicit user-consented live GPS drive tracker.
 * Only accesses navigator.geolocation when the employee clicks Start Drive.
 */
export function useLiveGpsTracker(): UseLiveGpsTrackerReturn {
  const [isTracking, setIsTracking] = useState(false);
  const [points, setPoints] = useState<GpsPoint[]>([]);
  const [milesDriven, setMilesDriven] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const pointsRef = useRef<GpsPoint[]>([]);
  const milesRef = useRef<number>(0);

  useEffect(() => {
    if (!isTracking) return;
    const interval = window.setInterval(() => {
      if (startTimeRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isTracking]);

  const clearWatcher = useCallback(() => {
    if (watchIdRef.current !== null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearWatcher();
  }, [clearWatcher]);

  const startTracking = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGpsError('Geolocation is not supported in this browser.');
      return;
    }

    clearWatcher();
    setGpsError(null);
    pointsRef.current = [];
    milesRef.current = 0;
    startTimeRef.current = Date.now();
    setPoints([]);
    setMilesDriven(0);
    setElapsedSeconds(0);
    setIsTracking(true);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        // Filter out wildly inaccurate readings when we already have a lock
        if (pointsRef.current.length > 0 && accuracy > 120) {
          return;
        }

        const nextPoint: GpsPoint = {
          lat: latitude,
          lng: longitude,
          timestamp: position.timestamp || Date.now(),
        };

        const prev = pointsRef.current[pointsRef.current.length - 1];
        if (!prev) {
          pointsRef.current = [nextPoint];
          setPoints([nextPoint]);
          return;
        }

        const deltaMiles = haversineMiles(prev.lat, prev.lng, nextPoint.lat, nextPoint.lng);
        // Ignore sub-50ft GPS jitter while parked
        if (deltaMiles < 0.01) return;

        milesRef.current = round1(milesRef.current + deltaMiles);
        pointsRef.current = [...pointsRef.current, nextPoint];
        setMilesDriven(milesRef.current);
        setPoints(pointsRef.current);
      },
      (err) => {
        console.error('Geolocation watchPosition error:', err);
        setGpsError(
          err.code === err.PERMISSION_DENIED
            ? 'Location access was denied. Enable browser location permissions to record live drives.'
            : 'Unable to read GPS signal. You can still calculate exact route mileage automatically.'
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 15000,
      }
    );
  }, [clearWatcher]);

  const stopTracking = useCallback((): FinishedGpsDrive | null => {
    clearWatcher();
    setIsTracking(false);

    const captured = pointsRef.current;
    const elapsedMins = startTimeRef.current
      ? Math.max(1, Math.round((Date.now() - startTimeRef.current) / 60000))
      : 0;

    if (captured.length === 0) {
      return null;
    }

    return {
      startPoint: captured[0],
      endPoint: captured[captured.length - 1],
      milesDriven: milesRef.current,
      durationMinutes: elapsedMins,
      points: captured,
    };
  }, [clearWatcher]);

  const cancelTracking = useCallback(() => {
    clearWatcher();
    setIsTracking(false);
    pointsRef.current = [];
    milesRef.current = 0;
    startTimeRef.current = null;
    setPoints([]);
    setMilesDriven(0);
    setElapsedSeconds(0);
    setGpsError(null);
  }, [clearWatcher]);

  return {
    isTracking,
    points,
    milesDriven,
    elapsedSeconds,
    gpsError,
    startTracking,
    stopTracking,
    cancelTracking,
  };
}
