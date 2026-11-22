import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  Calendar,
  CheckCircle2,
  CheckSquare,
  Clock,
  Copy,
  Download,
  FileCheck2,
  FolderInput,
  Map as MapIcon,
  MapPin,
  Pencil,
  Plus,
  Search,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { downloadTripsCsv } from '../lib/exportUtils';
import { useI18n, type MessageKey } from '../lib/i18n';
import { downloadTripReceiptPdf } from '../lib/pdfReportGenerator';
import {
  formatCurrency,
  TRIP_PURPOSES,
  type MileageReport,
  type MileageTrip,
  type RouteTemplate,
  type StoreLocation,
  type TripExpense,
  type TripPurpose,
  type UserProfile,
} from '../types/mileage';
import { LedgerMapViewModal } from './LedgerMapViewModal';
import { PastDriveModal } from './PastDriveModal';
import { TopDestinationsCard } from './TopDestinationsCard';
import type { NewTripInput } from './TripLoggerView';
import { TripRouteMiniMap } from './TripRouteMiniMap';

export interface EditTripPatch {
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
  reimbursementAmount: number;
}

type TripStage = 'ready' | 'submitted' | 'reimbursed';

type TripSortOption =
  | 'date_desc'
  | 'date_asc'
  | 'amount_desc'
  | 'amount_asc'
  | 'destination_asc'
  | 'destination_desc';

const SORT_OPTIONS: Array<{ value: TripSortOption; labelKey: MessageKey }> = [
  { value: 'date_desc', labelKey: 'sort.date_desc' },
  { value: 'date_asc', labelKey: 'sort.date_asc' },
  { value: 'amount_desc', labelKey: 'sort.amount_desc' },
  { value: 'amount_asc', labelKey: 'sort.amount_asc' },
  { value: 'destination_asc', labelKey: 'sort.destination_asc' },
  { value: 'destination_desc', labelKey: 'sort.destination_desc' },
];

function getTripStage(
  trip: MileageTrip,
  reportById: Record<string, MileageReport>
): TripStage {
  if (trip.status === 'ready') return 'ready';
  const linkedReport = trip.reportId ? reportById[trip.reportId] : undefined;
  if (linkedReport?.status === 'reimbursed') return 'reimbursed';
  return 'submitted';
}

const STAGE_BADGE_CONFIG: Record<
  TripStage,
  {
    label: string;
    className: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  ready: {
    label: 'Ready',
    className:
      'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/70',
    Icon: Clock,
  },
  submitted: {
    label: 'Submitted',
    className:
      'bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800/70',
    Icon: Send,
  },
  reimbursed: {
    label: 'Reimbursed',
    className:
      'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/70',
    Icon: CheckCircle2,
  },
};

interface TripLedgerViewProps {
  profile: UserProfile | null;
  trips: MileageTrip[];
  expenses: TripExpense[];
  reports: MileageReport[];
  stores: StoreLocation[];
  biasCenter?: google.maps.LatLngLiteral | null;
  onManageLocations?: () => void;
  templates: RouteTemplate[];
  findNearestStore: (
    lat: number,
    lng: number,
    maxMiles?: number
  ) => { store: StoreLocation; distanceMiles: number } | null;
  loading: boolean;
  isAuthenticated: boolean;
  onRequestSignIn: () => void;
  onGoToLogger: () => void;
  onCreateTrip: (input: NewTripInput) => Promise<void>;
  onUpdateTrip: (trip: MileageTrip, patch: EditTripPatch) => Promise<void>;
  onDeleteTrip: (tripId: string) => Promise<void>;
  onBatchDeleteTrips: (tripIds: string[]) => Promise<void>;
  onGenerateReport: (selectedTrips: MileageTrip[]) => Promise<void>;
  onAssignTripsToReport: (targetTrips: MileageTrip[], report: MileageReport) => Promise<void>;
  onOpenQuickExpense: (tripId?: string) => void;
  onOpenReport: (reportId: string) => void;
}

export function TripLedgerView({
  profile,
  trips,
  expenses,
  reports,
  stores,
  biasCenter,
  onManageLocations,
  templates,
  findNearestStore,
  loading,
  isAuthenticated,
  onRequestSignIn,
  onGoToLogger,
  onCreateTrip,
  onUpdateTrip,
  onDeleteTrip,
  onBatchDeleteTrips,
  onGenerateReport,
  onAssignTripsToReport,
  onOpenQuickExpense,
  onOpenReport,
}: TripLedgerViewProps) {
  const { t, tPurpose, tStage, formatLocalizedDate } = useI18n();
  const [statusFilter, setStatusFilter] = useState<'all' | TripStage>('all');
  const [sortBy, setSortBy] = useState<TripSortOption>('date_desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [purposeFilter, setPurposeFilter] = useState<'all' | TripPurpose>('all');
  const [dateFilter, setDateFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [inspectedTripId, setInspectedTripId] = useState<string | null>(null);
  const miniMapSectionRef = useRef<HTMLDivElement | null>(null);
  const [assignTargetId, setAssignTargetId] = useState<string>('__new__');
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [confirmDeleteRowId, setConfirmDeleteRowId] = useState<string | null>(null);
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null);

  const [driveModalState, setDriveModalState] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    initialTrip: MileageTrip | null;
  }>({
    open: false,
    mode: 'create',
    initialTrip: null,
  });
  const [mapViewOpen, setMapViewOpen] = useState(false);
  const [tripPdfSavedId, setTripPdfSavedId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isBatchBusy, setIsBatchBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{
    text: string;
    reportId?: string;
  } | null>(null);

  const readyTrips = useMemo(() => trips.filter((t) => t.status === 'ready'), [trips]);

  // Open reports eligible to receive additional batch-assigned trips
  const assignableReports = useMemo(
    () =>
      reports
        .filter((r) => r.status === 'submitted')
        .sort((a, b) => (b.submittedAt?.seconds ?? 0) - (a.submittedAt?.seconds ?? 0)),
    [reports]
  );

  // Fast report lookup by reportId for displaying assigned report reference & reimbursed stage
  const reportById = useMemo(() => {
    const lookup: Record<string, MileageReport> = {};
    for (const r of reports) {
      lookup[r.id] = r;
    }
    return lookup;
  }, [reports]);

  // Fast expense lookup by tripId
  const expensesByTripId = useMemo(() => {
    const lookup: Record<string, TripExpense[]> = {};
    for (const exp of expenses) {
      if (!exp.tripId) continue;
      if (!lookup[exp.tripId]) lookup[exp.tripId] = [];
      lookup[exp.tripId].push(exp);
    }
    return lookup;
  }, [expenses]);

  const filteredTrips = useMemo(() => {
    const tokens = searchQuery
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return trips
      .filter((t) => {
        if (statusFilter === 'all') return true;
        return getTripStage(t, reportById) === statusFilter;
      })
      .filter((t) => (purposeFilter === 'all' ? true : t.purpose === purposeFilter))
      .filter((t) => (!dateFilter ? true : t.tripDate === dateFilter))
      .filter((trip) => {
        if (tokens.length === 0) return true;
        const formattedDate = formatLocalizedDate(trip.tripDate).toLowerCase();
        const reportRef = (reportById[trip.reportId]?.reportNumber ?? '').toLowerCase();
        const stage = getTripStage(trip, reportById);
        const localizedPurpose = tPurpose(trip.purpose).toLowerCase();
        const localizedStage = tStage(stage).toLowerCase();
        const searchableText = [
          trip.originName,
          trip.originAddress,
          trip.destinationName,
          trip.destinationAddress,
          trip.purpose,
          localizedPurpose,
          trip.notes,
          trip.tripDate,
          formattedDate,
          reportRef,
          stage,
          localizedStage,
        ]
          .join(' ')
          .toLowerCase();
        return tokens.every((token) => searchableText.includes(token));
      })
      .sort((a, b) => {
        const tieBreak = () => {
          const dateCmp = b.tripDate.localeCompare(a.tripDate);
          if (dateCmp !== 0) return dateCmp;
          return (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0);
        };

        switch (sortBy) {
          case 'date_asc': {
            const cmp = a.tripDate.localeCompare(b.tripDate);
            return cmp !== 0 ? cmp : (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0);
          }
          case 'amount_desc': {
            const cmp = b.reimbursementAmount - a.reimbursementAmount;
            return cmp !== 0 ? cmp : tieBreak();
          }
          case 'amount_asc': {
            const cmp = a.reimbursementAmount - b.reimbursementAmount;
            return cmp !== 0 ? cmp : tieBreak();
          }
          case 'destination_asc': {
            const cmp = a.destinationName.localeCompare(b.destinationName, undefined, {
              sensitivity: 'base',
            });
            return cmp !== 0 ? cmp : tieBreak();
          }
          case 'destination_desc': {
            const cmp = b.destinationName.localeCompare(a.destinationName, undefined, {
              sensitivity: 'base',
            });
            return cmp !== 0 ? cmp : tieBreak();
          }
          case 'date_desc':
          default:
            return tieBreak();
        }
      });
  }, [
    trips,
    statusFilter,
    purposeFilter,
    dateFilter,
    searchQuery,
    sortBy,
    reportById,
    formatLocalizedDate,
    tPurpose,
    tStage,
  ]);

  const inspectedTripIndex = useMemo(
    () => (inspectedTripId ? filteredTrips.findIndex((t) => t.id === inspectedTripId) : -1),
    [filteredTrips, inspectedTripId]
  );

  const inspectedTrip = useMemo(() => {
    if (!inspectedTripId) return null;
    if (inspectedTripIndex >= 0) return filteredTrips[inspectedTripIndex];
    return trips.find((t) => t.id === inspectedTripId) ?? null;
  }, [inspectedTripId, inspectedTripIndex, filteredTrips, trips]);

  useEffect(() => {
    if (inspectedTripId && !trips.some((t) => t.id === inspectedTripId)) {
      setInspectedTripId(null);
    }
  }, [trips, inspectedTripId]);

  const handleInspectTrip = (tripId: string) => {
    setInspectedTripId(tripId);
    window.requestAnimationFrame(() => {
      const el = miniMapSectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.top < 16 || rect.top > window.innerHeight * 0.65) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  };

  const selectedTrips = useMemo(
    () => trips.filter((t) => selectedIds[t.id]),
    [trips, selectedIds]
  );

  const selectedReadyTrips = useMemo(
    () => selectedTrips.filter((t) => t.status === 'ready'),
    [selectedTrips]
  );

  const selectedSubmittedCount = selectedTrips.length - selectedReadyTrips.length;

  const chosenReadyTrips = useMemo(
    () => (selectedReadyTrips.length > 0 ? selectedReadyTrips : readyTrips),
    [readyTrips, selectedReadyTrips]
  );

  const allFilteredSelected =
    filteredTrips.length > 0 && filteredTrips.every((t) => Boolean(selectedIds[t.id]));

  const hasActiveFilters = Boolean(
    searchQuery.trim() || purposeFilter !== 'all' || dateFilter || statusFilter !== 'all'
  );

  const totalFilteredMiles = useMemo(
    () => filteredTrips.reduce((sum, t) => sum + t.billableMiles, 0),
    [filteredTrips]
  );
  const totalFilteredAmount = useMemo(
    () => filteredTrips.reduce((sum, t) => sum + t.reimbursementAmount, 0),
    [filteredTrips]
  );

  const toggleSelect = (id: string) => {
    setConfirmBatchDelete(false);
    setSelectedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleSelectAllFiltered = () => {
    setConfirmBatchDelete(false);
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = { ...prev };
        for (const t of filteredTrips) {
          delete next[t.id];
        }
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = { ...prev };
        for (const t of filteredTrips) {
          next[t.id] = true;
        }
        return next;
      });
    }
  };

  const clearSelection = () => {
    setSelectedIds({});
    setConfirmBatchDelete(false);
  };

  const clearAllFilters = () => {
    setSearchQuery('');
    setPurposeFilter('all');
    setDateFilter('');
    setStatusFilter('all');
  };

  const handleExportCsv = () => {
    const targetTrips = selectedTrips.length > 0 ? selectedTrips : filteredTrips;
    if (targetTrips.length === 0) return;
    downloadTripsCsv(targetTrips, {
      filenamePrefix:
        selectedTrips.length > 0 ? 'MileTrack_Selected_Trips' : 'MileTrack_Filtered_Trips',
      reportById,
      expensesByTripId,
    });
  };

  const handleDownloadTripPdf = (trip: MileageTrip) => {
    setActionError(null);
    try {
      const stage = getTripStage(trip, reportById);
      const reportNumber = trip.reportId ? reportById[trip.reportId]?.reportNumber : undefined;
      const tripExpenses = expensesByTripId[trip.id] ?? [];
      downloadTripReceiptPdf(trip, {
        employeeName: profile?.employeeName,
        employeeId: profile?.employeeId,
        department: profile?.department,
        homeStoreName: profile?.homeStoreName,
        vehicleInfo: profile?.vehicleInfo,
        reportNumber,
        stage,
        expenses: tripExpenses,
      });
      setTripPdfSavedId(trip.id);
      window.setTimeout(() => {
        setTripPdfSavedId((prev) => (prev === trip.id ? null : prev));
      }, 2500);
    } catch (err) {
      console.error('Single-trip PDF receipt generation failed:', err);
      setActionError('Unable to generate PDF receipt for this trip. Please try again.');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedReadyTrips.length === 0) return;
    setIsBatchBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const count = selectedReadyTrips.length;
      const idsToDelete = selectedReadyTrips.map((t) => t.id);
      await onBatchDeleteTrips(idsToDelete);
      if (inspectedTripId && idsToDelete.includes(inspectedTripId)) {
        setInspectedTripId(null);
      }
      clearSelection();
      setActionNotice({
        text: `Deleted ${count} unsubmitted ${count === 1 ? 'trip' : 'trips'} from your ledger.`,
      });
    } catch {
      setActionError('Failed to delete selected trips. Please try again.');
    } finally {
      setIsBatchBusy(false);
    }
  };

  const handleBatchAssign = async () => {
    if (selectedReadyTrips.length === 0) return;
    setIsBatchBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      if (assignTargetId === '__new__') {
        await onGenerateReport(selectedReadyTrips);
        clearSelection();
      } else {
        const targetReport = assignableReports.find((r) => r.id === assignTargetId);
        if (!targetReport) {
          setActionError('Please choose an open submitted report or select Create New Report.');
          return;
        }
        const count = selectedReadyTrips.length;
        await onAssignTripsToReport(selectedReadyTrips, targetReport);
        clearSelection();
        setActionNotice({
          text: `Assigned ${count} ${count === 1 ? 'trip' : 'trips'} to report ${targetReport.reportNumber}.`,
          reportId: targetReport.id,
        });
      }
    } catch {
      setActionError('Failed to assign selected trips to report. Please try again.');
    } finally {
      setIsBatchBusy(false);
    }
  };

  const openCreatePastDrive = () => {
    setActionError(null);
    setConfirmDeleteRowId(null);
    setDriveModalState({ open: true, mode: 'create', initialTrip: null });
  };

  const openEditPastDrive = (trip: MileageTrip) => {
    setActionError(null);
    setConfirmDeleteRowId(null);
    setDriveModalState({ open: true, mode: 'edit', initialTrip: trip });
  };

  const openDuplicatePastDrive = (trip: MileageTrip) => {
    setActionError(null);
    setConfirmDeleteRowId(null);
    setDriveModalState({ open: true, mode: 'create', initialTrip: trip });
  };

  const handleCreatePastDrive = async (input: NewTripInput) => {
    await onCreateTrip(input);
    setActionNotice({
      text: `${formatLocalizedDate(input.tripDate)} (${input.billableMiles.toFixed(1)} ${t('common.mi')} · ${formatCurrency(input.reimbursementAmount)})`,
    });
  };

  const handleUpdatePastDrive = async (trip: MileageTrip, patch: EditTripPatch) => {
    await onUpdateTrip(trip, patch);
    setActionNotice({
      text: `${formatLocalizedDate(patch.tripDate)} (${patch.billableMiles.toFixed(1)} ${t('common.mi')} · ${formatCurrency(patch.reimbursementAmount)})`,
    });
  };

  const handleSingleDeleteTrip = async (tripId: string) => {
    setDeletingRowId(tripId);
    setActionError(null);
    try {
      await onDeleteTrip(tripId);
      if (inspectedTripId === tripId) {
        setInspectedTripId(null);
      }
      setSelectedIds((prev) => {
        if (!prev[tripId]) return prev;
        const next = { ...prev };
        delete next[tripId];
        return next;
      });
      setConfirmDeleteRowId(null);
      setActionNotice({ text: 'Deleted drive entry from your ledger.' });
    } catch {
      setActionError('Failed to delete drive entry. Please try again.');
    } finally {
      setDeletingRowId(null);
    }
  };

  const handleSubmitSelected = async () => {
    if (chosenReadyTrips.length === 0) return;
    setIsGenerating(true);
    setActionError(null);
    setActionNotice(null);
    try {
      await onGenerateReport(chosenReadyTrips);
      clearSelection();
    } catch {
      setActionError('Failed to generate mileage report. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center max-w-lg mx-auto my-8 space-y-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {t('ledger.signInTitle')}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {t('ledger.signInDesc')}
        </p>
        <button
          type="button"
          onClick={onRequestSignIn}
          className="px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap"
        >
          {t('auth.signInGoogle')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {t('ledger.readyToSubmit')}
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span
              className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100"
              dir="ltr"
            >
              {readyTrips.reduce((s, trip) => s + trip.billableMiles, 0).toFixed(1)}{' '}
              {t('common.mi')}
            </span>
            <span
              className="text-sm font-semibold font-mono tabular-nums text-amber-700 dark:text-amber-400"
              dir="ltr"
            >
              {formatCurrency(readyTrips.reduce((s, trip) => s + trip.reimbursementAmount, 0))}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {readyTrips.length}{' '}
            {readyTrips.length === 1
              ? t('ledger.unsubmittedSingle')
              : t('ledger.unsubmittedPlural')}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {t('ledger.filteredTotal')}
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span
              className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100"
              dir="ltr"
            >
              {totalFilteredMiles.toFixed(1)} {t('common.mi')}
            </span>
            <span
              className="text-sm font-semibold font-mono tabular-nums text-blue-800 dark:text-blue-400"
              dir="ltr"
            >
              {formatCurrency(totalFilteredAmount)}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {filteredTrips.length}{' '}
            {filteredTrips.length === 1 ? t('ledger.shownSingle') : t('ledger.shownPlural')}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-3">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {t('ledger.readyReportTitle')}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              {chosenReadyTrips.length > 0
                ? t('ledger.bundleHint', {
                    count: chosenReadyTrips.length,
                    unit:
                      chosenReadyTrips.length === 1
                        ? t('nav.tripSingular')
                        : t('nav.tripPlural'),
                  })
                : t('ledger.logToStart')}
            </p>
          </div>
          <button
            type="button"
            disabled={chosenReadyTrips.length === 0 || isGenerating}
            onClick={() => void handleSubmitSelected()}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:bg-slate-300 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap"
          >
            <FileCheck2 className="w-4 h-4" />
            {isGenerating
              ? t('ledger.generatingReport')
              : t('header.generateReport', { count: chosenReadyTrips.length })}
          </button>
        </div>
      </div>

      {/* Top Trip Destinations Analysis Card */}
      <TopDestinationsCard
        trips={trips}
        activeSearchQuery={searchQuery}
        onSelectDestination={(destName) => setSearchQuery(destName)}
      />

      {actionError && (
        <div
          role="alert"
          className="px-4 py-2.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/70 rounded-lg text-xs text-red-900 dark:text-red-200"
        >
          {actionError}
        </div>
      )}

      {actionNotice && (
        <div
          role="status"
          className="px-4 py-2.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/70 rounded-lg text-xs text-emerald-900 dark:text-emerald-200 flex flex-wrap items-center justify-between gap-3"
        >
          <span>{actionNotice.text}</span>
          <div className="flex items-center gap-3 shrink-0">
            {actionNotice.reportId && (
              <button
                type="button"
                onClick={() => onOpenReport(actionNotice.reportId!)}
                className="font-semibold text-emerald-900 dark:text-emerald-200 underline hover:text-emerald-700 dark:hover:text-emerald-100 whitespace-nowrap"
              >
                {t('ledger.openReport')}
              </button>
            )}
            <button
              type="button"
              onClick={() => setActionNotice(null)}
              className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-100"
            >
              {t('common.dismiss')}
            </button>
          </div>
        </div>
      )}

      {/* Interactive Route Mini-Map Preview (opens when a trip is clicked) */}
      <div ref={miniMapSectionRef}>
        {inspectedTrip && (
          <TripRouteMiniMap
            trip={inspectedTrip}
            expenses={expensesByTripId[inspectedTrip.id] ?? []}
            stores={stores}
            reportNumber={reportById[inspectedTrip.reportId]?.reportNumber}
            stage={getTripStage(inspectedTrip, reportById)}
            tripIndex={inspectedTripIndex >= 0 ? inspectedTripIndex : 0}
            totalTrips={inspectedTripIndex >= 0 ? filteredTrips.length : 1}
            pdfDownloaded={tripPdfSavedId === inspectedTrip.id}
            onDownloadPdf={() => handleDownloadTripPdf(inspectedTrip)}
            onAddExpense={() => onOpenQuickExpense(inspectedTrip.id)}
            onEditTrip={
              inspectedTrip.status === 'ready'
                ? () => openEditPastDrive(inspectedTrip)
                : undefined
            }
            onDuplicateTrip={() => openDuplicatePastDrive(inspectedTrip)}
            onPrevTrip={
              inspectedTripIndex > 0
                ? () => setInspectedTripId(filteredTrips[inspectedTripIndex - 1].id)
                : undefined
            }
            onNextTrip={
              inspectedTripIndex >= 0 && inspectedTripIndex < filteredTrips.length - 1
                ? () => setInspectedTripId(filteredTrips[inspectedTripIndex + 1].id)
                : undefined
            }
            onOpenReport={onOpenReport}
            onClose={() => setInspectedTripId(null)}
          />
        )}
      </div>

      {/* Search Bar, Filters, Batch Action Bar & Data Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {/* Search & Filter Toolbar */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
          {/* Primary Search Row */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                aria-label={t('ledger.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('ledger.searchPlaceholder')}
                className="w-full ps-9 pe-20 py-2 text-xs sm:text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
              {searchQuery && (
                <div className="absolute end-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                  <span
                    className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400"
                    dir="ltr"
                  >
                    {filteredTrips.length}/{trips.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label={t('common.clear')}
                    className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <select
                aria-label={t('ledger.colPurpose')}
                value={purposeFilter}
                onChange={(e) => setPurposeFilter(e.target.value as 'all' | TripPurpose)}
                className="px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              >
                <option value="all">{t('ledger.allPurposes')}</option>
                {TRIP_PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {tPurpose(p)}
                  </option>
                ))}
              </select>

              <div className="relative">
                <Calendar className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="date"
                  aria-label={t('ledger.colDate')}
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="ps-8 pe-2.5 py-2 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>
            </div>
          </div>

          {/* Secondary Status Tabs + Sort Dropdown + Export Row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                {(
                  [
                    ['all', t('ledger.allTrips')],
                    ['ready', tStage('ready')],
                    ['submitted', tStage('submitted')],
                    ['reimbursed', tStage('reimbursed')],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setStatusFilter(val)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      statusFilter === val
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="relative">
                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  aria-label={t('sort.date_desc')}
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as TripSortOption)}
                  className="ps-8 pe-7 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </option>
                  ))}
                </select>
              </div>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 whitespace-nowrap"
                >
                  {t('ledger.resetFilters')}
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {filteredTrips.length > 0 && !inspectedTrip && (
                <span className="hidden xl:inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 me-1">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                  {t('ledger.clickPreviewHint')}
                </span>
              )}
              <button
                type="button"
                onClick={openCreatePastDrive}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('ledger.addPastDrive')}
              </button>
              <button
                type="button"
                onClick={() => setMapViewOpen(true)}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/80 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <MapIcon className="w-3.5 h-3.5" />
                {t('ledger.mapView')}
              </button>
              <button
                type="button"
                disabled={selectedTrips.length === 0 && filteredTrips.length === 0}
                onClick={handleExportCsv}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-45 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                {selectedTrips.length > 0
                  ? t('ledger.exportCsvCount', { count: selectedTrips.length })
                  : filteredTrips.length > 0
                    ? t('ledger.exportCsvCount', { count: filteredTrips.length })
                    : t('ledger.exportCsv')}
              </button>
            </div>
          </div>
        </div>

        {/* Multi-Select Batch Action Bar */}
        {selectedTrips.length > 0 && (
          <div
            role="region"
            aria-label="Batch trip actions"
            className="px-4 py-3 bg-blue-50/80 dark:bg-blue-950/40 border-b border-blue-200 dark:border-blue-900/70 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-800 dark:text-slate-200">
              <span className="font-semibold font-mono tabular-nums text-blue-950 dark:text-blue-200">
                {t('ledger.selectedCount', {
                  count: selectedTrips.length,
                  unit:
                    selectedTrips.length === 1 ? t('nav.tripSingular') : t('nav.tripPlural'),
                })}
              </span>
              <span aria-hidden="true" className="text-blue-300 dark:text-blue-700">
                ·
              </span>
              <span className="text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                {selectedReadyTrips.length} {tStage('ready').toLowerCase()}
                {selectedSubmittedCount > 0
                  ? ` · ${selectedSubmittedCount} ${t('common.locked').toLowerCase()}`
                  : ''}
              </span>
              <span aria-hidden="true" className="text-blue-300 dark:text-blue-700">
                ·
              </span>
              <button
                type="button"
                onClick={clearSelection}
                className="font-medium text-blue-800 dark:text-blue-300 hover:text-blue-950 dark:hover:text-blue-200 underline whitespace-nowrap"
              >
                {t('ledger.clearSelection')}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Batch Assign to Specific Report */}
              <div className="flex items-center gap-1.5">
                <select
                  aria-label={t('ledger.createNewReport')}
                  value={assignTargetId}
                  onChange={(e) => setAssignTargetId(e.target.value)}
                  disabled={selectedReadyTrips.length === 0 || isBatchBusy}
                  className="px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800 rounded-lg text-slate-800 dark:text-slate-200 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                >
                  <option value="__new__">{t('ledger.createNewReport')}</option>
                  {assignableReports.map((rep) => (
                    <option key={rep.id} value={rep.id}>
                      {rep.reportNumber} ({rep.tripCount}{' '}
                      {rep.tripCount === 1 ? t('nav.tripSingular') : t('nav.tripPlural')})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={selectedReadyTrips.length === 0 || isBatchBusy}
                  onClick={() => void handleBatchAssign()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:bg-slate-300 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <FolderInput className="w-3.5 h-3.5" />
                  {isBatchBusy
                    ? t('ledger.assigning')
                    : t('ledger.assignToReport', { count: selectedReadyTrips.length })}
                </button>
              </div>

              {/* Batch Delete Unsubmitted Trips */}
              {!confirmBatchDelete ? (
                <button
                  type="button"
                  disabled={selectedReadyTrips.length === 0 || isBatchBusy}
                  onClick={() => setConfirmBatchDelete(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-300 bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/70 hover:bg-red-50 dark:hover:bg-red-950/50 disabled:opacity-45 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t('common.delete')} ({selectedReadyTrips.length})
                </button>
              ) : (
                <div className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isBatchBusy}
                    onClick={() => void handleBatchDelete()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    {isBatchBusy
                      ? t('common.deleting')
                      : t('ledger.confirmDeleteCount', { count: selectedReadyTrips.length })}
                  </button>
                  <button
                    type="button"
                    disabled={isBatchBusy}
                    onClick={() => setConfirmBatchDelete(false)}
                    className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="h-10 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
            ))}
          </div>
        ) : filteredTrips.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {trips.length === 0 ? t('ledger.noTripsTitle') : t('ledger.noTripsMatch')}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              {trips.length === 0 ? t('ledger.noTripsDesc') : t('ledger.noTripsMatchDesc')}
            </p>
            {trips.length === 0 ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={openCreatePastDrive}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  {t('ledger.addPastDrive')}
                </button>
                <button
                  type="button"
                  onClick={onGoToLogger}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap"
                >
                  {t('ledger.openLogger')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={clearAllFilters}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap"
              >
                {t('ledger.clearAllFilters')}
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 ps-4 pe-2 w-10">
                    <button
                      type="button"
                      onClick={toggleSelectAllFiltered}
                      aria-label={
                        allFilteredSelected
                          ? 'Deselect all visible trips'
                          : 'Select all visible trips'
                      }
                      className="text-slate-500 dark:text-slate-400 hover:text-blue-700 dark:hover:text-blue-400 align-middle"
                    >
                      {allFilteredSelected ? (
                        <CheckSquare className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  <th className="py-2.5 px-3 whitespace-nowrap">{t('ledger.colDate')}</th>
                  <th className="py-2.5 px-3">{t('ledger.colRoute')}</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">{t('ledger.colPurpose')}</th>
                  <th className="py-2.5 px-3 text-end whitespace-nowrap">{t('ledger.colMiles')}</th>
                  <th className="py-2.5 px-3 text-end whitespace-nowrap">
                    {t('ledger.colAmount')}
                  </th>
                  <th className="py-2.5 px-3 whitespace-nowrap">{t('ledger.colStatus')}</th>
                  <th className="py-2.5 ps-3 pe-4 text-end whitespace-nowrap">
                    {t('ledger.colActions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {filteredTrips.map((trip) => {
                  const isReady = trip.status === 'ready';
                  const stage = getTripStage(trip, reportById);
                  const badge = STAGE_BADGE_CONFIG[stage];
                  const StageIcon = badge.Icon;
                  const checked = Boolean(selectedIds[trip.id]);
                  const isInspected = inspectedTrip?.id === trip.id;
                  const reportRef = reportById[trip.reportId]?.reportNumber;
                  return (
                    <tr
                      key={trip.id}
                      onClick={() => handleInspectTrip(trip.id)}
                      aria-selected={isInspected}
                      className={`group cursor-pointer transition-colors ${
                        isInspected
                          ? 'bg-blue-50/75 dark:bg-blue-950/45 hover:bg-blue-50 dark:hover:bg-blue-950/55'
                          : checked
                            ? 'bg-blue-50/35 dark:bg-blue-950/25 hover:bg-blue-50/60 dark:hover:bg-blue-950/35'
                            : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <td
                        className="py-3 ps-4 pe-2 align-middle"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSelect(trip.id)}
                          aria-label={`Select trip on ${trip.tripDate}`}
                          className="text-slate-500 dark:text-slate-400 hover:text-blue-700 dark:hover:text-blue-400"
                        >
                          {checked ? (
                            <CheckSquare className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {formatLocalizedDate(trip.tripDate)}
                      </td>
                      <td className="py-3 px-3 min-w-[240px]">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleInspectTrip(trip.id);
                          }}
                          className="text-start block w-full focus:outline-none focus-visible:underline"
                        >
                          <div className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-slate-100 text-xs sm:text-sm">
                            <span className="truncate">
                              {trip.originName} → {trip.destinationName}
                            </span>
                            <MapPin
                              className={`w-3.5 h-3.5 shrink-0 transition-opacity ${
                                isInspected
                                  ? 'text-blue-700 dark:text-blue-400 opacity-100'
                                  : 'text-slate-400 dark:text-slate-500 opacity-0 group-hover:opacity-100'
                              }`}
                              aria-hidden="true"
                            />
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-md">
                            {isInspected ? t('ledger.showingRoute') : ''}
                            {trip.isRoundTrip ? t('common.roundTrip') : t('common.oneWay')}
                            {trip.commuteDeductionMiles > 0
                              ? ` · −${trip.commuteDeductionMiles.toFixed(1)} ${t('common.mi')}`
                              : ''}
                            {trip.notes ? ` · ${trip.notes}` : ''}
                          </div>
                        </button>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {tPurpose(trip.purpose)}
                      </td>
                      <td
                        className="py-3 px-3 text-end font-mono tabular-nums text-xs font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap"
                        dir="ltr"
                      >
                        {trip.billableMiles.toFixed(1)} {t('common.mi')}
                      </td>
                      <td
                        className="py-3 px-3 text-end font-mono tabular-nums text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap"
                        dir="ltr"
                      >
                        <div>{formatCurrency(trip.reimbursementAmount)}</div>
                        {(expensesByTripId[trip.id]?.length ?? 0) > 0 && (
                          <div className="text-[11px] font-medium text-blue-700 dark:text-blue-400">
                            +
                            {formatCurrency(
                              expensesByTripId[trip.id].reduce((sum, e) => sum + e.amount, 0)
                            )}{' '}
                            {t('nav.expShort')}
                          </div>
                        )}
                      </td>
                      <td
                        className="py-3 px-3 text-xs whitespace-nowrap"
                        onClick={(e) => {
                          if (!isReady && reportRef) e.stopPropagation();
                        }}
                      >
                        <div className="inline-flex flex-col items-start gap-1">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-md border whitespace-nowrap ${badge.className}`}
                          >
                            <StageIcon className="w-3 h-3 shrink-0" aria-hidden="true" />
                            {tStage(stage)}
                          </span>
                          {!isReady && reportRef && (
                            <button
                              type="button"
                              onClick={() => onOpenReport(trip.reportId)}
                              className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-blue-700 dark:hover:text-blue-400 hover:underline font-mono tabular-nums"
                              title={`${t('ledger.openReport')} ${reportRef}`}
                            >
                              {reportRef}
                            </button>
                          )}
                        </div>
                      </td>
                      <td
                        className="py-3 ps-3 pe-4 text-end whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isReady ? (
                          confirmDeleteRowId === trip.id ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                disabled={deletingRowId === trip.id}
                                onClick={() => void handleSingleDeleteTrip(trip.id)}
                                className="px-2 py-1 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded transition-colors whitespace-nowrap"
                              >
                                {deletingRowId === trip.id
                                  ? t('common.deleting')
                                  : t('common.delete')}
                              </button>
                              <button
                                type="button"
                                disabled={deletingRowId === trip.id}
                                onClick={() => setConfirmDeleteRowId(null)}
                                className="px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors whitespace-nowrap"
                              >
                                {t('common.cancel')}
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openEditPastDrive(trip)}
                                title={t('common.edit')}
                                aria-label={t('common.edit')}
                                className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-blue-700 dark:hover:text-blue-400 rounded transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openDuplicatePastDrive(trip)}
                                title={t('common.duplicate')}
                                aria-label={t('common.duplicate')}
                                className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-blue-700 dark:hover:text-blue-400 rounded transition-colors"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteRowId(trip.id)}
                                title={t('common.delete')}
                                aria-label={t('common.delete')}
                                className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )
                        ) : (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openDuplicatePastDrive(trip)}
                              title={t('common.duplicate')}
                              aria-label={t('common.duplicate')}
                              className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-blue-700 dark:hover:text-blue-400 rounded transition-colors"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-xs text-slate-400 dark:text-slate-500">
                              {t('common.locked')}
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit / Duplicate Past Drive Modal */}
      <PastDriveModal
        isOpen={driveModalState.open}
        mode={driveModalState.mode}
        initialTrip={driveModalState.initialTrip}
        profile={profile}
        stores={stores}
        biasCenter={biasCenter}
        onManageLocations={onManageLocations}
        templates={templates}
        findNearestStore={findNearestStore}
        onClose={() =>
          setDriveModalState({ open: false, mode: 'create', initialTrip: null })
        }
        onCreateTrip={handleCreatePastDrive}
        onUpdateTrip={handleUpdatePastDrive}
        onDeleteTrip={handleSingleDeleteTrip}
      />

      {/* Full-Screen Date-Range Interactive Map View */}
      <LedgerMapViewModal
        isOpen={mapViewOpen}
        trips={trips}
        expenses={expenses}
        stores={stores}
        onClose={() => setMapViewOpen(false)}
      />
    </div>
  );
}
