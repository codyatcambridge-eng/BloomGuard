import { afterEach, describe, expect, it } from 'vitest';
import { buildCard, injectScript, type InjectionResult } from './harness';

const VIDEO_ID = 'LiveRearm1';
const SRC = `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`;

let injection: InjectionResult | undefined;

afterEach(() => {
  injection?.cleanup();
  injection = undefined;
});

describe('live Main Dial OFF to ON recovery', () => {
  it('clears the Off latch and accepts new positive ownership without reinjection', () => {
    const { video } = buildCard('ytm-rich-item-renderer', VIDEO_ID);
    injection = injectScript();

    injection.probe.offModeCleanup('test_live_off');
    expect(injection.probe.isVisualModerationActive()).toBe(false);

    injection.probe.applySensitivityLevel(3, 'host_dial_test');
    expect(injection.probe.isVisualModerationActive()).toBe(true);

    injection.probe.applyBlur(video, SRC, 'porn', 40, VIDEO_ID, 'classifier_positive');
    expect(video.dataset.mwModerated).toBe('blurred');
    expect(document.querySelectorAll('.mw-reveal-overlay')).toHaveLength(1);
  });
});
