/**
 * Active Shorts: recycled <video> node must not keep reveal across swipes.
 *
 * Bug: after revealing short A, YouTube reuses the same video element for short B.
 * The node still has data-mw-revealed=true + mwRevealKey=shorts:A. isRevealedForSource
 * previously honored that marker without matching the new scope key → B skipped blur
 * ("positives stopped being flagged after I revealed one short").
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildActiveShortsPlayer,
  injectScript,
  pushShortsUrl,
  restoreMainFeedUrl,
  type InjectionResult,
} from './harness';

const SHORT_A = 'RecycleShortAAA1';
const SHORT_B = 'RecycleShortBBB2';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/oardefault.jpg`;
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
  restoreMainFeedUrl();
});

describe('Active Shorts recycled-node reveal isolation', () => {
  it('reveal A does not mark short B revealed on the same video node', () => {
    pushShortsUrl(SHORT_A);
    const fixture = buildActiveShortsPlayer(SHORT_A);
    injection = injectScript();

    expect(injection.probe.isShortsModeActive()).toBe(true);
    expect(injection.probe.getCurrentShortsUrlId()).toBe(SHORT_A);

    // User reveals short A on the active player video.
    const markA = injection.probe.markRevealedForSource(
      fixture.src,
      fixture.video,
      'test_reveal_short_a',
    );
    expect(markA.key).toBe(`shorts:${SHORT_A}`);
    expect(fixture.video.dataset.mwRevealed).toBe('true');
    expect(fixture.video.dataset.mwRevealKey).toBe(`shorts:${SHORT_A}`);
    expect(injection.probe.isRevealedForSource(fixture.src, fixture.video)).toBe(true);

    // YouTube recycles the same <video> node for short B (src/poster swap + URL change).
    pushShortsUrl(SHORT_B);
    const srcB = srcFor(SHORT_B);
    fixture.video.src = srcB;
    fixture.video.poster = srcB;
    fixture.video.dataset.mwSrc = srcB;
    // Intentionally leave stale mwRevealed / mwRevealKey from short A on the node.
    expect(fixture.video.dataset.mwRevealKey).toBe(`shorts:${SHORT_A}`);

    // Core invariant: short B must NOT be treated as revealed.
    expect(injection.probe.isRevealedForSource(srcB, fixture.video)).toBe(false);

    // Stale dataset markers should be cleared by the mismatch path.
    expect(fixture.video.dataset.mwRevealed).not.toBe('true');
    expect(String(fixture.video.dataset.mwRevealKey || '')).not.toBe(`shorts:${SHORT_A}`);

    // applyBlur for B must not no-op due to stale reveal (auth may still gate;
    // revealed short-circuit alone must not fire).
    injection.probe.applyBlur(
      fixture.video,
      srcB,
      'porn',
      40,
      SHORT_B,
      'classifier_positive',
    );
    // If blur applied, moderated becomes blurred; if auth blocks, at least
    // isRevealedForSource stayed false so we did not short-circuit as revealed.
    expect(injection.probe.isRevealedForSource(srcB, fixture.video)).toBe(false);
  });

  it('swipe clear drops stale shorts: keys that are not the current URL id', () => {
    pushShortsUrl(SHORT_A);
    const fixture = buildActiveShortsPlayer(SHORT_A);
    injection = injectScript();

    injection.probe.markRevealedForSource(fixture.src, fixture.video, 'test_reveal_a');
    fixture.video.dataset.mwModerated = 'revealed';

    pushShortsUrl(SHORT_B);
    fixture.video.src = srcFor(SHORT_B);
    fixture.video.poster = srcFor(SHORT_B);

    injection.probe.clearStaleShortsRevealMarkersOnSwipe('test_swipe_to_b');

    expect(fixture.video.dataset.mwRevealed).not.toBe('true');
    expect(String(fixture.video.dataset.mwRevealKey || '')).toBe('');
    expect(String(fixture.video.dataset.mwModerated || '')).not.toBe('revealed');
    expect(injection.probe.isRevealedForSource(srcFor(SHORT_B), fixture.video)).toBe(false);
  });

  it('data: frame src scopes to current shorts URL id, not a bare data key', () => {
    pushShortsUrl(SHORT_A);
    const fixture = buildActiveShortsPlayer(SHORT_A);
    injection = injectScript();

    const dataFrame =
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z';

    const mark = injection.probe.markRevealedForSource(
      dataFrame,
      fixture.video,
      'test_data_frame_reveal',
    );
    expect(mark.key).toBe(`shorts:${SHORT_A}`);

    pushShortsUrl(SHORT_B);
    expect(injection.probe.isRevealedForSource(dataFrame, fixture.video)).toBe(false);
  });
});
