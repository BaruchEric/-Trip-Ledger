import React, { useMemo, useState } from 'react';
import {
  Check,
  Edit3,
  Navigation2,
  Play,
  Radar,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-react';
import type { UseAutoDriveDetectorReturn } from '../hooks/useAutoDriveDetector';
import type { UseLiveGpsTrackerReturn } from '../hooks/useLiveGpsTracker';
import {
  MIN_TRIP_MILES_PRESETS,
  START_SPEED_PRESETS,
  STOP_COOLDOWN_PRESETS,
  type DetectedDrive,
} from '../lib/driveDetection';
import { suggestTripPurpose } from '../lib/purposeSuggestion';
import { useI18n } from '../lib/i18n';
import {
  calculateReimbursement,
  formatCurrency,
  type PlaceSelection,
  type RouteTemplate,
  type StoreLocation,
  type TripPurpose,
} from '../types/mileage';

export interface ResolvedDetectedDrive {
  drive: DetectedDrive;
  origin: PlaceSelection;
  destination: PlaceSelection;
  suggestedPurpose: TripPurpose;
  reimbursementEstimate: number;
}

function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function resolveDetectedDriveEndpoints(
  drive: DetectedDrive,
  findNearestStore: (
    lat: number,
    lng: number,
    maxMiles?: number
  ) => { store: StoreLocation; distanceMiles: number } | null,
  templates: RouteTemplate[],
  ratePerMile: number
): ResolvedDetectedDrive {
  const startStore = findNearestStore(drive.startPoint.lat, drive.startPoint.lng, 0.6);
  const endStore = findNearestStore(drive.endPoint.lat, drive.endPoint.lng, 0.6);

  const origin: PlaceSelection = startStore
    ? {
        name: startStore.store.shortName,
        address: startStore.store.address,
        placeId: startStore.store.placeId,
        lat: startStore.store.lat,
        lng: startStore.store.lng,
      }
    : {
        name: 'Auto-Detected Start',
        address: `${drive.startPoint.lat.toFixed(5)}, ${drive.startPoint.lng.toFixed(5)}`,
        placeId: '',
        lat: drive.startPoint.lat,
        lng: drive.startPoint.lng,
      };

  const destination: PlaceSelection = endStore
    ? {
        name: endStore.store.shortName,
        address: endStore.store.address,
        placeId: endStore.store.placeId,
        lat: endStore.store.lat,
        lng: endStore.store.lng,
      }
    : {
        name: 'Auto-Detected Stop',
        address: `${drive.endPoint.lat.toFixed(5)}, ${drive.endPoint.lng.toFixed(5)}`,
        placeId: '',
        lat: drive.endPoint.lat,
        lng: drive.endPoint.lng,
      };

  const purposeMatch = suggestTripPurpose(
    {
      originName: origin.name,
      originAddress: origin.address,
      originPlaceId: origin.placeId,
      destinationName: destination.name,
      destinationAddress: destination.address,
      destinationPlaceId: destination.placeId,
    },
    templates
  );

  const suggestedPurpose: TripPurpose =
    purposeMatch?.purpose ??
    (startStore && endStore ? 'Inter-Store Transfer' : 'Shift Coverage');

  return {
    drive,
    origin,
    destination,
    suggestedPurpose,
    reimbursementEstimate: calculateReimbursement(drive.milesDriven, ratePerMile),
  };
}

interface DriveTrackingHeaderProps {
  gpsTracker: UseLiveGpsTrackerReturn;
  autoDetector: UseAutoDriveDetectorReturn;
  stores: StoreLocation[];
  homeStorePlaceId?: string;
  onStopManualLiveDrive: () => void;
  onFinishAutoDriveNow: () => void;
}

export function DriveTrackingHeader({
  gpsTracker,
  autoDetector,
  stores,
  homeStorePlaceId,
  onStopManualLiveDrive,
  onFinishAutoDriveNow,
}: DriveTrackingHeaderProps) {
  const { t, isRtl } = useI18n();
  const [showSettings, setShowSettings] = useState(false);

  // Pick two mappable saved locations for desktop preview simulation
  const simulationPair = useMemo(() => {
    const mappable = stores.filter((s) => s.hasCoordinates !== false);
    if (mappable.length < 2) return null;
    const home = mappable.find(
      (s) => s.isHome || (homeStorePlaceId && s.placeId === homeStorePlaceId)
    );
    const fromStore = home ?? mappable[0];
    const toStore = mappable.find((s) => (s.id ?? s.placeId) !== (fromStore.id ?? fromStore.placeId)) ?? mappable[1];
    return { fromStore, toStore };
  }, [stores, homeStorePlaceId]);

  const isAutoRecording =
    autoDetector.phase === 'driving' || autoDetector.phase === 'parked_cooldown';

  const handleToggleAuto = () => {
    if (!autoDetector.isEnabled && gpsTracker.isTracking) {
      gpsTracker.cancelTracking();
    }
    autoDetector.toggleAutoDetect();
  };

  const handleStartManual = () => {
    if (autoDetector.isEnabled) {
      autoDetector.disableAutoDetect();
    }
    gpsTracker.startTracking();
  };

  const handleSimulateDrive = () => {
    if (!simulationPair) return;
    if (gpsTracker.isTracking) {
      gpsTracker.cancelTracking();
    }
    autoDetector.runSimulatedDrive(simulationPair.fromStore, simulationPair.toStore);
    setShowSettings(false);
  };

  return (
    <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/80 space-y-3">
      {/* Manual Live GPS Recording Mode */}
      {gpsTracker.isTracking ? (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-red-700 dark:text-red-400">
              <Navigation2 className="w-4 h-4 shrink-0" />
              <span>{t('drive.recordingManual')}</span>
            </div>
            <div className="font-mono tabular-nums text-xs font-semibold text-slate-900 dark:text-slate-100">
              {gpsTracker.milesDriven.toFixed(1)} {t('common.mi')} · {formatTimer(gpsTracker.elapsedSeconds)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onStopManualLiveDrive}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              {t('drive.stopAndFill')}
            </button>
            <button
              type="button"
              onClick={gpsTracker.cancelTracking}
              className="px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Top Row: Automated Driving Detection Toggle + Manual Start Drive */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                  isAutoRecording
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                    : autoDetector.isEnabled
                      ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                }`}
              >
                <Radar className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {t('drive.autoDetect')}
                  </span>
                  <span
                    className={`text-[11px] font-mono tabular-nums font-medium ${
                      isAutoRecording
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : autoDetector.isEnabled
                          ? 'text-blue-700 dark:text-blue-400'
                          : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {autoDetector.phase === 'off'
                      ? t('drive.phaseOff')
                      : autoDetector.phase === 'monitoring'
                        ? t('drive.phaseStandby', { speed: autoDetector.currentSpeedMph.toFixed(0) })
                        : autoDetector.phase === 'driving'
                          ? t('drive.phaseDriving', { speed: autoDetector.currentSpeedMph.toFixed(0) })
                          : t('drive.phaseParked', {
                              time: formatTimer(autoDetector.parkedCountdownSeconds ?? 0),
                            })}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {autoDetector.phase === 'off'
                    ? t('drive.descOff', { speed: autoDetector.settings.startSpeedMph })
                    : autoDetector.phase === 'monitoring'
                      ? `${t('drive.descMonitoring', { speed: autoDetector.settings.startSpeedMph })}${
                          autoDetector.gpsAccuracyMeters !== null
                            ? ` · ±${autoDetector.gpsAccuracyMeters}m`
                            : ''
                        }`
                      : autoDetector.phase === 'driving'
                        ? t('drive.descDriving')
                        : t('drive.descParked')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Accessible Switch Toggle */}
              <button
                type="button"
                role="switch"
                aria-checked={autoDetector.isEnabled}
                aria-label={t('drive.autoDetect')}
                onClick={handleToggleAuto}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600/30 ${
                  autoDetector.isEnabled
                    ? 'bg-blue-700 dark:bg-blue-600'
                    : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    isRtl
                      ? autoDetector.isEnabled
                        ? '-translate-x-6'
                        : '-translate-x-1'
                      : autoDetector.isEnabled
                        ? 'translate-x-6'
                        : 'translate-x-1'
                  }`}
                />
              </button>

              <button
                type="button"
                onClick={() => setShowSettings((prev) => !prev)}
                aria-expanded={showSettings}
                aria-label={t('drive.triggerSpeed')}
                className={`p-1.5 rounded-lg border transition-colors ${
                  showSettings
                    ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>

              {!isAutoRecording && (
                <button
                  type="button"
                  onClick={handleStartManual}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap"
                >
                  <Navigation2 className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" />
                  {t('drive.startDrive')}
                </button>
              )}
            </div>
          </div>

          {/* Active Auto-Detected Drive Telemetry Strip */}
          {isAutoRecording && (
            <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {autoDetector.isSimulating
                    ? t('drive.simulatedInProgress')
                    : autoDetector.phase === 'parked_cooldown'
                      ? t('drive.vehicleParked')
                      : t('drive.activeDetected')}
                </span>
                <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                  {autoDetector.activeMiles.toFixed(1)} {t('common.mi')} ·{' '}
                  {formatTimer(autoDetector.activeElapsedSeconds)} ·{' '}
                  {autoDetector.currentSpeedMph.toFixed(0)} mph
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onFinishAutoDriveNow}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 rounded-lg transition-colors whitespace-nowrap"
                >
                  <Check className="w-3.5 h-3.5" />
                  {t('drive.endAndCapture')}
                </button>
                <button
                  type="button"
                  onClick={autoDetector.discardActiveDrive}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap"
                >
                  {t('drive.discard')}
                </button>
              </div>
            </div>
          )}

          {/* Collapsible Detection Sensitivity & Store-to-Store Simulator Drawer */}
          {showSettings && (
            <div className="pt-2.5 border-t border-slate-200/80 dark:border-slate-800 space-y-2.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <span className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    {t('drive.triggerSpeed')}
                  </span>
                  <div className="grid grid-cols-3 gap-1" dir="ltr">
                    {START_SPEED_PRESETS.map((mph) => (
                      <button
                        key={mph}
                        type="button"
                        onClick={() => autoDetector.updateSettings({ startSpeedMph: mph })}
                        className={`py-1 px-1.5 text-[11px] font-mono tabular-nums rounded border transition-colors whitespace-nowrap ${
                          autoDetector.settings.startSpeedMph === mph
                            ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-300 font-semibold'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {mph} mph
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    {t('drive.stopWait')}
                  </span>
                  <div className="grid grid-cols-4 gap-1" dir="ltr">
                    {STOP_COOLDOWN_PRESETS.map(({ seconds, label }) => (
                      <button
                        key={seconds}
                        type="button"
                        onClick={() => autoDetector.updateSettings({ stopCooldownSeconds: seconds })}
                        className={`py-1 px-1 text-[11px] font-mono tabular-nums rounded border transition-colors whitespace-nowrap ${
                          autoDetector.settings.stopCooldownSeconds === seconds
                            ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-300 font-semibold'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    {t('drive.minDistance')}
                  </span>
                  <div className="grid grid-cols-3 gap-1" dir="ltr">
                    {MIN_TRIP_MILES_PRESETS.map((mi) => (
                      <button
                        key={mi}
                        type="button"
                        onClick={() => autoDetector.updateSettings({ minTripMiles: mi })}
                        className={`py-1 px-1.5 text-[11px] font-mono tabular-nums rounded border transition-colors whitespace-nowrap ${
                          Math.abs(autoDetector.settings.minTripMiles - mi) < 0.01
                            ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-300 font-semibold'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {mi} mi
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-200/70 dark:border-slate-800">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {simulationPair
                    ? t('drive.previewRoute', {
                        from: simulationPair.fromStore.shortName,
                        to: simulationPair.toStore.shortName,
                      })
                    : t('drive.waitingStores')}
                </span>
                <button
                  type="button"
                  disabled={!simulationPair || autoDetector.isSimulating}
                  onClick={handleSimulateDrive}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/70 hover:bg-blue-100 dark:hover:bg-blue-900/60 disabled:opacity-45 disabled:cursor-not-allowed rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <Play className="w-3 h-3 fill-current" />
                  {autoDetector.isSimulating ? t('drive.simulating') : t('drive.simulateDrive')}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {(gpsTracker.gpsError || autoDetector.detectorError) && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {gpsTracker.gpsError || autoDetector.detectorError}
        </p>
      )}
    </div>
  );
}

interface DetectedDrivesInboxProps {
  drives: DetectedDrive[];
  findNearestStore: (
    lat: number,
    lng: number,
    maxMiles?: number
  ) => { store: StoreLocation; distanceMiles: number } | null;
  templates: RouteTemplate[];
  ratePerMile: number;
  isSubmitting: boolean;
  onQuickLogDrive: (resolved: ResolvedDetectedDrive) => Promise<void>;
  onLoadDriveIntoForm: (resolved: ResolvedDetectedDrive) => void;
  onDismissDrive: (driveId: string) => void;
  onClearAll: () => void;
}

export function DetectedDrivesInbox({
  drives,
  findNearestStore,
  templates,
  ratePerMile,
  isSubmitting,
  onQuickLogDrive,
  onLoadDriveIntoForm,
  onDismissDrive,
  onClearAll,
}: DetectedDrivesInboxProps) {
  const { t, tPurpose, formatLocalizedClock } = useI18n();
  const resolvedDrives = useMemo(
    () =>
      drives.map((drive) =>
        resolveDetectedDriveEndpoints(drive, findNearestStore, templates, ratePerMile)
      ),
    [drives, findNearestStore, templates, ratePerMile]
  );

  if (resolvedDrives.length === 0) return null;

  return (
    <section
      aria-label={t('drive.inboxTitle', { count: resolvedDrives.length })}
      className="bg-white dark:bg-slate-900 border border-emerald-300/80 dark:border-emerald-800/80 rounded-xl overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-emerald-50/50 dark:bg-emerald-950/30 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 flex items-center justify-center shrink-0">
            <Radar className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t('drive.inboxTitle', { count: resolvedDrives.length })}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {t('drive.inboxSubtitle')}
            </p>
          </div>
        </div>
        {resolvedDrives.length > 1 && (
          <button
            type="button"
            onClick={onClearAll}
            className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap"
          >
            {t('drive.dismissAll')}
          </button>
        )}
      </div>

      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {resolvedDrives.map((item) => (
          <div
            key={item.drive.id}
            className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
          >
            <div className="min-w-0 space-y-0.5">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                {item.origin.name} → {item.destination.name}
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                  {item.drive.milesDriven.toFixed(1)} {t('common.mi')}
                </span>
                <span aria-hidden="true">·</span>
                <span dir="ltr" className="font-mono tabular-nums">
                  {formatCurrency(item.reimbursementEstimate)}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {item.drive.durationMinutes} {t('common.min')} (
                  {formatLocalizedClock(item.drive.startedAt)}–
                  {formatLocalizedClock(item.drive.endedAt)})
                </span>
                <span aria-hidden="true">·</span>
                <span>{tPurpose(item.suggestedPurpose)}</span>
                {item.drive.isSimulated && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-blue-700 dark:text-blue-400 font-medium">
                      {t('drive.simulatedPreview')}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void onQuickLogDrive(item)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
              >
                <Check className="w-3.5 h-3.5" />
                {t('nav.log')}
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => onLoadDriveIntoForm(item)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap"
              >
                <Edit3 className="w-3.5 h-3.5" />
                {t('drive.review')}
              </button>
              <button
                type="button"
                onClick={() => onDismissDrive(item.drive.id)}
                aria-label={t('common.dismiss')}
                className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded-md transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
