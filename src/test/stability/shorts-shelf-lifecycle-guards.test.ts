import { afterEach, describe, expect, it } from 'vitest';
import { injectScript, type InjectionResult } from './harness';

const POSITIVE_ID = 'dQw4w9WgXcQ';
const SAFE_ID = 'safe1234567';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function setRect(el: Element, left: number, top: number, width: number, height: number): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: left,
      y: top,
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      toJSON: () => ({}),
    }),
  });
}

function appendShortsLockup(parent: Element, id: string): HTMLImageElement {
  const lockup = document.createElement('ytm-shorts-lockup-view-model');
  const anchor = document.createElement('a');
  anchor.setAttribute('href', `/shorts/${id}`);
  const img = document.createElement('img');
  img.setAttribute('src', srcFor(id));
  anchor.appendChild(img);
  lockup.appendChild(anchor);
  parent.appendChild(lockup);
  return img;
}

function touchStartAt(x: number, y: number): Event {
  const event = new Event('touchstart', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    configurable: true,
    value: [{ clientX: x, clientY: y }],
  });
  return event;
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/');
});

describe('Shorts shelf lifecycle guards', () => {
  it('clears broad Shorts shelf ownership instead of blurring every shelf thumbnail', () => {
    const shelf = document.createElement('ytm-shorts-shelf-renderer');
    const positive = appendShortsLockup(shelf, POSITIVE_ID);
    const safe = appendShortsLockup(shelf, SAFE_ID);
    document.body.appendChild(shelf);
    injection = injectScript();

    shelf.classList.add('mw-owned-positive-card');
    shelf.dataset.mwOwnedPositive = '1';
    shelf.dataset.mwOwnedPositiveItemKey = POSITIVE_ID;

    injection.probe.reapplyOwnedContainerBlur(shelf, 'test_broad_shelf_reapply');

    expect(shelf.classList.contains('mw-owned-positive-card')).toBe(false);
    expect(shelf.classList.contains('mw-owned-safe-card')).toBe(true);
    expect(positive.dataset.mwModerated).not.toBe('blurred');
    expect(safe.dataset.mwModerated).not.toBe('blurred');
    expect(document.querySelector('.mw-reveal-overlay')).toBeNull();
  });

  it('does not let a hidden stale reveal button cancel touch scrolling after reveal', () => {
    const { video } = (() => {
      const card = document.createElement('ytm-rich-item-renderer');
      const anchor = document.createElement('a');
      anchor.setAttribute('href', `/watch?v=${POSITIVE_ID}`);
      const node = document.createElement('video');
      node.setAttribute('poster', srcFor(POSITIVE_ID));
      anchor.appendChild(node);
      card.appendChild(anchor);
      document.body.appendChild(card);
      return { video: node };
    })();
    injection = injectScript();
    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');

    const overlay = document.querySelector('.mw-reveal-overlay') as HTMLElement | null;
    const button = document.querySelector('.mw-reveal-btn') as HTMLButtonElement | null;
    expect(overlay).not.toBeNull();
    expect(button).not.toBeNull();

    setRect(button!, 20, 20, 80, 36);
    overlay!.style.display = 'none';
    video.dataset.mwModerated = 'revealed';

    const event = touchStartAt(40, 30);
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
