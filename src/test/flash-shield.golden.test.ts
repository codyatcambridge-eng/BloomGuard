import { afterEach, describe, expect, it } from 'vitest';
import {
  generateFlashShieldBootstrap,
  generateModerationScript,
} from '@/lib/webview-injection-script';

afterEach(() => {
  const api = (window as Record<string, unknown>).__MW_FLASH_BOOTSTRAP__ as
    | { disconnect?: () => void }
    | undefined;
  api?.disconnect?.();
  delete (window as Record<string, unknown>).__MW_FLASH_BOOTSTRAP__;
  document.documentElement.className = '';
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('GOLDEN: Flash Shield V1', () => {
  it('document-start bootstrap stamps feed media and active Shorts media', () => {
    window.history.replaceState({}, '', '/shorts/flash-test');
    document.body.innerHTML = `
      <ytm-rich-item-renderer>
        <img id="feed-image" src="https://i.ytimg.com/vi/feed/hqdefault.jpg">
      </ytm-rich-item-renderer>
      <div id="shorts-player">
        <ytm-reel-video-renderer aria-hidden="false">
          <video id="active-short"></video>
        </ytm-reel-video-renderer>
      </div>
    `;

    new Function(generateFlashShieldBootstrap(true))();

    expect(document.documentElement.classList.contains('mw-flash-shield-on')).toBe(true);
    expect(document.querySelector('#feed-image')?.getAttribute('data-mw-veil')).toBe('1');
    expect(document.querySelector('#active-short')?.getAttribute('data-mw-veil')).toBe('1');
    expect(
      document.querySelector('ytm-reel-video-renderer')?.getAttribute('data-mw-flash-frame'),
    ).toBe('1');
    expect(document.querySelector('.mw-flash-shorts-overlay')).not.toBeNull();
  });

  it('stamps an iOS Shorts player before active wrapper attributes settle', () => {
    window.history.replaceState({}, '', '/shorts/ios-swap');
    document.body.innerHTML = `
      <div id="shorts-player">
        <ytm-reel-video-renderer>
          <div class="html5-video-container">
            <video id="ios-active-short"></video>
          </div>
        </ytm-reel-video-renderer>
      </div>
    `;

    new Function(generateFlashShieldBootstrap(true))();

    expect(document.querySelector('#ios-active-short')?.getAttribute('data-mw-veil')).toBe('1');
    expect(
      document.querySelector('ytm-reel-video-renderer')?.getAttribute('data-mw-flash-frame'),
    ).toBe('1');
    expect(document.querySelector('#mw-flash-shield')?.textContent).toContain(
      '.mw-flash-shorts-overlay',
    );
    expect(document.querySelector('#mw-flash-shield')?.textContent).not.toContain('::after');
  });

  it('resets stale safe state when YouTube reuses the active Shorts video', () => {
    window.history.replaceState({}, '', '/shorts/first-item');
    document.body.innerHTML = `
      <div id="shorts-player">
        <ytm-reel-video-renderer is-active data-video-id="first-item">
          <video id="reused-short" src="blob:first-item" data-mw-moderated="safe"></video>
        </ytm-reel-video-renderer>
      </div>
    `;
    new Function(generateFlashShieldBootstrap(true))();

    const frame = document.querySelector('ytm-reel-video-renderer') as HTMLElement;
    const video = document.querySelector('#reused-short') as HTMLElement;
    const firstIdentity = frame.dataset.mwFlashIdentity;

    window.history.replaceState({}, '', '/shorts/second-item');
    frame.dataset.videoId = 'second-item';
    video.setAttribute('src', 'blob:second-item');
    const api = (window as Record<string, unknown>).__MW_FLASH_BOOTSTRAP__ as {
      setEnabled: (enabled: boolean) => void;
    };
    api.setEnabled(true);

    expect(frame.dataset.mwFlashIdentity).not.toBe(firstIdentity);
    expect(video.getAttribute('data-mw-moderated')).toBeNull();
    expect(video.getAttribute('data-mw-veil')).toBe('1');
    expect(frame.querySelector('.mw-flash-shorts-overlay')).not.toBeNull();
  });

  it('live disable removes veil and frame markers', () => {
    window.history.replaceState({}, '', '/shorts/live-disable');
    document.body.innerHTML = `
      <div id="shorts-player">
        <ytm-reel-video-renderer is-active>
          <video id="active-short"></video>
        </ytm-reel-video-renderer>
      </div>
    `;
    new Function(generateFlashShieldBootstrap(true))();

    const api = (window as Record<string, unknown>).__MW_FLASH_BOOTSTRAP__ as {
      setEnabled: (enabled: boolean) => void;
    };
    api.setEnabled(false);

    expect(document.documentElement.classList.contains('mw-flash-shield-on')).toBe(false);
    expect(document.querySelector('[data-mw-veil="1"]')).toBeNull();
    expect(document.querySelector('[data-mw-flash-frame="1"]')).toBeNull();
    expect(document.querySelector('.mw-flash-shorts-overlay')).toBeNull();
  });

  it('keeps scanning enabled while the main blur dial remains disabled', () => {
    const script = generateModerationScript({
      sensitivity: 0,
      blurStrength: 24,
      enabled: false,
      scanEnabled: true,
      flashShieldV1: true,
      nonce: 'flash_test_nonce',
    });

    expect(script).toContain('enabled: false');
    expect(script).toContain('scanEnabled: true');
    expect(script).toContain('flashShieldV1: true');
    expect(script).toContain('[0, 16, 50, 120, 180]');
    expect(script).toContain('mw-flash-shorts-overlay');
  });
});
