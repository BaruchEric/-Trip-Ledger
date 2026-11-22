import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  Car,
  FileSpreadsheet,
  FileText,
  LogIn,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Route,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  ProfileSettingsView,
  type ProfileSettingsInput,
} from './components/ProfileSettingsView';
import { QuickExpenseModal } from './components/QuickExpenseModal';
import { ReportsView } from './components/ReportsView';
import { TripLedgerView, type EditTripPatch } from './components/TripLedgerView';
import {
  TripLoggerView,
  type NewTemplateInput,
  type NewTripInput,
} from './components/TripLoggerView';
import { useAutoDriveDetector } from './hooks/useAutoDriveDetector';
import { useCuracaoStores } from './hooks/useCuracaoStores';
import { useLiveGpsTracker } from './hooks/useLiveGpsTracker';
import { useTheme, type ThemePreference } from './hooks/useTheme';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  signInWithGoogle,
  signOutUser,
} from './lib/firebase';
import {
  DEFAULT_RATE_PER_MILE,
  FIELD_LIMITS,
  formatCurrency,
  formatDateISO,
  generateDocId,
  round1,
  round2,
  sanitizeStr,
  type ActiveView,
  type MileageReport,
  type MileageTrip,
  type NewExpenseInput,
  type RouteTemplate,
  type TripExpense,
  type UserProfile,
} from './types/mileage';

const MAPS_API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? '';

const NAV_ITEMS: Array<{
  id: ActiveView;
  label: string;
  breadcrumb: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'log', label: 'Log Trip', breadcrumb: 'Log Trip', icon: Route },
  { id: 'ledger', label: 'Trip Ledger', breadcrumb: 'Trip Ledger', icon: FileSpreadsheet },
  { id: 'reports', label: 'Reports', breadcrumb: 'Reports', icon: FileText },
  { id: 'settings', label: 'Profile & Rate', breadcrumb: 'Profile & Rate', icon: Settings },
];

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

function WorkspaceShell() {
  const [activeView, setActiveView] = useState<ActiveView>('log');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const { preference: themePreference, isDark, setPreference: setThemePreference } = useTheme();

  // Firebase Auth state
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Firestore synced state
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [trips, setTrips] = useState<MileageTrip[]>([]);
  const [templates, setTemplates] = useState<RouteTemplate[]>([]);
  const [reports, setReports] = useState<MileageReport[]>([]);
  const [expenses, setExpenses] = useState<TripExpense[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  // Quick Expense modal state
  const [quickExpenseOpen, setQuickExpenseOpen] = useState(false);
  const [quickExpenseTripId, setQuickExpenseTripId] = useState<string>('');

  // Google Maps Curacao LA store discovery + explicit GPS & Auto-Detect trackers
  const { stores, loading: storesLoading, error: storesError, refreshStores, findNearestStore } =
    useCuracaoStores();
  const gpsTracker = useLiveGpsTracker();
  const autoDetector = useAutoDriveDetector();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (!firebaseUser) {
        setProfile(null);
        setTrips([]);
        setTemplates([]);
        setReports([]);
        setExpenses([]);
      }
    });
    return () => unsub();
  }, []);

  // Real-time Firestore listeners (attached strictly after authReady && user)
  useEffect(() => {
    if (!authReady || !user) return;
    setDataLoading(true);

    const profileRef = doc(db, 'users', user.uid);
    const unsubProfile = onSnapshot(
      profileRef,
      (snap) => {
        if (snap.exists()) {
          setProfile(snap.data() as UserProfile);
        } else {
          setProfile(null);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${user.uid}`)
    );

    const tripsQuery = query(collection(db, 'trips'), where('userId', '==', user.uid));
    const unsubTrips = onSnapshot(
      tripsQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<MileageTrip, 'id'>),
        }));
        setTrips(list);
        setDataLoading(false);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'trips')
    );

    const templatesQuery = query(collection(db, 'templates'), where('userId', '==', user.uid));
    const unsubTemplates = onSnapshot(
      templatesQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<RouteTemplate, 'id'>),
        }));
        setTemplates(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'templates')
    );

    const reportsQuery = query(collection(db, 'reports'), where('userId', '==', user.uid));
    const unsubReports = onSnapshot(
      reportsQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<MileageReport, 'id'>),
        }));
        setReports(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'reports')
    );

    const expensesQuery = query(collection(db, 'expenses'), where('userId', '==', user.uid));
    const unsubExpenses = onSnapshot(
      expensesQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<TripExpense, 'id'>),
        }));
        setExpenses(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'expenses')
    );

    return () => {
      unsubProfile();
      unsubTrips();
      unsubTemplates();
      unsubReports();
      unsubExpenses();
    };
  }, [authReady, user]);

  const handleSignIn = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      console.error('Google sign-in error:', err);
      setAuthError('Sign-in popup was closed or blocked. Please try again.');
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      await signOutUser();
    } catch (err) {
      console.error('Sign-out error:', err);
    }
  }, []);

  // --- Firestore Mutations (strictly synced with firebase-blueprint.json & firestore.rules) ---

  const handleLogTrip = useCallback(
    async (input: NewTripInput) => {
      if (!user) return;
      const tripId = generateDocId('trip');
      const path = `trips/${tripId}`;
      try {
        await setDoc(doc(db, 'trips', tripId), {
          userId: user.uid,
          tripDate: input.tripDate,
          originName: sanitizeStr(input.originName, FIELD_LIMITS.originName),
          originAddress: sanitizeStr(input.originAddress, FIELD_LIMITS.originAddress),
          originPlaceId: sanitizeStr(input.originPlaceId, FIELD_LIMITS.originPlaceId),
          destinationName: sanitizeStr(input.destinationName, FIELD_LIMITS.destinationName),
          destinationAddress: sanitizeStr(
            input.destinationAddress,
            FIELD_LIMITS.destinationAddress
          ),
          destinationPlaceId: sanitizeStr(
            input.destinationPlaceId,
            FIELD_LIMITS.destinationPlaceId
          ),
          purpose: input.purpose,
          notes: sanitizeStr(input.notes, FIELD_LIMITS.notes),
          oneWayMiles: round1(Math.min(2000, Math.max(0, input.oneWayMiles))),
          commuteDeductionMiles: round1(
            Math.min(200, Math.max(0, input.commuteDeductionMiles))
          ),
          billableMiles: round1(Math.min(4000, Math.max(0, input.billableMiles))),
          durationMinutes: Math.min(1440, Math.max(0, Math.round(input.durationMinutes))),
          isRoundTrip: Boolean(input.isRoundTrip),
          captureMethod: input.captureMethod,
          ratePerMile: Math.min(5, Math.max(0.01, input.ratePerMile)),
          reimbursementAmount: round2(Math.min(20000, Math.max(0, input.reimbursementAmount))),
          status: 'ready',
          reportId: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
    },
    [user]
  );

  const handleUpdateTrip = useCallback(
    async (trip: MileageTrip, patch: EditTripPatch) => {
      if (!user) return;
      const path = `trips/${trip.id}`;
      try {
        await updateDoc(doc(db, 'trips', trip.id), {
          tripDate: patch.tripDate,
          originName: sanitizeStr(patch.originName, FIELD_LIMITS.originName),
          originAddress: sanitizeStr(patch.originAddress, FIELD_LIMITS.originAddress),
          originPlaceId: sanitizeStr(patch.originPlaceId, FIELD_LIMITS.originPlaceId),
          destinationName: sanitizeStr(patch.destinationName, FIELD_LIMITS.destinationName),
          destinationAddress: sanitizeStr(
            patch.destinationAddress,
            FIELD_LIMITS.destinationAddress
          ),
          destinationPlaceId: sanitizeStr(
            patch.destinationPlaceId,
            FIELD_LIMITS.destinationPlaceId
          ),
          purpose: patch.purpose,
          notes: sanitizeStr(patch.notes, FIELD_LIMITS.notes),
          oneWayMiles: round1(Math.min(2000, Math.max(0, patch.oneWayMiles))),
          commuteDeductionMiles: round1(
            Math.min(200, Math.max(0, patch.commuteDeductionMiles))
          ),
          isRoundTrip: Boolean(patch.isRoundTrip),
          billableMiles: round1(Math.min(4000, Math.max(0, patch.billableMiles))),
          durationMinutes: Math.min(1440, Math.max(0, Math.round(patch.durationMinutes))),
          reimbursementAmount: round2(Math.min(20000, Math.max(0, patch.reimbursementAmount))),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [user]
  );

  const handleDeleteTrip = useCallback(
    async (tripId: string) => {
      if (!user) return;
      const path = `trips/${tripId}`;
      try {
        await deleteDoc(doc(db, 'trips', tripId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [user]
  );

  const handleBatchDeleteTrips = useCallback(
    async (tripIds: string[]) => {
      if (!user || tripIds.length === 0) return;
      const batch = writeBatch(db);
      for (const tripId of tripIds) {
        batch.delete(doc(db, 'trips', tripId));
      }
      try {
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, 'trips');
      }
    },
    [user]
  );

  const handleSaveTemplate = useCallback(
    async (input: NewTemplateInput) => {
      if (!user) return;
      const templateId = generateDocId('tpl');
      const path = `templates/${templateId}`;
      try {
        await setDoc(doc(db, 'templates', templateId), {
          userId: user.uid,
          label: sanitizeStr(input.label, FIELD_LIMITS.templateLabel),
          originName: sanitizeStr(input.originName, FIELD_LIMITS.originName),
          originAddress: sanitizeStr(input.originAddress, FIELD_LIMITS.originAddress),
          originPlaceId: sanitizeStr(input.originPlaceId, FIELD_LIMITS.originPlaceId),
          destinationName: sanitizeStr(input.destinationName, FIELD_LIMITS.destinationName),
          destinationAddress: sanitizeStr(
            input.destinationAddress,
            FIELD_LIMITS.destinationAddress
          ),
          destinationPlaceId: sanitizeStr(
            input.destinationPlaceId,
            FIELD_LIMITS.destinationPlaceId
          ),
          purpose: input.purpose,
          oneWayMiles: round1(Math.min(2000, Math.max(0, input.oneWayMiles))),
          durationMinutes: Math.min(1440, Math.max(0, Math.round(input.durationMinutes))),
          isRoundTrip: Boolean(input.isRoundTrip),
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
    },
    [user]
  );

  const handleDeleteTemplate = useCallback(
    async (templateId: string) => {
      if (!user) return;
      const path = `templates/${templateId}`;
      try {
        await deleteDoc(doc(db, 'templates', templateId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [user]
  );

  const handleLogExpense = useCallback(
    async (input: NewExpenseInput) => {
      if (!user) return;
      const expenseId = generateDocId('exp');
      const path = `expenses/${expenseId}`;
      try {
        await setDoc(doc(db, 'expenses', expenseId), {
          userId: user.uid,
          tripId: sanitizeStr(input.tripId, 128),
          reportId: '',
          expenseDate: input.expenseDate,
          category: input.category,
          description: sanitizeStr(input.description, FIELD_LIMITS.expenseDescription),
          amount: round2(Math.min(5000, Math.max(0.01, input.amount))),
          notes: sanitizeStr(input.notes, FIELD_LIMITS.notes),
          status: 'ready',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
    },
    [user]
  );

  const handleDeleteExpense = useCallback(
    async (expenseId: string) => {
      if (!user) return;
      const path = `expenses/${expenseId}`;
      try {
        await deleteDoc(doc(db, 'expenses', expenseId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [user]
  );

  const handleOpenQuickExpense = useCallback(
    (tripId = '') => {
      if (!user) {
        void handleSignIn();
        return;
      }
      setQuickExpenseTripId(tripId);
      setQuickExpenseOpen(true);
    },
    [user, handleSignIn]
  );

  const handleSaveProfile = useCallback(
    async (input: ProfileSettingsInput) => {
      if (!user) return;
      const path = `users/${user.uid}`;
      const ref = doc(db, 'users', user.uid);
      try {
        if (profile) {
          await updateDoc(ref, {
            employeeName: sanitizeStr(input.employeeName, FIELD_LIMITS.employeeName),
            employeeId: sanitizeStr(input.employeeId, FIELD_LIMITS.employeeId),
            department: sanitizeStr(input.department, FIELD_LIMITS.department),
            managerEmail: sanitizeStr(input.managerEmail, FIELD_LIMITS.managerEmail),
            homeStoreName: sanitizeStr(input.homeStoreName, FIELD_LIMITS.homeStoreName),
            homeStoreAddress: sanitizeStr(input.homeStoreAddress, FIELD_LIMITS.homeStoreAddress),
            homeStorePlaceId: sanitizeStr(input.homeStorePlaceId, FIELD_LIMITS.homeStorePlaceId),
            vehicleInfo: sanitizeStr(input.vehicleInfo, FIELD_LIMITS.vehicleInfo),
            ratePerMile: Math.min(5, Math.max(0.01, input.ratePerMile)),
            normalCommuteMiles: round1(Math.min(200, Math.max(0, input.normalCommuteMiles))),
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(ref, {
            uid: user.uid,
            employeeName: sanitizeStr(input.employeeName, FIELD_LIMITS.employeeName),
            employeeId: sanitizeStr(input.employeeId, FIELD_LIMITS.employeeId),
            department: sanitizeStr(input.department, FIELD_LIMITS.department),
            managerEmail: sanitizeStr(input.managerEmail, FIELD_LIMITS.managerEmail),
            homeStoreName: sanitizeStr(input.homeStoreName, FIELD_LIMITS.homeStoreName),
            homeStoreAddress: sanitizeStr(input.homeStoreAddress, FIELD_LIMITS.homeStoreAddress),
            homeStorePlaceId: sanitizeStr(input.homeStorePlaceId, FIELD_LIMITS.homeStorePlaceId),
            vehicleInfo: sanitizeStr(input.vehicleInfo, FIELD_LIMITS.vehicleInfo),
            ratePerMile: Math.min(5, Math.max(0.01, input.ratePerMile)),
            normalCommuteMiles: round1(Math.min(200, Math.max(0, input.normalCommuteMiles))),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, path);
      }
    },
    [user, profile]
  );

  // Atomic WriteBatch: creates MileageReport AND links all selected ready trips & matching ready expenses
  const handleGenerateReport = useCallback(
    async (targetTrips: MileageTrip[]) => {
      if (!user || targetTrips.length === 0) return;
      const reportId = generateDocId('rep');
      const dates = targetTrips.map((t) => t.tripDate).sort();
      const periodStart = dates[0] ?? formatDateISO();
      const periodEnd = dates[dates.length - 1] ?? formatDateISO();
      const now = new Date();
      const seq = String(reports.length + 1).padStart(2, '0');
      const reportNumber = sanitizeStr(
        `MR-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${seq}`,
        FIELD_LIMITS.reportNumber
      );

      const totalMiles = round1(targetTrips.reduce((sum, t) => sum + t.billableMiles, 0));
      const totalReimbursement = round2(
        targetTrips.reduce((sum, t) => sum + t.reimbursementAmount, 0)
      );

      const targetTripIds = new Set(targetTrips.map((t) => t.id));
      const allReadyTripCount = trips.filter((t) => t.status === 'ready').length;
      const includeAllUnassigned = targetTrips.length >= allReadyTripCount;

      const matchingReadyExpenses = expenses.filter((exp) => {
        if (exp.status !== 'ready') return false;
        if (exp.tripId && targetTripIds.has(exp.tripId)) return true;
        if (!exp.tripId) {
          if (includeAllUnassigned) return true;
          return exp.expenseDate >= periodStart && exp.expenseDate <= periodEnd;
        }
        return false;
      });

      const batch = writeBatch(db);
      const reportRef = doc(db, 'reports', reportId);

      batch.set(reportRef, {
        userId: user.uid,
        reportNumber,
        periodStart,
        periodEnd,
        employeeName: sanitizeStr(
          profile?.employeeName || user.displayName || '',
          FIELD_LIMITS.employeeName
        ),
        employeeId: sanitizeStr(profile?.employeeId || '', FIELD_LIMITS.employeeId),
        department: sanitizeStr(profile?.department || 'Retail Operations', FIELD_LIMITS.department),
        homeStoreName: sanitizeStr(profile?.homeStoreName || '', FIELD_LIMITS.homeStoreName),
        vehicleInfo: sanitizeStr(profile?.vehicleInfo || '', FIELD_LIMITS.vehicleInfo),
        tripCount: targetTrips.length,
        totalMiles,
        totalReimbursement,
        status: 'submitted',
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      for (const trip of targetTrips) {
        batch.update(doc(db, 'trips', trip.id), {
          status: 'submitted',
          reportId,
          updatedAt: serverTimestamp(),
        });
      }

      for (const exp of matchingReadyExpenses) {
        batch.update(doc(db, 'expenses', exp.id), {
          status: 'submitted',
          reportId,
          updatedAt: serverTimestamp(),
        });
      }

      try {
        await batch.commit();
        setSelectedReportId(reportId);
        setActiveView('reports');
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `reports/${reportId}`);
      }
    },
    [user, profile, reports.length, trips, expenses]
  );

  const handleAssignTripsToReport = useCallback(
    async (targetTrips: MileageTrip[], report: MileageReport) => {
      if (!user || targetTrips.length === 0 || report.status !== 'submitted') return;

      const addedMiles = targetTrips.reduce((sum, t) => sum + t.billableMiles, 0);
      const addedReimbursement = targetTrips.reduce(
        (sum, t) => sum + t.reimbursementAmount,
        0
      );
      const allDates = [
        report.periodStart,
        report.periodEnd,
        ...targetTrips.map((t) => t.tripDate),
      ].sort();

      const targetTripIds = new Set(targetTrips.map((t) => t.id));
      const linkedReadyExpenses = expenses.filter(
        (exp) => exp.status === 'ready' && exp.tripId && targetTripIds.has(exp.tripId)
      );

      const batch = writeBatch(db);
      const reportRef = doc(db, 'reports', report.id);

      batch.update(reportRef, {
        periodStart: allDates[0] ?? report.periodStart,
        periodEnd: allDates[allDates.length - 1] ?? report.periodEnd,
        tripCount: report.tripCount + targetTrips.length,
        totalMiles: round1(report.totalMiles + addedMiles),
        totalReimbursement: round2(report.totalReimbursement + addedReimbursement),
        updatedAt: serverTimestamp(),
      });

      for (const trip of targetTrips) {
        batch.update(doc(db, 'trips', trip.id), {
          status: 'submitted',
          reportId: report.id,
          updatedAt: serverTimestamp(),
        });
      }

      for (const exp of linkedReadyExpenses) {
        batch.update(doc(db, 'expenses', exp.id), {
          status: 'submitted',
          reportId: report.id,
          updatedAt: serverTimestamp(),
        });
      }

      try {
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `reports/${report.id}`);
      }
    },
    [user, expenses]
  );

  const handleMarkReimbursed = useCallback(
    async (report: MileageReport) => {
      if (!user) return;
      const path = `reports/${report.id}`;
      try {
        await updateDoc(doc(db, 'reports', report.id), {
          status: 'reimbursed',
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [user]
  );

  const readyTrips = useMemo(() => trips.filter((t) => t.status === 'ready'), [trips]);
  const readyExpenses = useMemo(() => expenses.filter((e) => e.status === 'ready'), [expenses]);
  const readyAmount = useMemo(
    () =>
      round2(
        readyTrips.reduce((s, t) => s + t.reimbursementAmount, 0) +
          readyExpenses.reduce((s, e) => s + e.amount, 0)
      ),
    [readyTrips, readyExpenses]
  );

  const currentNav = NAV_ITEMS.find((n) => n.id === activeView) ?? NAV_ITEMS[0];

  const handlePrimaryHeaderCta = () => {
    if (!user) {
      void handleSignIn();
      return;
    }
    if (readyTrips.length > 0) {
      void handleGenerateReport(readyTrips);
    } else {
      setActiveView('log');
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Desktop Left Sidebar (256px) */}
      <aside className="no-print hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
        {/* Single-line Brand Wordmark */}
        <div className="h-16 px-5 flex items-center gap-2.5 border-b border-slate-200 dark:border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-blue-700 dark:bg-blue-600 text-white flex items-center justify-center shrink-0">
            <Car className="w-4 h-4" />
          </div>
          <span className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
            Curacao Mileage
          </span>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 p-3 space-y-1" aria-label="Primary Workspace">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon
                    className={`w-4 h-4 ${
                      active
                        ? 'text-blue-700 dark:text-blue-400'
                        : 'text-slate-400 dark:text-slate-500'
                    }`}
                  />
                  {item.label}
                </span>
                {item.id === 'log' &&
                  (autoDetector.phase === 'driving' ||
                    autoDetector.phase === 'parked_cooldown') && (
                    <span className="text-[11px] font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
                      Live
                    </span>
                  )}
                {item.id === 'log' &&
                  autoDetector.phase !== 'driving' &&
                  autoDetector.phase !== 'parked_cooldown' &&
                  autoDetector.detectedDrives.length > 0 && (
                    <span className="text-xs font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
                      {autoDetector.detectedDrives.length}
                    </span>
                  )}
                {item.id === 'ledger' && readyTrips.length > 0 && (
                  <span className="text-xs font-mono tabular-nums text-amber-700 dark:text-amber-400 font-semibold">
                    {readyTrips.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Quiet Ready Queue Summary */}
        {user && (
          <div className="mx-3 mb-3 px-3.5 py-3 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">Unsubmitted Queue</div>
            <div className="flex items-baseline justify-between font-mono tabular-nums">
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {formatCurrency(readyAmount)}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {readyTrips.length} {readyTrips.length === 1 ? 'trip' : 'trips'}
                {readyExpenses.length > 0 ? ` · ${readyExpenses.length} exp` : ''}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              Rate ${(profile?.ratePerMile ?? DEFAULT_RATE_PER_MILE).toFixed(2)}/mi
            </div>
          </div>
        )}

        {/* Theme Switcher (Light / Dark / System) */}
        <div className="px-3 pb-3">
          <div
            role="group"
            aria-label="Appearance theme"
            className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg"
          >
            {THEME_OPTIONS.map(({ value, label, Icon }) => {
              const active = themePreference === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setThemePreference(value)}
                  aria-pressed={active}
                  className={`inline-flex items-center justify-center gap-1 py-1.5 px-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* User Account Zone */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800">
          {user ? (
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              <div className="flex items-center gap-2.5 min-w-0">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName ?? 'Employee'}
                    referrerPolicy="no-referrer"
                    className="w-8 h-8 rounded-full object-cover shrink-0 border border-slate-200 dark:border-slate-700"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center text-xs font-semibold shrink-0">
                    {(user.displayName || user.email || 'E').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {profile?.employeeName || user.displayName || 'Employee'}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {user.email}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                title="Sign out"
                aria-label="Sign out"
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md transition-colors shrink-0"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void handleSignIn()}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap"
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign In to Sync Data
            </button>
          )}
        </div>
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/50 dark:bg-black/70"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-64 max-w-[80vw] bg-white dark:bg-slate-900 h-full flex flex-col border-r border-slate-200 dark:border-slate-800 z-10">
            <div className="h-16 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
              <span className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Curacao Mileage
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation"
                className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveView(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg ${
                      active
                        ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </button>
                );
              })}
            </nav>

            {/* Mobile Theme Switcher */}
            <div className="px-3 pb-3">
              <div
                role="group"
                aria-label="Appearance theme"
                className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg"
              >
                {THEME_OPTIONS.map(({ value, label, Icon }) => {
                  const active = themePreference === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setThemePreference(value)}
                      aria-pressed={active}
                      className={`inline-flex items-center justify-center gap-1 py-1.5 px-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-3 border-t border-slate-200 dark:border-slate-800">
              {user ? (
                <button
                  type="button"
                  onClick={() => {
                    void handleSignOut();
                    setMobileMenuOpen(false);
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-lg"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out ({user.email})
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void handleSignIn();
                    setMobileMenuOpen(false);
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-blue-700 dark:bg-blue-600 rounded-lg"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  Sign In with Google
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean Contextual Top Bar */}
        <header className="no-print h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
              className="lg:hidden p-2 -ml-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 dark:text-slate-500 hidden sm:inline whitespace-nowrap">
                Los Angeles Retail
              </span>
              <span
                className="text-slate-300 dark:text-slate-700 hidden sm:inline"
                aria-hidden="true"
              >
                /
              </span>
              <h1 className="font-display font-semibold text-slate-900 dark:text-slate-100 truncate">
                {currentNav.breadcrumb}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handlePrimaryHeaderCta}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {!user
                ? 'Sign In to Sync'
                : readyTrips.length > 0
                  ? `Generate Report (${readyTrips.length})`
                  : 'Log New Trip'}
            </button>
          </div>
        </header>

        {authError && (
          <div
            role="alert"
            className="no-print mx-4 sm:mx-6 mt-4 px-4 py-2.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/70 rounded-lg text-xs text-red-900 dark:text-red-200 flex items-center justify-between"
          >
            <span>{authError}</span>
            <button
              type="button"
              onClick={() => setAuthError(null)}
              className="text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-red-100 font-medium ml-4"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Active View Content */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {activeView === 'log' && (
            <TripLoggerView
              isAuthenticated={Boolean(user)}
              onRequestSignIn={() => void handleSignIn()}
              profile={profile}
              stores={stores}
              storesLoading={storesLoading}
              storesError={storesError}
              onRefreshStores={refreshStores}
              findNearestStore={findNearestStore}
              templates={templates}
              trips={trips}
              expenses={expenses}
              gpsTracker={gpsTracker}
              autoDetector={autoDetector}
              onLogTrip={handleLogTrip}
              onSaveTemplate={handleSaveTemplate}
              onDeleteTemplate={handleDeleteTemplate}
              onOpenQuickExpense={() => handleOpenQuickExpense('')}
              onDeleteExpense={handleDeleteExpense}
              isDark={isDark}
            />
          )}

          {activeView === 'ledger' && (
            <TripLedgerView
              profile={profile}
              trips={trips}
              expenses={expenses}
              reports={reports}
              stores={stores}
              templates={templates}
              findNearestStore={findNearestStore}
              loading={dataLoading}
              isAuthenticated={Boolean(user)}
              onRequestSignIn={() => void handleSignIn()}
              onGoToLogger={() => setActiveView('log')}
              onCreateTrip={handleLogTrip}
              onUpdateTrip={handleUpdateTrip}
              onDeleteTrip={handleDeleteTrip}
              onBatchDeleteTrips={handleBatchDeleteTrips}
              onGenerateReport={handleGenerateReport}
              onAssignTripsToReport={handleAssignTripsToReport}
              onOpenQuickExpense={handleOpenQuickExpense}
              onOpenReport={(reportId) => {
                setSelectedReportId(reportId);
                setActiveView('reports');
              }}
            />
          )}

          {activeView === 'reports' && (
            <ReportsView
              reports={reports}
              trips={trips}
              expenses={expenses}
              loading={dataLoading}
              isAuthenticated={Boolean(user)}
              selectedReportId={selectedReportId}
              onSelectReport={setSelectedReportId}
              onRequestSignIn={() => void handleSignIn()}
              onGenerateReportFromReady={() => handleGenerateReport(readyTrips)}
              onMarkReimbursed={handleMarkReimbursed}
              isDark={isDark}
            />
          )}

          {activeView === 'settings' && (
            <ProfileSettingsView
              isAuthenticated={Boolean(user)}
              onRequestSignIn={() => void handleSignIn()}
              userDisplayName={user?.displayName ?? ''}
              profile={profile}
              stores={stores}
              storesLoading={storesLoading}
              onSaveProfile={handleSaveProfile}
            />
          )}
        </main>

        {/* Quick Expense Modal (accessible from Dashboard & Trip Ledger) */}
        <QuickExpenseModal
          isOpen={quickExpenseOpen}
          trips={trips}
          expenses={expenses}
          defaultTripId={quickExpenseTripId}
          onClose={() => setQuickExpenseOpen(false)}
          onSaveExpense={handleLogExpense}
        />

        {/* Quiet Compliance Footer */}
        <footer className="no-print px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center justify-between gap-2">
          <span>
            Curacao Mileage · Built for Los Angeles retail travel &amp; reimbursement reporting.
          </span>
          <span>
            Map data &amp; routing powered by Google Maps Platform (
            <a
              href="https://maps.google.com/help/terms_maps/?utm_campaign=gmp_mcp_codeassist_v1_aistudio"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-slate-700 dark:hover:text-slate-200"
            >
              End User Terms
            </a>
            {' · '}
            <a
              href="https://policies.google.com/privacy?utm_campaign=gmp_mcp_codeassist_v1_aistudio"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-slate-700 dark:hover:text-slate-200"
            >
              Google Privacy Policy
            </a>
            ). Location tracking runs only when you press Start Drive, Use GPS, or enable
            Auto-Detect Drives.
          </span>
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <APIProvider apiKey={MAPS_API_KEY} language="en" region="US">
        <WorkspaceShell />
      </APIProvider>
    </ErrorBoundary>
  );
}
