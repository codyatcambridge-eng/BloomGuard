/**
 * T1: Card Selector Coverage
 *
 * Verifies that every known YouTube renderer element type can be located by
 * the production selector so diagNonShortsReattach can establish card context.
 * No script injection required — pure DOM fixture tests.
 *
 * Failure modes documented:
 *  - "unknown renderer" test proves what breaks when YouTube adds a new type.
 *  - All known types must pass at 100%; 95% threshold noted but we assert 100%
 *    because partial failure is never acceptable in a safety system.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CARD_SELECTOR_PARTS,
  NON_SHORTS_REATTACH_CARD_SELECTOR,
  NON_SHORTS_REATTACH_STRONG_CARD_SELECTOR,
} from './harness';

/** Creates an element that matches the given CSS selector part */
function makeElementForSelectorPart(part: string): HTMLElement {
  if (part === '#content') {
    const el = document.createElement('div');
    el.id = 'content';
    return el;
  }
  return document.createElement(part);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('T1: Card Selector Coverage', () => {

  it('all known renderer types resolve via NON_SHORTS_REATTACH_CARD_SELECTOR', () => {
    const results: { tag: string; resolved: boolean }[] = [];

    for (const tag of CARD_SELECTOR_PARTS) {
      const card = makeElementForSelectorPart(tag);
      const video = document.createElement('video');
      card.appendChild(video);
      document.body.appendChild(card);

      const found = video.closest(NON_SHORTS_REATTACH_CARD_SELECTOR);
      results.push({ tag, resolved: !!found });

      document.body.removeChild(card);
    }

    const failures = results.filter(r => !r.resolved).map(r => r.tag);
    expect(
      failures,
      `Selector missed these renderer types (blur silently fails for them): ${failures.join(', ')}`,
    ).toHaveLength(0);
  });

  it('STRONG selector resolves all renderer types except #content', () => {
    const strongParts = CARD_SELECTOR_PARTS.filter(t => t !== '#content');

    for (const tag of strongParts) {
      const card = makeElementForSelectorPart(tag);
      const video = document.createElement('video');
      card.appendChild(video);
      document.body.appendChild(card);

      const found = video.closest(NON_SHORTS_REATTACH_STRONG_CARD_SELECTOR);
      expect(found, `STRONG selector missed: ${tag}`).not.toBeNull();

      document.body.removeChild(card);
    }
  });

  it('#content fallback resolves in CARD selector but not STRONG selector', () => {
    const content = document.createElement('div');
    content.id = 'content';
    const video = document.createElement('video');
    content.appendChild(video);
    document.body.appendChild(content);

    expect(video.closest(NON_SHORTS_REATTACH_CARD_SELECTOR)).toBe(content);
    expect(video.closest(NON_SHORTS_REATTACH_STRONG_CARD_SELECTOR)).toBeNull();
  });

  it('[ALERT PROBE] unknown renderer type returns null — simulates YouTube adding new card type', () => {
    // This test documents the exact failure mode from risk H1.
    // If YouTube ships a new renderer and it appears here, the test passes
    // (good — it proves the new type IS detected). When this test starts failing
    // (resolved !== null), it means the production selector was updated correctly.
    const UNKNOWN = 'yt-experimental-video-renderer-v2';
    const card = document.createElement(UNKNOWN);
    const video = document.createElement('video');
    card.appendChild(video);
    document.body.appendChild(card);

    const resolved = video.closest(NON_SHORTS_REATTACH_CARD_SELECTOR);

    // Assertion: null proves the gap exists (expected failure mode).
    expect(resolved).toBeNull();
    // If this line is reached, the gap exists. No production code was changed.
    console.warn(
      `[STABILITY-T1-ALERT] Renderer "${UNKNOWN}" is not in NON_SHORTS_REATTACH_CARD_SELECTOR. ` +
      `Blur would silently fail on cards of this type.`,
    );
  });

  it('deeply nested video still resolves card through multiple wrapper divs', () => {
    const card = document.createElement('ytm-rich-item-renderer');
    const wrapper1 = document.createElement('div');
    const wrapper2 = document.createElement('div');
    const wrapper3 = document.createElement('div');
    const video = document.createElement('video');

    wrapper3.appendChild(video);
    wrapper2.appendChild(wrapper3);
    wrapper1.appendChild(wrapper2);
    card.appendChild(wrapper1);
    document.body.appendChild(card);

    const found = video.closest(NON_SHORTS_REATTACH_CARD_SELECTOR);
    expect(found).toBe(card);
  });

  it('video inside sibling card does not match wrong card', () => {
    const card1 = document.createElement('ytm-rich-item-renderer');
    const card2 = document.createElement('ytm-rich-item-renderer');
    const video1 = document.createElement('video');
    const video2 = document.createElement('video');

    card1.appendChild(video1);
    card2.appendChild(video2);
    document.body.appendChild(card1);
    document.body.appendChild(card2);

    expect(video1.closest(NON_SHORTS_REATTACH_CARD_SELECTOR)).toBe(card1);
    expect(video2.closest(NON_SHORTS_REATTACH_CARD_SELECTOR)).toBe(card2);
    expect(video1.closest(NON_SHORTS_REATTACH_CARD_SELECTOR)).not.toBe(card2);
  });

  it('Shorts lockup element is NOT in the card selector (quarantined by design)', () => {
    const shortsLockup = document.createElement('ytm-shorts-lockup-view-model');
    const video = document.createElement('video');
    shortsLockup.appendChild(video);
    document.body.appendChild(shortsLockup);

    // Shorts lockup must NOT resolve via the regular card selector.
    // If it did, Shorts could contaminate the regular blur path.
    const found = video.closest(NON_SHORTS_REATTACH_CARD_SELECTOR);
    expect(found).toBeNull();
  });

  it('selector string contains all expected parts (contract test)', () => {
    for (const part of CARD_SELECTOR_PARTS) {
      expect(NON_SHORTS_REATTACH_CARD_SELECTOR).toContain(part);
    }
    expect(NON_SHORTS_REATTACH_STRONG_CARD_SELECTOR).not.toContain('#content');
  });
});
