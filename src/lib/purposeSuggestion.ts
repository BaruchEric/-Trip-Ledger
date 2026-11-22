import type { RouteTemplate, TripPurpose } from '../types/mileage';

export interface PurposeSuggestionInput {
  originName?: string;
  originAddress?: string;
  originPlaceId?: string;
  destinationName?: string;
  destinationAddress?: string;
  destinationPlaceId?: string;
  notes?: string;
}

export interface PurposeSuggestion {
  purpose: TripPurpose;
  matchedKeywords: string[];
  source: 'templates' | 'keywords';
  sourceTemplateLabel?: string;
  score: number;
}

const STOP_WORDS: Record<string, boolean> = {
  the: true,
  and: true,
  for: true,
  from: true,
  with: true,
  into: true,
  store: true,
  branch: true,
  blvd: true,
  ave: true,
  avenue: true,
  street: true,
  road: true,
  drive: true,
  suite: true,
  unit: true,
  west: true,
  east: true,
  north: true,
  south: true,
  trip: true,
  route: true,
};

const FALLBACK_PURPOSE_KEYWORDS: Record<TripPurpose, string[]> = {
  'Inter-Store Transfer': ['transfer', 'inventory', 'pickup', 'merchandise', 'stock', 'restock', 'unit'],
  'Shift Coverage': ['shift', 'cover', 'coverage', 'float', 'floating', 'schedule', 'fill'],
  'Bank Deposit': ['bank', 'deposit', 'chase', 'wells', 'fargo', 'bofa', 'citibank', 'cash', 'armored'],
  'Supply Run': ['supply', 'supplies', 'staples', 'office', 'depot', 'costco', 'target', 'walmart', 'paper', 'toner'],
  'Customer Delivery': ['delivery', 'deliver', 'customer', 'client', 'dropoff', 'home', 'residence'],
  'Training / HQ': ['training', 'corporate', 'headquarters', 'office', 'meeting', 'seminar', 'orientation', 'regional'],
  Other: [],
};

export function extractKeywords(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS[token] && !/^\d+$/.test(token));

  const seen: Record<string, boolean> = {};
  const unique: string[] = [];
  for (const token of normalized) {
    if (!seen[token]) {
      seen[token] = true;
      unique.push(token);
    }
  }
  return unique;
}

/**
 * Automatically suggests a Business Purpose for a new trip by analyzing
 * common keywords found in the user's saved Route Template descriptions
 * (label, origin, destination), with a lightweight domain keyword fallback.
 */
export function suggestTripPurpose(
  input: PurposeSuggestionInput,
  templates: RouteTemplate[]
): PurposeSuggestion | null {
  const combinedInput = [
    input.originName ?? '',
    input.originAddress ?? '',
    input.destinationName ?? '',
    input.destinationAddress ?? '',
    input.notes ?? '',
  ]
    .join(' ')
    .trim();

  if (!combinedInput) return null;

  const inputTokens = extractKeywords(combinedInput);
  if (inputTokens.length === 0 && !input.originPlaceId && !input.destinationPlaceId) {
    return null;
  }

  // 1. Primary Signal: Match against keywords & locations in user's saved Templates
  if (templates.length > 0) {
    const purposeScores: Record<string, number> = {};
    const purposeKeywords: Record<string, Record<string, boolean>> = {};
    const purposeBestTemplate: Record<string, { label: string; score: number }> = {};

    for (const tpl of templates) {
      const templateDescription = [
        tpl.label,
        tpl.originName,
        tpl.destinationName,
        tpl.originAddress,
        tpl.destinationAddress,
      ].join(' ');
      const tplTokens = extractKeywords(templateDescription);
      const labelTokens = extractKeywords(tpl.label);

      let tplScore = 0;
      const matched: string[] = [];

      // Exact Place ID match with a saved template endpoint
      if (
        input.originPlaceId &&
        tpl.originPlaceId &&
        input.originPlaceId === tpl.originPlaceId &&
        input.destinationPlaceId &&
        tpl.destinationPlaceId &&
        input.destinationPlaceId === tpl.destinationPlaceId
      ) {
        tplScore += 8;
        matched.push('saved route');
      } else {
        if (
          input.destinationPlaceId &&
          tpl.destinationPlaceId &&
          input.destinationPlaceId === tpl.destinationPlaceId
        ) {
          tplScore += 3;
        }
        if (
          input.originPlaceId &&
          tpl.originPlaceId &&
          input.originPlaceId === tpl.originPlaceId
        ) {
          tplScore += 1.5;
        }
      }

      // Keyword overlap against template descriptions (label keywords weighted higher)
      for (const token of inputTokens) {
        if (labelTokens.includes(token)) {
          tplScore += 3;
          matched.push(token);
        } else if (tplTokens.includes(token)) {
          tplScore += 1.5;
          matched.push(token);
        }
      }

      if (tplScore > 0) {
        const purpose = tpl.purpose;
        purposeScores[purpose] = (purposeScores[purpose] ?? 0) + tplScore;
        if (!purposeKeywords[purpose]) purposeKeywords[purpose] = {};
        for (const kw of matched) {
          purposeKeywords[purpose][kw] = true;
        }
        const prevBest = purposeBestTemplate[purpose];
        if (!prevBest || tplScore > prevBest.score) {
          purposeBestTemplate[purpose] = { label: tpl.label, score: tplScore };
        }
      }
    }

    let bestPurpose: TripPurpose | null = null;
    let bestScore = 0;
    for (const [purpose, score] of Object.entries(purposeScores)) {
      if (score > bestScore) {
        bestScore = score;
        bestPurpose = purpose as TripPurpose;
      }
    }

    if (bestPurpose && bestScore >= 1.5) {
      return {
        purpose: bestPurpose,
        matchedKeywords: Object.keys(purposeKeywords[bestPurpose] ?? {}).slice(0, 3),
        source: 'templates',
        sourceTemplateLabel: purposeBestTemplate[bestPurpose]?.label,
        score: bestScore,
      };
    }
  }

  // 2. Secondary Fallback: Common business travel keywords when no saved template matches yet
  let fallbackPurpose: TripPurpose | null = null;
  let fallbackMatches: string[] = [];

  for (const [purpose, keywords] of Object.entries(FALLBACK_PURPOSE_KEYWORDS) as Array<
    [TripPurpose, string[]]
  >) {
    if (keywords.length === 0) continue;
    const matches = inputTokens.filter((token) => keywords.includes(token));
    if (matches.length > fallbackMatches.length) {
      fallbackMatches = matches;
      fallbackPurpose = purpose;
    }
  }

  if (fallbackPurpose && fallbackMatches.length > 0) {
    return {
      purpose: fallbackPurpose,
      matchedKeywords: fallbackMatches.slice(0, 3),
      source: 'keywords',
      score: fallbackMatches.length,
    };
  }

  return null;
}
