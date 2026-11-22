import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import {
  ArrowUpDown,
  Calculator,
  CalendarClock,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';
import { suggestTripPurpose } from '../lib/purposeSuggestion';
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
  type TripPurpose,
  type UserProfile,
} from '../types/mileage';
import { LocationPickerInput } from './LocationPickerInput';
import type { NewTripInput } from './TripLoggerView';
import type { EditTripPatch } from './TripLedgerView';

const METERS_PER_MILE = 1609.344;

function offsetDateISO(daysAgo: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() - daysAgo);
  return formatDateISO(dt);
}

const DATE_PRESETS = [
  { label: 'Yesterday', daysAgo: 1 },
  { label: '2 Days Ago', daysAgo: 2 },
  { label: 'Last Week', daysAgo: 7 },
  { label: 'Today', daysAgo: 0 },
] as const;

export interface PastDriveModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initialTrip?: MileageTrip | null;
  profile: UserProfile | null;
  stores: StoreLocation[];
  templates: RouteTemplate[];
  findNearestStore: (
    lat: number,
    lng: number,
    maxMiles?: number
  ) => { store: StoreLocation; distanceMiles: number } | null;
  onClose: () => void;
  onCreateTrip: (input: NewTripInput) => Promise<void>;
  onUpdateTrip: (trip: MileageTrip, patch: EditTripPatch) => Promise<void>;
  onDeleteTrip?: (tripId: string) => Promise<void>;
}

function toPlaceSelectionFromTrip(
  name: string,
  address: string,
  placeId: string,
  stores: StoreLocation[]
): PlaceSelection | null {
  if (!name.trim()) return null;
  const matched = placeId ? stores.find((s) => s.placeId === placeId) : undefined;
  return {
    name,
    address,
    placeId,
    lat: matched?.lat,
    lng: matched?.lng,
  };
}

export function PastDriveModal({
  isOpen,
  mode,
  initialTrip = null,
  profile,
  stores,
  templates,
  findNearestStore,
  onClose,
  onCreateTrip,
  onUpdateTrip,
  onDeleteTrip,
}: PastDriveModalProps) {
  const routesLib = useMapsLibrary('routes');
  const todayIso = useMemo(() => formatDateISO(), []);

  const [tripDate, setTripDate] = useState<string>(() => offsetDateISO(1));
  const [origin, setOrigin] = useState<PlaceSelection | null>(null);
  const [destination, setDestination] = useState<PlaceSelection | null>(null);
  const [purpose, setPurpose] = useState<TripPurpose>('Inter-Store Transfer');
  const [purposeTouchedManually, setPurposeTouchedManually] = useState(false);
  const [oneWayMilesStr, setOneWayMilesStr] = useState<string>('');
  const [durationMinutesStr, setDurationMinutesStr] = useState<string>('');
  const [isRoundTrip, setIsRoundTrip] = useState(false);
  const [applyCommuteDeduction, setApplyCommuteDeduction] = useState(false);
  const [customCommuteMiles, setCustomCommuteMiles] = useState<number>(0);
  const [notes, setNotes] = useState<string>('');
  const [captureMethod, setCaptureMethod] = useState<CaptureMethod>('manual');

  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  const [routeCalcMsg, setRouteCalcMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isDuplicateMode = mode === 'create' && Boolean(initialTrip);
  const ratePerMile =
    mode === 'edit' && initialTrip
      ? initialTrip.ratePerMile
      : profile?.ratePerMile ?? DEFAULT_RATE_PER_MILE;
  const profileCommuteMiles = profile?.normalCommuteMiles ?? 0;

  // Populate fields whenever modal opens
  useEffect(() => {
    if (!isOpen) return;

    setErrorMsg(null);
    setRouteCalcMsg(null);
    setConfirmDelete(false);

    if (initialTrip) {
      setTripDate(mode === 'edit' ? initialTrip.tripDate : offsetDateISO(1));
      setOrigin(
        toPlaceSelectionFromTrip(
          initialTrip.originName,
          initialTrip.originAddress,
          initialTrip.originPlaceId,
          stores
        )
      );
      setDestination(
        toPlaceSelectionFromTrip(
          initialTrip.destinationName,
          initialTrip.destinationAddress,
          initialTrip.destinationPlaceId,
          stores
        )
      );
      setPurpose(initialTrip.purpose);
      setPurposeTouchedManually(true);
      setOneWayMilesStr(initialTrip.oneWayMiles > 0 ? String(initialTrip.oneWayMiles) : '');
      setDurationMinutesStr(
        initialTrip.durationMinutes > 0 ? String(initialTrip.durationMinutes) : ''
      );
      setIsRoundTrip(initialTrip.isRoundTrip);
      const existingCommute = initialTrip.commuteDeductionMiles ?? 0;
      setApplyCommuteDeduction(existingCommute > 0);
      setCustomCommuteMiles(existingCommute > 0 ? existingCommute : profileCommuteMiles);
      setNotes(initialTrip.notes ?? '');
      setCaptureMethod(mode === 'edit' ? initialTrip.captureMethod : 'manual');
    } else {
      setTripDate(offsetDateISO(1));
      if (profile?.homeStoreName) {
        const matchedHome = stores.find((s) => s.placeId === profile.homeStorePlaceId);
        setOrigin({
          name: profile.homeStoreName,
          address: profile.homeStoreAddress,
          placeId: profile.homeStorePlaceId,
          lat: matchedHome?.lat,
          lng: matchedHome?.lng,
        });
      } else {
        setOrigin(null);
      }
      setDestination(null);
      setPurpose('Inter-Store Transfer');
      setPurposeTouchedManually(false);
      setOneWayMilesStr('');
      setDurationMinutesStr('');
      setIsRoundTrip(false);
      setApplyCommuteDeduction(false);
      setCustomCommuteMiles(profileCommuteMiles);
      setNotes('');
      setCaptureMethod('manual');
    }
  }, [isOpen, mode, initialTrip, profile, stores, profileCommuteMiles]);

  // Escape key closes modal safely
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving && !isDeleting) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isSaving, isDeleting, onClose]);

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

  useEffect(() => {
    if (!isOpen) return;
    if (!purposeTouchedManually && purposeSuggestion) {
      setPurpose(purposeSuggestion.purpose);
    }
  }, [isOpen, purposeSuggestion, purposeTouchedManually]);

  const handleCalculateRouteMiles = useCallback(async () => {
    if (!origin || !destination) return;
    if (!routesLib) {
      setRouteCalcMsg('Google Maps routing is still loading. Enter miles manually or retry shortly.');
      return;
    }

    setIsCalculatingRoute(true);
    setRouteCalcMsg(null);
    setErrorMsg(null);

    try {
      const originWaypoint =
        typeof origin.lat === 'number' && typeof origin.lng === 'number'
          ? { lat: origin.lat, lng: origin.lng }
          : origin.address || origin.name;
      const destWaypoint =
        typeof destination.lat === 'number' && typeof destination.lng === 'number'
          ? { lat: destination.lat, lng: destination.lng }
          : destination.address || destination.name;

      const RouteClass = (
        routesLib as unknown as {
          Route: {
            computeRoutes: (req: Record<string, unknown>) => Promise<{
              routes?: Array<{ distanceMeters?: number; durationMillis?: number }>;
            }>;
          };
        }
      ).Route;

      const { routes } = await RouteClass.computeRoutes({
        origin: originWaypoint,
        destination: destWaypoint,
        travelMode: 'DRIVING',
        fields: ['distanceMeters', 'durationMillis'],
        internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
      });

      const primary = routes?.[0];
      if (!primary || typeof primary.distanceMeters !== 'number') {
        setRouteCalcMsg('No driving route found for these locations. Enter miles manually.');
        return;
      }

      const miles = round1(primary.distanceMeters / METERS_PER_MILE);
      const mins =
        typeof primary.durationMillis === 'number'
          ? Math.max(1, Math.round(primary.durationMillis / 60000))
          : 0;

      setOneWayMilesStr(miles.toFixed(1));
      if (mins > 0) setDurationMinutesStr(String(mins));
      if (mode === 'create') setCaptureMethod('route_auto');
      setRouteCalcMsg(`Calculated ${miles.toFixed(1)} mi one-way${mins > 0 ? ` · ~${mins} min` : ''}.`);
    } catch (err) {
      console.error('PastDriveModal route calculation error:', err);
      setRouteCalcMsg('Unable to calculate driving distance automatically. You can enter miles manually.');
    } finally {
      setIsCalculatingRoute(false);
    }
  }, [origin, destination, routesLib, mode]);

  if (!isOpen) return null;

  const parsedMiles = parseFloat(oneWayMilesStr);
  const validOneWayMiles = Number.isFinite(parsedMiles) && parsedMiles >= 0.1 && parsedMiles <= 2000;
  const parsedDuration = parseInt(durationMinutesStr, 10);
  const safeDurationMinutes =
    Number.isFinite(parsedDuration) && parsedDuration > 0 ? Math.min(1440, parsedDuration) : 0;

  const activeCommuteDeduction = applyCommuteDeduction ? Math.max(0, customCommuteMiles) : 0;
  const billableMiles = validOneWayMiles
    ? calculateBillableMiles(parsedMiles, isRoundTrip, activeCommuteDeduction)
    : 0;
  const reimbursementAmount = calculateReimbursement(billableMiles, ratePerMile);

  const canSubmit = Boolean(
    origin?.name.trim() &&
      destination?.name.trim() &&
      tripDate &&
      validOneWayMiles &&
      billableMiles > 0
  );

  const handleSwap = () => {
    const prev = origin;
    setOrigin(destination);
    setDestination(prev);
    setRouteCalcMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!origin?.name.trim() || !destination?.name.trim()) {
      setErrorMsg('Select both an origin and a destination for this drive.');
      return;
    }
    if (!validOneWayMiles || billableMiles <= 0) {
      setErrorMsg('Enter valid one-way miles so billable mileage is greater than 0.0 mi.');
      return;
    }

    setIsSaving(true);
    try {
      if (mode === 'edit' && initialTrip) {
        await onUpdateTrip(initialTrip, {
          tripDate,
          originName: origin.name.trim(),
          originAddress: origin.address.trim(),
          originPlaceId: origin.placeId.trim(),
          destinationName: destination.name.trim(),
          destinationAddress: destination.address.trim(),
          destinationPlaceId: destination.placeId.trim(),
          purpose,
          notes: notes.trim(),
          oneWayMiles: round1(parsedMiles),
          commuteDeductionMiles: round1(activeCommuteDeduction),
          billableMiles,
          durationMinutes: safeDurationMinutes,
          isRoundTrip,
          reimbursementAmount,
        });
      } else {
        await onCreateTrip({
          tripDate,
          originName: origin.name.trim(),
          originAddress: origin.address.trim(),
          originPlaceId: origin.placeId.trim(),
          destinationName: destination.name.trim(),
          destinationAddress: destination.address.trim(),
          destinationPlaceId: destination.placeId.trim(),
          purpose,
          notes: notes.trim(),
          oneWayMiles: round1(parsedMiles),
          commuteDeductionMiles: round1(activeCommuteDeduction),
          billableMiles,
          durationMinutes: safeDurationMinutes,
          isRoundTrip,
          captureMethod,
          ratePerMile,
          reimbursementAmount,
        });
      }
      onClose();
    } catch {
      setErrorMsg(
        mode === 'edit'
          ? 'Unable to save changes to this drive. Please check all fields and try again.'
          : 'Unable to add past drive entry. Please check all fields and try again.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!initialTrip || !onDeleteTrip) return;
    setIsDeleting(true);
    setErrorMsg(null);
    try {
      await onDeleteTrip(initialTrip.id);
      onClose();
    } catch {
      setErrorMsg('Unable to delete this drive entry. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 dark:bg-black/75 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="past-drive-modal-title"
      onClick={() => {
        if (!isSaving && !isDeleting) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-xl w-full max-h-[92vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/70 text-blue-700 dark:text-blue-400 flex items-center justify-center shrink-0">
              <CalendarClock className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2
                id="past-drive-modal-title"
                className="text-sm font-semibold text-slate-900 dark:text-slate-100"
              >
                {mode === 'edit'
                  ? 'Edit Past Drive Entry'
                  : isDuplicateMode
                    ? 'Duplicate Past Drive Entry'
                    : 'Add Past Drive Entry'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {mode === 'edit'
                  ? 'Update date, stops, mileage, purpose, or notes for this unsubmitted drive.'
                  : 'Log a previous business drive directly into your reimbursement ledger.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSaving || isDeleting}
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Date + Quick Past-Date Presets */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="past-drive-date"
                className="text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Drive Date
              </label>
              <div className="flex flex-wrap items-center gap-1">
                {DATE_PRESETS.map((preset) => {
                  const presetIso = offsetDateISO(preset.daysAgo);
                  const active = tripDate === presetIso;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setTripDate(presetIso)}
                      className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-transparent'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <input
              id="past-drive-date"
              type="date"
              max={todayIso}
              required
              value={tripDate}
              onChange={(e) => setTripDate(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          {/* Origin + Swap + Destination */}
          <div className="space-y-2.5">
            <LocationPickerInput
              id="past-drive-origin"
              label="Origin (Start)"
              placeholder="Pick a Curacao store or search LA address..."
              value={origin}
              onChange={(place) => {
                setOrigin(place);
                setRouteCalcMsg(null);
              }}
              stores={stores}
              homeStorePlaceId={profile?.homeStorePlaceId}
              findNearestStore={findNearestStore}
              accentDotColor="#15803d"
            />

            <div className="flex items-center justify-between gap-2">
              <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
              <button
                type="button"
                onClick={handleSwap}
                disabled={!origin && !destination}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                <ArrowUpDown className="w-3 h-3" />
                Swap
              </button>
              <button
                type="button"
                disabled={!origin || !destination || isCalculatingRoute}
                onClick={() => void handleCalculateRouteMiles()}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/70 hover:bg-blue-100 dark:hover:bg-blue-900/60 disabled:opacity-45 disabled:cursor-not-allowed rounded-md transition-colors whitespace-nowrap"
              >
                {isCalculatingRoute ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Calculator className="w-3 h-3" />
                )}
                {isCalculatingRoute ? 'Calculating...' : 'Auto-Fill Route Miles'}
              </button>
              <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
            </div>

            <LocationPickerInput
              id="past-drive-destination"
              label="Destination (Stop)"
              placeholder="Pick a Curacao store, bank, or LA address..."
              value={destination}
              onChange={(place) => {
                setDestination(place);
                setRouteCalcMsg(null);
              }}
              stores={stores}
              homeStorePlaceId={profile?.homeStorePlaceId}
              findNearestStore={findNearestStore}
              accentDotColor="#d97706"
            />

            {routeCalcMsg && (
              <p className="text-xs text-blue-700 dark:text-blue-400 font-mono tabular-nums">
                {routeCalcMsg}
              </p>
            )}
          </div>

          {/* Direction + Miles + Duration */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <span className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Trip Direction
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
                  One-Way
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
                  Round Trip
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="past-drive-miles"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                One-Way Miles
              </label>
              <input
                id="past-drive-miles"
                type="number"
                min="0.1"
                max="2000"
                step="0.1"
                required
                placeholder="0.0"
                value={oneWayMilesStr}
                onChange={(e) => {
                  setOneWayMilesStr(e.target.value);
                  if (mode === 'create') setCaptureMethod('manual');
                }}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="past-drive-duration"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Duration (Min)
              </label>
              <input
                id="past-drive-duration"
                type="number"
                min="0"
                max="1440"
                step="1"
                placeholder="Optional"
                value={durationMinutesStr}
                onChange={(e) => setDurationMinutesStr(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>
          </div>

          {/* Purpose + Optional Commute Deduction */}
          <div className="space-y-2">
            <div>
              <label
                htmlFor="past-drive-purpose"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Business Purpose
              </label>
              <select
                id="past-drive-purpose"
                value={purpose}
                onChange={(e) => {
                  setPurpose(e.target.value as TripPurpose);
                  setPurposeTouchedManually(true);
                }}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              >
                {TRIP_PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            {purposeSuggestion && purpose !== purposeSuggestion.purpose && (
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="truncate">
                  Suggested: {purposeSuggestion.purpose}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPurpose(purposeSuggestion.purpose);
                    setPurposeTouchedManually(false);
                  }}
                  className="text-blue-700 dark:text-blue-400 hover:underline font-medium whitespace-nowrap"
                >
                  Apply {purposeSuggestion.purpose}
                </button>
              </div>
            )}

            {(profileCommuteMiles > 0 || customCommuteMiles > 0) && (
              <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none pt-0.5">
                <input
                  type="checkbox"
                  checked={applyCommuteDeduction}
                  onChange={(e) => setApplyCommuteDeduction(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 dark:border-slate-700 text-blue-700 focus:ring-blue-600"
                />
                <span>
                  Subtract normal daily commute ({customCommuteMiles.toFixed(1)} mi{' '}
                  {isRoundTrip ? 'each way' : 'one-way'})
                </span>
              </label>
            )}
          </div>

          {/* Notes */}
          <div>
            <label
              htmlFor="past-drive-notes"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Notes / Transfer Ticket (Optional)
            </label>
            <input
              id="past-drive-notes"
              type="text"
              maxLength={FIELD_LIMITS.notes}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., Retroactive log — Shift coverage at South Gate branch"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          {/* Live Reimbursement Summary Strip */}
          <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center justify-between gap-3">
            <div className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
              {billableMiles.toFixed(1)} billable mi × ${ratePerMile.toFixed(2)}/mi
            </div>
            <div className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatCurrency(reimbursementAmount)}
            </div>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="px-3 py-2 text-xs text-red-900 dark:text-red-200 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/70 rounded-lg"
            >
              {errorMsg}
            </div>
          )}

          {/* Footer Actions (with inline Delete confirmation in Edit mode) */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              {mode === 'edit' && initialTrip && onDeleteTrip && (
                !confirmDelete ? (
                  <button
                    type="button"
                    disabled={isSaving || isDeleting}
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Entry
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => void handleDeleteConfirmed()}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg whitespace-nowrap"
                    >
                      {isDeleting ? 'Deleting...' : 'Confirm Delete'}
                    </button>
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => setConfirmDelete(false)}
                      className="px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg whitespace-nowrap"
                    >
                      Keep
                    </button>
                  </div>
                )
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto shrink-0">
              <button
                type="button"
                disabled={isSaving || isDeleting}
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit || isSaving || isDeleting}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:bg-slate-300 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap"
              >
                {isSaving
                  ? 'Saving...'
                  : mode === 'edit'
                    ? 'Save Changes'
                    : 'Add Past Drive'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
