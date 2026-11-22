import {
  formatCurrency,
  formatDisplayDate,
  round2,
  type MileageReport,
  type MileageTrip,
  type TripExpense,
} from '../types/mileage';

function escapeCsvCell(value: string | number | boolean): string {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function downloadReportCsv(
  report: MileageReport,
  trips: MileageTrip[],
  expenses: TripExpense[] = []
) {
  const sorted = [...trips].sort((a, b) => a.tripDate.localeCompare(b.tripDate));
  const sortedExpenses = [...expenses].sort((a, b) =>
    a.expenseDate.localeCompare(b.expenseDate)
  );
  const expensesSubtotal = round2(sortedExpenses.reduce((sum, e) => sum + e.amount, 0));
  const grandTotal = round2(report.totalReimbursement + expensesSubtotal);

  const headerMeta = [
    ['Application', 'MileTrack'],
    ['Report Number', report.reportNumber],
    ['Driver / Employee', report.employeeName || 'Not specified'],
    ['Employee ID', report.employeeId || 'Not specified'],
    ['Department / Team', report.department || 'Not specified'],
    ['Primary Location', report.homeStoreName || 'Not specified'],
    ['Vehicle', report.vehicleInfo || 'Personal Vehicle'],
    ['Pay Period', `${report.periodStart} to ${report.periodEnd}`],
    ['Total Miles', report.totalMiles.toFixed(1)],
    ['Mileage Subtotal', report.totalReimbursement.toFixed(2)],
    ['Non-Mileage Expenses', expensesSubtotal.toFixed(2)],
    ['Total Reimbursement', grandTotal.toFixed(2)],
    [],
  ];

  const columns = [
    'Date',
    'Origin',
    'Origin Address',
    'Destination',
    'Destination Address',
    'Purpose',
    'Trip Type',
    'One-Way Miles',
    'Commute Deduction (mi)',
    'Billable Miles',
    'Rate ($/mi)',
    'Reimbursement ($)',
    'Capture Method',
    'Notes',
  ];

  const rows = sorted.map((t) => [
    t.tripDate,
    t.originName,
    t.originAddress,
    t.destinationName,
    t.destinationAddress,
    t.purpose,
    t.isRoundTrip ? 'Round Trip' : 'One-Way',
    t.oneWayMiles.toFixed(1),
    t.commuteDeductionMiles.toFixed(1),
    t.billableMiles.toFixed(1),
    t.ratePerMile.toFixed(3),
    t.reimbursementAmount.toFixed(2),
    t.captureMethod,
    t.notes,
  ]);

  const expenseSection: string[] = [];
  if (sortedExpenses.length > 0) {
    expenseSection.push(
      '',
      ['Non-Mileage Business Expenses'].map(escapeCsvCell).join(','),
      ['Date', 'Category', 'Description', 'Amount ($)', 'Notes'].map(escapeCsvCell).join(','),
      ...sortedExpenses.map((e) =>
        [e.expenseDate, e.category, e.description, e.amount.toFixed(2), e.notes]
          .map(escapeCsvCell)
          .join(',')
      )
    );
  }

  const csvLines = [
    ...headerMeta.map((row) => row.map(escapeCsvCell).join(',')),
    columns.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
    ...expenseSection,
  ];

  const blob = new Blob(['\uFEFF' + csvLines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `MileTrack_Report_${report.reportNumber}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface DownloadTripsCsvOptions {
  filenamePrefix?: string;
  reportById?: Record<string, MileageReport>;
  expensesByTripId?: Record<string, TripExpense[]>;
}

export function downloadTripsCsv(
  trips: MileageTrip[],
  options: DownloadTripsCsvOptions = {}
) {
  if (trips.length === 0) return;

  const {
    filenamePrefix = 'MileTrack_Trips',
    reportById = {},
    expensesByTripId = {},
  } = options;

  const sorted = [...trips].sort((a, b) => a.tripDate.localeCompare(b.tripDate));
  const totalMiles = sorted.reduce((sum, t) => sum + t.billableMiles, 0);
  const totalMileageAmount = round2(
    sorted.reduce((sum, t) => sum + t.reimbursementAmount, 0)
  );
  let totalLinkedExpenses = 0;
  const today = new Date().toISOString().slice(0, 10);

  const columns = [
    'Date',
    'Origin',
    'Origin Address',
    'Destination',
    'Destination Address',
    'Purpose',
    'Trip Type',
    'One-Way Miles',
    'Commute Deduction (mi)',
    'Billable Miles',
    'Rate ($/mi)',
    'Mileage Reimbursement ($)',
    'Linked Expenses ($)',
    'Total ($)',
    'Status',
    'Report Number',
    'Capture Method',
    'Notes',
  ];

  const rows = sorted.map((t) => {
    const linkedExps = expensesByTripId[t.id] ?? [];
    const expSum = round2(linkedExps.reduce((s, e) => s + e.amount, 0));
    totalLinkedExpenses = round2(totalLinkedExpenses + expSum);
    const rowTotal = round2(t.reimbursementAmount + expSum);
    const linkedReport = t.reportId ? reportById[t.reportId] : undefined;
    const statusLabel =
      linkedReport?.status === 'reimbursed'
        ? 'Reimbursed'
        : t.status === 'submitted'
          ? 'Submitted'
          : 'Ready';

    return [
      t.tripDate,
      t.originName,
      t.originAddress,
      t.destinationName,
      t.destinationAddress,
      t.purpose,
      t.isRoundTrip ? 'Round Trip' : 'One-Way',
      t.oneWayMiles.toFixed(1),
      t.commuteDeductionMiles.toFixed(1),
      t.billableMiles.toFixed(1),
      t.ratePerMile.toFixed(3),
      t.reimbursementAmount.toFixed(2),
      expSum.toFixed(2),
      rowTotal.toFixed(2),
      statusLabel,
      linkedReport?.reportNumber ?? '',
      t.captureMethod,
      t.notes,
    ];
  });

  const grandTotal = round2(totalMileageAmount + totalLinkedExpenses);

  const totalsRow = [
    'TOTAL',
    `${sorted.length} ${sorted.length === 1 ? 'trip' : 'trips'}`,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    totalMiles.toFixed(1),
    '',
    totalMileageAmount.toFixed(2),
    totalLinkedExpenses.toFixed(2),
    grandTotal.toFixed(2),
    '',
    '',
    '',
    '',
  ];

  const csvLines = [
    columns.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
    totalsRow.map(escapeCsvCell).join(','),
  ];

  const blob = new Blob(['\uFEFF' + csvLines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filenamePrefix}_${today}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function buildReportEmailText(
  report: MileageReport,
  trips: MileageTrip[],
  expenses: TripExpense[] = []
): string {
  const sorted = [...trips].sort((a, b) => a.tripDate.localeCompare(b.tripDate));
  const sortedExpenses = [...expenses].sort((a, b) =>
    a.expenseDate.localeCompare(b.expenseDate)
  );
  const expensesSubtotal = round2(sortedExpenses.reduce((sum, e) => sum + e.amount, 0));
  const grandTotal = round2(report.totalReimbursement + expensesSubtotal);

  const lines = [
    `Subject: Mileage Reimbursement Report ${report.reportNumber} — ${report.employeeName || 'Driver'}`,
    '',
    `Hello,`,
    '',
    `Please find my business mileage & travel expense reimbursement summary for ${formatDisplayDate(report.periodStart)} – ${formatDisplayDate(report.periodEnd)}.`,
    '',
    `Driver / Employee: ${report.employeeName || '—'}${report.employeeId ? ` (ID: ${report.employeeId})` : ''}`,
    `Department / Team: ${report.department || '—'}`,
    `Primary Location: ${report.homeStoreName || '—'}`,
    `Vehicle: ${report.vehicleInfo || 'Personal Vehicle'}`,
    `Report Ref: ${report.reportNumber}`,
    '',
    `Trip Summary (${sorted.length} ${sorted.length === 1 ? 'trip' : 'trips'}):`,
    ...sorted.map(
      (t) =>
        `- ${t.tripDate}: ${t.originName} -> ${t.destinationName} (${t.purpose}, ${
          t.isRoundTrip ? 'Round Trip' : 'One-Way'
        }) | ${t.billableMiles.toFixed(1)} mi @ $${t.ratePerMile.toFixed(2)}/mi = ${formatCurrency(
          t.reimbursementAmount
        )}`
    ),
    ...(sortedExpenses.length > 0
      ? [
          '',
          `Non-Mileage Business Expenses (${sortedExpenses.length} ${
            sortedExpenses.length === 1 ? 'item' : 'items'
          }):`,
          ...sortedExpenses.map(
            (e) => `- ${e.expenseDate}: [${e.category}] ${e.description} = ${formatCurrency(e.amount)}`
          ),
        ]
      : []),
    '',
    `Total Reimbursable Miles: ${report.totalMiles.toFixed(1)} mi (${formatCurrency(
      report.totalReimbursement
    )})`,
    ...(expensesSubtotal > 0
      ? [`Non-Mileage Expenses (Parking/Tolls/Other): ${formatCurrency(expensesSubtotal)}`]
      : []),
    `Total Reimbursement Requested: ${formatCurrency(grandTotal)}`,
    '',
    `Thank you,`,
    `${report.employeeName || 'Driver'}`,
  ];

  return lines.join('\n');
}
