/**
 * Storage Layer - LocalStorage-based persistence
 * 
 * Uses localStorage for persistence (works in web + Capacitor WebView).
 * All data is stored as JSON strings with typed accessors.
 */

// Storage keys
const STORAGE_KEYS = {
  USER_PROGRESS: 'champ_user_progress',
  TRIGGER_EVENTS: 'champ_trigger_events',
  FOCUS_SESSIONS: 'champ_focus_sessions',
  PARTNER_REQUESTS: 'champ_partner_requests',
} as const;

/**
 * Generic get/set helpers with JSON serialization
 */
export function getStorageItem<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error(`[Storage] Failed to read ${key}:`, error);
    return null;
  }
}

export function setStorageItem<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`[Storage] Failed to write ${key}:`, error);
  }
}

export function appendToStorageArray<T>(key: string, item: T): void {
  try {
    const existing = getStorageItem<T[]>(key) ?? [];
    existing.push(item);
    setStorageItem(key, existing);
  } catch (error) {
    console.error(`[Storage] Failed to append to ${key}:`, error);
  }
}

export function updateInStorageArray<T extends { id: string }>(
  key: string,
  id: string,
  updater: (item: T) => T
): void {
  try {
    const existing = getStorageItem<T[]>(key) ?? [];
    const updated = existing.map(item => 
      item.id === id ? updater(item) : item
    );
    setStorageItem(key, updated);
  } catch (error) {
    console.error(`[Storage] Failed to update in ${key}:`, error);
  }
}

export function filterStorageArray<T>(
  key: string,
  predicate: (item: T) => boolean
): T[] {
  try {
    const existing = getStorageItem<T[]>(key) ?? [];
    return existing.filter(predicate);
  } catch (error) {
    console.error(`[Storage] Failed to filter ${key}:`, error);
    return [];
  }
}

export { STORAGE_KEYS };
