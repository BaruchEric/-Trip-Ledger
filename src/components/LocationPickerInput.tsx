import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Building2, CornerDownLeft, LocateFixed, MapPin, Plus, Search, X } from 'lucide-react';
import { useAutocompleteSuggestions } from '../hooks/useAutocompleteSuggestions';
import { useI18n } from '../lib/i18n';
import type { PlaceSelection, StoreLocation } from '../types/mileage';

interface LocationPickerInputProps {
  id: string;
  label: string;
  placeholder: string;
  value: PlaceSelection | null;
  onChange: (place: PlaceSelection | null) => void;
  stores: StoreLocation[];
  homeStorePlaceId?: string;
  biasCenter?: google.maps.LatLngLiteral | null;
  onManageLocations?: () => void;
  findNearestStore: (
    lat: number,
    lng: number,
    maxMiles?: number
  ) => { store: StoreLocation; distanceMiles: number } | null;
  accentDotColor: string;
}

export function LocationPickerInput({
  id,
  label,
  placeholder,
  value,
  onChange,
  stores,
  homeStorePlaceId,
  biasCenter,
  onManageLocations,
  findNearestStore,
  accentDotColor,
}: LocationPickerInputProps) {
  const { t, tLocationCategory } = useI18n();
  const placesLib = useMapsLibrary('places');
  const [inputText, setInputText] = useState(value?.name ?? '');
  const [isOpen, setIsOpen] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep input text synced when value changes externally (e.g., Swap, Map pin click, Template, GPS)
  useEffect(() => {
    setInputText(value?.name ?? '');
  }, [value?.name, value?.placeId, value?.address]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const queryForAutocomplete = isOpen && inputText !== value?.name ? inputText : '';
  const { suggestions, isLoading, resetSession } = useAutocompleteSuggestions(
    queryForAutocomplete,
    isOpen,
    biasCenter
  );

  // Filter user's saved locations by input text
  const normalizedQuery = inputText.trim().toLowerCase();
  const matchingStores = stores
    .filter((s) => {
      if (!normalizedQuery || inputText === value?.name) return true;
      return (
        s.shortName.toLowerCase().includes(normalizedQuery) ||
        s.address.toLowerCase().includes(normalizedQuery) ||
        (s.category && s.category.toLowerCase().includes(normalizedQuery))
      );
    })
    .sort((a, b) => {
      const aHome = a.isHome || (homeStorePlaceId && a.placeId === homeStorePlaceId);
      const bHome = b.isHome || (homeStorePlaceId && b.placeId === homeStorePlaceId);
      if (aHome && !bHome) return -1;
      if (!aHome && bHome) return 1;
      return 0;
    });

  const handleSelectStore = useCallback(
    (store: StoreLocation) => {
      const hasCoords = store.hasCoordinates !== false;
      onChange({
        name: store.shortName,
        address: store.address,
        placeId: store.placeId,
        lat: hasCoords ? store.lat : undefined,
        lng: hasCoords ? store.lng : undefined,
      });
      setInputText(store.shortName);
      setIsOpen(false);
      setLocError(null);
      resetSession();
    },
    [onChange, resetSession]
  );

  const handleSelectCustomTyped = useCallback(() => {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    onChange({
      name: trimmed,
      address: trimmed,
      placeId: '',
    });
    setInputText(trimmed);
    setIsOpen(false);
    setLocError(null);
    resetSession();
  }, [inputText, onChange, resetSession]);

  const handleSelectSuggestion = useCallback(
    async (suggestion: google.maps.places.AutocompleteSuggestion) => {
      if (!placesLib || !suggestion.placePrediction) return;
      try {
        const place = suggestion.placePrediction.toPlace();
        await place.fetchFields({
          fields: ['id', 'displayName', 'formattedAddress', 'location'],
        });

        const name =
          place.displayName ||
          suggestion.placePrediction.mainText?.text ||
          suggestion.placePrediction.text.text;
        const address = place.formattedAddress || suggestion.placePrediction.text.text;

        onChange({
          name,
          address,
          placeId: place.id ?? '',
          lat: place.location?.lat(),
          lng: place.location?.lng(),
        });
        setInputText(name);
        setIsOpen(false);
        setLocError(null);
        resetSession();
      } catch (err) {
        console.error('Failed to fetch place details:', err);
        setLocError('Could not load address details. Please try another selection.');
      }
    },
    [placesLib, onChange, resetSession]
  );

  const handleUseCurrentLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setLocError('Geolocation is not available in this browser.');
      return;
    }

    setIsLocating(true);
    setLocError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const nearest = findNearestStore(latitude, longitude, 0.6);
        if (nearest) {
          handleSelectStore(nearest.store);
        } else {
          const coordLabel = `Current Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
          onChange({
            name: 'Current GPS Location',
            address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
            placeId: '',
            lat: latitude,
            lng: longitude,
          });
          setInputText(coordLabel);
          setIsOpen(false);
        }
        setIsLocating(false);
      },
      (err) => {
        console.error('Geolocation error:', err);
        setIsLocating(false);
        setLocError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied.'
            : 'Unable to determine current location.'
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [findNearestStore, handleSelectStore, onChange]);

  const showCustomTypedOption =
    inputText.trim().length >= 2 && inputText.trim() !== (value?.name ?? '').trim();

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center justify-between mb-1.5">
        <label
          htmlFor={id}
          className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300"
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: accentDotColor }}
            aria-hidden="true"
          />
          {label}
        </label>
        <button
          type="button"
          onClick={handleUseCurrentLocation}
          disabled={isLocating}
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 disabled:opacity-50 transition-colors whitespace-nowrap"
          title={t('loc.useGps')}
        >
          <LocateFixed className="w-3.5 h-3.5" />
          {isLocating ? t('loc.locating') : t('loc.useGps')}
        </button>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          id={id}
          type="text"
          value={inputText}
          autoComplete="off"
          placeholder={placeholder}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isOpen && showCustomTypedOption && suggestions.length === 0) {
              e.preventDefault();
              handleSelectCustomTyped();
            }
          }}
          onChange={(e) => {
            setInputText(e.target.value);
            setIsOpen(true);
            setLocError(null);
            if (e.target.value.trim() === '') {
              onChange(null);
            }
          }}
          className="w-full ps-9 pe-9 py-2.5 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition-colors"
        />
        {inputText && (
          <button
            type="button"
            onClick={() => {
              setInputText('');
              onChange(null);
              resetSession();
            }}
            aria-label={label}
            className="absolute end-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {value?.address && !isOpen && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">{value.address}</p>
      )}

      {locError && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
          {locError}
        </p>
      )}

      {isOpen && (
        <div className="absolute z-30 inset-x-0 mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {/* User's Saved Locations */}
          {matchingStores.length > 0 ? (
            <div className="py-1.5">
              <div className="px-3 py-1 text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between gap-2">
                <span>{t('loc.savedLocations')}</span>
                {onManageLocations && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      onManageLocations();
                    }}
                    className="text-blue-700 dark:text-blue-400 hover:underline font-medium whitespace-nowrap"
                  >
                    {t('loc.manageLocations')}
                  </button>
                )}
              </div>
              {matchingStores.map((store) => {
                const isHome = store.isHome || (homeStorePlaceId && store.placeId === homeStorePlaceId);
                return (
                  <button
                    key={store.id ?? store.placeId}
                    type="button"
                    onClick={() => handleSelectStore(store)}
                    className="w-full px-3 py-2 text-start hover:bg-slate-50 dark:hover:bg-slate-800 flex items-start gap-2.5 transition-colors"
                  >
                    <Building2 className="w-4 h-4 text-blue-700 dark:text-blue-400 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                        <span className="truncate">{store.shortName}</span>
                        {store.category && (
                          <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400 shrink-0">
                            {tLocationCategory(store.category)}
                          </span>
                        )}
                        {isHome && (
                          <span className="text-xs font-medium text-blue-700 dark:text-blue-400 shrink-0">
                            · {t('loc.homeLocation')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {store.address}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : stores.length === 0 && !normalizedQuery ? (
            <div className="px-3 py-2.5 space-y-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('loc.noSavedYet')}</p>
              {onManageLocations && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onManageLocations();
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('loc.addLocationLink')}
                </button>
              )}
            </div>
          ) : null}

          {/* Live Global Google Places Autocomplete Results */}
          {queryForAutocomplete.trim().length >= 2 && (
            <div className="py-1.5">
              <div className="px-3 py-1 text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between">
                <span>{t('loc.addressesPlaces')}</span>
                {isLoading && (
                  <span className="text-slate-400 dark:text-slate-500">{t('loc.searching')}</span>
                )}
              </div>
              {suggestions.length === 0 && !isLoading ? (
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
                      onClick={() => void handleSelectSuggestion(suggestion)}
                      className="w-full px-3 py-2 text-start hover:bg-slate-50 dark:hover:bg-slate-800 flex items-start gap-2.5 transition-colors"
                    >
                      <MapPin className="w-4 h-4 text-slate-400 dark:text-slate-500 mt-0.5 shrink-0" />
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

          {/* Direct manual address / custom label option */}
          {showCustomTypedOption && (
            <div className="py-1.5">
              <button
                type="button"
                onClick={handleSelectCustomTyped}
                className="w-full px-3 py-2 text-start hover:bg-blue-50/70 dark:hover:bg-blue-950/40 flex items-center gap-2.5 transition-colors text-xs font-medium text-blue-700 dark:text-blue-400"
              >
                <CornerDownLeft className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {t('loc.useTypedAddress', { text: inputText.trim() })}
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
