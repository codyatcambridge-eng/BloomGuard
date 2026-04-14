import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { generateModerationScript } from '@/lib/webview-injection-script';

function createShortsDom(url: string) {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><div id="shorts-player"></div></body></html>',
    {
      url,
      runScripts: 'dangerously',
      pretendToBeVisual: true,
    },
  );
  return dom;
}

describe('Shorts Safety Veil (hardening)', () => {
  it('applies on replaceState and lifts on host command at rAF boundary (no mid-tick gap)', () => {
    const dom = createShortsDom('https://m.youtube.com/shorts/old');
    const { window } = dom;

    const postedToHost: any[] = [];
    (window as any).mobileApp = {
      postMessage: (msg: any) => postedToHost.push(msg?.detail),
    };

    const rafCallbacks = new Map<number, FrameRequestCallback>();
    let rafId = 0;
    (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafId += 1;
      rafCallbacks.set(rafId, cb);
      return rafId;
    };
    (window as any).cancelAnimationFrame = (id: number) => {
      rafCallbacks.delete(id);
    };
    const flushRaf = () => {
      const pending = Array.from(rafCallbacks.entries());
      rafCallbacks.clear();
      pending.forEach(([id, cb]) => cb((window as any).performance?.now?.() ?? id));
    };

    const script = generateModerationScript({
      sensitivity: 2,
      blurStrength: 12,
      enabled: true,
      forcedBlur: false,
      debug: false,
      nonce: 'n_test_veil',
      pageEpoch: 1,
      blockingMode: 'mvp',
      diagYouTubeShorts: true,
      enableShortsHealthHeal: false,
    });

    window.eval(script);
    expect(postedToHost.some((m) => m && m.type === 'MW_INJECTED_ACK')).toBe(true);

    (window.history as any).replaceState({}, '', 'https://m.youtube.com/shorts/new');
    expect(window.document.getElementById('mw-shorts-safety-veil')).toBeTruthy();

    (window as any).__MW_HARD_TEARDOWN__('test_hard_teardown');
    expect(window.document.getElementById('mw-shorts-safety-veil')).toBeTruthy();

    window.dispatchEvent(new (window as any).MessageEvent('message', {
      data: { type: 'MW_BLUR_COMMAND', command: 'LIFT_SHORTS_VEIL', reason: 'test_lift' },
    }));
    expect(window.document.getElementById('mw-shorts-safety-veil')).toBeTruthy();

    flushRaf();
    expect(window.document.getElementById('mw-shorts-safety-veil')).toBeFalsy();
  });
});
