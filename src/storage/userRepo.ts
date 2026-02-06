/**
 * User Progress Repository
 * Handles persistence for UserProgress model
 */

import { 
  UserProgress, 
  createDefaultUserProgress,
  clampIntegrityScore,
} from '@/models/UserProgress';
import { normalizeUserSettings } from '@/models/UserSettings';
import { getStorageItem, setStorageItem, STORAGE_KEYS } from './db';

/**
 * Load user progress from storage
 * Returns sane defaults for first install
 */
export async function loadUserProgress(): Promise<UserProgress> {
  const stored = getStorageItem<UserProgress>(STORAGE_KEYS.USER_PROGRESS);
  
  if (!stored) {
    // First install - create default progress
    const defaultProgress = createDefaultUserProgress();
    await saveUserProgress(defaultProgress);
    return defaultProgress;
  }
  
  // Normalize and validate stored data
  return {
    ...createDefaultUserProgress(),
    ...stored,
    integrityScore: clampIntegrityScore(stored.integrityScore ?? 100),
    settings: normalizeUserSettings(stored.settings ?? {}),
  };
}

/**
 * Save user progress to storage
 */
export async function saveUserProgress(progress: UserProgress): Promise<void> {
  // Ensure integrity score is clamped
  const normalized: UserProgress = {
    ...progress,
    integrityScore: clampIntegrityScore(progress.integrityScore),
    settings: normalizeUserSettings(progress.settings),
  };
  
  setStorageItem(STORAGE_KEYS.USER_PROGRESS, normalized);
}

/**
 * Update user progress partially
 */
export async function updateUserProgress(
  updates: Partial<UserProgress>
): Promise<UserProgress> {
  const current = await loadUserProgress();
  const updated: UserProgress = {
    ...current,
    ...updates,
    // If settings are being updated, normalize them
    settings: updates.settings 
      ? normalizeUserSettings({ ...current.settings, ...updates.settings })
      : current.settings,
  };
  
  await saveUserProgress(updated);
  return updated;
}

/**
 * Add SP to user progress
 */
export async function addSP(amount: number): Promise<UserProgress> {
  const current = await loadUserProgress();
  return updateUserProgress({
    totalSP: current.totalSP + amount,
    spToday: current.spToday + amount,
  });
}

/**
 * Reset daily SP (call at day boundary)
 */
export async function resetDailySP(): Promise<UserProgress> {
  return updateUserProgress({ spToday: 0 });
}
