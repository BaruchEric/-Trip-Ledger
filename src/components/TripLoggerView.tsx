import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  Bookmark,
  Check,
  Plus,
  Receipt,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import type { UseAutoDriveDetectorReturn } from '../hooks/useAutoDriveDetector';
import type { UseLiveGpsTrackerReturn } from '../hooks/useLiveGpsTracker';
import {
  DEFAULT_SHIFT_COMMUTE_THRESHOLD_MILES,
  evaluateDailyMileageStatus,
  loadDailyMileageThreshold,
  MAX_SHIFT_THRESHOLD_MILES,
  MIN_SHIFT_THRESHOLD_MILES,
  saveDailyMileageThreshold,
  THRESHOLD_PRESETS,
} from '../lib/dailyMileageThreshold';
import { suggestTripPurpose } from '../lib/purposeSuggestion';
import { useI18n } from '../lib/i18n';
import {
  calculateBillableMiles,
  calculateReimbursement,
  DEFAULT_RATE_PER_MILE,
  FIELD_LIMITS,
  formatCurrency,
  formatDateISO,
  round1,
  TRIP_PURPOSES,
  type CaptureMethod,
  type MileageTrip,
  type PlaceSelection,
  type RouteTemplate,
  type StoreLocation,
  type TripExpense,
  type TripPurpose,
  type UserProfile,
} from '../types/mileage';
import {
  DetectedDrivesInbox,
  DriveTrackingHeader,
  type ResolvedDetectedDrive,
} from './AutoDrivePanel';
import { CommuteSavingsCard } from './CommuteSavingsCard';
import { LocationPickerInput } from './LocationPickerInput';
import { RouteMapPanel, type ComputedRouteMetrics } from './RouteMapPanel';
import { StaticRouteThumbnail } from './StaticRouteThumbnail';

export interface NewTripInput {
  tripDate: string;
  originName: string;
  originAddress: string;
  originPlaceId: string;
  destinationName: string;
  destinationAddress: string;
  destinationPlaceId: string;
  purpose: TripPurpose;
  notes: string;
  oneWayMiles: number;
  commuteDeductionMiles: number;
  billableMiles: number;
  durationMinutes: number;
  isRoundTrip: boolean;
  captureMethod: CaptureMethod;
  ratePerMile: number;
  reimbursementAmount: number;
}

export interface NewTemplateInput {
  label: string;
  originName: string;
  originAddress: string;
  originPlaceId: string;
  destinationName: string;
  destinationAddress: string;
  destinationPlaceId: string;
  purpose: TripPurpose;
  oneWayMiles: number;
  durationMinutes: number;
  isRoundTrip: boolean;
}

interface TripLoggerViewProps {
  isAuthenticated: boolean;
  onRequestSignIn: () => void;
  profile: UserProfile | null;
  stores: StoreLocation[];
  storesLoading: boolean;
  storesError?: string | null;
  biasCenter?: google.maps.LatLngLiteral | null;
  onManageLocations?: () => void;
  pendingPlacePick?: {
    role: 'origin' | 'destination';
    place: PlaceSelection;
    nonce: number;
  } | null;
  findNearestStore: (
    lat: number,
    lng: number,
    maxMiles?: number
  ) => { store: StoreLocation; distanceMiles: number } | null;
  templates: RouteTemplate[];
  trips: MileageTrip[];
  expenses: TripExpense[];
  gpsTracker: UseLiveGpsTrackerReturn;
  autoDetector: UseAutoDriveDetectorReturn;
  onLogTrip: (trip: NewTripInput) => Promise<void>;
  onSaveTemplate: (template: NewTemplateInput) => Promise<void>;
  onDeleteTemplate: (templateId: string) => Promise<void>;
  onOpenQuickExpense: () => void;
  onDeleteExpense: (expenseId: string) => Promise<void>;
  isDark?: boolean;
}

export function TripLoggerView({
  isAuthenticated,
  onRequestSignIn,
  profile,
  stores,
  storesLoading,
  storesError,
  biasCenter,
  onManageLocations,
  pendingPlacePick,
  findNearestStore,
  templates,
  trips,
  expenses,
  gpsTracker,
  autoDetector,
  onLogTrip,
  onSaveTemplate,
  onDeleteTemplate,
  onOpenQuickExpense,
  onDeleteExpense,
  isDark = false,
}: TripLoggerViewProps) {
  const { t, tPurpose, tExpenseCategory, formatLocalizedDate } = useI18n();
  const [tripDate, setTripDate] = useState(formatDateISO());
  const [origin, setOrigin] = useState<PlaceSelection | null>(null);
  const [destination, setDestination] = useState<PlaceSelection | null>(null);
  const [purpose, setPurpose] = useState<TripPurpose>('Inter-Store Transfer');
  const [purposeTouchedManually, setPurposeTouchedManually] = useState(false);
  const [isRoundTrip, setIsRoundTrip] = useState(false);
  const [applyCommuteDeduction, setApplyCommuteDeduction] = useState(false);
  const [oneWayMiles, setOneWayMiles] = useState<number>(0);
  const [durationMinutes, setDurationMinutes] = useState<number>(0);
  const [routePath, setRoutePath] = useState<google.maps.LatLngLiteral[] | undefined>(undefined);
  const [activeRouteMeta, setActiveRouteMeta] = useState<{
    summary?: string;
    trafficDelayMinutes?: number;
    trafficSeverity?: 'clear' | 'moderate' | 'heavy';
  } | null>(null);
  const [manualOverride, setManualOverride] = useState(false);
  const [captureMethod, setCaptureMethod] = useState<CaptureMethod>('route_auto');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [hasPrefilledHome, setHasPrefilledHome] = useState(false);
  const [dailyThresholdMiles, setDailyThresholdMiles] = useState<number>(() =>
    loadDailyMileageThreshold()
  );
  const [showThresholdEditor, setShowThresholdEditor] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState<string>(() =>
    String(loadDailyMileageThreshold())
  );

  const ratePerMile = profile?.ratePerMile ?? DEFAULT_RATE_PER_MILE;
  const normalCommuteMiles = profile?.normalCommuteMiles ?? 0;

  // Auto-fill Primary / Home Location as default Origin once profile or saved locations load
  useEffect(() => {
    if (hasPrefilledHome || origin) return;
    if (profile?.homeStoreName) {
      const matched = stores.find(
        (s) => profile.homeStorePlaceId && s.placeId === profile.homeStorePlaceId
      );
      const hasCoords = matched && matched.hasCoordinates !== false;
      setOrigin({
        name: profile.homeStoreName,
        address: profile.homeStoreAddress,
        placeId: profile.homeStorePlaceId,
        lat: hasCoords ? matched.lat : undefined,
        lng: hasCoords ? matched.lng : undefined,
      });
      setHasPrefilledHome(true);
      return;
    }
    const homeLoc = stores.find((s) => s.isHome);
    if (homeLoc) {
      const hasCoords = homeLoc.hasCoordinates !== false;
      setOrigin({
        name: homeLoc.shortName,
        address: homeLoc.address,
        placeId: homeLoc.placeId,
        lat: hasCoords ? homeLoc.lat : undefined,
        lng: hasCoords ? homeLoc.lng : undefined,
      });
      setHasPrefilledHome(true);
    }
  }, [hasPrefilledHome, origin, profile, stores]);

  // Apply origin/destination quick-pick dispatched from Saved Locations view
  useEffect(() => {
    if (!pendingPlacePick) return;
    if (pendingPlacePick.role === 'origin') {
      setOrigin(pendingPlacePick.place);
    } else {
      setDestination(pendingPlacePick.place);
    }
    setRoutePath(undefined);
    setActiveRouteMeta(null);
    setManualOverride(false);
    setPurposeTouchedManually(false);
    setCaptureMethod('route_auto');
    setFeedback(null);
  }, [pendingPlacePick?.nonce]);

  const purposeSuggestion = useMemo(
    () =>
      suggestTripPurpose(
        {
          originName: origin?.name,
          originAddress: origin?.address,
          originPlaceId: origin?.placeId,
          destinationName: destination?.name,
          destinationAddress: destination?.address,
          destinationPlaceId: destination?.placeId,
          notes,
        },
        templates
      ),
    [origin, destination, notes, templates]
  );

  // Automatically apply suggested purpose unless user manually selected one for this trip
  useEffect(() => {
    if (!purposeTouchedManually && purposeSuggestion) {
      setPurpose(purposeSuggestion.purpose);
    }
  }, [purposeSuggestion, purposeTouchedManually]);

  const handleRouteComputed = useCallback(
    (metrics: ComputedRouteMetrics | null) => {
      setRoutePath(metrics?.sampledPath);
      if (metrics) {
        setActiveRouteMeta({
          summary: metrics.routeSummary,
          trafficDelayMinutes: metrics.trafficDelayMinutes,
          trafficSeverity: metrics.trafficSeverity,
        });
        if (!manualOverride || metrics.userSelected) {
          setOneWayMiles(metrics.oneWayMiles);
          setDurationMinutes(metrics.durationMinutes);
          if (metrics.userSelected) {
            setManualOverride(false);
            setCaptureMethod('route_auto');
          } else {
            setCaptureMethod((prev) =>
              prev === 'gps_live' || prev === 'template' ? prev : 'route_auto'
            );
          }
        }
      } else {
        setActiveRouteMeta(null);
      }
    },
    [manualOverride]
  );

  const handleOriginChange = (place: PlaceSelection | null) => {
    setOrigin(place);
    setRoutePath(undefined);
    setActiveRouteMeta(null);
    setManualOverride(false);
    setPurposeTouchedManually(false);
    setCaptureMethod('route_auto');
    setFeedback(null);
  };

  const handleDestinationChange = (place: PlaceSelection | null) => {
    setDestination(place);
    setRoutePath(undefined);
    setActiveRouteMeta(null);
    setManualOverride(false);
    setPurposeTouchedManually(false);
    setCaptureMethod('route_auto');
    setFeedback(null);
  };

  const handleSwap = () => {
    const prevOrigin = origin;
    setOrigin(destination);
    setDestination(prevOrigin);
    setRoutePath(undefined);
    setActiveRouteMeta(null);
    setManualOverride(false);
  };

  const handleStopLiveDrive = () => {
    const result = gpsTracker.stopTracking();
    if (!result) {
      setFeedback({
        type: 'error',
        text: 'No GPS coordinates were recorded yet. Wait a moment for GPS lock before stopping.',
      });
      return;
    }

    const startStore = findNearestStore(result.startPoint.lat, result.startPoint.lng, 0.6);
    const endStore = findNearestStore(result.endPoint.lat, result.endPoint.lng, 0.6);

    setOrigin(
      startStore
        ? {
            name: startStore.store.shortName,
            address: startStore.store.address,
            placeId: startStore.store.placeId,
            lat: startStore.store.lat,
            lng: startStore.store.lng,
          }
        : {
            name: 'GPS Start Location',
            address: `${result.startPoint.lat.toFixed(5)}, ${result.startPoint.lng.toFixed(5)}`,
            placeId: '',
            lat: result.startPoint.lat,
            lng: result.startPoint.lng,
          }
    );

    setDestination(
      endStore
        ? {
            name: endStore.store.shortName,
            address: endStore.store.address,
            placeId: endStore.store.placeId,
            lat: endStore.store.lat,
            lng: endStore.store.lng,
          }
        : {
            name: 'GPS End Location',
            address: `${result.endPoint.lat.toFixed(5)}, ${result.endPoint.lng.toFixed(5)}`,
            placeId: '',
            lat: result.endPoint.lat,
            lng: result.endPoint.lng,
          }
    );

    setTripDate(formatDateISO());
    setIsRoundTrip(false);
    setCaptureMethod('gps_live');
    if (result.milesDriven >= 0.1) {
      setOneWayMiles(result.milesDriven);
      setDurationMinutes(result.durationMinutes);
      setManualOverride(true);
    } else {
      setManualOverride(false);
    }

    setFeedback({
      type: 'success',
      text: `Live drive captured (${result.milesDriven.toFixed(1)} mi · ${result.durationMinutes} min). Review and click Log Trip.`,
    });
  };

  const handleFinishAutoDriveNow = () => {
    const captured = autoDetector.finishActiveDriveNow();
    if (!captured) {
      setFeedback({
        type: 'warning',
        text: 'Drive was too short (< 0.1 mi) to capture. Keep driving or log mileage manually.',
      });
      return;
    }
    setFeedback({
      type: 'success',
      text: `Auto-detected drive captured (${captured.milesDriven.toFixed(1)} mi · ${captured.durationMinutes} min). Confirm it in the review queue above.`,
    });
  };

  const handleLoadDetectedDriveIntoForm = (resolved: ResolvedDetectedDrive) => {
    setOrigin(resolved.origin);
    setDestination(resolved.destination);
    setPurpose(resolved.suggestedPurpose);
    setPurposeTouchedManually(false);
    setTripDate(formatDateISO(new Date(resolved.drive.endedAt)));
    setIsRoundTrip(false);
    setCaptureMethod('gps_live');
    setOneWayMiles(resolved.drive.milesDriven);
    setDurationMinutes(resolved.drive.durationMinutes);
    setManualOverride(true);
    setRoutePath(undefined);
    setActiveRouteMeta(null);
    setNotes(
      resolved.drive.isSimulated
        ? 'Auto-detected drive preview'
        : `Auto-detected drive (peak ${resolved.drive.maxSpeedMph.toFixed(0)} mph)`
    );
    autoDetector.removeDetectedDrive(resolved.drive.id);
    setFeedback({
      type: 'success',
      text: `Loaded auto-detected drive (${resolved.drive.milesDriven.toFixed(1)} mi) into form. Review and click Save Trip.`,
    });
  };

  const handleQuickLogDetectedDrive = async (resolved: ResolvedDetectedDrive) => {
    if (!isAuthenticated) {
      onRequestSignIn();
      return;
    }
    setIsSubmitting(true);
    setFeedback(null);
    try {
      const driveDateIso = formatDateISO(new Date(resolved.drive.endedAt));
      const billable = calculateBillableMiles(resolved.drive.milesDriven, false, 0);
      const amount = calculateReimbursement(billable, ratePerMile);
      const dailyProjection = evaluateDailyMileageStatus({
        trips,
        tripDate: driveDateIso,
        pendingMiles: billable,
        thresholdMiles: dailyThresholdMiles,
      });

      await onLogTrip({
        tripDate: driveDateIso,
        originName: resolved.origin.name,
        originAddress: resolved.origin.address,
        originPlaceId: resolved.origin.placeId,
        destinationName: resolved.destination.name,
        destinationAddress: resolved.destination.address,
        destinationPlaceId: resolved.destination.placeId,
        purpose: resolved.suggestedPurpose,
        notes: (resolved.drive.isSimulated
          ? 'Auto-detected drive preview'
          : `Auto-detected drive (${resolved.drive.durationMinutes} min · peak ${resolved.drive.maxSpeedMph.toFixed(0)} mph)`
        ).slice(0, FIELD_LIMITS.notes),
        oneWayMiles: round1(resolved.drive.milesDriven),
        commuteDeductionMiles: 0,
        billableMiles: billable,
        durationMinutes: resolved.drive.durationMinutes,
        isRoundTrip: false,
        captureMethod: 'gps_live',
        ratePerMile,
        reimbursementAmount: amount,
      });

      autoDetector.removeDetectedDrive(resolved.drive.id);

      if (dailyProjection.severity === 'exceeded' || dailyProjection.severity === 'high') {
        setFeedback({
          type: 'warning',
          text: `Logged auto-detected drive (${billable.toFixed(1)} mi · ${formatCurrency(amount)}). Heads up: daily total is now ${dailyProjection.projectedMiles.toFixed(1)} mi, exceeding your ${dailyProjection.thresholdMiles.toFixed(0)} mi shift limit.`,
        });
      } else {
        setFeedback({
          type: 'success',
          text: `Logged auto-detected drive: ${resolved.origin.name} → ${resolved.destination.name} (${billable.toFixed(1)} mi · ${formatCurrency(amount)}).`,
        });
      }
    } catch {
      setFeedback({ type: 'error', text: 'Could not log auto-detected drive. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApplyTemplate = (tpl: RouteTemplate) => {
    const matchedOrigin = stores.find((s) => s.placeId === tpl.originPlaceId);
    const matchedDest = stores.find((s) => s.placeId === tpl.destinationPlaceId);

    setOrigin({
      name: tpl.originName,
      address: tpl.originAddress,
      placeId: tpl.originPlaceId,
      lat: matchedOrigin && matchedOrigin.hasCoordinates !== false ? matchedOrigin.lat : undefined,
      lng: matchedOrigin && matchedOrigin.hasCoordinates !== false ? matchedOrigin.lng : undefined,
    });
    setDestination({
      name: tpl.destinationName,
      address: tpl.destinationAddress,
      placeId: tpl.destinationPlaceId,
      lat: matchedDest && matchedDest.hasCoordinates !== false ? matchedDest.lat : undefined,
      lng: matchedDest && matchedDest.hasCoordinates !== false ? matchedDest.lng : undefined,
    });
    setPurpose(tpl.purpose);
    setIsRoundTrip(tpl.isRoundTrip);
    setOneWayMiles(tpl.oneWayMiles);
    setDurationMinutes(tpl.durationMinutes);
    setRoutePath(undefined);
    setCaptureMethod('template');
    setManualOverride(false);
    setTripDate(formatDateISO());
    setFeedback(null);
  };

  const handleQuickLogTemplate = async (tpl: RouteTemplate) => {
    if (!isAuthenticated) {
      onRequestSignIn();
      return;
    }
    setIsSubmitting(true);
    setFeedback(null);
    try {
      const todayIso = formatDateISO();
      const billable = calculateBillableMiles(tpl.oneWayMiles, tpl.isRoundTrip, 0);
      const amount = calculateReimbursement(billable, ratePerMile);
      const todayProjection = evaluateDailyMileageStatus({
        trips,
        tripDate: todayIso,
        pendingMiles: billable,
        thresholdMiles: dailyThresholdMiles,
      });

      await onLogTrip({
        tripDate: todayIso,
        originName: tpl.originName,
        originAddress: tpl.originAddress,
        originPlaceId: tpl.originPlaceId,
        destinationName: tpl.destinationName,
        destinationAddress: tpl.destinationAddress,
        destinationPlaceId: tpl.destinationPlaceId,
        purpose: tpl.purpose,
        notes: `Quick-logged from template: ${tpl.label}`.slice(0, FIELD_LIMITS.notes),
        oneWayMiles: tpl.oneWayMiles,
        commuteDeductionMiles: 0,
        billableMiles: billable,
        durationMinutes: tpl.durationMinutes,
        isRoundTrip: tpl.isRoundTrip,
        captureMethod: 'template',
        ratePerMile,
        reimbursementAmount: amount,
      });
      if (todayProjection.severity === 'exceeded' || todayProjection.severity === 'high') {
        setFeedback({
          type: 'warning',
          text: `Logged "${tpl.label}" (${billable.toFixed(1)} mi · ${formatCurrency(amount)}). Heads up: today's total is now ${todayProjection.projectedMiles.toFixed(1)} mi, exceeding your ${todayProjection.thresholdMiles.toFixed(0)} mi daily mileage threshold by ${todayProjection.overageMiles.toFixed(1)} mi.`,
        });
      } else {
        setFeedback({
          type: 'success',
          text: `Logged "${tpl.label}" (${billable.toFixed(1)} mi · ${formatCurrency(amount)}) for today.`,
        });
      }
    } catch {
      setFeedback({ type: 'error', text: 'Could not log trip. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const commuteDeduction = applyCommuteDeduction ? normalCommuteMiles : 0;
  const billableMiles = calculateBillableMiles(oneWayMiles, isRoundTrip, commuteDeduction);
  const reimbursementAmount = calculateReimbursement(billableMiles, ratePerMile);

  const dailyMileageStatus = useMemo(
    () =>
      evaluateDailyMileageStatus({
        trips,
        tripDate,
        pendingMiles: billableMiles,
        thresholdMiles: dailyThresholdMiles,
      }),
    [trips, tripDate, billableMiles, dailyThresholdMiles]
  );

  const handleApplyThreshold = (nextMiles: number) => {
    const saved = saveDailyMileageThreshold(nextMiles);
    setDailyThresholdMiles(saved);
    setThresholdDraft(String(saved));
    setShowThresholdEditor(false);
  };

  const canSubmit = Boolean(origin?.name && destination?.name && billableMiles > 0);

  const handleSubmitTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      onRequestSignIn();
      return;
    }
    if (!origin || !destination || billableMiles <= 0) {
      setFeedback({
        type: 'error',
        text: 'Select an origin, destination, and verify billable miles before logging.',
      });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    try {
      await onLogTrip({
        tripDate,
        originName: origin.name,
        originAddress: origin.address,
        originPlaceId: origin.placeId,
        destinationName: destination.name,
        destinationAddress: destination.address,
        destinationPlaceId: destination.placeId,
        purpose,
        notes,
        oneWayMiles: round1(oneWayMiles),
        commuteDeductionMiles: round1(commuteDeduction),
        billableMiles,
        durationMinutes: Math.max(0, Math.round(durationMinutes)),
        isRoundTrip,
        captureMethod,
        ratePerMile,
        reimbursementAmount,
      });
      setFeedback({
        type: 'success',
        text: `Trip logged: ${billableMiles.toFixed(1)} mi (${formatCurrency(reimbursementAmount)}) added to your report queue.`,
      });
      setNotes('');
      setDestination(null);
      setRoutePath(undefined);
      setActiveRouteMeta(null);
      setOneWayMiles(0);
      setDurationMinutes(0);
      setManualOverride(false);
      setPurposeTouchedManually(false);
      setApplyCommuteDeduction(false);
    } catch {
      setFeedback({
        type: 'error',
        text: 'Failed to save trip to your account. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveCurrentAsTemplate = async () => {
    if (!isAuthenticated) {
      onRequestSignIn();
      return;
    }
    if (!origin || !destination || oneWayMiles <= 0) return;

    setIsSavingTemplate(true);
    setFeedback(null);
    try {
      const label = `${origin.name} to ${destination.name}`.slice(
        0,
        FIELD_LIMITS.templateLabel
      );
      await onSaveTemplate({
        label,
        originName: origin.name,
        originAddress: origin.address,
        originPlaceId: origin.placeId,
        destinationName: destination.name,
        destinationAddress: destination.address,
        destinationPlaceId: destination.placeId,
        purpose,
        oneWayMiles: round1(oneWayMiles),
        durationMinutes: Math.max(0, Math.round(durationMinutes)),
        isRoundTrip,
      });
      setFeedback({
        type: 'success',
        text: `Saved "${label}" to your 1-click frequent routes.`,
      });
    } catch {
      setFeedback({ type: 'error', text: 'Could not save route template.' });
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const readyExpenses = useMemo(
    () =>
      expenses
        .filter((e) => e.status === 'ready')
        .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate)),
    [expenses]
  );

  const readyExpensesTotal = useMemo(
    () => readyExpenses.reduce((sum, e) => sum + e.amount, 0),
    [readyExpenses]
  );

  const tripById = useMemo(() => {
    const map: Record<string, MileageTrip> = {};
    for (const t of trips) map[t.id] = t;
    return map;
  }, [trips]);

  return (
    <div className="space-y-5">
      {/* Dashboard Quick Actions Strip (Quick Expense for Parking, Tolls & Non-Mileage Costs) */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/70 text-blue-700 dark:text-blue-400 flex items-center justify-center shrink-0">
            <Receipt className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t('logger.nonMileageTitle')}
              </h2>
              {readyExpenses.length > 0 && (
                <span className="text-xs font-mono tabular-nums font-semibold text-blue-800 dark:text-blue-300">
                  {t('logger.queuedAmount', {
                    amount: formatCurrency(readyExpensesTotal),
                    count: readyExpenses.length,
                  })}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('logger.nonMileageDesc')}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenQuickExpense}
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Receipt className="w-3.5 h-3.5" />
          {t('logger.quickExpense')}
        </button>
      </section>

      {/* Frequent Route Templates (1-Click Repeat Logging) */}
      {templates.length > 0 && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t('logger.frequentRoutes')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('logger.frequentRoutesDesc')}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {templates.map((tpl) => {
              const tplMiles = calculateBillableMiles(tpl.oneWayMiles, tpl.isRoundTrip, 0);
              return (
                <div
                  key={tpl.id}
                  className="flex items-center justify-between gap-2 px-3 py-2.5 border border-slate-200 dark:border-slate-800 rounded-lg hover:border-blue-300 dark:hover:border-blue-700 bg-slate-50/50 dark:bg-slate-950/50 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => handleApplyTemplate(tpl)}
                    className="min-w-0 flex-1 text-start"
                  >
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {tpl.label}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5 truncate">
                      {tplMiles.toFixed(1)} {t('common.mi')} ·{' '}
                      {tpl.isRoundTrip ? t('common.roundTrip') : t('common.oneWay')} ·{' '}
                      {tPurpose(tpl.purpose)}
                    </div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => void handleQuickLogTemplate(tpl)}
                      className="px-2.5 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60 rounded-md transition-colors whitespace-nowrap"
                    >
                      {t('logger.logToday')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteTemplate(tpl.id)}
                      aria-label={tpl.label}
                      className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded-md transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Auto-Detected Drives Pending Review Inbox */}
      <DetectedDrivesInbox
        drives={autoDetector.detectedDrives}
        findNearestStore={findNearestStore}
        templates={templates}
        ratePerMile={ratePerMile}
        isSubmitting={isSubmitting}
        onQuickLogDrive={handleQuickLogDetectedDrive}
        onLoadDriveIntoForm={handleLoadDetectedDriveIntoForm}
        onDismissDrive={autoDetector.removeDetectedDrive}
        onClearAll={autoDetector.clearDetectedDrives}
      />

      {/* Main 2-Column Balanced Split: Auto Trip Builder + Live Route Map */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left Column: Automated Trip Builder */}
        <div className="lg:col-span-5 flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          {/* Unified Automated Driving Detection & Manual Live GPS Header */}
          <DriveTrackingHeader
            gpsTracker={gpsTracker}
            autoDetector={autoDetector}
            stores={stores}
            homeStorePlaceId={profile?.homeStorePlaceId}
            onStopManualLiveDrive={handleStopLiveDrive}
            onFinishAutoDriveNow={handleFinishAutoDriveNow}
          />

          {/* Trip Entry Form */}
          <form onSubmit={handleSubmitTrip} className="p-5 flex-1 flex flex-col justify-between gap-5">
            <div className="space-y-4">
              {/* Origin + Swap + Destination */}
              <div className="space-y-3">
                <LocationPickerInput
                  id="trip-origin"
                  label={t('loc.originLabel')}
                  placeholder={t('loc.originPlaceholder')}
                  value={origin}
                  onChange={handleOriginChange}
                  stores={stores}
                  homeStorePlaceId={profile?.homeStorePlaceId}
                  biasCenter={biasCenter}
                  onManageLocations={onManageLocations}
                  findNearestStore={findNearestStore}
                  accentDotColor="#15803d"
                />

                <div className="flex items-center justify-between">
                  <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
                  <button
                    type="button"
                    onClick={handleSwap}
                    disabled={!origin && !destination}
                    className="mx-3 inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors disabled:opacity-40 whitespace-nowrap"
                  >
                    <ArrowUpDown className="w-3 h-3" />
                    {t('common.swap')}
                  </button>
                  <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
                </div>

                <LocationPickerInput
                  id="trip-destination"
                  label={t('loc.destinationLabel')}
                  placeholder={t('loc.destinationPlaceholder')}
                  value={destination}
                  onChange={handleDestinationChange}
                  stores={stores}
                  homeStorePlaceId={profile?.homeStorePlaceId}
                  biasCenter={biasCenter}
                  onManageLocations={onManageLocations}
                  findNearestStore={findNearestStore}
                  accentDotColor="#d97706"
                />
              </div>

              {/* Date + Purpose */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label
                    htmlFor="trip-date"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    {t('logger.tripDate')}
                  </label>
                  <input
                    id="trip-date"
                    type="date"
                    required
                    value={tripDate}
                    onChange={(e) => setTripDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                </div>
                <div>
                  <label
                    htmlFor="trip-purpose"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    {t('logger.businessPurpose')}
                  </label>
                  <select
                    id="trip-purpose"
                    value={purpose}
                    onChange={(e) => {
                      setPurpose(e.target.value as TripPurpose);
                      setPurposeTouchedManually(true);
                    }}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  >
                    {TRIP_PURPOSES.map((p) => (
                      <option key={p} value={p}>
                        {tPurpose(p)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {purposeSuggestion && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 -mt-1">
                  <span className="truncate">
                    {purpose === purposeSuggestion.purpose
                      ? `${t('expense.autoSelected')} ${tPurpose(purposeSuggestion.purpose)}`
                      : t('pastDrive.suggested', { purpose: tPurpose(purposeSuggestion.purpose) })}
                  </span>
                  {purpose !== purposeSuggestion.purpose && (
                    <button
                      type="button"
                      onClick={() => {
                        setPurpose(purposeSuggestion.purpose);
                        setPurposeTouchedManually(false);
                      }}
                      className="text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium whitespace-nowrap"
                    >
                      {t('logger.applyPurpose', { purpose: tPurpose(purposeSuggestion.purpose) })}
                    </button>
                  )}
                </div>
              )}

              {/* Trip Type Segmented Control + Editable Miles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <span className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('logger.tripDirection')}
                  </span>
                  <div className="grid grid-cols-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setIsRoundTrip(false)}
                      className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        !isRoundTrip
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                      }`}
                    >
                      {t('common.oneWay')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsRoundTrip(true)}
                      className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        isRoundTrip
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                      }`}
                    >
                      {t('common.roundTrip')}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="trip-miles"
                      className="text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      {t('logger.oneWayMiles')}
                    </label>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {manualOverride ? t('logger.manual') : t('logger.autoCalculated')}
                    </span>
                  </div>
                  <input
                    id="trip-miles"
                    type="number"
                    dir="ltr"
                    min="0"
                    max="2000"
                    step="0.1"
                    value={oneWayMiles || ''}
                    placeholder="0.0"
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setOneWayMiles(Number.isFinite(val) && val >= 0 ? val : 0);
                      setManualOverride(true);
                      setCaptureMethod('manual');
                    }}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                </div>
              </div>

              {/* Active Real-Time Traffic Route Summary */}
              {activeRouteMeta?.summary && !manualOverride && durationMinutes > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg text-xs">
                  <span className="text-slate-700 dark:text-slate-300 truncate">
                    {t('logger.activeRoute')}{' '}
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {activeRouteMeta.summary}
                    </span>
                  </span>
                  <span
                    className={`font-mono tabular-nums font-semibold whitespace-nowrap ${
                      activeRouteMeta.trafficSeverity === 'heavy'
                        ? 'text-red-700 dark:text-red-400'
                        : activeRouteMeta.trafficSeverity === 'moderate'
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    {durationMinutes} {t('common.min')}
                    {activeRouteMeta.trafficDelayMinutes && activeRouteMeta.trafficDelayMinutes > 0
                      ? ` (${t('logger.trafficDelay', { min: activeRouteMeta.trafficDelayMinutes })})`
                      : ` · ${t('logger.clearTraffic')}`}
                  </span>
                </div>
              )}

              {/* Optional CA Alternate-Store Commute Deduction */}
              {normalCommuteMiles > 0 && (
                <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none pt-0.5">
                  <input
                    type="checkbox"
                    checked={applyCommuteDeduction}
                    onChange={(e) => setApplyCommuteDeduction(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 dark:border-slate-700 text-blue-700 focus:ring-blue-600"
                  />
                  <span>
                    {t('logger.commuteCheckbox', {
                      miles: normalCommuteMiles.toFixed(1),
                      way: isRoundTrip ? t('logger.eachWay') : t('logger.oneWayLower'),
                    })}
                  </span>
                </label>
              )}

              {/* Notes */}
              <div>
                <label
                  htmlFor="trip-notes"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  {t('logger.notesLabel')}
                </label>
                <input
                  id="trip-notes"
                  type="text"
                  maxLength={FIELD_LIMITS.notes}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('logger.notesPlaceholder')}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>
            </div>

            {/* Summary Step: Static Route Confirmation Thumbnail + Daily Shift Meter + Reimbursement CTA */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3.5">
              {/* Static Google Map Route Confirmation Thumbnail */}
              {origin && destination && (
                <StaticRouteThumbnail
                  origin={origin}
                  destination={destination}
                  routePath={routePath}
                  oneWayMiles={oneWayMiles}
                  durationMinutes={durationMinutes}
                  isRoundTrip={isRoundTrip}
                  darkMode={isDark}
                />
              )}

              {/* Daily Retail Shift Commuting Threshold Meter */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-slate-600 dark:text-slate-400">
                    {t('logger.dailyTotal', { date: formatLocalizedDate(tripDate) })}{' '}
                    <span
                      className={`font-mono tabular-nums font-semibold ${
                        dailyMileageStatus.severity === 'high'
                          ? 'text-red-700 dark:text-red-400'
                          : dailyMileageStatus.severity === 'exceeded'
                            ? 'text-amber-800 dark:text-amber-300'
                            : 'text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {dailyMileageStatus.projectedMiles.toFixed(1)} /{' '}
                      {dailyMileageStatus.thresholdMiles.toFixed(0)} {t('common.mi')}
                    </span>
                  </span>

                  <button
                    type="button"
                    onClick={() => {
                      setThresholdDraft(String(dailyThresholdMiles));
                      setShowThresholdEditor((prev) => !prev);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap"
                  >
                    <SlidersHorizontal className="w-3 h-3" />
                    {showThresholdEditor ? t('common.close') : t('logger.shiftLimit')}
                  </button>
                </div>

                {/* Slim Progress Bar */}
                <div
                  className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden"
                  role="progressbar"
                  aria-label={t('logger.dailyThresholdLabel')}
                  aria-valuenow={Math.round(dailyMileageStatus.projectedMiles)}
                  aria-valuemin={0}
                  aria-valuemax={Math.round(dailyMileageStatus.thresholdMiles)}
                >
                  <div
                    className={`h-full rounded-full transition-all duration-200 ${
                      dailyMileageStatus.severity === 'high'
                        ? 'bg-red-600'
                        : dailyMileageStatus.severity === 'exceeded'
                          ? 'bg-amber-500'
                          : dailyMileageStatus.severity === 'approaching'
                            ? 'bg-amber-400'
                            : 'bg-blue-600 dark:bg-blue-500'
                    }`}
                    style={{
                      width: `${Math.min(100, Math.max(0, dailyMileageStatus.percentOfThreshold))}%`,
                    }}
                  />
                </div>

                {/* Collapsible Inline Threshold Adjuster */}
                {showThresholdEditor && (
                  <div className="p-2.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        {t('logger.dailyThresholdLabel')}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleApplyThreshold(DEFAULT_SHIFT_COMMUTE_THRESHOLD_MILES)}
                        className="text-[11px] font-medium text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 whitespace-nowrap"
                      >
                        {t('logger.resetThreshold', { miles: DEFAULT_SHIFT_COMMUTE_THRESHOLD_MILES })}
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {THRESHOLD_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => handleApplyThreshold(preset)}
                          className={`px-2 py-1 text-xs font-mono tabular-nums rounded border transition-colors whitespace-nowrap ${
                            Math.abs(dailyThresholdMiles - preset) < 0.1
                              ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-300 font-semibold'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          {preset} {t('common.mi')}
                        </button>
                      ))}
                      <div className="flex items-center gap-1 ms-auto">
                        <input
                          type="number"
                          dir="ltr"
                          min={MIN_SHIFT_THRESHOLD_MILES}
                          max={MAX_SHIFT_THRESHOLD_MILES}
                          step="1"
                          aria-label={t('logger.dailyThresholdLabel')}
                          value={thresholdDraft}
                          onChange={(e) => setThresholdDraft(e.target.value)}
                          className="w-16 px-2 py-1 text-xs font-mono tabular-nums bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600"
                        />
                        <button
                          type="button"
                          onClick={() => handleApplyThreshold(parseFloat(thresholdDraft))}
                          className="px-2 py-1 text-xs font-medium text-white bg-slate-800 dark:bg-blue-700 hover:bg-slate-900 dark:hover:bg-blue-600 rounded whitespace-nowrap"
                        >
                          {t('logger.set')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Approaching Threshold Caution */}
                {dailyMileageStatus.severity === 'approaching' && (
                  <div
                    role="status"
                    className="flex items-start gap-2 px-3 py-2 bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 rounded-lg text-xs text-amber-900 dark:text-amber-200"
                  >
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold">{t('logger.approachingTitle')}</span>
                      <span className="font-mono tabular-nums">
                        {dailyMileageStatus.projectedMiles.toFixed(1)} /{' '}
                        {dailyMileageStatus.thresholdMiles.toFixed(0)} {t('common.mi')} (
                        {dailyMileageStatus.percentOfThreshold}%)
                      </span>
                    </div>
                  </div>
                )}

                {/* Exceeded / High Daily Mileage Warning Alert */}
                {(dailyMileageStatus.severity === 'exceeded' ||
                  dailyMileageStatus.severity === 'high') && (
                  <div
                    role="alert"
                    className={`p-3 rounded-lg border text-xs space-y-2 ${
                      dailyMileageStatus.severity === 'high'
                        ? 'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-900/70 text-red-950 dark:text-red-200'
                        : 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800/70 text-amber-950 dark:text-amber-200'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle
                        className={`w-4 h-4 shrink-0 mt-0.5 ${
                          dailyMileageStatus.severity === 'high'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      />
                      <div className="space-y-1 min-w-0">
                        <div className="font-semibold">
                          {dailyMileageStatus.severity === 'high'
                            ? t('logger.highMileageTitle')
                            : t('logger.exceededTitle')}
                        </div>
                        <p className="leading-snug font-mono tabular-nums">
                          {formatLocalizedDate(tripDate)} ·{' '}
                          {dailyMileageStatus.projectedMiles.toFixed(1)} {t('common.mi')} (+
                          {dailyMileageStatus.overageMiles.toFixed(1)} {t('common.mi')} /{' '}
                          {dailyMileageStatus.thresholdMiles.toFixed(0)} {t('common.mi')})
                        </p>
                      </div>
                    </div>

                    {normalCommuteMiles > 0 && !applyCommuteDeduction && (
                      <div className="ps-6">
                        <button
                          type="button"
                          onClick={() => setApplyCommuteDeduction(true)}
                          className="px-2.5 py-1 text-xs font-semibold bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-amber-950 dark:text-amber-200 hover:bg-amber-100/70 dark:hover:bg-amber-900/50 rounded-md transition-colors whitespace-nowrap"
                        >
                          {t('logger.applyCommuteBtn', { miles: normalCommuteMiles.toFixed(1) })}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {t('logger.reimbursableTotal')}
                  </div>
                  <div dir="ltr" className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                    {billableMiles.toFixed(1)} mi × ${ratePerMile.toFixed(2)}/mi
                  </div>
                </div>
                <div dir="ltr" className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {formatCurrency(reimbursementAmount)}
                </div>
              </div>

              {feedback && (
                <div
                  role={feedback.type === 'error' || feedback.type === 'warning' ? 'alert' : 'status'}
                  className={`text-xs px-3 py-2 rounded-lg border flex items-start gap-2 ${
                    feedback.type === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/70 text-emerald-900 dark:text-emerald-200'
                      : feedback.type === 'warning'
                        ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800/70 text-amber-950 dark:text-amber-200'
                        : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/70 text-red-900 dark:text-red-200'
                  }`}
                >
                  {feedback.type === 'warning' && (
                    <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <span>{feedback.text}</span>
                </div>
              )}

              <div className="flex items-center gap-2.5">
                <button
                  type="submit"
                  disabled={!canSubmit || isSubmitting}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:bg-slate-300 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap"
                >
                  {isSubmitting ? (
                    t('common.saving')
                  ) : isAuthenticated ? (
                    <>
                      <Plus className="w-4 h-4" />
                      {t('logger.saveTripQueue')}
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      {t('logger.signInSaveTrip')}
                    </>
                  )}
                </button>

                {isAuthenticated && origin && destination && oneWayMiles > 0 && (
                  <button
                    type="button"
                    disabled={isSavingTemplate}
                    onClick={() => void handleSaveCurrentAsTemplate()}
                    title={t('logger.saveRoute')}
                    className="inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <Bookmark className="w-4 h-4" />
                    {t('logger.saveRoute')}
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>

        {/* Right Column: Live Interactive Route Map */}
        <div className="lg:col-span-7 flex flex-col">
          <RouteMapPanel
            stores={stores}
            storesLoading={storesLoading}
            storesError={storesError}
            onManageLocations={onManageLocations}
            origin={origin}
            destination={destination}
            homeStorePlaceId={profile?.homeStorePlaceId}
            ratePerMile={ratePerMile}
            gpsPoints={gpsTracker.isTracking ? gpsTracker.points : autoDetector.activePoints}
            onSetOrigin={handleOriginChange}
            onSetDestination={handleDestinationChange}
            onRouteComputed={handleRouteComputed}
          />
        </div>
      </div>

      {/* Queued Non-Mileage Business Expenses List */}
      {readyExpenses.length > 0 && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t('logger.queuedExpensesTitle', { count: readyExpenses.length })}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('logger.queuedExpensesDesc')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span dir="ltr" className="text-sm font-bold font-mono tabular-nums text-blue-800 dark:text-blue-400">
                {formatCurrency(readyExpensesTotal)}
              </span>
              <button
                type="button"
                onClick={onOpenQuickExpense}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('logger.addExpense')}
              </button>
            </div>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {readyExpenses.slice(0, 6).map((exp) => {
              const linked = exp.tripId ? tripById[exp.tripId] : undefined;
              return (
                <div
                  key={exp.id}
                  className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {formatLocalizedDate(exp.expenseDate)}
                      </span>
                      <span className="px-1.5 py-0.5 text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded">
                        {tExpenseCategory(exp.category)}
                      </span>
                      <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {exp.description}
                      </span>
                    </div>
                    {(linked || exp.notes) && (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {linked ? `${t('logger.tripPrefix')} ${linked.originName} → ${linked.destinationName}` : ''}
                        {linked && exp.notes ? ' · ' : ''}
                        {exp.notes}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span dir="ltr" className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      {formatCurrency(exp.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => void onDeleteExpense(exp.id)}
                      aria-label={t('common.delete')}
                      className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Annual Commute Savings Calculator */}
      <CommuteSavingsCard profile={profile} trips={trips} stores={stores} />
    </div>
  );
}
