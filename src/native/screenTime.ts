import { registerPlugin } from '@capacitor/core';
import type { ShieldWindow, ShieldsState } from '@/logic/shields';
import { getStrictestActiveShield } from '@/logic/shields';
import { isSafeDriverActive, getSafeDriverSelection } from '@/lib/safeDriverState';
import type {
  ApplyShieldRestrictionsRequest,
  ScreenTimePickerOptions,
  ScreenTimePickerResult,
  ScreenTimeStatus,
  ScreenTimeSelectionInfo,
  ScreenTimePlugin,
} from '@/native/screenTimeTypes';

export const ScreenTime = registerPlugin<ScreenTimePlugin>('ScreenTime', {
  web: () => import('./screenTimeWeb').then((m) => new m.ScreenTimeWeb()),
});

interface ScreenTimeSelectionMeta {
  version: number;
  shieldId?: string;
  createdAt: string;
  apps: string[];
  categories: string[];
}

let lastAppliedBlob: string | null = null;

export async function applyActiveShieldRestrictions(state: ShieldsState, now: Date = new Date()): Promise<void> {
  const safeDriverActive = isSafeDriverActive();
  if (safeDriverActive) {
    const selection = getSafeDriverSelection();
    if (!selection) {
      console.debug('[SafeDriver][DIAG] active but no selection blob');
      lastAppliedBlob = null;
      await ScreenTime.clearShieldRestrictions({ reason: 'safe-driver-no-selection' }).catch(() => {});
      return;
    }
    if (selection.blob === lastAppliedBlob) {
      return;
    }
    const shield = state.shields[selection.shieldId];
    const strictness = shield?.strictness ?? 99;
    await ScreenTime.applyShieldRestrictions({
      shieldId: selection.shieldId,
      selectionBlob: selection.blob,
      windows: selection.windows,
      reason: 'safe-driver',
      timestamp: now.toISOString(),
      strictness,
    }).catch(() => {
      console.debug('[SafeDriver][DIAG] apply failed');
    });
    lastAppliedBlob = selection.blob;
    return;
  }

  lastAppliedBlob = null;

  const strictest = getStrictestActiveShield(state, now);
  const selectionBlob = strictest?.screenTimeSelectionBlob;
  if (!selectionBlob) {
    lastAppliedBlob = null;
    await ScreenTime.clearShieldRestrictions({ reason: 'no-active-shield' }).catch(() => {});
    return;
  }
  if (selectionBlob === lastAppliedBlob) return;
  await ScreenTime.applyShieldRestrictions({
    shieldId: strictest!.id,
    selectionBlob,
    windows: strictest!.windows,
    reason: `shield:${strictest!.id}`,
    timestamp: now.toISOString(),
    strictness: strictest!.strictness,
  }).catch(() => {});
  lastAppliedBlob = selectionBlob;
}

export function parseScreenTimeSelectionBlob(blob: string | null): ScreenTimeSelectionInfo | null {
  if (!blob) return null;
  try {
    const decoded = atob(blob);
    const parsed = JSON.parse(decoded) as ScreenTimeSelectionMeta;
    const apps = Array.isArray(parsed.apps) ? parsed.apps.length : 0;
    const categories = Array.isArray(parsed.categories) ? parsed.categories.length : 0;
    const total = apps + categories;
    return {
      label: total > 0 ? `${total} item${total === 1 ? '' : 's'} selected via Screen Time` : 'No apps selected',
      selectedCount: total,
    };
  } catch (error) {
    console.warn('Failed to parse Screen Time selection blob', error);
    return null;
  }
}

export const screenTime = ScreenTime;

export type {
  ScreenTimeStatus,
  ScreenTimePickerOptions,
  ScreenTimePickerResult,
  ApplyShieldRestrictionsRequest,
  ScreenTimeSelectionInfo,
  ScreenTimePlugin,
};
