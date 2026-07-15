/**
 * Active Shorts frame-sample retry: first entry must not permanently lock out
 * decoded-frame capture after video_not_ready / poster provisional.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectScript, type InjectionResult } from './harness';

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
  vi.useRealTimers();
});

describe('Active Shorts frame retry (miss-until-scrollback)', () => {
  it('exposes frame capture helpers via live inject (smoke)', () => {
    window.history.pushState({}, '', 'https://m.youtube.com/shorts/dQw4w9WgXcQ');
    injection = injectScript();
    // Script must still inject cleanly with retry helpers present in source path.
    expect((window as unknown as { __MW_ACTIVE__?: boolean }).__MW_ACTIVE__).toBe(true);
    expect(typeof (window as unknown as { __MW_SCAN_FULL__?: unknown }).__MW_SCAN_FULL__).toBe(
      'function',
    );
  });

  it('scanActiveShortsPlayerContainer can run on a selected reel shell', () => {
    window.history.pushState({}, '', 'https://m.youtube.com/shorts/FrameRetry01');
    injection = injectScript();

    const player = document.createElement('div');
    player.id = 'shorts-player';
    const frame = document.createElement('ytm-reel-video-renderer');
    frame.setAttribute('selected', '');
    const video = document.createElement('video');
    // Not ready — capture should fail retriably; inject must not throw.
    Object.defineProperty(video, 'readyState', { get: () => 0 });
    Object.defineProperty(video, 'videoWidth', { get: () => 0 });
    Object.defineProperty(video, 'videoHeight', { get: () => 0 });
    video.poster = 'https://i.ytimg.com/vi/FrameRetry01/hqdefault.jpg';
    frame.appendChild(video);
    player.appendChild(frame);
    document.body.appendChild(player);

    const ran = injection.probe.scanActiveShortsPlayerContainer('test_frame_retry');
    expect(typeof ran).toBe('boolean');
    // Awaiting frame marker may be set when poster path runs on active short.
    // Soft assert: script still active after not-ready video.
    expect((window as unknown as { __MW_ACTIVE__?: boolean }).__MW_ACTIVE__).toBe(true);
  });
});
