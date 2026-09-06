import { afterEach, describe, expect, it } from 'vitest';
import { buildCard, injectScript, type InjectionResult } from './harness';

const VIDEO_ID = 'RevealChurn1';
const SRC = `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`;

let injection: InjectionResult | undefined;

afterEach(() => {
  injection?.cleanup();
  injection = undefined;
});

describe('main-surface blur/reveal invariant during ordinary feed churn', () => {
  it('restores the reveal for an authoritative positive during a normal feed scan', () => {
    const { video } = buildCard('ytm-rich-item-renderer', VIDEO_ID);
    injection = injectScript();

    injection.probe.applyBlur(
      video,
      SRC,
      'porn',
      40,
      VIDEO_ID,
      'classifier_positive',
    );
    document.querySelectorAll('.mw-reveal-overlay, .mw-reveal-btn').forEach(node => node.remove());

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(document.querySelector('.mw-reveal-btn')).toBeNull();

    injection.probe.scanYouTubeThumbnails();

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(document.querySelectorAll('.mw-reveal-overlay')).toHaveLength(1);
    expect(document.querySelectorAll('.mw-reveal-btn')).toHaveLength(1);
  });
});
