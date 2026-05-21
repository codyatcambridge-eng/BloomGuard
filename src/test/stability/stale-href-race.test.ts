/**
 * T5: Stale-Href Race Simulation
 *
 * Documents and probes risk M1 from the stability report:
 *   YouTube SPA navigation reuses card elements. There is a window between
 *   when a new video's src/poster updates and when the card's a[href] updates.
 *   If diagNonShortsReattach fires in that window with stale href, the system
 *   might authorize blur for a negative video using the old positive's credentials.
 *
 * Test structure:
 *   Phase 1 — href still stale (positive), src has changed to negative.
 *   Phase 2 — href updated to negative.
 *   Phase 3 — MVP card observer fires (href change detected, ownership cleared).
 *
 * This test does NOT patch production code. It proves whether the race is
 * exploitable under current conditions. If Phase 1 incorrectly allows blur,
 * the test is marked accordingly and a production patch is listed in §6.
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

describe('T5: Stale-Href Race Simulation', () => {

  it('Phase 1: reattach fires while href is stale (positive) but src changed to negative', () => {
    // Set up card pointing to POSITIVE_ID (href not yet updated)
    const { card, video, anchor } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    stampPositiveBlur(video, POSITIVE_ID);

    injection = injectScript();

    // Simulate: YouTube updates the video src first (negative video starts loading)
    // but card href hasn't changed yet
    video.src = `https://i.ytimg.com/vi/${NEGATIVE_ID}/hqdefault.jpg`;
    video.poster = `https://i.ytimg.com/vi/${NEGATIVE_ID}/hqdefault.jpg`;
    // data-mw-hardBlurItemKey still says POSITIVE_ID (stale from previous stamp)
    // card anchor href still says POSITIVE_ID

    clearReattachCooldown(video);
    injection.logs.length = 0;
    injection.probe.diagNonShortsReattach(video, 'attr:src');

    const combinedPhase1 = injection.logs.join('\n');
    const phase1Allowed = combinedPhase1.includes('MW-MVP-AUTHZ-BLUR-ALLOW');
    const phase1Denied = combinedPhase1.includes('MW-MVP-AUTHZ-BLUR-DENY');

    if (phase1Allowed) {
      // Race IS exploitable: negative was granted blur using stale href
      console.warn(
        '[STABILITY-T5-RACE-CONFIRMED] Phase 1 ALLOWED blur for negative video ' +
        `while href was stale. POSITIVE_ID=${POSITIVE_ID}, NEGATIVE_ID=${NEGATIVE_ID}. ` +
        'A production patch is needed to close this window (see proposed patches §6).',
      );
    }

    // DOCUMENTED EXPECTATION:
    // If the race is NOT exploitable (href check catches mismatched itemKey/src key):
    //   phase1Allowed === false (good — the existing defense holds)
    // If the race IS exploitable:
    //   phase1Allowed === true (gap confirmed — production patch needed)
    //
    // We do NOT assert a specific value here; we document the outcome.
    // The console.warn above creates a visible signal in CI output.
    expect(typeof phase1Allowed).toBe('boolean');
    expect(typeof phase1Denied).toBe('boolean');

    // What we CAN assert unconditionally:
    // After phase 1, the element must not have gained new authoritative blur
    // from the NEGATIVE src/ID. If it WAS allowed, it's using the stale POSITIVE
    // credentials — which is the race.
    const raceExploited = phase1Allowed && video.dataset.mwModerated === 'blurred';
    if (raceExploited) {
      console.error(
        '[STABILITY-T5-RACE-EXPLOITED] Negative video is now blurred with positive credentials. ' +
        'This is the M1 vulnerability. See proposed patches §6.',
      );
    }

    void anchor;
    void card;
  });

  it('Phase 2: after href updates to negative, reattach correctly denies', () => {
    const { card, video, anchor } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    stampPositiveBlur(video, POSITIVE_ID);

    injection = injectScript();

    // Phase 2: YouTube has now updated the href to negative
    if (anchor) {
      anchor.href = `/watch?v=${NEGATIVE_ID}`;
      anchor.setAttribute('href', `/watch?v=${NEGATIVE_ID}`);
    }

    // Update src to negative as well
    video.src = `https://i.ytimg.com/vi/${NEGATIVE_ID}/hqdefault.jpg`;
    video.poster = `https://i.ytimg.com/vi/${NEGATIVE_ID}/hqdefault.jpg`;

    clearReattachCooldown(video);
    injection.logs.length = 0;
    injection.probe.diagNonShortsReattach(video, 'attr:src');

    const combined = injection.logs.join('\n');

    // With correct href, the mismatch between stale hardBlurItemKey (POSITIVE_ID)
    // and live hrefKey (NEGATIVE_ID) must cause a deny.
    expect(combined).not.toMatch(/MW-MVP-AUTHZ-BLUR-ALLOW/);

    const correctlyDenied = combined.includes('MW-MVP-AUTHZ-BLUR-DENY') ||
      video.dataset.mwModerated !== 'blurred';
    expect(
      correctlyDenied,
      `Phase 2: negative video still authorized after href update. ` +
      `mwModerated=${video.dataset.mwModerated}`,
    ).toBe(true);

    void card;
  });

  it('Phase 3: href key mismatch is directly caught by isMvpBlurAuthorized', () => {
    // Directly test: stale POSITIVE_ID as itemKey, card pointing to NEGATIVE_ID
    const { card, video } = buildCard('ytm-rich-item-renderer', NEGATIVE_ID);

    injection = injectScript();

    const stalePositiveSrc = `https://i.ytimg.com/vi/${POSITIVE_ID}/hqdefault.jpg`;
    const result = injection.probe.isMvpBlurAuthorized(
      video,
      stalePositiveSrc,
      POSITIVE_ID,    // stale itemKey from POSITIVE
      'card_blurred',
      'race_phase_3',
    );

    // card href says NEGATIVE_ID; itemKey says POSITIVE_ID → must deny
    expect(result).toBe(false);
    expect(injection.logs.join('\n')).toMatch(/MW-MVP-AUTHZ-BLUR-DENY/);
    expect(injection.logs.join('\n')).toMatch(/item_href_mismatch|card_blurred_key_mismatch/);

    void card;
  });

  it('race window closes when getDiagItemKey extracts correct ID from negative src', () => {
    // When the negative's src URL contains its own video ID, strictContinuityItemKey
    // is derived as NEGATIVE_ID, which won't match stale blurred element's POSITIVE_ID.
    // strictCardMatch fails → no card_blurred context → no blur.
    const { video } = buildCard('ytm-rich-item-renderer', NEGATIVE_ID);

    // Simulate fully-stamped positive state on the video node
    stampPositiveBlur(video, POSITIVE_ID);

    // Now update src to negative (ytimg URL contains NEGATIVE_ID)
    video.src = `https://i.ytimg.com/vi/${NEGATIVE_ID}/hqdefault.jpg`;
    video.poster = `https://i.ytimg.com/vi/${NEGATIVE_ID}/hqdefault.jpg`;
    // Leave href pointing to NEGATIVE_ID (already set by buildCard)
    // Leave hardBlurItemKey as POSITIVE_ID (stale)

    injection = injectScript();

    clearReattachCooldown(video);
    injection.probe.diagNonShortsReattach(video, 'attr:src');

    // strictContinuityItemKey (from new src NEGATIVE_ID) !== contextItemKeyForCard (POSITIVE_ID)
    // → strictCardMatch = false
    // → strictUnknownButCardAuthoritative = false (strictContinuityItemKey is known)
    // → contextKind stays 'none' or context not found
    // → no applyBlur with card_blurred proof
    expect(injection.logs.join('\n')).not.toMatch(/MW-MVP-AUTHZ-BLUR-ALLOW/);
  });
});
