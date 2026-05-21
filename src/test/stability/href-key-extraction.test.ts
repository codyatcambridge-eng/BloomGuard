/**
 * T2: Href Key Extraction
 *
 * Verifies getMvpCardHrefItemKey behavior against 25+ card configurations.
 * Tests the descendant-anchor path, ancestor-anchor path, and failure modes
 * that would occur if YouTube changes from /watch?v= URL format.
 *
 * No script injection — tests the replicated extractHrefItemKey function.
 * If this function diverges from production, behavioral tests (T3-T6) will
 * also catch it via the probe.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { extractHrefItemKey, CARD_SELECTOR_PARTS } from './harness';

const VID_A = 'dQw4w9WgXcQ'; // 11-char test video IDs
const VID_B = 'jNQXAC9IVRw';
const VID_C = 'oHg5SJYRHA0';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('T2: Href Key Extraction', () => {

  describe('descendant anchor path (primary)', () => {
    it('extracts ?v= from inner a[href="/watch?v=ID"]', () => {
      const card = document.createElement('ytm-rich-item-renderer');
      const a = document.createElement('a');
      a.setAttribute('href', `/watch?v=${VID_A}`);
      card.appendChild(a);
      document.body.appendChild(card);
      expect(extractHrefItemKey(card)).toBe(VID_A);
    });

    it('extracts from href with leading params (&v=)', () => {
      const card = document.createElement('ytm-rich-item-renderer');
      const a = document.createElement('a');
      a.setAttribute('href', `/watch?pp=abc&v=${VID_A}&feature=share`);
      card.appendChild(a);
      document.body.appendChild(card);
      expect(extractHrefItemKey(card)).toBe(VID_A);
    });

    it('extracts from absolute m.youtube.com URL', () => {
      const card = document.createElement('ytm-rich-item-renderer');
      const a = document.createElement('a');
      a.setAttribute('href', `https://m.youtube.com/watch?v=${VID_A}`);
      card.appendChild(a);
      document.body.appendChild(card);
      expect(extractHrefItemKey(card)).toBe(VID_A);
    });

    it('extracts from absolute www.youtube.com URL', () => {
      const card = document.createElement('ytm-rich-item-renderer');
      const a = document.createElement('a');
      a.setAttribute('href', `https://www.youtube.com/watch?v=${VID_B}`);
      card.appendChild(a);
      document.body.appendChild(card);
      expect(extractHrefItemKey(card)).toBe(VID_B);
    });

    it('extracts from deeply nested anchor', () => {
      const card = document.createElement('ytm-video-with-context-renderer');
      const wrapper = document.createElement('div');
      const thumb = document.createElement('div');
      const a = document.createElement('a');
      a.setAttribute('href', `/watch?v=${VID_C}`);
      thumb.appendChild(a);
      wrapper.appendChild(thumb);
      card.appendChild(wrapper);
      document.body.appendChild(card);
      expect(extractHrefItemKey(card)).toBe(VID_C);
    });
  });

  describe('ancestor anchor path (fallback)', () => {
    it('extracts from outer a[href] ancestor wrapping the card', () => {
      const outer = document.createElement('a');
      outer.setAttribute('href', `/watch?v=${VID_A}`);
      const card = document.createElement('ytm-rich-item-renderer');
      outer.appendChild(card);
      document.body.appendChild(outer);
      expect(extractHrefItemKey(card)).toBe(VID_A);
    });

    it('ancestor path used only when no descendant anchor exists', () => {
      // card has no inner anchor but is itself inside a watch link
      const outer = document.createElement('a');
      outer.setAttribute('href', `/watch?v=${VID_B}`);
      const card = document.createElement('ytd-compact-video-renderer');
      const video = document.createElement('video');
      card.appendChild(video);
      outer.appendChild(card);
      document.body.appendChild(outer);
      expect(extractHrefItemKey(card)).toBe(VID_B);
    });
  });

  describe('failure modes — YouTube URL format change detection', () => {
    it('[ALERT PROBE] path-based href /watch/ID without ?v= returns unknown', () => {
      // Risk H2: If YouTube migrates to path-based IDs, key extraction silently breaks.
      const card = document.createElement('ytm-rich-item-renderer');
      const a = document.createElement('a');
      a.setAttribute('href', `/watch/${VID_A}`);  // No ?v= param
      card.appendChild(a);
      document.body.appendChild(card);

      const key = extractHrefItemKey(card);
      expect(key).toBe('unknown'); // Proves the break point
      console.warn(
        `[STABILITY-T2-ALERT] Path-based /watch/${VID_A} href format returns 'unknown'. ` +
        `If YouTube switches to this format, ALL blur authorization fails.`,
      );
    });

    it('Shorts href (/shorts/ID) is not a watch link — returns unknown', () => {
      const card = document.createElement('ytm-rich-item-renderer');
      const a = document.createElement('a');
      a.setAttribute('href', `/shorts/${VID_A}`);
      card.appendChild(a);
      document.body.appendChild(card);
      // /shorts/ doesn't match a[href*="/watch"] so both paths miss it
      expect(extractHrefItemKey(card)).toBe('unknown');
    });

    it('no anchor in card returns unknown', () => {
      const card = document.createElement('ytm-rich-item-renderer');
      document.body.appendChild(card);
      expect(extractHrefItemKey(card)).toBe('unknown');
    });

    it('anchor with empty href returns unknown', () => {
      const card = document.createElement('ytm-rich-item-renderer');
      const a = document.createElement('a');
      a.setAttribute('href', '');
      card.appendChild(a);
      document.body.appendChild(card);
      expect(extractHrefItemKey(card)).toBe('unknown');
    });

    it('anchor with non-watch href returns unknown', () => {
      const card = document.createElement('ytm-rich-item-renderer');
      const a = document.createElement('a');
      a.setAttribute('href', '/channel/UCxxxxxx');
      card.appendChild(a);
      document.body.appendChild(card);
      expect(extractHrefItemKey(card)).toBe('unknown');
    });

    it('null card returns unknown', () => {
      expect(extractHrefItemKey(null as unknown as Element)).toBe('unknown');
    });
  });

  describe('25-sample matrix — all renderer × URL pattern combinations', () => {
    const RENDERERS: string[] = [
      'ytm-rich-item-renderer',
      'ytm-video-with-context-renderer',
      'ytm-compact-video-renderer',
      'ytd-rich-item-renderer',
      'ytd-video-renderer',
    ];

    const VIDEO_IDS = [
      'aAbBcCdDeEf',
      'AAAAAAAAAAA',
      '11111111111',
      'xYz123AbC89',
      'short_id123',
    ];

    it('all 25 renderer×videoId combos return the correct ID', () => {
      const results: { renderer: string; videoId: string; got: string; pass: boolean }[] = [];

      for (const renderer of RENDERERS) {
        for (const videoId of VIDEO_IDS) {
          const card = document.createElement(renderer);
          const a = document.createElement('a');
          a.setAttribute('href', `/watch?v=${videoId}`);
          card.appendChild(a);
          document.body.appendChild(card);

          const got = extractHrefItemKey(card);
          results.push({ renderer, videoId, got, pass: got === videoId });

          document.body.removeChild(card);
        }
      }

      expect(results.length).toBeGreaterThanOrEqual(25);

      const failures = results.filter(r => !r.pass);
      expect(
        failures,
        `Key extraction failed for: ${JSON.stringify(failures.map(f => `${f.renderer}/${f.videoId}→${f.got}`))}`,
      ).toHaveLength(0);
    });
  });

  describe('key uniqueness — different cards must not bleed IDs', () => {
    it('two adjacent cards return their own distinct video IDs', () => {
      const card1 = document.createElement('ytm-rich-item-renderer');
      const a1 = document.createElement('a');
      a1.setAttribute('href', `/watch?v=${VID_A}`);
      card1.appendChild(a1);

      const card2 = document.createElement('ytm-rich-item-renderer');
      const a2 = document.createElement('a');
      a2.setAttribute('href', `/watch?v=${VID_B}`);
      card2.appendChild(a2);

      document.body.appendChild(card1);
      document.body.appendChild(card2);

      expect(extractHrefItemKey(card1)).toBe(VID_A);
      expect(extractHrefItemKey(card2)).toBe(VID_B);
      expect(extractHrefItemKey(card1)).not.toBe(extractHrefItemKey(card2));
    });
  });
});
