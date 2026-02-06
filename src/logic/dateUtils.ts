/**
 * Date Utilities
 * ISO day/week helpers for streaks and challenges
 */

/**
 * Get current date as ISO string (YYYY-MM-DD)
 */
export function getTodayISO(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get yesterday's date as ISO string
 */
export function getYesterdayISO(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

/**
 * Get start of day timestamp for a given ISO date
 */
export function getStartOfDayTs(isoDate: string): number {
  return new Date(isoDate + 'T00:00:00').getTime();
}

/**
 * Get end of day timestamp for a given ISO date
 */
export function getEndOfDayTs(isoDate: string): number {
  return new Date(isoDate + 'T23:59:59.999').getTime();
}

/**
 * Get current ISO week string (e.g., "2026-W06")
 */
export function getCurrentWeekISO(): string {
  const date = new Date();
  const year = date.getFullYear();
  const weekNum = getWeekNumber(date);
  return `${year}-W${weekNum.toString().padStart(2, '0')}`;
}

/**
 * Get week number for a date (ISO 8601)
 */
export function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Check if two ISO dates are consecutive days
 */
export function areConsecutiveDays(earlier: string, later: string): boolean {
  const earlierDate = new Date(earlier);
  const laterDate = new Date(later);
  
  const diffTime = laterDate.getTime() - earlierDate.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays === 1;
}

/**
 * Check if date is today
 */
export function isToday(isoDate: string): boolean {
  return isoDate === getTodayISO();
}

/**
 * Check if date is yesterday
 */
export function isYesterday(isoDate: string): boolean {
  return isoDate === getYesterdayISO();
}

/**
 * Get days since a given ISO date
 */
export function daysSince(isoDate: string): number {
  const then = new Date(isoDate);
  const now = new Date(getTodayISO());
  const diffTime = now.getTime() - then.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Get start of current week (Monday) as ISO date
 */
export function getWeekStartISO(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().split('T')[0];
}

/**
 * Get end of current week (Sunday) as ISO date
 */
export function getWeekEndISO(): string {
  const start = new Date(getWeekStartISO());
  start.setDate(start.getDate() + 6);
  return start.toISOString().split('T')[0];
}

/**
 * Format timestamp as readable time ago
 */
export function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}

/**
 * Format duration in minutes to readable string
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
