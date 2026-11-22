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
  Globe,
  LogIn,
  LogOut,
  MapPin,
  Menu,
  Monitor,
  Moon,
  Route,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LocationsView } from './components/LocationsView';
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
import { useLiveGpsTracker } from './hooks/useLiveGpsTracker';
import { useLocalLocations, useLocationHelpers } from './hooks/useSavedLocations';
import { useTheme, type ThemePreference } from './hooks/useTheme';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  setAnalyticsUser,
  signInWithGoogle,
  signOutUser,
  trackAnalyticsEvent,
} from './lib/firebase';
import {
  I18nProvider,
  LOCALE_OPTIONS,
  useI18n,
  type MessageKey,
} from './lib/i18n';
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
  type PlaceSelection,
  type RouteTemplate,
  type SavedLocation,
  type SavedLocationInput,
  type TripExpense,
  type UserProfile,
} from './types/mileage';

import { GOOGLE_MAPS_API_KEY } from './lib/env';

const MAPS_API_KEY = GOOGLE_MAPS_API_KEY;

const NAV_ITEMS: Array<{
  id: ActiveView;
  labelKey: MessageKey;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'log', labelKey: 'nav.log', icon: Route },
  { id: 'locations', labelKey: 'nav.locations', icon: MapPin },
  { id: 'ledger', labelKey: 'nav.ledger', icon: FileSpreadsheet },
  { id: 'reports', labelKey: 'nav.reports', icon: FileText },
  { id: 'settings', labelKey: 'nav.settings', icon: Settings },
];

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  labelKey: MessageKey;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: 'light', labelKey: 'theme.light', Icon: Sun },
  { value: 'dark', labelKey: 'theme.dark', Icon: Moon },
  { value: 'system', labelKey: 'theme.system', Icon: Monitor },
];

function WorkspaceShell() {
  const { locale, setLocale, t } = useI18n();
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
  const [firestoreLocations, setFirestoreLocations] = useState<SavedLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);

  // Quick-pick handoff from LocationsView -> TripLoggerView
  const [pendingPlacePick, setPendingPlacePick] = useState<{
    role: 'origin' | 'destination';
    place: PlaceSelection;
    nonce: number;
  } | null>(null);

  // Quick Expense modal state
  const [quickExpenseOpen, setQuickExpenseOpen] = useState(false);
  const [quickExpenseTripId, setQuickExpenseTripId] = useState<string>('');

  // User-managed saved locations (Firestore when signed in, localStorage when guest)
  const localLocations = useLocalLocations();
  const activeLocations = user ? firestoreLocations : localLocations.locations;
  const { storeLocations, findNearestStore, primaryBiasCenter } =
    useLocationHelpers(activeLocations);

  const gpsTracker = useLiveGpsTracker();
  const autoDetector = useAutoDriveDetector();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAnalyticsUser(firebaseUser?.uid ?? null);
      setAuthReady(true);
      if (!firebaseUser) {
        setProfile(null);
        setTrips([]);
        setTemplates([]);
        setReports([]);
        setExpenses([]);
        setFirestoreLocations([]);
        setLocationsLoading(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    trackAnalyticsEvent('page_view', { page_title: activeView });
  }, [activeView]);

  // Real-time Firestore listeners (attached strictly after authReady && user)
  useEffect(() => {
    if (!authReady || !user) return;
    setDataLoading(true);
    setLocationsLoading(true);

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

    const locationsQuery = query(collection(db, 'locations'), where('userId', '==', user.uid));
    const unsubLocations = onSnapshot(
      locationsQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<SavedLocation, 'id'>),
        }));
        setFirestoreLocations(list);
        setLocationsLoading(false);
      },
      (err) => {
        setLocationsLoading(false);
        handleFirestoreError(err, OperationType.LIST, 'locations');
      }
    );

    return () => {
      unsubProfile();
      unsubTrips();
      unsubTemplates();
      unsubReports();
      unsubExpenses();
      unsubLocations();
    };
  }, [authReady, user]);

  const handleSignIn = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
      trackAnalyticsEvent('login', { method: 'google' });
    } catch (err) {
      console.error('Google sign-in error:', err);
      setAuthError(t('auth.popupError'));
    }
  }, [t]);

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
        trackAnalyticsEvent('trip_logged', {
          capture_method: input.captureMethod,
          is_round_trip: Boolean(input.isRoundTrip),
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
        trackAnalyticsEvent('expense_logged', { category: input.category });
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

  // --- Saved Locations CRUD (Firestore when signed in, localStorage when guest) ---
  const handleAddLocation = useCallback(
    async (input: SavedLocationInput) => {
      if (!user) {
        await localLocations.addLocation(input);
        trackAnalyticsEvent('location_saved', {
          category: input.category,
          is_home: Boolean(input.isHome),
        });
        return;
      }
      const locId = generateDocId('loc');
      const path = `locations/${locId}`;
      const batch = writeBatch(db);
      const cleanName = sanitizeStr(input.name, FIELD_LIMITS.locationName);
      const cleanAddress = sanitizeStr(input.address, FIELD_LIMITS.locationAddress);
      const cleanPlaceId = sanitizeStr(input.placeId, FIELD_LIMITS.placeId);
      const isHome = Boolean(input.isHome);

      if (isHome) {
        for (const existingLoc of firestoreLocations) {
          if (existingLoc.isHome) {
            batch.update(doc(db, 'locations', existingLoc.id), {
              isHome: false,
              updatedAt: serverTimestamp(),
            });
          }
        }
        if (profile) {
          batch.update(doc(db, 'users', user.uid), {
            homeStoreName: sanitizeStr(cleanName, FIELD_LIMITS.homeStoreName),
            homeStoreAddress: sanitizeStr(cleanAddress, FIELD_LIMITS.homeStoreAddress),
            homeStorePlaceId: sanitizeStr(cleanPlaceId, FIELD_LIMITS.homeStorePlaceId),
            updatedAt: serverTimestamp(),
          });
        }
      }

      batch.set(doc(db, 'locations', locId), {
        userId: user.uid,
        name: cleanName,
        address: cleanAddress,
        placeId: cleanPlaceId,
        category: input.category,
        lat: input.hasCoordinates ? Math.min(90, Math.max(-90, input.lat)) : 0,
        lng: input.hasCoordinates ? Math.min(180, Math.max(-180, input.lng)) : 0,
        hasCoordinates: Boolean(input.hasCoordinates),
        isHome,
        notes: sanitizeStr(input.notes, FIELD_LIMITS.locationNotes),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      try {
        await batch.commit();
        trackAnalyticsEvent('location_saved', {
          category: input.category,
          is_home: isHome,
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
    },
    [user, localLocations, firestoreLocations, profile]
  );

  const handleUpdateLocation = useCallback(
    async (locationId: string, input: SavedLocationInput) => {
      if (!user) {
        await localLocations.updateLocation(locationId, input);
        return;
      }
      const path = `locations/${locationId}`;
      const batch = writeBatch(db);
      const cleanName = sanitizeStr(input.name, FIELD_LIMITS.locationName);
      const cleanAddress = sanitizeStr(input.address, FIELD_LIMITS.locationAddress);
      const cleanPlaceId = sanitizeStr(input.placeId, FIELD_LIMITS.placeId);
      const isHome = Boolean(input.isHome);

      if (isHome) {
        for (const existingLoc of firestoreLocations) {
          if (existingLoc.id !== locationId && existingLoc.isHome) {
            batch.update(doc(db, 'locations', existingLoc.id), {
              isHome: false,
              updatedAt: serverTimestamp(),
            });
          }
        }
        if (profile) {
          batch.update(doc(db, 'users', user.uid), {
            homeStoreName: sanitizeStr(cleanName, FIELD_LIMITS.homeStoreName),
            homeStoreAddress: sanitizeStr(cleanAddress, FIELD_LIMITS.homeStoreAddress),
            homeStorePlaceId: sanitizeStr(cleanPlaceId, FIELD_LIMITS.homeStorePlaceId),
            updatedAt: serverTimestamp(),
          });
        }
      }

      batch.update(doc(db, 'locations', locationId), {
        name: cleanName,
        address: cleanAddress,
        placeId: cleanPlaceId,
        category: input.category,
        lat: input.hasCoordinates ? Math.min(90, Math.max(-90, input.lat)) : 0,
        lng: input.hasCoordinates ? Math.min(180, Math.max(-180, input.lng)) : 0,
        hasCoordinates: Boolean(input.hasCoordinates),
        isHome,
        notes: sanitizeStr(input.notes, FIELD_LIMITS.locationNotes),
        updatedAt: serverTimestamp(),
      });

      try {
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [user, localLocations, firestoreLocations, profile]
  );

  const handleDeleteLocation = useCallback(
    async (locationId: string) => {
      if (!user) {
        await localLocations.deleteLocation(locationId);
        return;
      }
      const path = `locations/${locationId}`;
      try {
        await deleteDoc(doc(db, 'locations', locationId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [user, localLocations]
  );

  const handleSetHomeLocation = useCallback(
    async (target: SavedLocation) => {
      if (!user) {
        await localLocations.setHomeLocation(target);
        return;
      }
      const path = `locations/${target.id}`;
      const batch = writeBatch(db);
      for (const existingLoc of firestoreLocations) {
        if (existingLoc.id !== target.id && existingLoc.isHome) {
          batch.update(doc(db, 'locations', existingLoc.id), {
            isHome: false,
            updatedAt: serverTimestamp(),
          });
        }
      }
      batch.update(doc(db, 'locations', target.id), {
        isHome: true,
        updatedAt: serverTimestamp(),
      });
      if (profile) {
        batch.update(doc(db, 'users', user.uid), {
          homeStoreName: sanitizeStr(target.name, FIELD_LIMITS.homeStoreName),
          homeStoreAddress: sanitizeStr(target.address, FIELD_LIMITS.homeStoreAddress),
          homeStorePlaceId: sanitizeStr(target.placeId, FIELD_LIMITS.homeStorePlaceId),
          updatedAt: serverTimestamp(),
        });
      }
      try {
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [user, localLocations, firestoreLocations, profile]
  );

  const handleUseLocationInTrip = useCallback(
    (role: 'origin' | 'destination', place: PlaceSelection) => {
      setPendingPlacePick({ role, place, nonce: Date.now() });
      setActiveView('log');
    },
    []
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
        department: sanitizeStr(profile?.department || '', FIELD_LIMITS.department),
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
        trackAnalyticsEvent('report_generated', { trip_count: targetTrips.length });
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
      {/* Desktop Sidebar (256px) */}
      <aside className="no-print hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white dark:bg-slate-900 border-e border-slate-200 dark:border-slate-800">
        {/* Single-line Brand Wordmark */}
        <div className="h-16 px-5 flex items-center gap-2.5 border-b border-slate-200 dark:border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-blue-700 dark:bg-blue-600 text-white flex items-center justify-center shrink-0">
            <Car className="w-4 h-4" />
          </div>
          <span className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
            {t('app.brand')}
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
                  {t(item.labelKey)}
                </span>
                {item.id === 'log' &&
                  (autoDetector.phase === 'driving' ||
                    autoDetector.phase === 'parked_cooldown') && (
                    <span className="text-[11px] font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
                      {t('nav.live')}
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
                {item.id === 'locations' && activeLocations.length > 0 && (
                  <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 font-semibold">
                    {activeLocations.length}
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
            <div className="text-xs text-slate-500 dark:text-slate-400">{t('nav.queueTitle')}</div>
            <div className="flex items-baseline justify-between font-mono tabular-nums">
              <span dir="ltr" className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {formatCurrency(readyAmount)}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {readyTrips.length}{' '}
                {readyTrips.length === 1 ? t('nav.tripSingular') : t('nav.tripPlural')}
                {readyExpenses.length > 0 ? ` · ${readyExpenses.length} ${t('nav.expShort')}` : ''}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {t('nav.ratePerMile', {
                rate: (profile?.ratePerMile ?? DEFAULT_RATE_PER_MILE).toFixed(2),
              })}
            </div>
          </div>
        )}

        {/* Language Switcher (EN / ES / עב) */}
        <div className="px-3 pb-2">
          <div
            role="group"
            aria-label={t('nav.languageAria')}
            className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg"
          >
            {LOCALE_OPTIONS.map((opt) => {
              const active = locale === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setLocale(opt.value)}
                  aria-pressed={active}
                  title={opt.nativeLabel}
                  className={`inline-flex items-center justify-center py-1.5 px-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {opt.nativeLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* Theme Switcher (Light / Dark / System) */}
        <div className="px-3 pb-3">
          <div
            role="group"
            aria-label={t('nav.themeAria')}
            className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg"
          >
            {THEME_OPTIONS.map(({ value, labelKey, Icon }) => {
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
                  <span>{t(labelKey)}</span>
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
                    alt={user.displayName ?? t('auth.employee')}
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
                    {profile?.employeeName || user.displayName || t('auth.employee')}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {user.email}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                title={t('auth.signOut')}
                aria-label={t('auth.signOut')}
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
              {t('auth.signInSyncData')}
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
          <div className="relative w-64 max-w-[80vw] bg-white dark:bg-slate-900 h-full flex flex-col border-e border-slate-200 dark:border-slate-800 z-10">
            <div className="h-16 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
              <span className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                {t('app.brand')}
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label={t('common.closeNavigation')}
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
                    {t(item.labelKey)}
                  </button>
                );
              })}
            </nav>

            {/* Mobile Language Switcher */}
            <div className="px-3 pb-2">
              <div
                role="group"
                aria-label={t('nav.languageAria')}
                className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg"
              >
                {LOCALE_OPTIONS.map((opt) => {
                  const active = locale === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setLocale(opt.value)}
                      aria-pressed={active}
                      className={`inline-flex items-center justify-center py-1.5 px-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                      }`}
                    >
                      {opt.nativeLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Mobile Theme Switcher */}
            <div className="px-3 pb-3">
              <div
                role="group"
                aria-label={t('nav.themeAria')}
                className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg"
              >
                {THEME_OPTIONS.map(({ value, labelKey, Icon }) => {
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
                      <span>{t(labelKey)}</span>
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
                  {t('auth.signOut')} ({user.email})
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
                  {t('auth.signInGoogle')}
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
              aria-label={t('common.openMenu')}
              className="lg:hidden p-2 -ms-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 dark:text-slate-500 hidden sm:inline whitespace-nowrap">
                {t('app.region')}
              </span>
              <span
                className="text-slate-300 dark:text-slate-700 hidden sm:inline"
                aria-hidden="true"
              >
                /
              </span>
              <h1 className="font-display font-semibold text-slate-900 dark:text-slate-100 truncate">
                {t(currentNav.labelKey)}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Compact Mobile Language Switcher */}
            <div
              role="group"
              aria-label={t('nav.languageAria')}
              className="lg:hidden inline-flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg"
            >
              <Globe className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 ms-1.5 me-0.5 hidden sm:inline shrink-0" />
              {LOCALE_OPTIONS.map((opt) => {
                const active = locale === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setLocale(opt.value)}
                    aria-pressed={active}
                    title={opt.nativeLabel}
                    className={`px-1.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    {opt.shortLabel}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handlePrimaryHeaderCta}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {!user
                ? t('auth.signInSync')
                : readyTrips.length > 0
                  ? t('header.generateReport', { count: readyTrips.length })
                  : t('header.logNewTrip')}
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
              className="text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-red-100 font-medium ms-4"
            >
              {t('common.dismiss')}
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
              stores={storeLocations}
              storesLoading={locationsLoading}
              biasCenter={primaryBiasCenter}
              onManageLocations={() => setActiveView('locations')}
              pendingPlacePick={pendingPlacePick}
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

          {activeView === 'locations' && (
            <LocationsView
              isAuthenticated={Boolean(user)}
              onRequestSignIn={() => void handleSignIn()}
              locations={activeLocations}
              loading={locationsLoading}
              biasCenter={primaryBiasCenter}
              onAddLocation={handleAddLocation}
              onUpdateLocation={handleUpdateLocation}
              onDeleteLocation={handleDeleteLocation}
              onSetHomeLocation={handleSetHomeLocation}
              onUseLocationInTrip={handleUseLocationInTrip}
            />
          )}

          {activeView === 'ledger' && (
            <TripLedgerView
              profile={profile}
              trips={trips}
              expenses={expenses}
              reports={reports}
              stores={storeLocations}
              biasCenter={primaryBiasCenter}
              onManageLocations={() => setActiveView('locations')}
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
              stores={storeLocations}
              biasCenter={primaryBiasCenter}
              findNearestStore={findNearestStore}
              onManageLocations={() => setActiveView('locations')}
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
          <span>{t('footer.tagline')}</span>
          <span>
            {t('footer.mapsPrefix')}
            <a
              href="https://maps.google.com/help/terms_maps/?utm_campaign=gmp_mcp_codeassist_v1_aistudio"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-slate-700 dark:hover:text-slate-200"
            >
              {t('footer.endUserTerms')}
            </a>
            {' · '}
            <a
              href="https://policies.google.com/privacy?utm_campaign=gmp_mcp_codeassist_v1_aistudio"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-slate-700 dark:hover:text-slate-200"
            >
              {t('footer.privacyPolicy')}
            </a>
            {t('footer.gpsNotice')}
          </span>
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <I18nProvider>
        <APIProvider apiKey={MAPS_API_KEY}>
          <WorkspaceShell />
        </APIProvider>
      </I18nProvider>
    </ErrorBoundary>
  );
}
