import type { ExpenseCategory, TripExpense } from '../types/mileage';

export interface ExpenseCategorySuggestion {
  category: ExpenseCategory;
  matchedKeywords: string[];
  source: 'keywords' | 'history';
  confidence: 'high' | 'medium';
  score: number;
}

export interface ExpenseCategorizerInput {
  description?: string;
  notes?: string;
}

interface CategoryRuleSet {
  category: ExpenseCategory;
  priority: number;
  phrases: Array<{ phrase: string; weight: number }>;
  keywords: Array<{ word: string; weight: number }>;
}

const HISTORY_STOP_WORDS: Record<string, boolean> = {
  the: true,
  and: true,
  for: true,
  from: true,
  with: true,
  expense: true,
  receipt: true,
  paid: true,
  card: true,
  personal: true,
  business: true,
  trip: true,
  store: true,
  curacao: true,
  los: true,
  angeles: true,
  shift: true,
  run: true,
};

const CATEGORY_RULES: CategoryRuleSet[] = [
  {
    category: 'Express Lane',
    priority: 6,
    phrases: [
      { phrase: 'express lane', weight: 5 },
      { phrase: 'express lanes', weight: 5 },
      { phrase: 'metro express', weight: 5 },
      { phrase: 'metro expresslanes', weight: 5 },
      { phrase: 'fast trak', weight: 5 },
      { phrase: 'hot lane', weight: 4 },
      { phrase: 'hov lane', weight: 4 },
      { phrase: 'i-110 express', weight: 5 },
      { phrase: 'i-10 express', weight: 5 },
      { phrase: '91 express', weight: 5 },
    ],
    keywords: [
      { word: 'fastrak', weight: 4.5 },
      { word: 'fasttrak', weight: 4.5 },
      { word: 'expresslanes', weight: 4.5 },
      { word: 'expresslane', weight: 4.5 },
      { word: 'hov', weight: 3 },
      { word: 'carpool', weight: 2.5 },
    ],
  },
  {
    category: 'Parking',
    priority: 5,
    phrases: [
      { phrase: 'parking garage', weight: 5 },
      { phrase: 'parking structure', weight: 5 },
      { phrase: 'parking lot', weight: 5 },
      { phrase: 'parking meter', weight: 5 },
      { phrase: 'parking ticket', weight: 5 },
      { phrase: 'parking validation', weight: 5 },
      { phrase: 'valet parking', weight: 5 },
      { phrase: 'street parking', weight: 5 },
      { phrase: 'self park', weight: 4.5 },
      { phrase: 'public parking', weight: 4.5 },
      { phrase: 'metered lot', weight: 4.5 },
    ],
    keywords: [
      { word: 'parking', weight: 4 },
      { word: 'park', weight: 2.5 },
      { word: 'parked', weight: 3 },
      { word: 'meter', weight: 3.5 },
      { word: 'metered', weight: 3.5 },
      { word: 'garage', weight: 3.5 },
      { word: 'valet', weight: 3.5 },
      { word: 'parkwhiz', weight: 4 },
      { word: 'spothero', weight: 4 },
      { word: 'paybyphone', weight: 4 },
      { word: 'parkmobile', weight: 4 },
      { word: 'validation', weight: 3 },
    ],
  },
  {
    category: 'Fuel / Gas',
    priority: 4,
    phrases: [
      { phrase: 'gas station', weight: 5 },
      { phrase: 'fuel stop', weight: 5 },
      { phrase: 'fuel pump', weight: 4.5 },
      { phrase: 'fill up', weight: 4 },
      { phrase: 'ev charge', weight: 5 },
      { phrase: 'ev charging', weight: 5 },
      { phrase: 'charging station', weight: 5 },
      { phrase: 'costco gas', weight: 5 },
      { phrase: 'sams gas', weight: 5 },
      { phrase: 'union 76', weight: 4.5 },
      { phrase: '76 gas', weight: 5 },
      { phrase: '76 station', weight: 4.5 },
      { phrase: 'unleaded gas', weight: 5 },
      { phrase: 'regular gas', weight: 5 },
    ],
    keywords: [
      { word: 'gas', weight: 4 },
      { word: 'fuel', weight: 4 },
      { word: 'gasoline', weight: 4 },
      { word: 'petrol', weight: 4 },
      { word: 'diesel', weight: 4 },
      { word: 'unleaded', weight: 3.5 },
      { word: 'octane', weight: 3.5 },
      { word: 'refuel', weight: 4 },
      { word: 'pump', weight: 2.5 },
      { word: 'chevron', weight: 4 },
      { word: 'shell', weight: 4 },
      { word: 'mobil', weight: 4 },
      { word: 'exxon', weight: 4 },
      { word: 'arco', weight: 4 },
      { word: 'valero', weight: 4 },
      { word: 'texaco', weight: 4 },
      { word: 'sinclair', weight: 3.5 },
      { word: 'supercharger', weight: 4 },
      { word: 'chargepoint', weight: 4 },
      { word: 'electrify', weight: 3.5 },
      { word: 'evgo', weight: 4 },
      { word: 'charging', weight: 3 },
      { word: 'gallon', weight: 3 },
      { word: 'gallons', weight: 3 },
    ],
  },
  {
    category: 'Tolls',
    priority: 3,
    phrases: [
      { phrase: 'toll road', weight: 5 },
      { phrase: 'toll roads', weight: 5 },
      { phrase: 'bridge toll', weight: 5 },
      { phrase: 'toll bridge', weight: 5 },
      { phrase: 'toll plaza', weight: 5 },
      { phrase: 'toll booth', weight: 5 },
      { phrase: 'toll charge', weight: 5 },
      { phrase: 'sr-73', weight: 4 },
      { phrase: 'sr-241', weight: 4 },
      { phrase: 'sr-261', weight: 4 },
      { phrase: 'sr-133', weight: 4 },
      { phrase: '73 toll', weight: 5 },
      { phrase: '241 toll', weight: 5 },
    ],
    keywords: [
      { word: 'toll', weight: 4 },
      { word: 'tolls', weight: 4 },
      { word: 'turnpike', weight: 4 },
      { word: 'tollway', weight: 4 },
      { word: 'transponder', weight: 3.5 },
      { word: 'bridge', weight: 2.5 },
      { word: 'thetolls', weight: 4 },
    ],
  },
  {
    category: 'Supplies',
    priority: 2,
    phrases: [
      { phrase: 'packing tape', weight: 5 },
      { phrase: 'office depot', weight: 4.5 },
      { phrase: 'home depot', weight: 4.5 },
      { phrase: 'shipping box', weight: 4.5 },
      { phrase: 'shipping boxes', weight: 4.5 },
      { phrase: 'printer ink', weight: 4.5 },
      { phrase: 'copy paper', weight: 4.5 },
      { phrase: 'store supplies', weight: 5 },
      { phrase: 'office supplies', weight: 5 },
      { phrase: 'cleaning supplies', weight: 5 },
      { phrase: 'trash bags', weight: 4 },
      { phrase: 'bubble wrap', weight: 4.5 },
      { phrase: 'zip ties', weight: 4 },
    ],
    keywords: [
      { word: 'supply', weight: 4 },
      { word: 'supplies', weight: 4 },
      { word: 'staples', weight: 3.5 },
      { word: 'tape', weight: 3 },
      { word: 'box', weight: 2.5 },
      { word: 'boxes', weight: 3 },
      { word: 'packaging', weight: 3.5 },
      { word: 'packing', weight: 3 },
      { word: 'printer', weight: 3 },
      { word: 'ink', weight: 3 },
      { word: 'toner', weight: 3.5 },
      { word: 'paper', weight: 2.5 },
      { word: 'folders', weight: 3 },
      { word: 'binders', weight: 3 },
      { word: 'labels', weight: 3 },
      { word: 'markers', weight: 3 },
      { word: 'envelopes', weight: 3 },
      { word: 'hardware', weight: 3 },
      { word: 'lowes', weight: 3.5 },
      { word: 'batteries', weight: 3 },
      { word: 'gloves', weight: 2.5 },
      { word: 'cleaning', weight: 2.5 },
      { word: 'wipes', weight: 2.5 },
      { word: 'cardboard', weight: 3 },
    ],
  },
  {
    category: 'Other',
    priority: 1,
    phrases: [
      { phrase: 'car wash', weight: 4 },
      { phrase: 'delivery fee', weight: 4 },
      { phrase: 'service fee', weight: 3.5 },
      { phrase: 'post office', weight: 4 },
    ],
    keywords: [
      { word: 'carwash', weight: 3.5 },
      { word: 'fedex', weight: 3.5 },
      { word: 'ups', weight: 3 },
      { word: 'usps', weight: 3.5 },
      { word: 'postage', weight: 3.5 },
      { word: 'shipping', weight: 3 },
      { word: 'courier', weight: 3.5 },
      { word: 'errand', weight: 2.5 },
      { word: 'gratuity', weight: 3 },
      { word: 'tip', weight: 2.5 },
      { word: 'misc', weight: 3 },
      { word: 'miscellaneous', weight: 3 },
    ],
  },
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenizeForHistory(value: string): string[] {
  const tokens = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !HISTORY_STOP_WORDS[token] && !/^\d+$/.test(token));

  const seen: Record<string, boolean> = {};
  const unique: string[] = [];
  for (const token of tokens) {
    if (!seen[token]) {
      seen[token] = true;
      unique.push(token);
    }
  }
  return unique;
}

function matchPhrase(text: string, phrase: string): boolean {
  if (!text) return false;
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(phrase)}($|[^a-z0-9])`, 'i');
  return pattern.test(text);
}

function matchWord(text: string, word: string): boolean {
  if (!text) return false;
  const pattern = new RegExp(`\\b${escapeRegex(word)}\\b`, 'i');
  return pattern.test(text);
}

/**
 * Automatically suggests an ExpenseCategory from the user's expense description
 * and optional notes using weighted domain keywords/phrases, falling back to
 * recurring merchant terms from the user's saved expense history.
 */
export function suggestExpenseCategory(
  input: ExpenseCategorizerInput,
  pastExpenses: TripExpense[] = []
): ExpenseCategorySuggestion | null {
  const desc = normalizeText(input.description ?? '');
  const notes = normalizeText(input.notes ?? '');

  if (!desc && !notes) return null;

  // 1. Primary Signal: Domain keyword and phrase classification
  let bestRuleMatch: {
    category: ExpenseCategory;
    score: number;
    priority: number;
    matchedKeywords: string[];
  } | null = null;

  for (const rule of CATEGORY_RULES) {
    let score = 0;
    const matched: string[] = [];
    const matchedSet = new Set<string>();

    const recordMatch = (label: string, points: number) => {
      score += points;
      if (!matchedSet.has(label)) {
        matchedSet.add(label);
        matched.push(label);
      }
    };

    for (const { phrase, weight } of rule.phrases) {
      if (matchPhrase(desc, phrase)) {
        recordMatch(phrase, weight * 1.5);
      } else if (matchPhrase(notes, phrase)) {
        recordMatch(phrase, weight);
      }
    }

    for (const { word, weight } of rule.keywords) {
      // Avoid double-counting a single word already represented inside a matched phrase
      const alreadyInPhrase = matched.some((m) => m.includes(word));
      if (matchWord(desc, word)) {
        if (!alreadyInPhrase) {
          recordMatch(word, weight * 1.5);
        } else {
          score += 0.5;
        }
      } else if (matchWord(notes, word)) {
        if (!alreadyInPhrase) {
          recordMatch(word, weight);
        } else {
          score += 0.25;
        }
      }
    }

    if (score > 0) {
      if (
        !bestRuleMatch ||
        score > bestRuleMatch.score ||
        (score === bestRuleMatch.score && rule.priority > bestRuleMatch.priority)
      ) {
        bestRuleMatch = {
          category: rule.category,
          score,
          priority: rule.priority,
          matchedKeywords: matched.slice(0, 3),
        };
      }
    }
  }

  if (bestRuleMatch && bestRuleMatch.score >= 2.5) {
    return {
      category: bestRuleMatch.category,
      matchedKeywords: bestRuleMatch.matchedKeywords,
      source: 'keywords',
      confidence: bestRuleMatch.score >= 5 ? 'high' : 'medium',
      score: bestRuleMatch.score,
    };
  }

  // 2. Secondary Signal: Learn from recurring merchant descriptions in user's past expenses
  if (pastExpenses.length > 0 && desc.length >= 3) {
    const inputTokens = tokenizeForHistory(desc);
    if (inputTokens.length > 0) {
      const categoryScores: Record<string, number> = {};
      const categoryMatches: Record<string, Set<string>> = {};

      for (const exp of pastExpenses) {
        const expTokens = tokenizeForHistory(exp.description);
        if (expTokens.length === 0) continue;

        let overlap = 0;
        const matchedTokens: string[] = [];
        for (const token of inputTokens) {
          if (expTokens.includes(token)) {
            overlap += 2;
            matchedTokens.push(token);
          }
        }

        if (overlap > 0) {
          categoryScores[exp.category] = (categoryScores[exp.category] ?? 0) + overlap;
          if (!categoryMatches[exp.category]) {
            categoryMatches[exp.category] = new Set<string>();
          }
          for (const tk of matchedTokens) {
            categoryMatches[exp.category].add(tk);
          }
        }
      }

      let bestHistoryCategory: ExpenseCategory | null = null;
      let bestHistoryScore = 0;
      for (const [cat, sc] of Object.entries(categoryScores)) {
        if (sc > bestHistoryScore) {
          bestHistoryScore = sc;
          bestHistoryCategory = cat as ExpenseCategory;
        }
      }

      if (bestHistoryCategory && bestHistoryScore >= 2) {
        return {
          category: bestHistoryCategory,
          matchedKeywords: Array.from(categoryMatches[bestHistoryCategory] ?? []).slice(0, 3),
          source: 'history',
          confidence: bestHistoryScore >= 4 ? 'high' : 'medium',
          score: bestHistoryScore,
        };
      }
    }
  }

  return null;
}
