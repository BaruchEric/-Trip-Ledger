import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCheck2,
  FileDown,
  FileText,
  Printer,
} from 'lucide-react';
import { buildReportEmailText, downloadReportCsv } from '../lib/exportUtils';
import { useI18n } from '../lib/i18n';
import { downloadReportPdf } from '../lib/pdfReportGenerator';
import {
  formatCurrency,
  round2,
  type MileageReport,
  type MileageTrip,
  type TripExpense,
} from '../types/mileage';
import { MonthlyReimbursementChart } from './MonthlyReimbursementChart';

interface ReportsViewProps {
  reports: MileageReport[];
  trips: MileageTrip[];
  expenses: TripExpense[];
  loading: boolean;
  isAuthenticated: boolean;
  selectedReportId: string | null;
  onSelectReport: (id: string) => void;
  onRequestSignIn: () => void;
  onGenerateReportFromReady: () => Promise<void>;
  onMarkReimbursed: (report: MileageReport) => Promise<void>;
  isDark?: boolean;
}

export function ReportsView({
  reports,
  trips,
  expenses,
  loading,
  isAuthenticated,
  selectedReportId,
  onSelectReport,
  onRequestSignIn,
  onGenerateReportFromReady,
  onMarkReimbursed,
  isDark = false,
}: ReportsViewProps) {
  const { t, tPurpose, tExpenseCategory, tStage, formatLocalizedDate } = useI18n();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pdfSavedId, setPdfSavedId] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [printingReportId, setPrintingReportId] = useState<string | null>(null);
  const printCleanupTimerRef = useRef<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isMarking, setIsMarking] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const readyTrips = useMemo(() => trips.filter((t) => t.status === 'ready'), [trips]);
  const readyExpenses = useMemo(() => expenses.filter((e) => e.status === 'ready'), [expenses]);
  const readyExpensesTotal = useMemo(
    () => round2(readyExpenses.reduce((sum, e) => sum + e.amount, 0)),
    [readyExpenses]
  );

  const sortedReports = useMemo(
    () =>
      [...reports].sort((a, b) => {
        const aSec = a.submittedAt?.seconds ?? 0;
        const bSec = b.submittedAt?.seconds ?? 0;
        return bSec - aSec;
      }),
    [reports]
  );

  const activeReport = useMemo(() => {
    if (selectedReportId) {
      const found = sortedReports.find((r) => r.id === selectedReportId);
      if (found) return found;
    }
    return sortedReports[0] ?? null;
  }, [sortedReports, selectedReportId]);

  const clearPrintMode = useCallback(() => {
    document.documentElement.classList.remove('report-print-mode');
    setPrintingReportId(null);
    if (printCleanupTimerRef.current !== null) {
      window.clearTimeout(printCleanupTimerRef.current);
      printCleanupTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handleAfterPrint = () => clearPrintMode();
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      window.removeEventListener('afterprint', handleAfterPrint);
      clearPrintMode();
    };
  }, [clearPrintMode]);

  const handlePrintReport = useCallback(
    (targetReportId?: string) => {
      const idToPrint = targetReportId ?? activeReport?.id ?? null;
      if (!idToPrint) return;

      if (targetReportId && targetReportId !== activeReport?.id) {
        onSelectReport(targetReportId);
      }

      document.documentElement.classList.add('report-print-mode');
      setPrintingReportId(idToPrint);

      // Allow React to paint the selected report sheet and print CSS class before invoking window.print()
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.print();
          if (printCleanupTimerRef.current !== null) {
            window.clearTimeout(printCleanupTimerRef.current);
          }
          printCleanupTimerRef.current = window.setTimeout(() => {
            clearPrintMode();
          }, 1500);
        });
      });
    },
    [activeReport?.id, onSelectReport, clearPrintMode]
  );

  // Match expenses linked directly to a report OR linked to any trip inside that report
  const expensesByReportId = useMemo(() => {
    const tripIdsByReport = new Map<string, Set<string>>();
    for (const t of trips) {
      if (!t.reportId) continue;
      let set = tripIdsByReport.get(t.reportId);
      if (!set) {
        set = new Set<string>();
        tripIdsByReport.set(t.reportId, set);
      }
      set.add(t.id);
    }

    const result: Record<string, TripExpense[]> = {};
    for (const rep of reports) {
      const repTripIds = tripIdsByReport.get(rep.id);
      result[rep.id] = expenses
        .filter(
          (exp) =>
            exp.reportId === rep.id || (Boolean(exp.tripId) && Boolean(repTripIds?.has(exp.tripId)))
        )
        .sort((a, b) => a.expenseDate.localeCompare(b.expenseDate));
    }
    return result;
  }, [reports, trips, expenses]);

  const activeTrips = useMemo(() => {
    if (!activeReport) return [];
    return trips
      .filter((t) => t.reportId === activeReport.id)
      .sort((a, b) => a.tripDate.localeCompare(b.tripDate));
  }, [trips, activeReport]);

  const activeExpenses = useMemo(() => {
    if (!activeReport) return [];
    return expensesByReportId[activeReport.id] ?? [];
  }, [activeReport, expensesByReportId]);

  const activeExpensesSubtotal = useMemo(
    () => round2(activeExpenses.reduce((sum, e) => sum + e.amount, 0)),
    [activeExpenses]
  );

  const activeTripById = useMemo(() => {
    const map: Record<string, MileageTrip> = {};
    for (const t of activeTrips) map[t.id] = t;
    return map;
  }, [activeTrips]);

  const handleCopyEmail = async (
    report: MileageReport,
    reportTrips: MileageTrip[],
    reportExpenses: TripExpense[]
  ) => {
    try {
      await navigator.clipboard.writeText(
        buildReportEmailText(report, reportTrips, reportExpenses)
      );
      setCopiedId(report.id);
      window.setTimeout(() => setCopiedId(null), 2500);
    } catch {
      setErrorMsg('Clipboard access was blocked by the browser.');
    }
  };

  const generatePrintablePdfSummary = (
    report: MileageReport,
    reportTrips: MileageTrip[],
    reportExpenses: TripExpense[]
  ) => {
    setErrorMsg(null);
    setIsExportingPdf(true);
    try {
      downloadReportPdf(report, reportTrips, reportExpenses);
      setPdfSavedId(report.id);
      window.setTimeout(() => setPdfSavedId(null), 2500);
    } catch (err) {
      console.error('PDF generation failed:', err);
      setErrorMsg('Unable to generate PDF document. Please try again or use Print.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleGenerateNow = async () => {
    setIsGenerating(true);
    setErrorMsg(null);
    try {
      await onGenerateReportFromReady();
    } catch {
      setErrorMsg('Could not generate report. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReimbursed = async (report: MileageReport) => {
    setIsMarking(true);
    setErrorMsg(null);
    try {
      await onMarkReimbursed(report);
    } catch {
      setErrorMsg('Unable to update report status.');
    } finally {
      setIsMarking(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center max-w-lg mx-auto my-8 space-y-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {t('reports.signInTitle')}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {t('reports.signInDesc')}
        </p>
        <button
          type="button"
          onClick={onRequestSignIn}
          className="px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap"
        >
          {t('auth.signInGoogle')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Current-Year Monthly Mileage Reimbursement Comparison Chart (hidden when printing a report) */}
      <div className="no-print">
        <MonthlyReimbursementChart trips={trips} expenses={expenses} isDark={isDark} />
      </div>

      {/* Unsubmitted Ready Queue Banner (hidden when printing) */}
      {readyTrips.length > 0 && (
        <div className="no-print bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t('reports.readyBannerTitle', {
                count: readyTrips.length,
                unit: readyTrips.length === 1 ? t('nav.tripSingular') : t('nav.tripPlural'),
              })}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums mt-0.5">
              <span dir="ltr">
                {readyTrips.reduce((s, trip) => s + trip.billableMiles, 0).toFixed(1)}{' '}
                {t('common.mi')}
              </span>{' '}
              ·{' '}
              <span dir="ltr">
                {formatCurrency(
                  readyTrips.reduce((s, trip) => s + trip.reimbursementAmount, 0) +
                    readyExpensesTotal
                )}
              </span>
              {readyExpenses.length > 0
                ? ` (+${formatCurrency(readyExpensesTotal)} ${t('nav.expShort')})`
                : ''}
            </p>
          </div>
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => void handleGenerateNow()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <FileCheck2 className="w-4 h-4" />
            {isGenerating ? t('reports.generating') : t('reports.generateNow')}
          </button>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="no-print px-4 py-2.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/70 rounded-lg text-xs text-red-900 dark:text-red-200"
        >
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="no-print grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-4 h-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl animate-pulse" />
          <div className="lg:col-span-8 h-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl animate-pulse" />
        </div>
      ) : sortedReports.length === 0 ? (
        <div className="no-print bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center space-y-3">
          <FileText className="w-8 h-8 text-slate-400 dark:text-slate-500 mx-auto" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {t('reports.emptyTitle')}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            {t('reports.emptyDesc')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Archive List (hidden when printing) */}
          <div className="no-print lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t('reports.submittedReports')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('reports.archivedCount', {
                  count: sortedReports.length,
                  unit:
                    sortedReports.length === 1
                      ? t('reports.reportSingular')
                      : t('reports.reportPlural'),
                })}
              </p>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[640px] overflow-y-auto">
              {sortedReports.map((rep) => {
                const isSelected = activeReport?.id === rep.id;
                const repTrips = trips
                  .filter((t) => t.reportId === rep.id)
                  .sort((a, b) => a.tripDate.localeCompare(b.tripDate));
                const repExps = expensesByReportId[rep.id] ?? [];
                const repExpTotal = round2(repExps.reduce((sum, e) => sum + e.amount, 0));
                const repGrandTotal = round2(rep.totalReimbursement + repExpTotal);
                return (
                  <div
                    key={rep.id}
                    className={`flex items-stretch transition-colors ${
                      isSelected
                        ? 'bg-blue-50/70 dark:bg-blue-950/50'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectReport(rep.id)}
                      className="flex-1 min-w-0 text-start px-4 py-3.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold font-mono text-slate-900 dark:text-slate-100 truncate">
                          {rep.reportNumber}
                        </span>
                        <span
                          className={`text-xs font-medium shrink-0 ${
                            rep.status === 'reimbursed'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-blue-700 dark:text-blue-400'
                          }`}
                        >
                          {rep.status === 'reimbursed'
                            ? tStage('reimbursed')
                            : tStage('submitted')}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                        {formatLocalizedDate(rep.periodStart)} – {formatLocalizedDate(rep.periodEnd)}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        <span>
                          {rep.tripCount}{' '}
                          {rep.tripCount === 1 ? t('nav.tripSingular') : t('nav.tripPlural')} ·{' '}
                          <span dir="ltr">
                            {rep.totalMiles.toFixed(1)} {t('common.mi')}
                          </span>
                          {repExpTotal > 0
                            ? ` · +${formatCurrency(repExpTotal)} ${t('nav.expShort')}`
                            : ''}
                        </span>
                        <span
                          className="font-semibold text-slate-900 dark:text-slate-100"
                          dir="ltr"
                        >
                          {formatCurrency(repGrandTotal)}
                        </span>
                      </div>
                    </button>
                    <div className="flex items-center gap-0.5 pe-2.5">
                      <button
                        type="button"
                        onClick={() => handlePrintReport(rep.id)}
                        title={t('reports.print')}
                        aria-label={`${t('reports.print')} ${rep.reportNumber}`}
                        className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white dark:hover:bg-slate-800 rounded-lg transition-colors"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={isExportingPdf}
                        onClick={() => generatePrintablePdfSummary(rep, repTrips, repExps)}
                        title={t('reports.downloadPdf')}
                        aria-label={`${t('reports.downloadPdf')} ${rep.reportNumber}`}
                        className="p-2 text-slate-500 dark:text-slate-400 hover:text-blue-700 dark:hover:text-blue-400 hover:bg-white dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {pdfSavedId === rep.id ? (
                          <Check className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                        ) : (
                          <FileDown className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Official Expense Report Sheet */}
          {activeReport && (
            <div className="lg:col-span-8 space-y-3">
              {/* Action Toolbar (hidden when printing) */}
              <div className="no-print bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-2.5">
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  {t('reports.reportLabel')}{' '}
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {activeReport.reportNumber}
                  </span>
                  {' · '}
                  <span
                    className={
                      activeReport.status === 'reimbursed'
                        ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                        : 'text-blue-700 dark:text-blue-400 font-medium'
                    }
                  >
                    {activeReport.status === 'reimbursed'
                      ? tStage('reimbursed')
                      : tStage('submitted')}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isExportingPdf}
                    onClick={() =>
                      generatePrintablePdfSummary(activeReport, activeTrips, activeExpenses)
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
                  >
                    {pdfSavedId === activeReport.id ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        {t('reports.pdfDownloaded')}
                      </>
                    ) : (
                      <>
                        <FileDown className="w-3.5 h-3.5" />
                        {t('reports.downloadPdf')}
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePrintReport(activeReport.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    {t('reports.print')}
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadReportCsv(activeReport, activeTrips, activeExpenses)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {t('reports.downloadCsv')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopyEmail(activeReport, activeTrips, activeExpenses)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap"
                  >
                    {copiedId === activeReport.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                        {t('reports.copiedEmail')}
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        {t('reports.copyEmail')}
                      </>
                    )}
                  </button>
                  {activeReport.status === 'submitted' && (
                    <button
                      type="button"
                      disabled={isMarking}
                      onClick={() => void handleReimbursed(activeReport)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800/70 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {isMarking ? t('reports.updating') : t('reports.markReimbursed')}
                    </button>
                  )}
                </div>
              </div>

              {/* Official Printable Expense Sheet */}
              <article
                className={`print-sheet bg-white dark:bg-slate-900 print:bg-white border border-slate-200 dark:border-slate-800 print:border-none rounded-xl p-6 sm:p-8 space-y-6 ${
                  printingReportId === activeReport.id ? 'report-print-active' : ''
                }`}
              >
                {/* Report Header */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800 print:border-slate-200">
                  <div>
                    <div className="text-xs font-semibold text-blue-800 dark:text-blue-400 print:text-blue-800 tracking-wide">
                      {activeReport.department
                        ? activeReport.department.toUpperCase()
                        : t('reports.regionBanner')}
                    </div>
                    <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 print:text-slate-900 mt-1">
                      {t('reports.sheetTitle')}
                    </h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400 print:text-slate-500 mt-1">
                      {t('reports.sheetLaw')}
                    </p>
                  </div>
                  <div className="sm:text-end font-mono tabular-nums">
                    <div className="text-xs text-slate-500 dark:text-slate-400 print:text-slate-500">
                      {t('reports.reportRef')}
                    </div>
                    <div className="text-base font-bold text-slate-900 dark:text-slate-100 print:text-slate-900">
                      {activeReport.reportNumber}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400 print:text-slate-600 mt-0.5">
                      {formatLocalizedDate(activeReport.periodStart)} –{' '}
                      {formatLocalizedDate(activeReport.periodEnd)}
                    </div>
                  </div>
                </div>

                {/* Employee Metadata Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pb-5 border-b border-slate-200 dark:border-slate-800 print:border-slate-200 text-xs">
                  <div>
                    <div className="text-slate-500 dark:text-slate-400 print:text-slate-500">
                      {t('reports.empName')}
                    </div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100 print:text-slate-900 mt-0.5">
                      {activeReport.employeeName || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400 print:text-slate-500">
                      {t('reports.empId')}
                    </div>
                    <div className="font-semibold font-mono text-slate-900 dark:text-slate-100 print:text-slate-900 mt-0.5">
                      {activeReport.employeeId || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400 print:text-slate-500">
                      {t('reports.department')}
                    </div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100 print:text-slate-900 mt-0.5">
                      {activeReport.department || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400 print:text-slate-500">
                      {t('reports.homeStore')}
                    </div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100 print:text-slate-900 mt-0.5">
                      {activeReport.homeStoreName || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400 print:text-slate-500">
                      {t('reports.vehicle')}
                    </div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100 print:text-slate-900 mt-0.5">
                      {activeReport.vehicleInfo || 'Personal Vehicle'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400 print:text-slate-500">
                      {t('reports.status')}
                    </div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100 print:text-slate-900 mt-0.5">
                      {activeReport.status === 'reimbursed'
                        ? tStage('reimbursed')
                        : tStage('submitted')}
                    </div>
                  </div>
                </div>

                {/* Itemized Trip Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-start border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-300 dark:border-slate-700 print:border-slate-300 text-slate-600 dark:text-slate-400 print:text-slate-600 font-semibold">
                        <th className="py-2 pe-3 whitespace-nowrap">{t('ledger.colDate')}</th>
                        <th className="py-2 px-2">{t('reports.colOriginDest')}</th>
                        <th className="py-2 px-2 whitespace-nowrap">{t('ledger.colPurpose')}</th>
                        <th className="py-2 px-2 text-end whitespace-nowrap">
                          {t('ledger.colMiles')}
                        </th>
                        <th className="py-2 px-2 text-end whitespace-nowrap">
                          {t('reports.colRate')}
                        </th>
                        <th className="py-2 ps-2 text-end whitespace-nowrap">
                          {t('ledger.colAmount')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800 print:divide-slate-200">
                      {activeTrips.map((trip) => (
                        <tr key={trip.id}>
                          <td className="py-2.5 pe-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 print:text-slate-700 whitespace-nowrap align-top">
                            {trip.tripDate}
                          </td>
                          <td className="py-2.5 px-2 align-top">
                            <div className="font-medium text-slate-900 dark:text-slate-100 print:text-slate-900">
                              {trip.originName} → {trip.destinationName}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 print:text-slate-500 mt-0.5">
                              {trip.isRoundTrip ? t('common.roundTrip') : t('common.oneWay')}
                              {trip.commuteDeductionMiles > 0
                                ? ` · −${trip.commuteDeductionMiles.toFixed(1)} ${t('common.mi')}`
                                : ''}
                              {trip.notes ? ` · ${trip.notes}` : ''}
                            </div>
                          </td>
                          <td className="py-2.5 px-2 text-slate-700 dark:text-slate-300 print:text-slate-700 whitespace-nowrap align-top">
                            {tPurpose(trip.purpose)}
                          </td>
                          <td
                            className="py-2.5 px-2 text-end font-mono tabular-nums text-slate-900 dark:text-slate-100 print:text-slate-900 whitespace-nowrap align-top"
                            dir="ltr"
                          >
                            {trip.billableMiles.toFixed(1)}
                          </td>
                          <td
                            className="py-2.5 px-2 text-end font-mono tabular-nums text-slate-600 dark:text-slate-400 print:text-slate-600 whitespace-nowrap align-top"
                            dir="ltr"
                          >
                            ${trip.ratePerMile.toFixed(2)}
                          </td>
                          <td
                            className="py-2.5 ps-2 text-end font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 print:text-slate-900 whitespace-nowrap align-top"
                            dir="ltr"
                          >
                            {formatCurrency(trip.reimbursementAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-900 dark:border-slate-300 print:border-slate-900 font-semibold text-slate-900 dark:text-slate-100 print:text-slate-900">
                        <td colSpan={3} className="py-3 pe-3">
                          {activeExpenses.length > 0
                            ? t('reports.mileageSubtotal')
                            : t('reports.total')}{' '}
                          ({activeReport.tripCount}{' '}
                          {activeReport.tripCount === 1
                            ? t('nav.tripSingular')
                            : t('nav.tripPlural')}
                          )
                        </td>
                        <td
                          className="py-3 px-2 text-end font-mono tabular-nums whitespace-nowrap"
                          dir="ltr"
                        >
                          {activeReport.totalMiles.toFixed(1)} {t('common.mi')}
                        </td>
                        <td className="py-3 px-2" />
                        <td
                          className="py-3 ps-2 text-end font-mono tabular-nums text-sm whitespace-nowrap"
                          dir="ltr"
                        >
                          {formatCurrency(activeReport.totalReimbursement)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Itemized Non-Mileage Business Expenses (Parking, Tolls, etc.) */}
                {activeExpenses.length > 0 && (
                  <div className="space-y-3 pt-2">
                    <h2 className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300 print:text-slate-700">
                      {t('reports.nonMileageHeader')}
                    </h2>
                    <div className="overflow-x-auto">
                      <table className="w-full text-start border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-300 dark:border-slate-700 print:border-slate-300 text-slate-600 dark:text-slate-400 print:text-slate-600 font-semibold">
                            <th className="py-2 pe-3 whitespace-nowrap">{t('ledger.colDate')}</th>
                            <th className="py-2 px-2 whitespace-nowrap">
                              {t('reports.colCategory')}
                            </th>
                            <th className="py-2 px-2">{t('reports.colDescTrip')}</th>
                            <th className="py-2 ps-2 text-end whitespace-nowrap">
                              {t('ledger.colAmount')}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800 print:divide-slate-200">
                          {activeExpenses.map((exp) => {
                            const linked = exp.tripId ? activeTripById[exp.tripId] : undefined;
                            return (
                              <tr key={exp.id}>
                                <td className="py-2 pe-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 print:text-slate-700 whitespace-nowrap align-top">
                                  {exp.expenseDate}
                                </td>
                                <td className="py-2 px-2 font-medium text-slate-800 dark:text-slate-200 print:text-slate-800 whitespace-nowrap align-top">
                                  {tExpenseCategory(exp.category)}
                                </td>
                                <td className="py-2 px-2 align-top">
                                  <div className="font-medium text-slate-900 dark:text-slate-100 print:text-slate-900">
                                    {exp.description}
                                  </div>
                                  {(linked || exp.notes) && (
                                    <div className="text-[11px] text-slate-500 dark:text-slate-400 print:text-slate-500 mt-0.5">
                                      {linked
                                        ? `${t('logger.tripPrefix')} ${linked.originName} → ${linked.destinationName}`
                                        : ''}
                                      {linked && exp.notes ? ' · ' : ''}
                                      {exp.notes}
                                    </div>
                                  )}
                                </td>
                                <td
                                  className="py-2 ps-2 text-end font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 print:text-slate-900 whitespace-nowrap align-top"
                                  dir="ltr"
                                >
                                  {formatCurrency(exp.amount)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-slate-400 dark:border-slate-600 print:border-slate-400 font-semibold text-slate-900 dark:text-slate-100 print:text-slate-900">
                            <td colSpan={3} className="py-2.5 pe-3">
                              {t('reports.expensesSubtotal')} ({activeExpenses.length})
                            </td>
                            <td
                              className="py-2.5 ps-2 text-end font-mono tabular-nums whitespace-nowrap"
                              dir="ltr"
                            >
                              {formatCurrency(activeExpensesSubtotal)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Combined Grand Total Bar */}
                    <div className="px-4 py-3 bg-blue-50/80 dark:bg-blue-950/50 print:bg-blue-50 border border-blue-200 dark:border-blue-800/80 print:border-blue-200 rounded-lg flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 print:text-slate-900">
                        {t('reports.grandTotal')} (
                        <span dir="ltr">
                          {formatCurrency(activeReport.totalReimbursement)} +{' '}
                          {formatCurrency(activeExpensesSubtotal)}
                        </span>
                        )
                      </span>
                      <span
                        className="text-base font-bold font-mono tabular-nums text-blue-800 dark:text-blue-300 print:text-blue-800"
                        dir="ltr"
                      >
                        {formatCurrency(
                          round2(activeReport.totalReimbursement + activeExpensesSubtotal)
                        )}
                      </span>
                    </div>
                  </div>
                )}

                {/* Employee Certification & Manager Approval Signature Lines */}
                <div className="print-keep-together pt-6 border-t border-slate-200 dark:border-slate-800 print:border-slate-200 space-y-6">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 print:text-slate-500 leading-relaxed">
                    {t('reports.certText')}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-2 text-xs">
                    <div>
                      <div className="border-b border-slate-400 dark:border-slate-600 print:border-slate-400 h-7" />
                      <div className="mt-1.5 flex items-center justify-between text-slate-600 dark:text-slate-400 print:text-slate-600">
                        <span>{t('reports.empSignature')}</span>
                        <span>{t('ledger.colDate')}</span>
                      </div>
                    </div>
                    <div>
                      <div className="border-b border-slate-400 dark:border-slate-600 print:border-slate-400 h-7" />
                      <div className="mt-1.5 flex items-center justify-between text-slate-600 dark:text-slate-400 print:text-slate-600">
                        <span>{t('reports.mgrApproval')}</span>
                        <span>{t('ledger.colDate')}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
