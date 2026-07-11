/**
 * Active Shorts negative controls (Step 0 regression net).
 *
 * AGENTS.md §3: negatives must stay clean. Every heal/repair mechanism on
 * active Shorts is a potential contamination vector — these tests prove the
 * heal machinery does NOTHING when there is no positive verdict, so the
 * C-phase and B-phase patches are measured against a pinned clean baseline.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildActiveShortsPlayer,
  injectScript,
  pushShortsUrl,
  restoreMainFeedUrl,
  type InjectionResult,
} from './harness';

let shortsIdCounter = 100;
function nextShortsId(): string {
  shortsIdCounter += 1;
  return `NegShort${String(shortsIdCounter).padStart(4, '0')}`;
}

let injection: InjectionResult | undefined;

afterEach(() => {
  injection?.cleanup();
  injection = undefined;
  restoreMainFeedUrl();
});

function noBlurAnywhere(nodes: HTMLElement[]): void {
  for (const node of nodes) {
    expect(node.dataset.mwModerated).not.toBe('blurred');
    expect(node.style.getPropertyValue('filter') || '').not.toContain('blur(');
    expect(node.classList.contains('mw-blurred')).toBe(false);
  }
}

describe('Active Shorts negative controls — safe Shorts stay clean', () => {
  it('an unstamped safe Short gets no blur and no reveal from the pairing heal', () => {
    const id = nextShortsId();
    pushShortsUrl(id);
    const { player, frame, video, src } = buildActiveShortsPlayer(id);
    injection = injectScript();

    const healed = injection.probe.healActiveShortsRevealPairing(
      video,
      src,
      'porn',
      id,
      'test_negative_control',
    );

    expect(healed).toBe(false);
    expect(document.querySelector('.mw-reveal-overlay')).toBeNull();
    noBlurAnywhere([player, frame as HTMLElement, video]);
  });

  it('the health heal cycle is a no-op on a container with no blur context', () => {
    const id = nextShortsId();
    pushShortsUrl(id);
    const { player, frame, video } = buildActiveShortsPlayer(id);
    injection = injectScript();

    injection.probe.runShortsHealthHealForContainer(frame, 'test_negative_control');
    injection.probe.runShortsHealthHealForContainer(player, 'test_negative_control');

    expect(document.querySelector('.mw-reveal-overlay')).toBeNull();
    noBlurAnywhere([player, frame as HTMLElement, video]);
  });

  it('createRevealOverlay on an unstamped safe Short creates no overlay and no blur', () => {
    const id = nextShortsId();
    pushShortsUrl(id);
    const { player, frame, video, src } = buildActiveShortsPlayer(id);
    injection = injectScript();

    injection.probe.createRevealOverlay(video, src, 'porn', id);
    injection.probe.createRevealOverlay(frame, src, 'porn', id);

    expect(document.querySelector('.mw-reveal-overlay')).toBeNull();
    noBlurAnywhere([player, frame as HTMLElement, video]);
  });

  it('a positive heal on one Short does not leak blur onto a different safe Short after swipe', () => {
    const positiveId = nextShortsId();
    pushShortsUrl(positiveId);
    const fixtureA = buildActiveShortsPlayer(positiveId);
    injection = injectScript();

    // Positive on Short A, healed into blur+reveal.
    fixtureA.video.dataset.mwModerated = 'blurred';
    fixtureA.video.dataset.mwCategory = 'porn';
    fixtureA.video.dataset.mwSrc = fixtureA.src;
    fixtureA.video.dataset.mwItemId = positiveId;
    fixtureA.video.style.setProperty('filter', 'blur(40px)', 'important');
    injection.probe.healActiveShortsRevealPairing(
      fixtureA.video,
      fixtureA.src,
      'porn',
      positiveId,
      'test_swipe_setup',
    );

    // Swipe: Short A's DOM is replaced by safe Short B, URL changes.
    fixtureA.player.remove();
    const safeId = nextShortsId();
    pushShortsUrl(safeId);
    const fixtureB = buildActiveShortsPlayer(safeId);

    // Heal machinery runs again on the new container (as the interval would).
    const container = injection.probe.getActiveShortsPlayerContainer();
    if (container) {
      injection.probe.runShortsHealthHealForContainer(container, 'test_after_swipe');
    }
    const healedB = injection.probe.healActiveShortsRevealPairing(
      fixtureB.video,
      fixtureB.src,
      'porn',
      safeId,
      'test_after_swipe',
    );

    expect(healedB).toBe(false);
    noBlurAnywhere([fixtureB.player, fixtureB.frame as HTMLElement, fixtureB.video]);
  });
});
