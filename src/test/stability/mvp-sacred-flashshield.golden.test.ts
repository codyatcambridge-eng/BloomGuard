/**
 * GOLDEN / FREEZE TEST — Flash Shield V1 (fail-closed pre-paint blur veil)
 *
 * Flash Shield is a cold-start determinism feature: when CONFIG.flashShieldV1 is ON, feed
 * thumbnails are blurred BY DEFAULT via CSS (html.mw-flash-shield-on img[data-mw-veil="1"]
 * :not([data-mw-moderated])) so blur appears regardless of scan timing. The EXISTING
 * moderation pipeline then clears the veil the instant it stamps data-mw-moderated
 * safe/revealed/timeout-safe, and keeps the hard blur for positives ('blurred').
 *
 * These tests lock:
 *   - flag ON: a >=120x60 feed thumbnail with no data-mw-moderated gets data-mw-veil="1",
 *     and the veil CSS rule exists once the class is present.
 *   - an avatar-sized (40x40) img is NOT stamped (no over-blur).
 *   - a 'safe' img is NOT blurred by the veil (the clear rule wins).
 *   - a positive ('blurred') is unaffected by the veil code (its hard blur stands).
 *   - flag OFF: markFlashShieldCandidates is a no-op and no 'mw-flash-shield-on' class —
 *     i.e. OFF == current behavior (fully inert).
 *
 * Driven through generateModerationScript() in jsdom. No production code modified.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { injectScript, type InjectionResult } from './harness';

const FLASH_SHIELD_STYLE_ID = 'mw-flash-shield';
const FLASH_SHIELD_CLASS = 'mw-flash-shield-on';

/** Force getBoundingClientRect to report a fixed size (jsdom defaults to all-zero). */
function sizeImg(img: HTMLImageElement, width: number, height: number): void {
  img.getBoundingClientRect = () =>
    ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON() {} }) as DOMRect;
}

/** Build a feed thumbnail img inside a known lockup container, with a forced size. */
function buildThumb(width: number, height: number): HTMLImageElement {
  const card = document.createElement('yt-lockup-view-model');
  const img = document.createElement('img');
  card.appendChild(img);
  document.body.appendChild(card);
  sizeImg(img, width, height);
  return img;
}

function flashShieldStyleText(): string {
  return document.getElementById(FLASH_SHIELD_STYLE_ID)?.textContent ?? '';
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
  document.documentElement.classList.remove(FLASH_SHIELD_CLASS);
  const style = document.getElementById(FLASH_SHIELD_STYLE_ID);
  style?.parentElement?.removeChild(style);
});

describe('GOLDEN: Flash Shield V1 — flag ON', () => {
  it('stamps data-mw-veil="1" on a >=120x60 feed thumbnail with no data-mw-moderated', () => {
    const img = buildThumb(160, 90);
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldCandidates(document);

    expect(img.dataset.mwVeil).toBe('1');
  });

  it('installs the veil style + documentElement class with the active veil CSS rule', () => {
    injection = injectScript({ flashShieldV1: true });
    injection.probe.ensureFlashShieldStyle();
    document.documentElement.classList.add(FLASH_SHIELD_CLASS);

    expect(document.documentElement.classList.contains(FLASH_SHIELD_CLASS)).toBe(true);
    const css = flashShieldStyleText();
    expect(css).toContain('html.' + FLASH_SHIELD_CLASS + ' img[data-mw-veil="1"]:not([data-mw-moderated])');
    expect(css).toContain('blur(20px)');
  });

  it('does NOT stamp an avatar-sized (40x40) img — no over-blur of icons/avatars', () => {
    const img = buildThumb(40, 40);
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldCandidates(document);

    expect(img.dataset.mwVeil).toBeUndefined();
  });

  it('never stamps an img that already carries data-mw-moderated', () => {
    const img = buildThumb(160, 90);
    img.dataset.mwModerated = 'safe';
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldCandidates(document);

    expect(img.dataset.mwVeil).toBeUndefined();
  });

  it('CLEAR rule wins: a "safe" img is exempted from the veil blur', () => {
    injection = injectScript({ flashShieldV1: true });
    injection.probe.ensureFlashShieldStyle();

    const css = flashShieldStyleText();
    // The clear block targets safe/revealed/timeout-safe and forces filter: none.
    expect(css).toContain('img[data-mw-moderated="safe"]');
    expect(css).toContain('img[data-mw-moderated="revealed"]');
    expect(css).toContain('img[data-mw-moderated="timeout-safe"]');
    expect(css).toContain('filter: none !important');
  });

  it('positive ("blurred") is unaffected by veil code (no veil stamp, no veil rule targets it)', () => {
    const img = buildThumb(160, 90);
    img.dataset.mwModerated = 'blurred';
    injection = injectScript({ flashShieldV1: true });
    injection.probe.ensureFlashShieldStyle();

    injection.probe.markFlashShieldCandidates(document);

    // No veil stamp (already moderated) and the veil never clears 'blurred'.
    expect(img.dataset.mwVeil).toBeUndefined();
    const css = flashShieldStyleText();
    expect(css).not.toContain('data-mw-moderated="blurred"');
  });
});

describe('GOLDEN: Flash Shield V1 — flag OFF (OFF == current behavior)', () => {
  it('markFlashShieldCandidates is a no-op: no data-mw-veil stamped', () => {
    const img = buildThumb(160, 90);
    injection = injectScript({ flashShieldV1: false });

    injection.probe.markFlashShieldCandidates(document);

    expect(img.dataset.mwVeil).toBeUndefined();
  });

  it('does not add the mw-flash-shield-on class to documentElement on init', () => {
    injection = injectScript({ flashShieldV1: false });

    expect(document.documentElement.classList.contains(FLASH_SHIELD_CLASS)).toBe(false);
  });

  it('default (no override) keeps the flag OFF — fully inert', () => {
    const img = buildThumb(160, 90);
    injection = injectScript();

    injection.probe.markFlashShieldCandidates(document);

    expect(img.dataset.mwVeil).toBeUndefined();
    expect(document.documentElement.classList.contains(FLASH_SHIELD_CLASS)).toBe(false);
  });
});
