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
    ['Company', 'Curacao (Los Angeles Retail)'],
    ['Report Number', report.reportNumber],
    ['Employee Name', report.employeeName || 'Not specified'],
    ['Employee ID', report.employeeId || 'Not specified'],
    ['Department', report.department || 'Retail Operations'],
    ['Home Store', report.homeStoreName || 'Not specified'],
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

  const blob = new Blob([csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Curacao_Mileage_${report.reportNumber}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadTripsCsv(trips: MileageTrip[]) {
  if (trips.length === 0) return;

  const sorted = [...trips].sort((a, b) => a.tripDate.localeCompare(b.tripDate));
  const totalMiles = sorted.reduce((sum, t) => sum + t.billableMiles, 0);
  const totalAmount = sorted.reduce((sum, t) => sum + t.reimbursementAmount, 0);
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
    'Reimbursement ($)',
    'Status',
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
    t.status === 'submitted' ? 'Submitted' : 'Ready',
    t.captureMethod,
    t.notes,
  ]);

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
    totalAmount.toFixed(2),
    '',
    '',
    '',
  ];

  const csvLines = [
    columns.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
    totalsRow.map(escapeCsvCell).join(','),
  ];

  const blob = new Blob([csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Curacao_Selected_Trips_${today}.csv`;
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
    `Subject: Mileage Reimbursement Report ${report.reportNumber} — ${report.employeeName || 'Curacao Employee'}`,
    '',
    `Hello,`,
    '',
    `Please find my business mileage & travel expense reimbursement summary for ${formatDisplayDate(report.periodStart)} – ${formatDisplayDate(report.periodEnd)}.`,
    '',
    `Employee: ${report.employeeName || '—'}${report.employeeId ? ` (ID: ${report.employeeId})` : ''}`,
    `Department: ${report.department || 'Retail Operations'}`,
    `Home Store: ${report.homeStoreName || '—'}`,
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
    `${report.employeeName || 'Curacao Employee'}`,
  ];

  return lines.join('\n');
}
