import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  formatCurrency,
  formatDisplayDate,
  round2,
  type MileageReport,
  type MileageTrip,
  type TripExpense,
} from '../types/mileage';

const BRAND_BLUE: [number, number, number] = [29, 78, 216]; // #1d4ed8
const BRAND_NAVY: [number, number, number] = [15, 23, 42]; // #0f172a
const SLATE_600: [number, number, number] = [71, 85, 105];
const SLATE_400: [number, number, number] = [148, 163, 184];
const BORDER_LIGHT: [number, number, number] = [226, 232, 240];
const SURFACE_TINT: [number, number, number] = [248, 250, 252];

export function downloadReportPdf(
  report: MileageReport,
  trips: MileageTrip[],
  expenses: TripExpense[] = []
): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 42;
  const contentWidth = pageWidth - marginX * 2;
  const sortedTrips = [...trips].sort((a, b) => a.tripDate.localeCompare(b.tripDate));
  const sortedExpenses = [...expenses].sort((a, b) =>
    a.expenseDate.localeCompare(b.expenseDate)
  );
  const expensesSubtotal = round2(sortedExpenses.reduce((sum, e) => sum + e.amount, 0));
  const grandTotal = round2(report.totalReimbursement + expensesSubtotal);
  const tripById = new Map(sortedTrips.map((t) => [t.id, t]));

  // Top Brand Accent Bar
  doc.setFillColor(...BRAND_BLUE);
  doc.rect(0, 0, pageWidth, 8, 'F');

  // Header Block
  let cursorY = 36;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND_BLUE);
  doc.text('MILETRACK  ·  BUSINESS MILEAGE & EXPENSE REPORT', marginX, cursorY);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(...BRAND_NAVY);
  doc.text('Business Mileage Reimbursement Report', marginX, cursorY + 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE_600);
  doc.text(
    'Itemized Business Travel & Expense Reimbursement Log',
    marginX,
    cursorY + 32
  );

  // Right-Aligned Report Reference Block
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE_600);
  doc.text('REPORT REFERENCE', pageWidth - marginX, cursorY, { align: 'right' });

  doc.setFont('courier', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...BRAND_NAVY);
  doc.text(report.reportNumber, pageWidth - marginX, cursorY + 16, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE_600);
  doc.text(
    `${formatDisplayDate(report.periodStart)} – ${formatDisplayDate(report.periodEnd)}`,
    pageWidth - marginX,
    cursorY + 30,
    { align: 'right' }
  );

  cursorY += 44;
  doc.setDrawColor(...BORDER_LIGHT);
  doc.setLineWidth(1);
  doc.line(marginX, cursorY, pageWidth - marginX, cursorY);

  // Employee Details & Summary Totals Card
  cursorY += 14;
  const metaBoxHeight = 84;
  doc.setFillColor(...SURFACE_TINT);
  doc.setDrawColor(...BORDER_LIGHT);
  doc.roundedRect(marginX, cursorY, contentWidth, metaBoxHeight, 4, 4, 'FD');

  const col1X = marginX + 14;
  const col2X = marginX + 190;
  const col3X = marginX + 360;
  const row1Y = cursorY + 18;
  const row2Y = cursorY + 52;

  const drawField = (label: string, value: string, x: number, y: number, mono = false) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE_600);
    doc.text(label, x, y);

    doc.setFont(mono ? 'courier' : 'helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...BRAND_NAVY);
    doc.text(value, x, y + 13, { maxWidth: 162 });
  };

  drawField('Driver / Employee', report.employeeName || 'Not specified', col1X, row1Y);
  drawField('Employee ID', report.employeeId || '—', col2X, row1Y, true);
  drawField('Department / Team', report.department || '—', col3X, row1Y);

  drawField('Primary Location', report.homeStoreName || 'Not specified', col1X, row2Y);
  drawField('Personal Vehicle', report.vehicleInfo || 'Personal Vehicle', col2X, row2Y);
  drawField(
    'Report Status',
    report.status === 'reimbursed' ? 'Reimbursed' : 'Submitted for Approval',
    col3X,
    row2Y
  );

  // Executive KPI Strip
  cursorY += metaBoxHeight + 12;
  const kpiHeight = 46;
  const kpiGap = 10;

  const kpis =
    expensesSubtotal > 0
      ? [
          {
            label: 'Total Billable Miles',
            value: `${report.totalMiles.toFixed(1)} mi`,
            accent: false,
          },
          {
            label: `Mileage (${report.tripCount} ${report.tripCount === 1 ? 'Trip' : 'Trips'})`,
            value: formatCurrency(report.totalReimbursement),
            accent: false,
          },
          {
            label: `Non-Mileage (${sortedExpenses.length})`,
            value: formatCurrency(expensesSubtotal),
            accent: false,
          },
          {
            label: 'Total Reimbursement Due',
            value: formatCurrency(grandTotal),
            accent: true,
          },
        ]
      : [
          {
            label: 'Logged Business Trips',
            value: `${report.tripCount} ${report.tripCount === 1 ? 'Trip' : 'Trips'}`,
            accent: false,
          },
          {
            label: 'Total Billable Miles',
            value: `${report.totalMiles.toFixed(1)} mi`,
            accent: false,
          },
          {
            label: 'Total Reimbursement Due',
            value: formatCurrency(grandTotal),
            accent: true,
          },
        ];

  const kpiWidth = (contentWidth - kpiGap * (kpis.length - 1)) / kpis.length;

  kpis.forEach((kpi, idx) => {
    const x = marginX + idx * (kpiWidth + kpiGap);
    doc.setFillColor(kpi.accent ? 239 : 255, kpi.accent ? 246 : 255, kpi.accent ? 255 : 255);
    doc.setDrawColor(...(kpi.accent ? ([191, 219, 254] as [number, number, number]) : BORDER_LIGHT));
    doc.roundedRect(x, cursorY, kpiWidth, kpiHeight, 4, 4, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE_600);
    doc.text(kpi.label, x + 10, cursorY + 16);

    doc.setFont('courier', 'bold');
    doc.setFontSize(kpis.length === 4 ? 11.5 : 13);
    doc.setTextColor(...(kpi.accent ? BRAND_BLUE : BRAND_NAVY));
    doc.text(kpi.value, x + 10, cursorY + 34);
  });

  // Itemized Mileage Table
  cursorY += kpiHeight + 16;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...BRAND_NAVY);
  doc.text('Itemized Business Trip Log', marginX, cursorY);

  const tableRows = sortedTrips.map((t) => {
    const detailParts = [t.isRoundTrip ? 'Round Trip' : 'One-Way'];
    if (t.commuteDeductionMiles > 0) {
      detailParts.push(`Less ${t.commuteDeductionMiles.toFixed(1)} mi commute`);
    }
    if (t.notes.trim()) {
      detailParts.push(t.notes.trim());
    }
    const routeText = `${t.originName} -> ${t.destinationName}\n${detailParts.join(' · ')}`;

    return [
      t.tripDate,
      routeText,
      t.purpose,
      t.billableMiles.toFixed(1),
      `$${t.ratePerMile.toFixed(2)}`,
      formatCurrency(t.reimbursementAmount),
    ];
  });

  autoTable(doc, {
    startY: cursorY + 8,
    margin: { left: marginX, right: marginX, bottom: 52 },
    head: [['Date', 'Origin -> Destination & Details', 'Purpose', 'Miles', 'Rate', 'Amount']],
    body: tableRows,
    foot: [
      [
        `Total (${report.tripCount} ${report.tripCount === 1 ? 'trip' : 'trips'})`,
        '',
        '',
        `${report.totalMiles.toFixed(1)} mi`,
        '',
        formatCurrency(report.totalReimbursement),
      ],
    ],
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.2,
      cellPadding: { top: 6, right: 6, bottom: 6, left: 6 },
      textColor: BRAND_NAVY,
      lineColor: BORDER_LIGHT,
      lineWidth: 0.5,
      valign: 'top',
    },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: BRAND_NAVY,
      fontStyle: 'bold',
      fontSize: 8,
    },
    footStyles: {
      fillColor: [248, 250, 252],
      textColor: BRAND_NAVY,
      fontStyle: 'bold',
      fontSize: 8.8,
      lineColor: BRAND_NAVY,
      lineWidth: 0.75,
    },
    alternateRowStyles: {
      fillColor: [252, 253, 255],
    },
    columnStyles: {
      0: { cellWidth: 62, font: 'courier', fontSize: 8 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 94 },
      3: { cellWidth: 46, halign: 'right', font: 'courier' },
      4: { cellWidth: 44, halign: 'right', font: 'courier' },
      5: { cellWidth: 62, halign: 'right', font: 'courier', fontStyle: 'bold' },
    },
  });

  let currentBottomY =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ??
    cursorY + 120;

  // Itemized Non-Mileage Business Expenses (Parking, Tolls, Express Lane, etc.)
  if (sortedExpenses.length > 0) {
    let expHeaderY = currentBottomY + 20;
    if (expHeaderY + 84 > pageHeight - 52) {
      doc.addPage();
      doc.setFillColor(...BRAND_BLUE);
      doc.rect(0, 0, pageWidth, 8, 'F');
      expHeaderY = 44;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...BRAND_NAVY);
    doc.text('Non-Mileage Business Expenses (Parking, Tolls & Other)', marginX, expHeaderY);

    const expenseRows = sortedExpenses.map((exp) => {
      const linkedTrip = exp.tripId ? tripById.get(exp.tripId) : undefined;
      const details: string[] = [exp.description];
      if (linkedTrip) {
        details.push(`Trip: ${linkedTrip.originName} -> ${linkedTrip.destinationName}`);
      }
      if (exp.notes.trim()) {
        details.push(exp.notes.trim());
      }
      return [exp.expenseDate, exp.category, details.join('\n'), formatCurrency(exp.amount)];
    });

    autoTable(doc, {
      startY: expHeaderY + 8,
      margin: { left: marginX, right: marginX, bottom: 52 },
      head: [['Date', 'Category', 'Description & Associated Trip', 'Amount']],
      body: expenseRows,
      foot: [
        [
          `Expenses Subtotal (${sortedExpenses.length} ${
            sortedExpenses.length === 1 ? 'item' : 'items'
          })`,
          '',
          '',
          formatCurrency(expensesSubtotal),
        ],
      ],
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8.2,
        cellPadding: { top: 6, right: 6, bottom: 6, left: 6 },
        textColor: BRAND_NAVY,
        lineColor: BORDER_LIGHT,
        lineWidth: 0.5,
        valign: 'top',
      },
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: BRAND_NAVY,
        fontStyle: 'bold',
        fontSize: 8,
      },
      footStyles: {
        fillColor: [248, 250, 252],
        textColor: BRAND_NAVY,
        fontStyle: 'bold',
        fontSize: 8.8,
        lineColor: BRAND_NAVY,
        lineWidth: 0.75,
      },
      alternateRowStyles: {
        fillColor: [252, 253, 255],
      },
      columnStyles: {
        0: { cellWidth: 62, font: 'courier', fontSize: 8 },
        1: { cellWidth: 84, fontStyle: 'bold' },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 68, halign: 'right', font: 'courier', fontStyle: 'bold' },
      },
    });

    currentBottomY =
      (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ??
      expHeaderY + 90;

    // Combined Grand Total Summary Bar
    let summaryY = currentBottomY + 14;
    if (summaryY + 42 > pageHeight - 52) {
      doc.addPage();
      doc.setFillColor(...BRAND_BLUE);
      doc.rect(0, 0, pageWidth, 8, 'F');
      summaryY = 44;
    }

    doc.setFillColor(239, 246, 255);
    doc.setDrawColor(191, 219, 254);
    doc.setLineWidth(0.75);
    doc.roundedRect(marginX, summaryY, contentWidth, 34, 4, 4, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...BRAND_NAVY);
    doc.text(
      `Grand Total Reimbursement  (Mileage ${formatCurrency(report.totalReimbursement)} + Expenses ${formatCurrency(expensesSubtotal)})`,
      marginX + 12,
      summaryY + 21
    );

    doc.setFont('courier', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...BRAND_BLUE);
    doc.text(formatCurrency(grandTotal), pageWidth - marginX - 12, summaryY + 21, {
      align: 'right',
    });

    currentBottomY = summaryY + 34;
  }

  // Business Purpose Summary Breakdown Table
  if (sortedTrips.length > 0) {
    const byPurpose = new Map<
      string,
      { count: number; miles: number; amount: number }
    >();
    for (const t of sortedTrips) {
      const existing = byPurpose.get(t.purpose) ?? { count: 0, miles: 0, amount: 0 };
      existing.count += 1;
      existing.miles += t.billableMiles;
      existing.amount += t.reimbursementAmount;
      byPurpose.set(t.purpose, existing);
    }

    const purposeRows = Array.from(byPurpose.entries())
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([purposeLabel, agg]) => [
        purposeLabel,
        `${agg.count} ${agg.count === 1 ? 'trip' : 'trips'}`,
        `${agg.miles.toFixed(1)} mi`,
        formatCurrency(round2(agg.amount)),
      ]);

    let purposeHeaderY = currentBottomY + 20;
    if (purposeHeaderY + 72 > pageHeight - 52) {
      doc.addPage();
      doc.setFillColor(...BRAND_BLUE);
      doc.rect(0, 0, pageWidth, 8, 'F');
      purposeHeaderY = 44;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...BRAND_NAVY);
    doc.text('Mileage Summary by Business Purpose', marginX, purposeHeaderY);

    autoTable(doc, {
      startY: purposeHeaderY + 8,
      margin: { left: marginX, right: marginX, bottom: 52 },
      head: [['Business Purpose', 'Trips', 'Billable Miles', 'Mileage Subtotal']],
      body: purposeRows,
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8.2,
        cellPadding: { top: 5.5, right: 6, bottom: 5.5, left: 6 },
        textColor: BRAND_NAVY,
        lineColor: BORDER_LIGHT,
        lineWidth: 0.5,
      },
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: BRAND_NAVY,
        fontStyle: 'bold',
        fontSize: 8,
      },
      alternateRowStyles: {
        fillColor: [252, 253, 255],
      },
      columnStyles: {
        0: { cellWidth: 'auto', fontStyle: 'bold' },
        1: { cellWidth: 72, halign: 'right', font: 'courier' },
        2: { cellWidth: 84, halign: 'right', font: 'courier' },
        3: { cellWidth: 92, halign: 'right', font: 'courier', fontStyle: 'bold' },
      },
    });

    currentBottomY =
      (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ??
      purposeHeaderY + 80;
  }

  // Certification & Dual Signature Block
  let sigY = currentBottomY + 24;
  const requiredSigHeight = 112;
  if (sigY + requiredSigHeight > pageHeight - 46) {
    doc.addPage();
    doc.setFillColor(...BRAND_BLUE);
    doc.rect(0, 0, pageWidth, 8, 'F');
    sigY = 48;
  }

  doc.setDrawColor(...BORDER_LIGHT);
  doc.setLineWidth(0.75);
  doc.line(marginX, sigY, pageWidth - marginX, sigY);

  sigY += 16;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND_NAVY);
  doc.text('Employee Certification & Management Approval', marginX, sigY);

  sigY += 13;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE_600);
  const certText =
    'I certify that the mileage and any itemized business expenses (such as parking or tolls) in this report were incurred on authorized business travel using my personal vehicle, exclude non-reimbursable personal commuting where applicable, and are accurate to the best of my knowledge.';
  const certLines = doc.splitTextToSize(certText, contentWidth);
  doc.text(certLines, marginX, sigY);

  const lineY = sigY + certLines.length * 10 + 34;
  const sigColWidth = (contentWidth - 32) / 2;

  doc.setDrawColor(100, 116, 139);
  doc.setLineWidth(0.75);
  doc.line(marginX, lineY, marginX + sigColWidth, lineY);
  doc.line(marginX + sigColWidth + 32, lineY, pageWidth - marginX, lineY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE_600);
  doc.text('Driver / Employee Signature', marginX, lineY + 12);
  doc.text('Date', marginX + sigColWidth, lineY + 12, { align: 'right' });

  doc.text('Manager / Approver Signature', marginX + sigColWidth + 32, lineY + 12);
  doc.text('Date', pageWidth - marginX, lineY + 12, { align: 'right' });

  // Page Footers across all pages
  const totalPages = doc.getNumberOfPages();
  const generatedStamp = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  for (let p = 1; p <= totalPages; p += 1) {
    doc.setPage(p);
    doc.setDrawColor(...BORDER_LIGHT);
    doc.setLineWidth(0.5);
    doc.line(marginX, pageHeight - 34, pageWidth - marginX, pageHeight - 34);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE_400);
    doc.text(
      `MileTrack  ·  Report ${report.reportNumber}  ·  Generated ${generatedStamp}`,
      marginX,
      pageHeight - 20
    );
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - marginX, pageHeight - 20, {
      align: 'right',
    });
  }

  doc.save(`MileTrack_Mileage_Report_${report.reportNumber}.pdf`);
}

export interface TripReceiptPdfOptions {
  employeeName?: string;
  employeeId?: string;
  department?: string;
  homeStoreName?: string;
  vehicleInfo?: string;
  reportNumber?: string;
  stage?: 'ready' | 'submitted' | 'reimbursed';
  expenses?: TripExpense[];
}

export function downloadTripReceiptPdf(
  trip: MileageTrip,
  options: TripReceiptPdfOptions = {}
): void {
  const tripExpenses = [...(options.expenses ?? [])].sort((a, b) =>
    a.expenseDate.localeCompare(b.expenseDate)
  );
  const tripExpensesTotal = round2(tripExpenses.reduce((sum, e) => sum + e.amount, 0));
  const tripGrandTotal = round2(trip.reimbursementAmount + tripExpensesTotal);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 42;
  const contentWidth = pageWidth - marginX * 2;
  const shortId = trip.id.slice(-8).toUpperCase();
  const receiptRef = options.reportNumber ? `${options.reportNumber} · ${shortId}` : `TR-${shortId}`;

  const stageLabel =
    options.stage === 'reimbursed'
      ? 'Reimbursed'
      : options.stage === 'submitted' || trip.status === 'submitted'
        ? 'Submitted'
        : 'Ready to Submit';

  const captureLabel =
    trip.captureMethod === 'gps_live'
      ? 'Live GPS Drive'
      : trip.captureMethod === 'template'
        ? 'Saved Route Template'
        : trip.captureMethod === 'manual'
          ? 'Manual Entry'
          : 'Google Maps Routes API';

  // Top Brand Accent Bar
  doc.setFillColor(...BRAND_BLUE);
  doc.rect(0, 0, pageWidth, 8, 'F');

  // Header Block
  let cursorY = 36;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND_BLUE);
  doc.text('MILETRACK  ·  TRIP MILEAGE RECEIPT', marginX, cursorY);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(...BRAND_NAVY);
  doc.text('Individual Trip Mileage Receipt', marginX, cursorY + 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE_600);
  doc.text(
    'Single-Trip Business Travel & Expense Record',
    marginX,
    cursorY + 32
  );

  // Right-Aligned Reference Block
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE_600);
  doc.text('RECEIPT REFERENCE', pageWidth - marginX, cursorY, { align: 'right' });

  doc.setFont('courier', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(...BRAND_NAVY);
  doc.text(receiptRef, pageWidth - marginX, cursorY + 16, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE_600);
  doc.text(
    `${formatDisplayDate(trip.tripDate)}  ·  ${stageLabel}`,
    pageWidth - marginX,
    cursorY + 30,
    { align: 'right' }
  );

  cursorY += 44;
  doc.setDrawColor(...BORDER_LIGHT);
  doc.setLineWidth(1);
  doc.line(marginX, cursorY, pageWidth - marginX, cursorY);

  // Employee & Trip Metadata Box
  cursorY += 14;
  const metaHeight = 84;
  doc.setFillColor(...SURFACE_TINT);
  doc.setDrawColor(...BORDER_LIGHT);
  doc.roundedRect(marginX, cursorY, contentWidth, metaHeight, 4, 4, 'FD');

  const col1X = marginX + 14;
  const col2X = marginX + 190;
  const col3X = marginX + 360;
  const row1Y = cursorY + 18;
  const row2Y = cursorY + 52;

  const drawField = (label: string, value: string, x: number, y: number, mono = false) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE_600);
    doc.text(label, x, y);

    doc.setFont(mono ? 'courier' : 'helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...BRAND_NAVY);
    doc.text(value, x, y + 13, { maxWidth: 162 });
  };

  drawField('Driver / Employee', options.employeeName || 'Not specified', col1X, row1Y);
  drawField('Employee ID', options.employeeId || '—', col2X, row1Y, true);
  drawField('Department / Team', options.department || '—', col3X, row1Y);

  drawField('Business Purpose', trip.purpose, col1X, row2Y);
  drawField('Personal Vehicle', options.vehicleInfo || 'Personal Vehicle', col2X, row2Y);
  drawField('Capture Method', captureLabel, col3X, row2Y);

  // Executive KPI Strip
  cursorY += metaHeight + 12;
  const kpiHeight = 46;
  const kpiGap = 10;
  const kpiWidth = (contentWidth - kpiGap * 2) / 3;

  const kpis = [
    {
      label: 'Trip Direction',
      value: trip.isRoundTrip ? 'Round Trip' : 'One-Way',
      accent: false,
    },
    {
      label: 'Billable Miles',
      value: `${trip.billableMiles.toFixed(1)} mi`,
      accent: false,
    },
    {
      label: tripExpensesTotal > 0 ? 'Total Reimbursement' : 'Trip Reimbursement',
      value: formatCurrency(tripGrandTotal),
      accent: true,
    },
  ];

  kpis.forEach((kpi, idx) => {
    const x = marginX + idx * (kpiWidth + kpiGap);
    doc.setFillColor(kpi.accent ? 239 : 255, kpi.accent ? 246 : 255, kpi.accent ? 255 : 255);
    doc.setDrawColor(
      ...(kpi.accent ? ([191, 219, 254] as [number, number, number]) : BORDER_LIGHT)
    );
    doc.roundedRect(x, cursorY, kpiWidth, kpiHeight, 4, 4, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE_600);
    doc.text(kpi.label, x + 12, cursorY + 16);

    doc.setFont('courier', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...(kpi.accent ? BRAND_BLUE : BRAND_NAVY));
    doc.text(kpi.value, x + 12, cursorY + 34);
  });

  // Route & Stop Verification Table
  cursorY += kpiHeight + 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...BRAND_NAVY);
  doc.text('Route & Address Verification', marginX, cursorY);

  autoTable(doc, {
    startY: cursorY + 8,
    margin: { left: marginX, right: marginX },
    head: [['Stop', 'Location Name', 'Street Address']],
    body: [
      ['Origin (A)', trip.originName, trip.originAddress || '—'],
      ['Destination (B)', trip.destinationName, trip.destinationAddress || '—'],
    ],
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: { top: 7, right: 8, bottom: 7, left: 8 },
      textColor: BRAND_NAVY,
      lineColor: BORDER_LIGHT,
      lineWidth: 0.5,
      valign: 'top',
    },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: BRAND_NAVY,
      fontStyle: 'bold',
      fontSize: 8,
    },
    columnStyles: {
      0: { cellWidth: 82, fontStyle: 'bold' },
      1: { cellWidth: 165, fontStyle: 'bold' },
      2: { cellWidth: 'auto' },
    },
  });

  const afterStopsY =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ??
    cursorY + 95;

  // Mileage Calculation Breakdown Table
  const calcHeaderY = afterStopsY + 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...BRAND_NAVY);
  doc.text('Mileage & Reimbursement Calculation', marginX, calcHeaderY);

  const calcBody: string[][] = [
    ['One-Way Distance', `${trip.oneWayMiles.toFixed(1)} mi`],
    ['Trip Multiplier', trip.isRoundTrip ? '2× (Round Trip)' : '1× (One-Way)'],
    [
      'Commute Deduction',
      trip.commuteDeductionMiles > 0
        ? `−${(trip.isRoundTrip ? trip.commuteDeductionMiles * 2 : trip.commuteDeductionMiles).toFixed(1)} mi (${trip.commuteDeductionMiles.toFixed(1)} mi each way)`
        : '0.0 mi',
    ],
    ['Estimated Drive Time', trip.durationMinutes > 0 ? `${trip.durationMinutes} min one-way` : '—'],
    ['Billable Business Miles', `${trip.billableMiles.toFixed(1)} mi`],
    ['Reimbursement Rate', `$${trip.ratePerMile.toFixed(3)} / mile`],
    ['Mileage Reimbursement Subtotal', formatCurrency(trip.reimbursementAmount)],
  ];

  for (const exp of tripExpenses) {
    calcBody.push([`${exp.category} — ${exp.description}`, formatCurrency(exp.amount)]);
  }

  if (trip.notes.trim()) {
    calcBody.push(['Trip Notes / Ticket', trip.notes.trim()]);
  }

  autoTable(doc, {
    startY: calcHeaderY + 8,
    margin: { left: marginX, right: marginX },
    head: [['Line Item', 'Recorded Value']],
    body: calcBody,
    foot: [['Total Trip Reimbursement', formatCurrency(tripGrandTotal)]],
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: { top: 6, right: 8, bottom: 6, left: 8 },
      textColor: BRAND_NAVY,
      lineColor: BORDER_LIGHT,
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: BRAND_NAVY,
      fontStyle: 'bold',
      fontSize: 8,
    },
    footStyles: {
      fillColor: [239, 246, 255],
      textColor: BRAND_BLUE,
      fontStyle: 'bold',
      fontSize: 9.5,
      lineColor: BRAND_BLUE,
      lineWidth: 0.75,
    },
    columnStyles: {
      0: { cellWidth: 190, fontStyle: 'bold' },
      1: { cellWidth: 'auto', halign: 'right', font: 'courier' },
    },
  });

  const afterCalcY =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ??
    calcHeaderY + 170;

  // Compact Single-Page Certification & Signature Footer
  const sigY = Math.min(Math.max(afterCalcY + 24, pageHeight - 154), pageHeight - 134);
  doc.setDrawColor(...BORDER_LIGHT);
  doc.setLineWidth(0.75);
  doc.line(marginX, sigY, pageWidth - marginX, sigY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE_600);
  const certText =
    'I certify that this trip was driven on authorized business travel using my personal vehicle and that all distances and expenses recorded above are accurate.';
  const certLines = doc.splitTextToSize(certText, contentWidth);
  doc.text(certLines, marginX, sigY + 14);

  const lineY = sigY + certLines.length * 10 + 38;
  const sigColWidth = (contentWidth - 32) / 2;
  doc.setDrawColor(100, 116, 139);
  doc.setLineWidth(0.75);
  doc.line(marginX, lineY, marginX + sigColWidth, lineY);
  doc.line(marginX + sigColWidth + 32, lineY, pageWidth - marginX, lineY);

  doc.setFontSize(8);
  doc.setTextColor(...SLATE_600);
  doc.text('Driver / Employee Signature', marginX, lineY + 12);
  doc.text('Date', marginX + sigColWidth, lineY + 12, { align: 'right' });
  doc.text('Manager / Approver Verification', marginX + sigColWidth + 32, lineY + 12);
  doc.text('Date', pageWidth - marginX, lineY + 12, { align: 'right' });

  // Page Footer
  const generatedStamp = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  doc.setDrawColor(...BORDER_LIGHT);
  doc.setLineWidth(0.5);
  doc.line(marginX, pageHeight - 34, pageWidth - marginX, pageHeight - 34);
  doc.setFontSize(7.5);
  doc.setTextColor(...SLATE_400);
  doc.text(
    `MileTrack  ·  Trip Receipt ${receiptRef}  ·  Generated ${generatedStamp}`,
    marginX,
    pageHeight - 20
  );
  doc.text('Page 1 of 1', pageWidth - marginX, pageHeight - 20, { align: 'right' });

  doc.save(`MileTrack_Trip_Receipt_${trip.tripDate}_${shortId}.pdf`);
}
