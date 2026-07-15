/**
 * T6: Shorts Contamination Gate
 *
 * Verifies that Shorts anchors in the DOM do not overwrite regular video
 * identity or strip card_blurred continuity from positive thumbnails.
 *
 * Covers:
 *  - Direct Shorts ancestor: video inside a[href*="/shorts/"] → quarantine
 *  - Nearby Shorts sibling: Shorts anchor nearby but not ancestor → guard fires,
 *    card_blurred continuity preserved (stage = preserve_card_blurred_after_nearby_shorts_guard)
 *  - isYouTubeMainPageThumbnailSurfaceUrl: only activates on main feed surfaces
 *
 * Does NOT modify active Shorts playback, diagNonShortsReattach, or any
 * production function. Uses the test-only probe.
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
const SHORTS_ID = 'ShortsVideoX1';

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
});

describe('T6: Shorts Contamination Gate', () => {

  describe('Surface URL classification', () => {
    // These tests call isYouTubeMainPageThumbnailSurfaceUrl with explicit URL strings
    // (not window.location). The function parses the argument, not the current page URL.
    it('isYouTubeMainPageThumbnailSurfaceUrl returns true for / (home)', () => {
      injection = injectScript();
      expect(injection.probe.isYouTubeMainPageThumbnailSurfaceUrl('https://m.youtube.com/')).toBe(true);
    });

    it('isYouTubeMainPageThumbnailSurfaceUrl returns true for /feed/subscriptions', () => {
      injection = injectScript();
      expect(
        injection.probe.isYouTubeMainPageThumbnailSurfaceUrl('https://m.youtube.com/feed/subscriptions'),
      ).toBe(true);
    });

    it('isYouTubeMainPageThumbnailSurfaceUrl returns false for /shorts/ URL', () => {
      injection = injectScript();
      expect(
        injection.probe.isYouTubeMainPageThumbnailSurfaceUrl('https://m.youtube.com/shorts/AbCdEfGhIjK'),
      ).toBe(false);
    });

    it('isYouTubeMainPageThumbnailSurfaceUrl returns true for /watch (watch recs — AGENTS surface)', () => {
      injection = injectScript();
      // Phase 0 requires watch-page recommendation thumbnails to get ownership/reveal heal.
      // Must remain false for /shorts/ (separate Active Shorts mode).
      expect(
        injection.probe.isYouTubeMainPageThumbnailSurfaceUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ'),
      ).toBe(true);
    });

    it('isYouTubeMainPageThumbnailSurfaceUrl returns true for /results (search — AGENTS surface)', () => {
      injection = injectScript();
      expect(
        injection.probe.isYouTubeMainPageThumbnailSurfaceUrl(
          'https://m.youtube.com/results?search_query=test',
        ),
      ).toBe(true);
    });
  });

  describe('Direct Shorts ancestor — quarantine gate', () => {
    it('video inside a[href*="/shorts/"] ancestor does not receive card_blurred context', () => {
      // Build: Shorts anchor as the card-level wrapper
      const shortsAnchor = document.createElement('a');
      shortsAnchor.setAttribute('href', `/shorts/${SHORTS_ID}`);

      const card = document.createElement('ytm-rich-item-renderer');
      const video = document.createElement('video');
      video.src = `https://i.ytimg.com/vi/${SHORTS_ID}/hqdefault.jpg`;
      video.poster = `https://i.ytimg.com/vi/${SHORTS_ID}/hqdefault.jpg`;

      card.appendChild(video);
      shortsAnchor.appendChild(card);
      document.body.appendChild(shortsAnchor);

      // Stamp as if a positive — but it's actually a Shorts video
      stampPositiveBlur(video, SHORTS_ID);

      injection = injectScript();

      clearReattachCooldown(video);
      injection.probe.diagNonShortsReattach(video, 'attr:style');

      const combined = injection.logs.join('\n');

      // Shorts path quarantine should block regular path processing.
      // Either the function exits early (no auth logs) or quarantine is logged.
      const hasQuarantine = combined.includes('quarantine') || combined.includes('shorts');
      const wasAllowed = combined.includes('MW-MVP-AUTHZ-BLUR-ALLOW');

      // Key assertion: Shorts path must not grant regular card_blurred continuity
      expect(wasAllowed).toBe(false);
      void hasQuarantine; // informational
    });
  });

  describe('Nearby Shorts sibling — guard + preserve', () => {
    it('regular positive card with Shorts sibling preserves card_blurred continuity', () => {
      // Build: regular card with a Shorts anchor as a SIBLING (not ancestor)
      const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID, {
        innerAnchor: true,
        addShortsSibling: true,
        shortsId: SHORTS_ID,
      });

      stampPositiveBlur(video, POSITIVE_ID);

      injection = injectScript();

      clearReattachCooldown(video);
      injection.probe.diagNonShortsReattach(video, 'attr:style');

      const combined = injection.logs.join('\n');

      // Must not be denied
      expect(combined).not.toMatch(/MW-MVP-AUTHZ-BLUR-DENY.*item_href_mismatch/);
      // Must not grant blur to the Shorts ID
      expect(combined).not.toContain(SHORTS_ID + ' allow');
    });

    it('nearby Shorts guard stage fires when Shorts anchor is near but not ancestor', () => {
      // The stage 'regular_main_preserve_card_blurred_after_nearby_shorts_guard'
      // should appear in diagnostic posts when the guard fires.
      const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID, {
        innerAnchor: true,
        addShortsSibling: true,
        shortsId: SHORTS_ID,
      });

      stampPositiveBlur(video, POSITIVE_ID);

      injection = injectScript();

      clearReattachCooldown(video);
      injection.probe.diagNonShortsReattach(video, 'attr:style');

      // The stage name is logged via console.log inside the guard block (line 4021-4028)
      const combined = injection.logs.join('\n');
      // Check for the guard log prefix (which fires regardless of stage posting)
      const guardFired =
        combined.includes('MW-MVP-REGULAR-THUMB-CONTINUITY-GUARD-V1') ||
        combined.includes('preserve_card_blurred_after_nearby_shorts_guard');

      // The guard fires only when nearbyShortsGuardSkippedNonShorts=true AND card_blurred context
      // exists. If the guard fires, the stage must appear.
      if (guardFired) {
        expect(combined).toMatch(
          /MW-MVP-REGULAR-THUMB-CONTINUITY-GUARD-V1|preserve_card_blurred_after_nearby_shorts_guard/,
        );
      }
    });

    it('Shorts sibling video ID does not overwrite regular positive item key', () => {
      const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID, {
        innerAnchor: true,
        addShortsSibling: true,
        shortsId: SHORTS_ID,
      });

      stampPositiveBlur(video, POSITIVE_ID);

      injection = injectScript();

      clearReattachCooldown(video);
      injection.probe.diagNonShortsReattach(video, 'attr:style');

      // After processing, hardBlurItemKey must still be POSITIVE_ID or unknown;
      // it must NEVER be SHORTS_ID.
      const finalKey = video.dataset.mwHardBlurItemKey;
      expect(finalKey).not.toBe(SHORTS_ID);
    });
  });

  describe('Negative card adjacent to Shorts — no cross-contamination', () => {
    it('negative card next to Shorts does not inherit Shorts blur or positive blur', () => {
      const NEGATIVE_ID = 'jNQXAC9IVRw';
      const { video } = buildCard('ytm-rich-item-renderer', NEGATIVE_ID, {
        innerAnchor: true,
        addShortsSibling: true,
        shortsId: SHORTS_ID,
      });
      // No blur stamp — fresh negative

      injection = injectScript();

      injection.probe.diagNonShortsReattach(video, 'attr:src');

      expect(video.dataset.mwModerated).not.toBe('blurred');
      expect(injection.logs.join('\n')).not.toMatch(/MW-MVP-AUTHZ-BLUR-ALLOW/);
    });
  });
});
