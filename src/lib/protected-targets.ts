export type ProtectedTargetCategory =
  | 'social'
  | 'video'
  | 'browser'
  | 'messaging'
  | 'shopping'
  | 'news'
  | 'gaming'
  | 'other';

export type ProtectedTargetBucket = 'hard' | 'soft';

export interface ProtectedTarget {
  id: string;
  label: string;
  category: ProtectedTargetCategory;
  bucket: ProtectedTargetBucket;
  bundleId?: string;
  route?: string;
}

const TARGET_ID_PATTERN = /^target\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export const PROTECTED_TARGETS: ProtectedTarget[] = [
  { id: 'target.youtube', label: 'YouTube', category: 'video', bucket: 'hard' },
  { id: 'target.tiktok', label: 'TikTok', category: 'video', bucket: 'hard' },
  { id: 'target.instagram', label: 'Instagram', category: 'social', bucket: 'hard' },
  { id: 'target.facebook', label: 'Facebook', category: 'social', bucket: 'soft' },
  { id: 'target.x', label: 'X', category: 'social', bucket: 'soft' },
  { id: 'target.reddit', label: 'Reddit', category: 'social', bucket: 'soft' },
  { id: 'target.discord', label: 'Discord', category: 'messaging', bucket: 'hard' },
  { id: 'target.whatsapp', label: 'WhatsApp', category: 'messaging', bucket: 'soft' },
  { id: 'target.amazon', label: 'Amazon', category: 'shopping', bucket: 'soft' },
  { id: 'target.google-news', label: 'Google News', category: 'news', bucket: 'soft' },
  { id: 'target.web-browser', label: 'Web Browser', category: 'browser', bucket: 'hard' },
  { id: 'target.gaming', label: 'Gaming', category: 'gaming', bucket: 'hard' },
  { id: 'target.other', label: 'Other', category: 'other', bucket: 'soft' },
];

const TARGETS_BY_ID = new Map<string, ProtectedTarget>(
  PROTECTED_TARGETS.map(target => [target.id, target]),
);

function normalizeInputId(id: string): string {
  return id.trim().toLowerCase();
}

export function isProtectedTargetId(value: string): boolean {
  const normalized = normalizeInputId(String(value || ''));
  return TARGET_ID_PATTERN.test(normalized);
}

export function hasTarget(id: string): boolean {
  if (!isProtectedTargetId(id)) return false;
  return TARGETS_BY_ID.has(normalizeInputId(id));
}

export function resolveProtectedTarget(id: string): ProtectedTarget | undefined {
  if (!isProtectedTargetId(id)) return undefined;
  return TARGETS_BY_ID.get(normalizeInputId(id));
}

export function getTargetBucket(id: string): ProtectedTargetBucket | undefined {
  return resolveProtectedTarget(id)?.bucket;
}

export function normalizeTargetIds(ids: string[]): string[] {
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawId of ids) {
    if (typeof rawId !== 'string') continue;
    const id = normalizeInputId(rawId);
    if (!hasTarget(id) || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}
