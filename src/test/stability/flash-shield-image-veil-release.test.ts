/**
 * Bounded release fallback for non-Shorts (home feed / results) Flash Shield
 * veils — mirrors the sacred Shorts P3 armShortsVeilTimeout pattern.
 *
 * A veiled thumbnail with no reveal path is a permanent blur the user cannot
 * escape (AGENTS.md §2). This must hold even when the main blur dial is 0
 * (main moderation disabled) and Flash Shield is the only thing running —
 * scanning may legitimately skip an item (rate limit, queue cap, dedup),
 * so the veil must still resolve on its own after a bounded wait.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectScript, type InjectionResult } from './harness';

function buildFeedImage(id: string): HTMLImageElement {
  const card = document.createElement('ytm-rich-item-renderer');
  const img = document.createElement('img');
  img.id = id;
  img.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  Object.defineProperty(img, 'getBoundingClientRect', {
    value: () => ({ width: 200, height: 120, top: 0, left: 0, right: 200, bottom: 120 }),
  });
  card.appendChild(img);
  document.body.appendChild(card);
  return img;
}

let injection: InjectionResult | null = null;

afterEach(() => {
  injection?.cleanup();
  injection = null;
  vi.useRealTimers();
});

describe('Flash Shield: bounded image veil timeout', () => {
  it('an unresolved feed image veil times out to timeout-safe', () => {
    vi.useFakeTimers();
    injection = injectScript({ flashShieldV1: true });
    const img = buildFeedImage('unresolved-item');

    injection.probe.markFlashShieldCandidates(document);
    expect(img.dataset.mwVeil).toBe('1');
    expect(img.dataset.mwModerated).toBeUndefined();

    vi.advanceTimersByTime(4000);

    expect(img.dataset.mwModerated).toBe('timeout-safe');
    expect(img.dataset.mwVeil).toBeUndefined();
  });

  it('works with the main blur dial disabled (Flash Shield independent of moderation)', () => {
    vi.useFakeTimers();
    injection = injectScript({ flashShieldV1: true, enabled: false, sensitivity: 0 });
    const img = buildFeedImage('dial-off-item');

    injection.probe.markFlashShieldCandidates(document);
    expect(img.dataset.mwVeil).toBe('1');

    vi.advanceTimersByTime(4000);

    expect(img.dataset.mwModerated).toBe('timeout-safe');
    expect(img.dataset.mwVeil).toBeUndefined();
  });

  it('a resolved veil does not fire the timeout (no false release)', () => {
    vi.useFakeTimers();
    injection = injectScript({ flashShieldV1: true });
    const img = buildFeedImage('resolved-item');
    injection.probe.markFlashShieldCandidates(document);

    // Let the parallel legacy soft-blur scan (unrelated to Flash Shield,
    // reacts to the same DOM insertion via its own debounced timer) settle
    // to its own resting state before the real verdict lands, so it can't
    // be the last writer when our bounded timeout later checks in.
    vi.advanceTimersByTime(500);

    injection.probe.clearFlashShieldResolution(img, 'safe');
    vi.advanceTimersByTime(4000);

    expect(String(img.dataset.mwModerated || '')).toBe('safe');
  });

  it('Flash Shield disabled never arms a timeout', () => {
    vi.useFakeTimers();
    injection = injectScript({ flashShieldV1: false });
    const img = buildFeedImage('disabled-item');

    injection.probe.markFlashShieldCandidates(document);
    expect(img.dataset.mwVeil).toBeUndefined();

    vi.advanceTimersByTime(5000);
    // Flash Shield never touched this element; any moderated stamp here can
    // only come from the separate legacy pipeline, never 'timeout-safe'.
    expect(img.dataset.mwModerated).not.toBe('timeout-safe');
  });
});
