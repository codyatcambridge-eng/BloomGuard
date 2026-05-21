/**
 * T3: Positive Continuity
 *
 * Verifies that a blurred positive card stays blurred through repeated
 * hover / style-mutation cycles. Two code paths are tested:
 *
 * Path A — Already-blurred maintenance (primary hover path):
 *   activeVideoBlurred=true → blur_reapplied branch (line 4346)
 *   applyBlur is NOT called — the element is trusted as-is.
 *   Signals: blur_reapplied in logs, mwModerated=blurred, filter intact.
 *
 * Path B — Lost-blur healing (card_blurred continuity):
 *   YouTube strips blur → activeVideoBlurred=false → contextData found →
 *   applyBlur called with card_blurred proof → isMvpBlurAuthorized allows.
 *   Signals: heal_apply_blur + MW-MVP-AUTHZ-BLUR-ALLOW + card_blurred_continuity.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  buildCard,
  stampPositiveBlur,
  clearReattachCooldown,
  injectScript,
  type InjectionResult,
} from './harness';

const POSITIVE_ID = 'dQw4w9WgXcQ';

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
});

describe('T3: Positive Continuity', () => {

  /**
   * The deny checker used in Path A tests.
   * After blur_reapplied, the overlay-heal subsystem calls createRevealOverlay →
   * isMvpBlurAuthorized with proof=none. Without ownership stamped in the test
   * environment, this always produces a deny from createRevealOverlay — not from
   * the blur maintenance path itself. We only care that the blur maintenance path
   * never generates a deny, so we filter out createRevealOverlay lines.
   */
  function blurMaintenanceDenies(logs: string[]): string[] {
    return logs.filter(
      l => l.includes('MW-MVP-AUTHZ-BLUR-DENY') && !l.includes('createRevealOverlay'),
    );
  }

  describe('Path A: already-blurred maintenance (primary hover path)', () => {
    it('diagNonShortsReattach logs blur_reapplied when video is already blurred', () => {
      const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
      stampPositiveBlur(video, POSITIVE_ID);

      injection = injectScript();

      clearReattachCooldown(video);
      injection.logs.length = 0;
      injection.probe.diagNonShortsReattach(video, 'attr:style');

      const combined = injection.logs.join('\n');
      // Maintenance path logs blur_reapplied — not heal_apply_blur
      expect(combined).toMatch(/blur_reapplied/);
      // No denial from blur maintenance path (overlay-management denies are filtered)
      expect(blurMaintenanceDenies(injection.logs)).toHaveLength(0);
      // Element stays blurred
      expect(video.dataset.mwModerated).toBe('blurred');
    });

    it('blur survives 20 consecutive hover/style mutation cycles', () => {
      const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
      stampPositiveBlur(video, POSITIVE_ID);

      injection = injectScript();

      for (let cycle = 0; cycle < 20; cycle++) {
        clearReattachCooldown(video);
        injection.logs.length = 0;

        injection.probe.diagNonShortsReattach(video, 'attr:style');

        const combined = injection.logs.join('\n');
        expect(combined).toMatch(/blur_reapplied/);
        expect(blurMaintenanceDenies(injection.logs)).toHaveLength(0);
        expect(video.dataset.mwModerated).toBe('blurred');
      }
    });

    it('authoritativeBlur (data-mw-hard-blur=1) is maintained after hover cycle', () => {
      const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
      stampPositiveBlur(video, POSITIVE_ID);

      injection = injectScript();

      clearReattachCooldown(video);
      injection.probe.diagNonShortsReattach(video, 'attr:style');

      expect(video.dataset.mwHardBlur).toBe('1');
      expect(video.style.filter).toMatch(/blur\(40px\)/i);
    });

    it('no denial from blur maintenance path appears in any of 20 hover cycles', () => {
      const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
      stampPositiveBlur(video, POSITIVE_ID);

      injection = injectScript();

      for (let cycle = 0; cycle < 20; cycle++) {
        clearReattachCooldown(video);
        injection.probe.diagNonShortsReattach(video, 'attr:style');
      }

      // After 20 cycles, blur maintenance path must never have denied.
      // (createRevealOverlay denies are expected in test env without ownership stamps.)
      expect(blurMaintenanceDenies(injection.logs)).toHaveLength(0);
    });
  });

  /**
   * Build the healing fixture: card contains a context-sentinel element that still
   * carries the blur record (simulating the old thumbnail node left by YouTube's
   * vDOM), while the video element itself has no blur signals at all.
   *
   * This models the real scenario: YouTube re-creates the video element via
   * virtual DOM reconciliation (new element, no data attributes), but the
   * blurred thumbnail element from the previous render cycle remains in the card.
   * diagNonShortsReattach finds no blur on the video → activeVideoBlurred=false,
   * but finds card_blurred context from the sentinel → heal_apply_blur fires.
   */
  function buildHealingFixture(videoId: string) {
    const { card, video } = buildCard('ytm-rich-item-renderer', videoId);
    const src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    const sentinel = document.createElement('div');
    sentinel.dataset.mwModerated = 'blurred';
    sentinel.dataset.mwSrc = src;
    sentinel.dataset.mwHardBlur = '1';
    sentinel.dataset.mwHardBlurItemKey = videoId;
    sentinel.dataset.mwHardBlurSrc = src;
    sentinel.dataset.mwCategory = 'porn';
    sentinel.dataset.mwBlurStrength = '40';
    sentinel.dataset.mwItemId = videoId;
    card.appendChild(sentinel);

    return { card, video, sentinel };
  }

  describe('Path B: lost-blur healing via card_blurred context', () => {
    it('card_blurred continuity restores blur when YouTube strips authoritative state', () => {
      // video is fresh (no blur); sentinel inside card provides card_blurred context
      const { video } = buildHealingFixture(POSITIVE_ID);

      injection = injectScript();

      clearReattachCooldown(video);
      injection.logs.length = 0;
      injection.probe.diagNonShortsReattach(video, 'attr:style');

      const combined = injection.logs.join('\n');
      // Healing path must fire
      expect(combined).toMatch(/heal_apply_blur/);
    });

    it('card_blurred_continuity proof is passed to isMvpBlurAuthorized on restore', () => {
      const { video } = buildHealingFixture(POSITIVE_ID);

      injection = injectScript();

      clearReattachCooldown(video);
      injection.logs.length = 0;
      injection.probe.diagNonShortsReattach(video, 'attr:style');

      const combined = injection.logs.join('\n');
      expect(combined).toMatch(/card_blurred_continuity/);
      expect(combined).toMatch(/MW-MVP-AUTHZ-BLUR-ALLOW/);
      // No deny from the blur authorization path; overlay-management denies are filtered
      expect(blurMaintenanceDenies(injection.logs)).toHaveLength(0);
    });

    it('authorization returns true when called directly with card_blurred proof', () => {
      const { card, video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
      stampPositiveBlur(video, POSITIVE_ID);

      injection = injectScript();

      const src = `https://i.ytimg.com/vi/${POSITIVE_ID}/hqdefault.jpg`;
      const result = injection.probe.isMvpBlurAuthorized(
        video,
        src,
        POSITIVE_ID,
        'card_blurred',
        'test_caller',
      );

      expect(result).toBe(true);
      expect(injection.logs.join('\n')).toMatch(/MW-MVP-AUTHZ-BLUR-ALLOW/);
      expect(injection.logs.join('\n')).toMatch(/card_blurred_continuity/);

      void card;
    });
  });

  describe('Key extraction consistency', () => {
    it('getMvpCardHrefItemKey via probe returns same ID as replicated extractHrefItemKey', () => {
      const { card } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
      injection = injectScript();

      const key = injection.probe.getMvpCardHrefItemKey(card);
      expect(key).toBe(POSITIVE_ID);
    });
  });
});
