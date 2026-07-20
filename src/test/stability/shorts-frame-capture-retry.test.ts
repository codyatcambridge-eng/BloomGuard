import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectScript, type InjectionResult } from './harness';

const SHORTS_ID = 'RetryShort001';

function buildActiveShortWithoutPoster(): HTMLVideoElement {
  const player = document.createElement('div');
  player.id = 'shorts-player';

  const frame = document.createElement('ytm-reel-video-renderer');
  frame.setAttribute('selected', '');
  frame.setAttribute('aria-hidden', 'false');
  frame.setAttribute('is-active', '');
  frame.setAttribute('data-video-id', SHORTS_ID);

  const video = document.createElement('video');
  video.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 360,
    bottom: 640,
    width: 360,
    height: 640,
    toJSON: () => ({}),
  } as DOMRect);

  frame.appendChild(video);
  player.appendChild(frame);
  document.body.appendChild(player);
  return video;
}

let injection: InjectionResult | undefined;

afterEach(() => {
  injection?.cleanup();
  injection = undefined;
  vi.useRealTimers();
  document.body.innerHTML = '';
  window.history.pushState({}, '', 'https://m.youtube.com/');
});

describe('Active Shorts frame-capture retry', () => {
  it('retries a not-ready active Shorts frame without creating an unbounded timer loop', () => {
    vi.useFakeTimers();
    window.history.pushState({}, '', `https://m.youtube.com/shorts/${SHORTS_ID}`);
    const video = buildActiveShortWithoutPoster();
    injection = injectScript();

    injection.probe.scanVideoPoster(video);

    expect(video.dataset.mwShortsFrameRetryCount).toBe('1');
    expect(injection.probe.getTimerSnapshot().shortsFrameRetryTimers).toBe(1);

    vi.advanceTimersByTime(80);

    expect(video.dataset.mwShortsFrameRetryCount).toBe('2');
    expect(injection.probe.getTimerSnapshot().shortsFrameRetryTimers).toBe(1);

    injection.probe.offModeCleanup('test_retry_cleanup');

    expect(injection.probe.getTimerSnapshot().shortsFrameRetryTimers).toBe(0);
  });
});
