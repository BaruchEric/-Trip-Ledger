import type { Timestamp } from 'firebase/firestore';

export type TripPurpose =
  | 'Inter-Store Transfer'
  | 'Shift Coverage'
  | 'Bank Deposit'
  | 'Supply Run'
  | 'Customer Delivery'
  | 'Training / HQ'
  | 'Other';

export type CaptureMethod = 'route_auto' | 'gps_live' | 'template' | 'manual';

export type TripStatus = 'ready' | 'submitted';
export type ReportStatus = 'submitted' | 'reimbursed';
export type ActiveView = 'log' | 'ledger' | 'reports' | 'settings';

export const TRIP_PURPOSES: TripPurpose[] = [
  'Inter-Store Transfer',
  'Shift Coverage',
  'Bank Deposit',
  'Supply Run',
  'Customer Delivery',
  'Training / HQ',
  'Other',
];

export type ExpenseCategory =
  | 'Parking'
  | 'Tolls'
  | 'Express Lane'
  | 'Fuel / Gas'
  | 'Supplies'
  | 'Other';

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Parking',
  'Tolls',
  'Express Lane',
  'Fuel / Gas',
  'Supplies',
  'Other',
];

export const DEFAULT_RATE_PER_MILE = 0.70;

// Verbatim maxLength limits synced with firebase-blueprint.json and firestore.rules
export const FIELD_LIMITS = {
  employeeName: 100,
  employeeId: 40,
  department: 80,
  managerEmail: 120,
  homeStoreName: 120,
  homeStoreAddress: 240,
  homeStorePlaceId: 160,
  vehicleInfo: 100,
  originName: 120,
  originAddress: 240,
  originPlaceId: 160,
  destinationName: 120,
  destinationAddress: 240,
  destinationPlaceId: 160,
  notes: 300,
  expenseDescription: 160,
  templateLabel: 100,
  reportNumber: 40,
} as const;

export interface UserProfile {
  uid: string;
  employeeName: string;
  employeeId: string;
  department: string;
  managerEmail: string;
  homeStoreName: string;
  homeStoreAddress: string;
  homeStorePlaceId: string;
  vehicleInfo: string;
  ratePerMile: number;
  normalCommuteMiles: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface MileageTrip {
  id: string;
  userId: string;
  tripDate: string; // YYYY-MM-DD
  originName: string;
  originAddress: string;
  originPlaceId: string;
  destinationName: string;
  destinationAddress: string;
  destinationPlaceId: string;
  purpose: TripPurpose;
  notes: string;
  oneWayMiles: number;
  commuteDeductionMiles: number;
  billableMiles: number;
  durationMinutes: number;
  isRoundTrip: boolean;
  captureMethod: CaptureMethod;
  ratePerMile: number;
  reimbursementAmount: number;
  status: TripStatus;
  reportId: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface RouteTemplate {
  id: string;
  userId: string;
  label: string;
  originName: string;
  originAddress: string;
  originPlaceId: string;
  destinationName: string;
  destinationAddress: string;
  destinationPlaceId: string;
  purpose: TripPurpose;
  oneWayMiles: number;
  durationMinutes: number;
  isRoundTrip: boolean;
  createdAt?: Timestamp;
}

export interface MileageReport {
  id: string;
  userId: string;
  reportNumber: string;
  periodStart: string;
  periodEnd: string;
  employeeName: string;
  employeeId: string;
  department: string;
  homeStoreName: string;
  vehicleInfo: string;
  tripCount: number;
  totalMiles: number;
  totalReimbursement: number;
  status: ReportStatus;
  submittedAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface TripExpense {
  id: string;
  userId: string;
  tripId: string;
  reportId: string;
  expenseDate: string; // YYYY-MM-DD
  category: ExpenseCategory;
  description: string;
  amount: number;
  notes: string;
  status: TripStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface NewExpenseInput {
  tripId: string;
  expenseDate: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  notes: string;
}

// Ephemeral session-only geospatial objects from Google Maps Places API (New)
export interface StoreLocation {
  placeId: string;
  name: string;
  shortName: string;
  address: string;
  lat: number;
  lng: number;
  businessStatus?: string;
}

export interface PlaceSelection {
  name: string;
  address: string;
  placeId: string;
  lat?: number;
  lng?: number;
}

export function sanitizeStr(val: string | undefined | null, maxLen: number): string {
  return (val ?? '').trim().slice(0, maxLen);
}

export function round2(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function round1(num: number): number {
  return Math.round((num + Number.EPSILON) * 10) / 10;
}

export function calculateBillableMiles(
  oneWayMiles: number,
  isRoundTrip: boolean,
  commuteDeductionMiles: number
): number {
  const gross = isRoundTrip ? oneWayMiles * 2 : oneWayMiles;
  const deduction = isRoundTrip ? commuteDeductionMiles * 2 : commuteDeductionMiles;
  return round1(Math.max(0, gross - deduction));
}

export function calculateReimbursement(billableMiles: number, ratePerMile: number): number {
  return round2(billableMiles * ratePerMile);
}

export function formatDateISO(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDisplayDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatMiles(miles: number): string {
  return `${miles.toFixed(1)} mi`;
}

export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.7613; // Earth radius in miles
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function generateDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}
