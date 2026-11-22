import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import {
  Building2,
  Check,
  Edit3,
  Home,
  Info,
  LocateFixed,
  MapPin,
  Navigation,
  Plus,
  Search,
  Star,
  Trash2,
  Warehouse,
  Briefcase,
  X,
} from 'lucide-react';
import { useAutocompleteSuggestions } from '../hooks/useAutocompleteSuggestions';
import { useI18n } from '../lib/i18n';
import {
  FIELD_LIMITS,
  LOCATION_CATEGORIES,
  type LocationCategory,
  type PlaceSelection,
  type SavedLocation,
  type SavedLocationInput,
} from '../types/mileage';

interface LocationsViewProps {
  isAuthenticated: boolean;
  onRequestSignIn: () => void;
  locations: SavedLocation[];
  loading: boolean;
  biasCenter?: google.maps.LatLngLiteral | null;
  onAddLocation: (input: SavedLocationInput) => Promise<void>;
  onUpdateLocation: (locationId: string, input: SavedLocationInput) => Promise<void>;
  onDeleteLocation: (locationId: string) => Promise<void>;
  onSetHomeLocation: (location: SavedLocation) => Promise<void>;
  onUseLocationInTrip: (role: 'origin' | 'destination', place: PlaceSelection) => void;
}

function CategoryIcon({ category, className }: { category: LocationCategory; className?: string }) {
  switch (category) {
    case 'Home':
      return <Home className={className} />;
    case 'Office':
      return <Building2 className={className} />;
    case 'Client':
      return <Briefcase className={className} />;
    case 'Warehouse':
      return <Warehouse className={className} />;
    case 'Branch':
      return <Building2 className={className} />;
    default:
      return <MapPin className={className} />;
  }
}

export function LocationsView({
  isAuthenticated,
  onRequestSignIn,
  locations,
  loading,
  biasCenter,
  onAddLocation,
  onUpdateLocation,
  onDeleteLocation,
  onSetHomeLocation,
  onUseLocationInTrip,
}: LocationsViewProps) {
  const { t, tLocationCategory } = useI18n();
  const placesLib = useMapsLibrary('places');

  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [placeSearchText, setPlaceSearchText] = useState('');
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [placeId, setPlaceId] = useState('');
  const [lat, setLat] = useState<number>(0);
  const [lng, setLng] = useState<number>(0);
  const [hasCoordinates, setHasCoordinates] = useState<boolean>(false);
  const [category, setCategory] = useState<LocationCategory>('Office');
  const [notes, setNotes] = useState('');
  const [isHome, setIsHome] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // List filter state
  const [listSearch, setListSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | LocationCategory>('ALL');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const searchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const { suggestions, isLoading: suggestionsLoading, resetSession } = useAutocompleteSuggestions(
    searchDropdownOpen ? placeSearchText : '',
    searchDropdownOpen,
    biasCenter
  );

  const resetForm = useCallback(() => {
    setEditingId(null);
    setPlaceSearchText('');
    setSearchDropdownOpen(false);
    setName('');
    setAddress('');
    setPlaceId('');
    setLat(0);
    setLng(0);
    setHasCoordinates(false);
    setCategory('Office');
    setNotes('');
    setIsHome(false);
    resetSession();
  }, [resetSession]);

  const handleStartEdit = (loc: SavedLocation) => {
    setEditingId(loc.id);
    setName(loc.name);
    setAddress(loc.address);
    setPlaceId(loc.placeId);
    setLat(loc.lat);
    setLng(loc.lng);
    setHasCoordinates(loc.hasCoordinates);
    setCategory(loc.category);
    setNotes(loc.notes);
    setIsHome(loc.isHome);
    setPlaceSearchText('');
    setSearchDropdownOpen(false);
    setFeedback(null);
  };

  const handleSelectPlaceSuggestion = useCallback(
    async (suggestion: google.maps.places.AutocompleteSuggestion) => {
      if (!placesLib || !suggestion.placePrediction) return;
      try {
        const place = suggestion.placePrediction.toPlace();
        await place.fetchFields({
          fields: ['id', 'displayName', 'formattedAddress', 'location'],
        });

        const resolvedName =
          place.displayName ||
          suggestion.placePrediction.mainText?.text ||
          suggestion.placePrediction.text.text;
        const resolvedAddress = place.formattedAddress || suggestion.placePrediction.text.text;
        const locLat = place.location?.lat();
        const locLng = place.location?.lng();

        if (!name.trim()) {
          setName(resolvedName.slice(0, FIELD_LIMITS.locationName));
        }
        setAddress(resolvedAddress.slice(0, FIELD_LIMITS.locationAddress));
        setPlaceId((place.id ?? '').slice(0, FIELD_LIMITS.placeId));
        if (typeof locLat === 'number' && typeof locLng === 'number') {
          setLat(locLat);
          setLng(locLng);
          setHasCoordinates(true);
        } else {
          setLat(0);
          setLng(0);
          setHasCoordinates(false);
        }
        setPlaceSearchText(resolvedName);
        setSearchDropdownOpen(false);
        setFeedback(null);
        resetSession();
      } catch (err) {
        console.error('Failed to fetch place details:', err);
        setFeedback({ type: 'error', text: t('locations.errorSave') });
      }
    },
    [placesLib, name, resetSession, t]
  );

  const handleUseCurrentGps = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setFeedback({ type: 'error', text: 'Geolocation is not available in this browser.' });
      return;
    }
    setIsLocating(true);
    setFeedback(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setLat(latitude);
        setLng(longitude);
        setHasCoordinates(true);
        setPlaceId('');
        if (!address.trim()) {
          setAddress(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
        }
        if (!name.trim()) {
          setName('Current Location');
        }
        setFeedback({ type: 'success', text: t('locations.gpsCaptured') });
        setIsLocating(false);
      },
      (err) => {
        console.error('Geolocation error:', err);
        setIsLocating(false);
        setFeedback({
          type: 'error',
          text:
            err.code === err.PERMISSION_DENIED
              ? 'Location permission denied.'
              : 'Unable to determine current location.',
        });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [address, name, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim().slice(0, FIELD_LIMITS.locationName);
    const cleanAddress = address.trim().slice(0, FIELD_LIMITS.locationAddress);

    if (!cleanName || !cleanAddress) {
      setFeedback({ type: 'error', text: t('locations.errorSave') });
      return;
    }

    setIsSaving(true);
    setFeedback(null);
    try {
      const payload: SavedLocationInput = {
        name: cleanName,
        address: cleanAddress,
        placeId: placeId.trim().slice(0, FIELD_LIMITS.placeId),
        category,
        lat: hasCoordinates ? lat : 0,
        lng: hasCoordinates ? lng : 0,
        hasCoordinates,
        isHome,
        notes: notes.trim().slice(0, FIELD_LIMITS.locationNotes),
      };

      if (editingId) {
        await onUpdateLocation(editingId, payload);
        setFeedback({ type: 'success', text: t('locations.updatedSuccess') });
      } else {
        await onAddLocation(payload);
        setFeedback({ type: 'success', text: t('locations.savedSuccess') });
      }
      resetForm();
    } catch (err) {
      console.error('Failed to save location:', err);
      setFeedback({ type: 'error', text: t('locations.errorSave') });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyId(id);
    try {
      await onDeleteLocation(id);
      if (editingId === id) {
        resetForm();
      }
      setConfirmDeleteId(null);
    } finally {
      setBusyId(null);
    }
  };

  const handleSetHome = async (loc: SavedLocation) => {
    setBusyId(loc.id);
    try {
      await onSetHomeLocation(loc);
    } finally {
      setBusyId(null);
    }
  };

  const handleUseInTrip = (role: 'origin' | 'destination', loc: SavedLocation) => {
    onUseLocationInTrip(role, {
      name: loc.name,
      address: loc.address,
      placeId: loc.placeId || `saved:${loc.id}`,
      lat: loc.hasCoordinates ? loc.lat : undefined,
      lng: loc.hasCoordinates ? loc.lng : undefined,
    });
  };

  const filteredLocations = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return [...locations]
      .filter((loc) => {
        if (categoryFilter !== 'ALL' && loc.category !== categoryFilter) return false;
        if (!q) return true;
        return (
          loc.name.toLowerCase().includes(q) ||
          loc.address.toLowerCase().includes(q) ||
          loc.notes.toLowerCase().includes(q) ||
          loc.category.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (a.isHome && !b.isHome) return -1;
        if (!a.isHome && b.isHome) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [locations, listSearch, categoryFilter]);

  return (
    <div className="space-y-6">
      {/* Guest local storage notice */}
      {!isAuthenticated && (
        <div className="px-4 py-3 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/80 rounded-xl flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-blue-900 dark:text-blue-200">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-700 dark:text-blue-400" />
            <span>{t('locations.localModeNotice')}</span>
          </div>
          <button
            type="button"
            onClick={onRequestSignIn}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-md transition-colors whitespace-nowrap"
          >
            {t('auth.signInGoogle')}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Add / Edit Location Form */}
        <section className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {editingId ? t('locations.editTitle') : t('locations.addTitle')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t('locations.subtitle')}
              </p>
            </div>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap"
              >
                <X className="w-3.5 h-3.5" />
                {t('common.cancel')}
              </button>
            )}
          </div>

          {/* Optional Places Autocomplete Lookup + GPS Capture */}
          <div ref={searchContainerRef} className="relative space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="loc-place-search"
                className="text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                {t('locations.searchPlacesLabel')}
              </label>
              <button
                type="button"
                onClick={handleUseCurrentGps}
                disabled={isLocating}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <LocateFixed className="w-3.5 h-3.5" />
                {isLocating ? t('loc.locating') : t('loc.useGps')}
              </button>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="loc-place-search"
                type="text"
                autoComplete="off"
                value={placeSearchText}
                onFocus={() => setSearchDropdownOpen(true)}
                onChange={(e) => {
                  setPlaceSearchText(e.target.value);
                  setSearchDropdownOpen(true);
                }}
                placeholder={t('locations.searchPlacesPlaceholder')}
                className="w-full ps-9 pe-8 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
              {placeSearchText && (
                <button
                  type="button"
                  onClick={() => {
                    setPlaceSearchText('');
                    resetSession();
                  }}
                  aria-label={t('common.clear')}
                  className="absolute end-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {searchDropdownOpen && placeSearchText.trim().length >= 2 && (
              <div className="absolute z-30 inset-x-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                <div className="px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between">
                  <span>{t('loc.addressesPlaces')}</span>
                  {suggestionsLoading && <span>{t('loc.searching')}</span>}
                </div>
                {suggestions.length === 0 && !suggestionsLoading ? (
                  <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                    {t('loc.noMatches')}
                  </div>
                ) : (
                  suggestions.map((suggestion, idx) => {
                    const pred = suggestion.placePrediction;
                    if (!pred) return null;
                    return (
                      <button
                        key={pred.placeId ?? idx}
                        type="button"
                        onClick={() => void handleSelectPlaceSuggestion(suggestion)}
                        className="w-full px-3 py-2 text-start hover:bg-slate-50 dark:hover:bg-slate-800 flex items-start gap-2 transition-colors"
                      >
                        <MapPin className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                            {pred.mainText?.text ?? pred.text.text}
                          </div>
                          {pred.secondaryText?.text && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                              {pred.secondaryText.text}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Location Name */}
            <div>
              <label
                htmlFor="loc-name"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t('locations.nameLabel')}
              </label>
              <input
                id="loc-name"
                type="text"
                required
                maxLength={FIELD_LIMITS.locationName}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('locations.namePlaceholder')}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            {/* Street Address */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label
                  htmlFor="loc-address"
                  className="text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  {t('locations.addressLabel')}
                </label>
                <span
                  className={`text-[11px] font-medium ${
                    hasCoordinates
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {hasCoordinates
                    ? t('locations.coordsVerified')
                    : t('locations.manualAddressOnly')}
                </span>
              </div>
              <input
                id="loc-address"
                type="text"
                required
                maxLength={FIELD_LIMITS.locationAddress}
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  // If user manually edits the street address away from a verified place, clear stale coords
                  if (hasCoordinates) {
                    setHasCoordinates(false);
                    setPlaceId('');
                    setLat(0);
                    setLng(0);
                  }
                }}
                placeholder={t('locations.addressPlaceholder')}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            {/* Category */}
            <div>
              <span className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t('locations.categoryLabel')}
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {LOCATION_CATEGORIES.map((cat) => {
                  const active = category === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategory(cat)}
                      className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-400 dark:border-blue-700 text-blue-800 dark:text-blue-300'
                          : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <CategoryIcon category={cat} className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{tLocationCategory(cat)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label
                htmlFor="loc-notes"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t('locations.notesLabel')}
              </label>
              <input
                id="loc-notes"
                type="text"
                maxLength={FIELD_LIMITS.locationNotes}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('locations.notesPlaceholder')}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            {/* Primary / Home toggle */}
            <label className="flex items-center gap-2.5 cursor-pointer select-none pt-1">
              <input
                type="checkbox"
                checked={isHome}
                onChange={(e) => setIsHome(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-700 focus:ring-blue-600"
              />
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {t('locations.setAsHome')}
              </span>
            </label>

            {feedback && (
              <div
                role={feedback.type === 'error' ? 'alert' : 'status'}
                className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
                  feedback.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                }`}
              >
                {feedback.type === 'success' && <Check className="w-3.5 h-3.5 shrink-0" />}
                <span>{feedback.text}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSaving}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              {isSaving
                ? t('common.saving')
                : editingId
                  ? t('locations.updateButton')
                  : t('locations.addButton')}
            </button>
          </form>
        </section>

        {/* Right: Saved Locations Directory */}
        <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {t('locations.title')}
                </h2>
                <span className="px-2 py-0.5 text-xs font-mono tabular-nums font-medium rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  {t('locations.savedCount', { count: locations.length })}
                </span>
              </div>
            </div>

            {/* Search + Category Filter */}
            <div className="space-y-2.5">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  placeholder={t('locations.searchListPlaceholder')}
                  className="w-full ps-9 pe-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCategoryFilter('ALL')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                    categoryFilter === 'ALL'
                      ? 'bg-slate-900 dark:bg-slate-100 border-slate-900 dark:border-slate-100 text-white dark:text-slate-900'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {t('locations.allCategories')}
                </button>
                {LOCATION_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                      categoryFilter === cat
                        ? 'bg-blue-700 dark:bg-blue-600 border-blue-700 dark:border-blue-600 text-white'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {tLocationCategory(cat)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              {t('routeMap.loadingStores')}
            </div>
          ) : locations.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 flex items-center justify-center mx-auto">
                <MapPin className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t('locations.emptyTitle')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
                {t('locations.emptyDesc')}
              </p>
            </div>
          ) : filteredLocations.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              {t('locations.noFilterMatch')}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredLocations.map((loc) => {
                const isBusy = busyId === loc.id;
                const isConfirmingDelete = confirmDeleteId === loc.id;
                return (
                  <li
                    key={loc.id}
                    className={`p-4 transition-colors ${
                      editingId === loc.id
                        ? 'bg-blue-50/50 dark:bg-blue-950/25'
                        : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                            loc.isHome
                              ? 'bg-blue-700 text-white'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          <CategoryIcon category={loc.category} className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {loc.name}
                            </span>
                            <span className="px-1.5 py-0.5 text-[11px] font-medium rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                              {tLocationCategory(loc.category)}
                            </span>
                            {loc.isHome && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-semibold rounded bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300">
                                <Star className="w-3 h-3 fill-current" />
                                {t('locations.primaryBadge')}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400 break-words">
                            {loc.address}
                          </p>
                          {loc.notes && (
                            <p className="text-xs text-slate-500 dark:text-slate-500 italic">
                              {loc.notes}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Row Actions */}
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleUseInTrip('origin', loc)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 rounded-md transition-colors whitespace-nowrap"
                          title={t('routeMap.setOrigin')}
                        >
                          <Navigation className="w-3 h-3" />
                          {t('locations.useAsOrigin')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUseInTrip('destination', loc)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/60 rounded-md transition-colors whitespace-nowrap"
                          title={t('routeMap.setDest')}
                        >
                          <MapPin className="w-3 h-3" />
                          {t('locations.useAsDest')}
                        </button>
                        {!loc.isHome && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleSetHome(loc)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap disabled:opacity-50"
                            title={t('locations.setPrimary')}
                          >
                            <Star className="w-3 h-3" />
                            {t('locations.setPrimary')}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleStartEdit(loc)}
                          aria-label={t('common.edit')}
                          className="p-1.5 text-slate-500 hover:text-blue-700 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        {isConfirmingDelete ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleDelete(loc.id)}
                              className="px-2 py-1 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors whitespace-nowrap"
                            >
                              {t('locations.confirmDelete')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setConfirmDeleteId(loc.id)}
                            aria-label={t('common.delete')}
                            className="p-1.5 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
