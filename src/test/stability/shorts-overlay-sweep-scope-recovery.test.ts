import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCard,
  injectScript,
  pushShortsUrl,
  restoreMainFeedUrl,
  type InjectionResult,
} from './harness';

const VIDEO_ID = 'SweepScope1';
const SRC = `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`;

let injection: InjectionResult | undefined;

afterEach(() => {
  injection?.cleanup();
  injection = undefined;
  restoreMainFeedUrl();
});

describe('Shorts mode-transition overlay ownership', () => {
  it('does not sweep a main-feed reveal when entering Shorts', () => {
    const { video } = buildCard('ytm-rich-item-renderer', VIDEO_ID);
    injection = injectScript();
    injection.probe.applyBlur(video, SRC, 'porn', 40, VIDEO_ID, 'classifier_positive');
    const reveal = document.querySelector('.mw-reveal-overlay');
    expect(reveal).not.toBeNull();

    pushShortsUrl('ActiveShort1');
    injection.probe.sweepOrphanedModeOverlays('test_enter_shorts');

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(reveal?.isConnected).toBe(true);
  });

  it('preserves a non-Shorts portal reveal when leaving Shorts', () => {
    injection = injectScript();
    const portal = document.createElement('div');
    portal.id = 'mw-reveal-portal';
    const reveal = document.createElement('div');
    reveal.className = 'mw-reveal-overlay';
    reveal.dataset.mwPortalMode = 'non_shorts';
    portal.appendChild(reveal);
    document.documentElement.appendChild(portal);

    injection.probe.sweepOrphanedModeOverlays('test_leave_shorts');

    expect(reveal.isConnected).toBe(true);
  });
});
