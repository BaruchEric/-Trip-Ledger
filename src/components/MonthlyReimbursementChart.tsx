import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useI18n } from '../lib/i18n';
import {
  formatCurrency,
  round1,
  round2,
  type MileageTrip,
  type TripExpense,
} from '../types/mileage';

interface MonthlyBucket {
  monthIndex: number;
  month: string;
  submittedAmount: number;
  readyAmount: number;
  expenseAmount: number;
  totalAmount: number;
  miles: number;
  tripCount: number;
  expenseCount: number;
}

interface MonthlyReimbursementChartProps {
  trips: MileageTrip[];
  expenses?: TripExpense[];
  year?: number;
  isDark?: boolean;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: MonthlyBucket }>;
  scope: 'all' | 'submitted';
  year: number;
}

function ChartTooltip({ active, payload, scope, year }: CustomTooltipProps) {
  const { t, tStage, dir } = useI18n();
  if (!active || !payload || payload.length === 0) return null;
  const bucket = payload[0]?.payload;
  if (!bucket) return null;

  const shownAmount =
    scope === 'submitted'
      ? round2(bucket.submittedAmount + bucket.expenseAmount)
      : bucket.totalAmount;

  return (
    <div
      dir={dir}
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md px-3.5 py-2.5 text-xs space-y-1.5 min-w-[200px]"
    >
      <div className="font-semibold text-slate-900 dark:text-slate-100">
        {bucket.month} {year}
      </div>
      <div className="space-y-1 font-mono tabular-nums">
        <div className="flex items-center justify-between gap-4 text-slate-700 dark:text-slate-300">
          <span className="font-sans text-slate-500 dark:text-slate-400">
            {tStage('submitted')}
          </span>
          <span dir="ltr">{formatCurrency(bucket.submittedAmount)}</span>
        </div>
        {scope === 'all' && (
          <div className="flex items-center justify-between gap-4 text-slate-700 dark:text-slate-300">
            <span className="font-sans text-slate-500 dark:text-slate-400">
              {t('chart.readyQueue')}
            </span>
            <span dir="ltr">{formatCurrency(bucket.readyAmount)}</span>
          </div>
        )}
        {bucket.expenseAmount > 0 && (
          <div className="flex items-center justify-between gap-4 text-emerald-700 dark:text-emerald-400">
            <span className="font-sans text-slate-500 dark:text-slate-400">
              {t('nav.expShort')}
            </span>
            <span dir="ltr">{formatCurrency(bucket.expenseAmount)}</span>
          </div>
        )}
        <div className="pt-1 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4 font-semibold text-slate-900 dark:text-slate-100">
          <span className="font-sans">{t('reports.total')}</span>
          <span dir="ltr">{formatCurrency(shownAmount)}</span>
        </div>
      </div>
      <div className="pt-1 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
        {bucket.tripCount}{' '}
        {bucket.tripCount === 1 ? t('nav.tripSingular') : t('nav.tripPlural')} ·{' '}
        <span dir="ltr">
          {bucket.miles.toFixed(1)} {t('common.mi')}
        </span>
        {bucket.expenseCount > 0 ? ` · ${bucket.expenseCount} ${t('nav.expShort')}` : ''}
      </div>
    </div>
  );
}

export function MonthlyReimbursementChart({
  trips,
  expenses = [],
  year: initialYear = new Date().getFullYear(),
  isDark = false,
}: MonthlyReimbursementChartProps) {
  const { t, tStage, monthLabels } = useI18n();
  const [scope, setScope] = useState<'all' | 'submitted'>('all');

  // Collect all distinct years available in trips and expenses (always include initialYear)
  const availableYears = useMemo(() => {
    const years = new Set<number>([initialYear]);
    for (const trip of trips) {
      const yr = parseInt(trip.tripDate?.slice(0, 4) ?? '', 10);
      if (Number.isFinite(yr) && yr >= 2000 && yr <= 2100) years.add(yr);
    }
    for (const exp of expenses) {
      const yr = parseInt(exp.expenseDate?.slice(0, 4) ?? '', 10);
      if (Number.isFinite(yr) && yr >= 2000 && yr <= 2100) years.add(yr);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [trips, expenses, initialYear]);

  const [selectedYear, setSelectedYear] = useState<number>(initialYear);
  const year = availableYears.includes(selectedYear) ? selectedYear : availableYears[0] ?? initialYear;

  const { data, ytdAmount, ytdMiles, ytdExpenses, peakMonth } = useMemo(() => {
    const buckets: MonthlyBucket[] = monthLabels.map((label, idx) => ({
      monthIndex: idx,
      month: label,
      submittedAmount: 0,
      readyAmount: 0,
      expenseAmount: 0,
      totalAmount: 0,
      miles: 0,
      tripCount: 0,
      expenseCount: 0,
    }));

    const yearPrefix = `${year}-`;

    for (const trip of trips) {
      if (!trip.tripDate || !trip.tripDate.startsWith(yearPrefix)) continue;
      if (scope === 'submitted' && trip.status !== 'submitted') continue;

      const monthNum = parseInt(trip.tripDate.slice(5, 7), 10);
      if (!Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) continue;

      const bucket = buckets[monthNum - 1];
      if (trip.status === 'submitted') {
        bucket.submittedAmount = round2(bucket.submittedAmount + trip.reimbursementAmount);
      } else {
        bucket.readyAmount = round2(bucket.readyAmount + trip.reimbursementAmount);
      }
      bucket.miles = round1(bucket.miles + trip.billableMiles);
      bucket.tripCount += 1;
    }

    for (const exp of expenses) {
      if (!exp.expenseDate || !exp.expenseDate.startsWith(yearPrefix)) continue;
      if (scope === 'submitted' && exp.status !== 'submitted') continue;

      const monthNum = parseInt(exp.expenseDate.slice(5, 7), 10);
      if (!Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) continue;

      const bucket = buckets[monthNum - 1];
      bucket.expenseAmount = round2(bucket.expenseAmount + exp.amount);
      bucket.expenseCount += 1;
    }

    let totalAmt = 0;
    let totalMi = 0;
    let totalExp = 0;
    let peak: MonthlyBucket | null = null;

    for (const b of buckets) {
      b.totalAmount = round2(b.submittedAmount + b.readyAmount + b.expenseAmount);
      const amt =
        scope === 'submitted'
          ? round2(b.submittedAmount + b.expenseAmount)
          : b.totalAmount;
      totalAmt = round2(totalAmt + amt);
      totalMi = round1(totalMi + b.miles);
      totalExp = round2(totalExp + b.expenseAmount);
      const peakAmt = peak
        ? scope === 'submitted'
          ? round2(peak.submittedAmount + peak.expenseAmount)
          : peak.totalAmount
        : 0;
      if (amt > 0 && (!peak || amt > peakAmt)) {
        peak = b;
      }
    }

    return {
      data: buckets,
      ytdAmount: totalAmt,
      ytdMiles: totalMi,
      ytdExpenses: totalExp,
      peakMonth: peak,
    };
  }, [trips, expenses, year, scope, monthLabels]);

  const gridStroke = isDark ? '#1e293b' : '#e2e8f0';
  const axisTickColor = isDark ? '#94a3b8' : '#64748b';
  const cursorFill = isDark ? 'rgba(30, 41, 59, 0.55)' : '#f1f5f9';
  const submittedBarFill = isDark ? '#3b82f6' : '#1d4ed8';
  const readyBarFill = '#93c5fd';
  const expenseBarFill = isDark ? '#10b981' : '#059669';

  const hasExpenses = ytdExpenses > 0;

  return (
    <section className="no-print bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t('chart.title', { year })}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            <span>
              {t('chart.ytdTotal')}{' '}
              <strong className="font-semibold text-slate-900 dark:text-slate-100" dir="ltr">
                {formatCurrency(ytdAmount)}
              </strong>
            </span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
              ·
            </span>
            <span dir="ltr">
              {ytdMiles.toFixed(1)} {t('common.mi')}
            </span>
            {peakMonth && (
              <>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                  ·
                </span>
                <span>
                  {t('chart.peak')} {peakMonth.month} (
                  <span dir="ltr">
                    {formatCurrency(
                      scope === 'submitted'
                        ? round2(peakMonth.submittedAmount + peakMonth.expenseAmount)
                        : peakMonth.totalAmount
                    )}
                  </span>
                  )
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
          {availableYears.length > 1 && (
            <select
              aria-label="Year"
              value={year}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            >
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setScope('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                scope === 'all'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {t('chart.allLogged')}
            </button>
            <button
              type="button"
              onClick={() => setScope('submitted')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                scope === 'submitted'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {t('chart.submittedOnly')}
            </button>
          </div>
        </div>
      </div>

      {/* Recharts Bar Chart Container */}
      <div className="relative h-64 w-full" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            barCategoryGap="24%"
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke={gridStroke}
            />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fill: axisTickColor, fontSize: 12 }}
              dy={6}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={56}
              tick={{ fill: axisTickColor, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
              tickFormatter={(val: number) => `$${val}`}
            />
            <Tooltip
              cursor={{ fill: cursorFill }}
              content={<ChartTooltip scope={scope} year={year} />}
            />
            <Bar
              dataKey="submittedAmount"
              name={tStage('submitted')}
              stackId="reimbursement"
              fill={submittedBarFill}
              radius={scope === 'submitted' && !hasExpenses ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              maxBarSize={36}
            />
            {scope === 'all' && (
              <Bar
                dataKey="readyAmount"
                name={t('chart.readyQueue')}
                stackId="reimbursement"
                fill={readyBarFill}
                radius={!hasExpenses ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                maxBarSize={36}
              />
            )}
            {hasExpenses && (
              <Bar
                dataKey="expenseAmount"
                name={t('nav.expShort')}
                stackId="reimbursement"
                fill={expenseBarFill}
                radius={[4, 4, 0, 0]}
                maxBarSize={36}
              />
            )}
          </BarChart>
        </ResponsiveContainer>

        {ytdAmount === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-xs text-slate-500 dark:text-slate-400 bg-white/90 dark:bg-slate-900/90 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700">
              {t('chart.noMileage', { year })}
            </p>
          </div>
        )}
      </div>

      {/* Quiet Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-sm bg-blue-700 dark:bg-blue-500"
              aria-hidden="true"
            />
            {tStage('submitted')}
          </span>
          {scope === 'all' && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-300" aria-hidden="true" />
              {t('ledger.readyToSubmit')}
            </span>
          )}
          {hasExpenses && (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-sm bg-emerald-600 dark:bg-emerald-500"
                aria-hidden="true"
              />
              {t('nav.expShort')}
            </span>
          )}
        </div>
        <span>{t('chart.groupedByDate', { year })}</span>
      </div>
    </section>
  );
}
