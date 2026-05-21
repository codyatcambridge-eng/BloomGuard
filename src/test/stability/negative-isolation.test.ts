/**
 * T4: Negative Isolation
 *
 * Verifies that negatives never inherit blur from the authorization layer.
 * Two scenarios:
 *
 *  4a. Fresh negative (never classified positive) — no blur is applied.
 *  4b. Recycled slot (previously positive card, new negative video loads) —
 *      stale blur is cleared or denied before it can persist.
 *
 * Assertions:
 *  - data-mw-moderated must not be 'blurred' after diagNonShortsReattach
 *  - MW-MVP-AUTHZ-BLUR-ALLOW must not appear in logs
 *  - MW-MVP-AUTHZ-BLUR-DENY must appear when authorization is attempted
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
const NEGATIVE_ID = 'jNQXAC9IVRw';

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
});

describe('T4: Negative Isolation', () => {

  describe('4a: Fresh negative card — never classified positive', () => {
    it('diagNonShortsReattach does not blur a video with no blur state', () => {
      const { video } = buildCard('ytm-rich-item-renderer', NEGATIVE_ID);
      // No stampPositiveBlur — video is fresh/clean

      injection = injectScript();

      injection.probe.diagNonShortsReattach(video, 'attr:src');

      expect(video.dataset.mwModerated).not.toBe('blurred');
      expect(video.dataset.mwHardBlur).not.toBe('1');
    });

    it('isMvpBlurAuthorized denies with no_ownership_no_proof for clean negative', () => {
      const { card, video } = buildCard('ytm-rich-item-renderer', NEGATIVE_ID);

      injection = injectScript();

      const src = `https://i.ytimg.com/vi/${NEGATIVE_ID}/hqdefault.jpg`;
      const result = injection.probe.isMvpBlurAuthorized(
        video,
        src,
        NEGATIVE_ID,
        'none',       // No proof
        'test_caller',
      );

      expect(result).toBe(false);

      const combined = injection.logs.join('\n');
      expect(combined).toMatch(/MW-MVP-AUTHZ-BLUR-DENY/);
      expect(combined).not.toMatch(/MW-MVP-AUTHZ-BLUR-ALLOW/);

      void card;
    });

    it('isMvpBlurAuthorized denies card_blurred proof when keys mismatch', () => {
      // Scenario: stale card_blurred proof for POSITIVE_ID used on a card pointing to NEGATIVE_ID
      const { card, video } = buildCard('ytm-rich-item-renderer', NEGATIVE_ID);

      injection = injectScript();

      const staleSrc = `https://i.ytimg.com/vi/${POSITIVE_ID}/hqdefault.jpg`;
      const result = injection.probe.isMvpBlurAuthorized(
        video,
        staleSrc,
        POSITIVE_ID,    // stale itemKey
        'card_blurred', // proof from old positive
        'test_caller',
      );

      // card href points to NEGATIVE_ID; itemKey is POSITIVE_ID → mismatch → deny
      expect(result).toBe(false);

      const combined = injection.logs.join('\n');
      expect(combined).toMatch(/MW-MVP-AUTHZ-BLUR-DENY/);
      expect(combined).toMatch(/item_href_mismatch|card_blurred_key_mismatch/);

      void card;
    });
  });

  describe('4b: Recycled slot — positive card replaced by negative', () => {
    it('stale blur on recycled video node does not persist after diagNonShortsReattach', () => {
      // Build a card that now points to NEGATIVE_ID (YouTube updated the href)
      // but the video node still has stale POSITIVE_ID blur attributes
      const { card, video } = buildCard('ytm-rich-item-renderer', NEGATIVE_ID);

      // Stamp stale blur from the previous positive occupant
      stampPositiveBlur(video, POSITIVE_ID);

      // Update video src to negative (the src update happened, but we test the reattach outcome)
      video.src = `https://i.ytimg.com/vi/${NEGATIVE_ID}/hqdefault.jpg`;
      video.poster = `https://i.ytimg.com/vi/${NEGATIVE_ID}/hqdefault.jpg`;

      injection = injectScript();

      clearReattachCooldown(video);
      injection.probe.diagNonShortsReattach(video, 'attr:src');

      // Either blur must be cleared (safe) or authorization must have denied
      const wasDenied = injection.logs.join('\n').includes('MW-MVP-AUTHZ-BLUR-DENY');
      const wasAllowed = injection.logs.join('\n').includes('MW-MVP-AUTHZ-BLUR-ALLOW');

      // The system must not grant authorization to the negative
      expect(wasAllowed).toBe(false);

      // If authorization was denied or blur was cleared, the slot is safe.
      const isSafe = wasDenied || video.dataset.mwModerated !== 'blurred';
      expect(
        isSafe,
        `Recycled slot still blurred after reattach. ` +
        `mwModerated=${video.dataset.mwModerated}, allow=${wasAllowed}, deny=${wasDenied}`,
      ).toBe(true);

      void card;
    });

    it('card with correct NEGATIVE href denies classifier_positive proof for POSITIVE src', () => {
      // Even if the classifier tried to apply blur with POSITIVE_ID src to a NEGATIVE card:
      const { card, video } = buildCard('ytm-rich-item-renderer', NEGATIVE_ID);

      injection = injectScript();

      const staleSrc = `https://i.ytimg.com/vi/${POSITIVE_ID}/hqdefault.jpg`;
      const result = injection.probe.isMvpBlurAuthorized(
        video,
        staleSrc,
        POSITIVE_ID,         // itemKey from stale src
        'classifier_positive',
        'test_caller',
      );

      // href says NEGATIVE_ID, itemKey is POSITIVE_ID → DENY
      expect(result).toBe(false);

      const combined = injection.logs.join('\n');
      expect(combined).toMatch(/MW-MVP-AUTHZ-BLUR-DENY/);
      expect(combined).toMatch(/item_href_mismatch/);

      void card;
    });

    it('streaming URL src is denied regardless of proof', () => {
      const { card, video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
      stampPositiveBlur(video, POSITIVE_ID);

      injection = injectScript();

      const streamingSrc = 'https://rr1---sn-ab5l6ne7.googlevideo.com/videoplayback?v=SOME_TOKEN';
      const result = injection.probe.isMvpBlurAuthorized(
        video,
        streamingSrc,
        POSITIVE_ID,
        'card_blurred',
        'test_caller',
      );

      expect(result).toBe(false);
      expect(injection.logs.join('\n')).toMatch(/streaming_url|card_blurred_streaming_src/);

      void card;
    });

    it('no reveal overlay is created on negative card', () => {
      const { video } = buildCard('ytm-rich-item-renderer', NEGATIVE_ID);

      injection = injectScript();

      injection.probe.diagNonShortsReattach(video, 'attr:src');

      // No overlay should exist inside the card
      const overlay = document.querySelector('.mw-reveal-overlay');
      expect(overlay).toBeNull();
    });
  });
});
