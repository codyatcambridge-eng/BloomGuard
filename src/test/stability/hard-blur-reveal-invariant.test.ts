import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCard, injectScript, type InjectionResult } from './harness';

const POSITIVE_ID = 'dQw4w9WgXcQ';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function hasBlurFilter(element: HTMLElement): boolean {
  const filter = String(element.style.getPropertyValue('filter') || element.style.filter || '').toLowerCase();
  const webkit = String(element.style.getPropertyValue('-webkit-filter') || '').toLowerCase();
  const backdrop = String(element.style.getPropertyValue('backdrop-filter') || '').toLowerCase();
  return filter.includes('blur(') || webkit.includes('blur(') || backdrop.includes('blur(');
}

describe('Hard blur reveal invariant', () => {
  let injection: InjectionResult | null = null;

  afterEach(() => {
    injection?.cleanup();
    injection = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('clears hard blur when reveal overlay attachment fails', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    const originalAppendChild = Element.prototype.appendChild;
    vi.spyOn(Element.prototype, 'appendChild').mockImplementation(function appendChildWithOverlayFailure<T extends Node>(
      this: Element,
      node: T,
    ): T {
      if (node instanceof HTMLElement && node.classList.contains('mw-reveal-overlay')) {
        throw new Error('test overlay attach failure');
      }
      return originalAppendChild.call(this, node) as T;
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    injection = injectScript();
    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');

    expect(video.dataset.mwModerated).toBe('safe');
    expect(video.dataset.mwHardBlur || '').not.toBe('1');
    expect(video.classList.contains('mw-blurred')).toBe(false);
    expect(hasBlurFilter(video)).toBe(false);
    expect(document.querySelector('.mw-reveal-overlay')).toBeNull();
  });
});
