import React, { useEffect, useState } from 'react';
import { Check, Save } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import {
  DEFAULT_RATE_PER_MILE,
  FIELD_LIMITS,
  type StoreLocation,
  type UserProfile,
} from '../types/mileage';

export interface ProfileSettingsInput {
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
}

interface ProfileSettingsViewProps {
  isAuthenticated: boolean;
  onRequestSignIn: () => void;
  userDisplayName: string;
  profile: UserProfile | null;
  stores: StoreLocation[];
  storesLoading: boolean;
  onSaveProfile: (input: ProfileSettingsInput) => Promise<void>;
}

const RATE_PRESETS = [
  { label: '$0.67 / mi', value: 0.67 },
  { label: '$0.70 / mi', value: 0.70 },
  { label: '$0.725 / mi', value: 0.725 },
];

export function ProfileSettingsView({
  isAuthenticated,
  onRequestSignIn,
  userDisplayName,
  profile,
  stores,
  storesLoading,
  onSaveProfile,
}: ProfileSettingsViewProps) {
  const { t } = useI18n();
  const [employeeName, setEmployeeName] = useState(profile?.employeeName ?? userDisplayName);
  const [employeeId, setEmployeeId] = useState(profile?.employeeId ?? '');
  const [department, setDepartment] = useState(profile?.department ?? 'Retail Operations');
  const [managerEmail, setManagerEmail] = useState(profile?.managerEmail ?? '');
  const [homeStorePlaceId, setHomeStorePlaceId] = useState(profile?.homeStorePlaceId ?? '');
  const [homeStoreName, setHomeStoreName] = useState(profile?.homeStoreName ?? '');
  const [homeStoreAddress, setHomeStoreAddress] = useState(profile?.homeStoreAddress ?? '');
  const [vehicleInfo, setVehicleInfo] = useState(profile?.vehicleInfo ?? '');
  const [ratePerMile, setRatePerMile] = useState<number>(
    profile?.ratePerMile ?? DEFAULT_RATE_PER_MILE
  );
  const [normalCommuteMiles, setNormalCommuteMiles] = useState<number>(
    profile?.normalCommuteMiles ?? 0
  );
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!profile) {
      if (userDisplayName && !employeeName) setEmployeeName(userDisplayName);
      return;
    }
    setEmployeeName(profile.employeeName || userDisplayName);
    setEmployeeId(profile.employeeId);
    setDepartment(profile.department);
    setManagerEmail(profile.managerEmail);
    setHomeStorePlaceId(profile.homeStorePlaceId);
    setHomeStoreName(profile.homeStoreName);
    setHomeStoreAddress(profile.homeStoreAddress);
    setVehicleInfo(profile.vehicleInfo);
    setRatePerMile(profile.ratePerMile);
    setNormalCommuteMiles(profile.normalCommuteMiles);
  }, [profile, userDisplayName]);

  const handleSelectHomeStore = (placeId: string) => {
    setHomeStorePlaceId(placeId);
    const matched = stores.find((s) => s.placeId === placeId);
    if (matched) {
      setHomeStoreName(matched.shortName);
      setHomeStoreAddress(matched.address);
    } else {
      setHomeStoreName('');
      setHomeStoreAddress('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      onRequestSignIn();
      return;
    }

    setIsSaving(true);
    setStatus(null);
    try {
      const clampedRate = Math.min(5, Math.max(0.01, Number(ratePerMile) || DEFAULT_RATE_PER_MILE));
      const clampedCommute = Math.min(200, Math.max(0, Number(normalCommuteMiles) || 0));

      await onSaveProfile({
        employeeName,
        employeeId,
        department,
        managerEmail,
        homeStoreName,
        homeStoreAddress,
        homeStorePlaceId,
        vehicleInfo,
        ratePerMile: clampedRate,
        normalCommuteMiles: clampedCommute,
      });
      setStatus({
        type: 'success',
        text: t('settings.savedSuccess'),
      });
    } catch {
      setStatus({
        type: 'error',
        text: t('settings.savedError'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center max-w-lg mx-auto my-8 space-y-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {t('settings.signInTitle')}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {t('settings.signInDesc')}
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
    <div className="max-w-3xl">
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-200 dark:divide-slate-800"
      >
        {/* Employee Information */}
        <div className="p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {t('settings.empDetails')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t('settings.empDetailsDesc')}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="prof-name"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t('settings.fullName')}
              </label>
              <input
                id="prof-name"
                type="text"
                maxLength={FIELD_LIMITS.employeeName}
                value={employeeName}
                onChange={(e) => setEmployeeName(e.target.value)}
                placeholder={t('settings.fullNamePlaceholder')}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="prof-id"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t('settings.empId')}
              </label>
              <input
                id="prof-id"
                type="text"
                maxLength={FIELD_LIMITS.employeeId}
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                placeholder="CUR-10482"
                className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="prof-dept"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t('settings.deptRole')}
              </label>
              <input
                id="prof-dept"
                type="text"
                maxLength={FIELD_LIMITS.department}
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder={t('settings.deptPlaceholder')}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="prof-manager"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t('settings.managerEmail')}
              </label>
              <input
                id="prof-manager"
                type="email"
                dir="ltr"
                maxLength={FIELD_LIMITS.managerEmail}
                value={managerEmail}
                onChange={(e) => setManagerEmail(e.target.value)}
                placeholder="manager@icuracao.com"
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>
          </div>
        </div>

        {/* Home Store & Vehicle */}
        <div className="p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {t('settings.homeStoreVehicle')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t('settings.homeStoreVehicleDesc')}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="prof-store"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t('settings.primaryStore')}
              </label>
              <select
                id="prof-store"
                value={homeStorePlaceId}
                onChange={(e) => handleSelectHomeStore(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              >
                <option value="">
                  {storesLoading ? t('settings.loadingStores') : t('settings.selectHomeStore')}
                </option>
                {stores.map((s) => (
                  <option key={s.placeId} value={s.placeId}>
                    {s.shortName}
                  </option>
                ))}
              </select>
              {homeStoreAddress && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
                  {homeStoreAddress}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="prof-vehicle"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t('settings.personalVehicle')}
              </label>
              <input
                id="prof-vehicle"
                type="text"
                maxLength={FIELD_LIMITS.vehicleInfo}
                value={vehicleInfo}
                onChange={(e) => setVehicleInfo(e.target.value)}
                placeholder="2021 Toyota Corolla"
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>
          </div>
        </div>

        {/* Mileage Rate & CA Commute Deduction */}
        <div className="p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {t('settings.rateCommuteTitle')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t('settings.rateCommuteDesc')}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="prof-rate"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t('settings.rateLabel')}
              </label>
              <input
                id="prof-rate"
                type="number"
                dir="ltr"
                min="0.01"
                max="5"
                step="0.005"
                required
                value={ratePerMile}
                onChange={(e) => setRatePerMile(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
              <div className="flex items-center gap-1.5 mt-2">
                {RATE_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    dir="ltr"
                    onClick={() => setRatePerMile(preset.value)}
                    className={`px-2.5 py-1 text-xs font-mono rounded-md border transition-colors whitespace-nowrap ${
                      Math.abs(ratePerMile - preset.value) < 0.001
                        ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-300 font-semibold'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="prof-commute"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t('settings.commuteLabel')}
              </label>
              <input
                id="prof-commute"
                type="number"
                dir="ltr"
                min="0"
                max="200"
                step="0.1"
                value={normalCommuteMiles}
                onChange={(e) => setNormalCommuteMiles(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                {t('settings.commuteDesc')}
              </p>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50/70 dark:bg-slate-950/50 flex flex-wrap items-center justify-between gap-3 rounded-b-xl">
          <div>
            {status && (
              <span
                role={status.type === 'error' ? 'alert' : 'status'}
                className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                  status.type === 'success'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-700 dark:text-red-400'
                }`}
              >
                {status.type === 'success' && <Check className="w-4 h-4" />}
                {status.text}
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <Save className="w-4 h-4" />
            {isSaving ? t('common.saving') : t('settings.saveSettings')}
          </button>
        </div>
      </form>
    </div>
  );
}
