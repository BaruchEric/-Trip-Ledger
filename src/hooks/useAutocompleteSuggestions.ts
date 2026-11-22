import { useCallback, useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';

export interface UseAutocompleteSuggestionsReturn {
  suggestions: google.maps.places.AutocompleteSuggestion[];
  isLoading: boolean;
  error: string | null;
  resetSession: () => void;
}

/**
 * Modern Places API (New) global autocomplete hook using AutocompleteSuggestion
 * and session tokens for cost-optimized address & place search anywhere in the world.
 * Optionally biases results around the user's primary saved location without hard-restricting region.
 */
export function useAutocompleteSuggestions(
  inputString: string,
  enabled: boolean = true,
  biasCenter?: google.maps.LatLngLiteral | null
): UseAutocompleteSuggestionsReturn {
  const placesLib = useMapsLibrary('places');
  const sessionTokenRef =
    useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  const [suggestions, setSuggestions] = useState<
    google.maps.places.AutocompleteSuggestion[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const biasLat = biasCenter?.lat ?? null;
  const biasLng = biasCenter?.lng ?? null;

  useEffect(() => {
    if (!placesLib || !enabled) return;

    const trimmed = inputString.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;

    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new AutocompleteSessionToken();
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      setError(null);

      const request: google.maps.places.AutocompleteRequest = {
        input: trimmed,
        sessionToken: sessionTokenRef.current ?? undefined,
      };

      if (biasLat !== null && biasLng !== null) {
        // Soft ~50 km radius bias around the user's primary location (does not exclude global results)
        request.locationBias = {
          center: { lat: biasLat, lng: biasLng },
          radius: 50000,
        };
      }

      AutocompleteSuggestion.fetchAutocompleteSuggestions(request)
        .then((res) => {
          if (cancelled) return;
          setSuggestions(res.suggestions ?? []);
          setIsLoading(false);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          console.error('AutocompleteSuggestion error:', err);
          setSuggestions([]);
          setIsLoading(false);
          setError('Unable to load address suggestions.');
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [placesLib, inputString, enabled, biasLat, biasLng]);

  const resetSession = useCallback(() => {
    sessionTokenRef.current = null;
    setSuggestions([]);
    setError(null);
  }, []);

  return {
    suggestions,
    isLoading,
    error,
    resetSession,
  };
}
