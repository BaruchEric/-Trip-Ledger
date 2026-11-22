import React, { useEffect, useMemo, useState } from 'react';
import {
  Car,
  DollarSign,
  Fuel,
  Package,
  ParkingCircle,
  Receipt,
  Route,
  Tag,
  X,
} from 'lucide-react';
import { suggestExpenseCategory } from '../lib/expenseCategorizer';
import { useI18n } from '../lib/i18n';
import {
  EXPENSE_CATEGORIES,
  FIELD_LIMITS,
  formatCurrency,
  formatDateISO,
  round2,
  type ExpenseCategory,
  type MileageTrip,
  type NewExpenseInput,
  type TripExpense,
} from '../types/mileage';

interface QuickExpenseModalProps {
  isOpen: boolean;
  trips: MileageTrip[];
  expenses?: TripExpense[];
  defaultTripId?: string;
  onClose: () => void;
  onSaveExpense: (input: NewExpenseInput) => Promise<void>;
}

const CATEGORY_META: Record<
  ExpenseCategory,
  {
    placeholder: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  Parking: {
    placeholder: 'e.g., Downtown Parking Garage or Metered Lot',
    Icon: ParkingCircle,
  },
  Tolls: {
    placeholder: 'e.g., Bridge Toll or Highway Toll Charge',
    Icon: Route,
  },
  'Express Lane': {
    placeholder: 'e.g., Express Lane / Toll Pass Transponder',
    Icon: Car,
  },
  'Fuel / Gas': {
    placeholder: 'e.g., Fuel Stop or EV Charging Station',
    Icon: Fuel,
  },
  Supplies: {
    placeholder: 'e.g., Packing Tape or Office Supplies',
    Icon: Package,
  },
  Other: {
    placeholder: 'e.g., Car Wash, Courier Fee, or Misc Receipt',
    Icon: Tag,
  },
};

const QUICK_AMOUNTS = [5, 10, 15, 20];

export function QuickExpenseModal({
  isOpen,
  trips,
  expenses = [],
  defaultTripId = '',
  onClose,
  onSaveExpense,
}: QuickExpenseModalProps) {
  const { t, tExpenseCategory, formatLocalizedDate } = useI18n();
  const sortedTrips = useMemo(
    () =>
      [...trips].sort((a, b) => {
        const cmp = b.tripDate.localeCompare(a.tripDate);
        if (cmp !== 0) return cmp;
        return (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0);
      }),
    [trips]
  );

  const [category, setCategory] = useState<ExpenseCategory>('Parking');
  const [categoryTouchedManually, setCategoryTouchedManually] = useState(false);
  const [tripId, setTripId] = useState<string>(defaultTripId);
  const [expenseDate, setExpenseDate] = useState<string>(formatDateISO());
  const [amountStr, setAmountStr] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync defaults when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setCategory('Parking');
    setCategoryTouchedManually(false);
    setAmountStr('');
    setDescription('');
    setNotes('');
    setErrorMsg(null);
    if (defaultTripId) {
      const matched = trips.find((t) => t.id === defaultTripId);
      setTripId(matched ? matched.id : '');
      setExpenseDate(matched?.tripDate ?? formatDateISO());
    } else {
      setTripId('');
      setExpenseDate(formatDateISO());
    }
  }, [isOpen, defaultTripId, trips]);

  // Keyword & history auto-categorization based on description and notes
  const categorySuggestion = useMemo(
    () => suggestExpenseCategory({ description, notes }, expenses),
    [description, notes, expenses]
  );

  useEffect(() => {
    if (!isOpen) return;
    if (!categoryTouchedManually && categorySuggestion) {
      setCategory(categorySuggestion.category);
    }
  }, [isOpen, categorySuggestion, categoryTouchedManually]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSaving, onClose]);

  if (!isOpen) return null;

  const parsedAmount = parseFloat(amountStr);
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount >= 0.01 && parsedAmount <= 5000;

  const handleTripSelect = (nextTripId: string) => {
    setTripId(nextTripId);
    if (nextTripId) {
      const selected = trips.find((t) => t.id === nextTripId);
      if (selected) {
        setExpenseDate(selected.tripDate);
      }
    }
  };

  const handleCategoryClick = (nextCategory: ExpenseCategory) => {
    setCategory(nextCategory);
    if (categorySuggestion && nextCategory === categorySuggestion.category) {
      setCategoryTouchedManually(false);
    } else {
      setCategoryTouchedManually(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!validAmount) {
      setErrorMsg('Enter an expense amount between $0.01 and $5,000.00.');
      return;
    }

    const cleanDescription =
      description.trim() ||
      (tripId
        ? `${category} — ${trips.find((t) => t.id === tripId)?.destinationName ?? 'Business Trip'}`
        : `${category} Expense`);

    setIsSaving(true);
    try {
      await onSaveExpense({
        tripId,
        expenseDate,
        category,
        description: cleanDescription.slice(0, FIELD_LIMITS.expenseDescription),
        amount: round2(parsedAmount),
        notes: notes.trim().slice(0, FIELD_LIMITS.notes),
      });
      onClose();
    } catch {
      setErrorMsg('Unable to save expense. Please check the values and try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 dark:bg-black/75 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-expense-modal-title"
      onClick={() => {
        if (!isSaving) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/70 text-blue-700 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Receipt className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2
                id="quick-expense-modal-title"
                className="text-sm font-semibold text-slate-900 dark:text-slate-100"
              >
                {t('expense.title')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {t('expense.subtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            aria-label={t('common.close')}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Merchant / Location Description (drives live auto-categorization) */}
          <div>
            <label
              htmlFor="expense-description"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              {t('expense.descLabel')}
            </label>
            <input
              id="expense-description"
              type="text"
              autoFocus
              maxLength={FIELD_LIMITS.expenseDescription}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('expense.descPlaceholder')}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
            {categorySuggestion ? (
              <div
                className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400"
                aria-live="polite"
              >
                <span className="truncate">
                  {category === categorySuggestion.category ? (
                    <>
                      {t('expense.autoSelected')}{' '}
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        {tExpenseCategory(categorySuggestion.category)}
                      </span>
                      {categorySuggestion.source === 'history' ? t('expense.fromHistory') : ''}
                      {categorySuggestion.matchedKeywords.length > 0
                        ? t('expense.matched', {
                            keywords: categorySuggestion.matchedKeywords.join(', '),
                          })
                        : ''}
                    </>
                  ) : (
                    <>
                      {categorySuggestion.source === 'history'
                        ? t('expense.historySuggests', {
                            category: tExpenseCategory(categorySuggestion.category),
                          })
                        : t('expense.keywordsSuggest', {
                            category: tExpenseCategory(categorySuggestion.category),
                          })}
                      {categorySuggestion.matchedKeywords.length > 0
                        ? t('expense.matched', {
                            keywords: categorySuggestion.matchedKeywords.join(', '),
                          })
                        : ''}
                    </>
                  )}
                </span>
                {category !== categorySuggestion.category && (
                  <button
                    type="button"
                    onClick={() => {
                      setCategory(categorySuggestion.category);
                      setCategoryTouchedManually(false);
                    }}
                    className="text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium whitespace-nowrap shrink-0"
                  >
                    {t('expense.applyCategory', {
                      category: tExpenseCategory(categorySuggestion.category),
                    })}
                  </button>
                )}
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                {t('expense.hint')}
              </p>
            )}
          </div>

          {/* Category Grid (6 categories, 2 cols mobile / 3 cols desktop) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {t('expense.categoryLabel')}
              </span>
              {!categoryTouchedManually && categorySuggestion && (
                <span className="text-[11px] text-blue-700 dark:text-blue-400 font-medium">
                  {t('expense.autoMatched')}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {EXPENSE_CATEGORIES.map((cat) => {
                const { Icon } = CATEGORY_META[cat];
                const active = category === cat;
                const isSuggested = categorySuggestion?.category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleCategoryClick(cat)}
                    className={`flex items-center justify-center gap-1.5 px-2.5 py-2.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-300'
                        : isSuggested
                          ? 'bg-slate-50 dark:bg-slate-900 border-blue-200 dark:border-blue-900/70 text-slate-700 dark:text-slate-200 hover:bg-blue-50/60 dark:hover:bg-blue-950/30'
                          : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{tExpenseCategory(cat)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Amount + Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="expense-amount"
                  className="text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  {t('expense.amountLabel')}
                </label>
                <div className="flex items-center gap-1" dir="ltr">
                  {QUICK_AMOUNTS.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setAmountStr(amt.toFixed(2))}
                      className="px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative">
                <DollarSign className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="expense-amount"
                  type="number"
                  dir="ltr"
                  min="0.01"
                  max="5000"
                  step="0.01"
                  required
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  placeholder="0.00"
                  className="w-full ps-8 pe-3 py-2 text-sm font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="expense-date"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t('expense.dateLabel')}
              </label>
              <input
                id="expense-date"
                type="date"
                required
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>
          </div>

          {/* Associated Trip */}
          <div>
            <label
              htmlFor="expense-trip"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              {t('expense.associatedTrip')}
            </label>
            <select
              id="expense-trip"
              value={tripId}
              onChange={(e) => handleTripSelect(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            >
              <option value="">{t('expense.generalExpense')}</option>
              {sortedTrips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {formatLocalizedDate(trip.tripDate)} · {trip.originName} → {trip.destinationName}{' '}
                  ({trip.billableMiles.toFixed(1)} {t('common.mi')})
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {t('expense.linkedHint')}
            </p>
          </div>

          {/* Notes */}
          <div>
            <label
              htmlFor="expense-notes"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              {t('expense.notesLabel')}
            </label>
            <input
              id="expense-notes"
              type="text"
              maxLength={FIELD_LIMITS.notes}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={CATEGORY_META[category].placeholder}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="px-3 py-2 text-xs text-red-900 dark:text-red-200 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/70 rounded-lg"
            >
              {errorMsg}
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
              {validAmount ? (
                <>
                  {t('expense.adding')}{' '}
                  <span dir="ltr" className="font-semibold text-slate-900 dark:text-slate-100">
                    {formatCurrency(round2(parsedAmount))}
                  </span>{' '}
                  ({tExpenseCategory(category)})
                </>
              ) : (
                t('expense.enterAmount')
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={isSaving}
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={!validAmount || isSaving}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:bg-slate-300 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap"
              >
                {isSaving ? t('common.saving') : t('expense.saveExpense')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
