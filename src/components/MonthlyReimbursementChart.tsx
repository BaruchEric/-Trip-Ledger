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
import { formatCurrency, round1, round2, type MileageTrip } from '../types/mileage';

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

interface MonthlyBucket {
  monthIndex: number;
  month: string;
  submittedAmount: number;
  readyAmount: number;
  totalAmount: number;
  miles: number;
  tripCount: number;
}

interface MonthlyReimbursementChartProps {
  trips: MileageTrip[];
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
  if (!active || !payload || payload.length === 0) return null;
  const bucket = payload[0]?.payload;
  if (!bucket) return null;

  const shownAmount =
    scope === 'submitted' ? bucket.submittedAmount : bucket.totalAmount;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md px-3.5 py-2.5 text-xs space-y-1.5 min-w-[180px]">
      <div className="font-semibold text-slate-900 dark:text-slate-100">
        {bucket.month} {year}
      </div>
      <div className="space-y-1 font-mono tabular-nums">
        {scope === 'all' ? (
          <>
            <div className="flex items-center justify-between gap-4 text-slate-700 dark:text-slate-300">
              <span className="font-sans text-slate-500 dark:text-slate-400">Submitted</span>
              <span>{formatCurrency(bucket.submittedAmount)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 text-slate-700 dark:text-slate-300">
              <span className="font-sans text-slate-500 dark:text-slate-400">Ready Queue</span>
              <span>{formatCurrency(bucket.readyAmount)}</span>
            </div>
            <div className="pt-1 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4 font-semibold text-slate-900 dark:text-slate-100">
              <span className="font-sans">Total</span>
              <span>{formatCurrency(shownAmount)}</span>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-4 font-semibold text-slate-900 dark:text-slate-100">
            <span className="font-sans text-slate-600 dark:text-slate-400 font-normal">
              Submitted
            </span>
            <span>{formatCurrency(shownAmount)}</span>
          </div>
        )}
      </div>
      <div className="pt-1 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
        {bucket.tripCount} {bucket.tripCount === 1 ? 'trip' : 'trips'} ·{' '}
        {bucket.miles.toFixed(1)} mi
      </div>
    </div>
  );
}

export function MonthlyReimbursementChart({
  trips,
  year = new Date().getFullYear(),
  isDark = false,
}: MonthlyReimbursementChartProps) {
  const [scope, setScope] = useState<'all' | 'submitted'>('all');

  const { data, ytdAmount, ytdMiles, peakMonth } = useMemo(() => {
    const buckets: MonthlyBucket[] = MONTH_LABELS.map((label, idx) => ({
      monthIndex: idx,
      month: label,
      submittedAmount: 0,
      readyAmount: 0,
      totalAmount: 0,
      miles: 0,
      tripCount: 0,
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
      bucket.totalAmount = round2(bucket.submittedAmount + bucket.readyAmount);
      bucket.miles = round1(bucket.miles + trip.billableMiles);
      bucket.tripCount += 1;
    }

    let totalAmt = 0;
    let totalMi = 0;
    let peak: MonthlyBucket | null = null;

    for (const b of buckets) {
      const amt = scope === 'submitted' ? b.submittedAmount : b.totalAmount;
      totalAmt = round2(totalAmt + amt);
      totalMi = round1(totalMi + b.miles);
      if (amt > 0 && (!peak || amt > (scope === 'submitted' ? peak.submittedAmount : peak.totalAmount))) {
        peak = b;
      }
    }

    return {
      data: buckets,
      ytdAmount: totalAmt,
      ytdMiles: totalMi,
      peakMonth: peak,
    };
  }, [trips, year, scope]);

  const gridStroke = isDark ? '#1e293b' : '#e2e8f0';
  const axisTickColor = isDark ? '#94a3b8' : '#64748b';
  const cursorFill = isDark ? 'rgba(30, 41, 59, 0.55)' : '#f1f5f9';
  const submittedBarFill = isDark ? '#3b82f6' : '#1d4ed8';
  const readyBarFill = isDark ? '#93c5fd' : '#93c5fd';

  return (
    <section className="no-print bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Monthly Mileage Reimbursement ({year})
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            <span>
              YTD Total:{' '}
              <strong className="font-semibold text-slate-900 dark:text-slate-100">
                {formatCurrency(ytdAmount)}
              </strong>
            </span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
              ·
            </span>
            <span>{ytdMiles.toFixed(1)} mi</span>
            {peakMonth && (
              <>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                  ·
                </span>
                <span>
                  Peak: {peakMonth.month} (
                  {formatCurrency(
                    scope === 'submitted'
                      ? peakMonth.submittedAmount
                      : peakMonth.totalAmount
                  )}
                  )
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={() => setScope('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              scope === 'all'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            All Logged
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
            Submitted Only
          </button>
        </div>
      </div>

      {/* Recharts Bar Chart Container */}
      <div className="relative h-64 w-full">
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
              name="Submitted"
              stackId="reimbursement"
              fill={submittedBarFill}
              radius={scope === 'submitted' ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              maxBarSize={36}
            />
            {scope === 'all' && (
              <Bar
                dataKey="readyAmount"
                name="Ready Queue"
                stackId="reimbursement"
                fill={readyBarFill}
                radius={[4, 4, 0, 0]}
                maxBarSize={36}
              />
            )}
          </BarChart>
        </ResponsiveContainer>

        {ytdAmount === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-xs text-slate-500 dark:text-slate-400 bg-white/90 dark:bg-slate-900/90 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700">
              No {scope === 'submitted' ? 'submitted ' : ''}mileage logged in {year} yet.
            </p>
          </div>
        )}
      </div>

      {/* Quiet Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-sm bg-blue-700 dark:bg-blue-500"
              aria-hidden="true"
            />
            Submitted
          </span>
          {scope === 'all' && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-300" aria-hidden="true" />
              Ready to Submit
            </span>
          )}
        </div>
        <span>Grouped by trip date ({year})</span>
      </div>
    </section>
  );
}
