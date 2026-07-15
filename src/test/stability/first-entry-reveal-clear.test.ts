/**
 * First-entry / main-surface reveal must fully clear hard blur residue.
 * Partial fog after Reveal (sibling img/video/veil) is a Phase 0 failure.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { buildCard, injectScript, type InjectionResult } from './harness';

const POSITIVE_ID = 'RevealClearPos1';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function hasBlurFilter(el: HTMLElement): boolean {
  const f = (el.style.getPropertyValue('filter') || el.style.filter || '').toLowerCase();
  return f.includes('blur(');
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
});

describe('First-entry reveal fully clears blur residue', () => {
  it('reveal clears hard blur on the blurred node', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    const src = srcFor(POSITIVE_ID);

    injection.probe.applyBlur(video, src, 'porn', 40, POSITIVE_ID, 'classifier_positive');
    expect(hasBlurFilter(video)).toBe(true);
    expect(document.querySelector('.mw-reveal-btn')).not.toBeNull();

    const btn = document.querySelector('.mw-reveal-btn') as HTMLButtonElement;
    btn.click();

    expect(hasBlurFilter(video)).toBe(false);
    expect(video.dataset.mwModerated).toBe('revealed');
    expect(video.classList.contains('mw-blurred')).toBe(false);
  });

  it('reveal clears same-card sibling residue with matching src (partial blur bug)', () => {
    const { card, video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    // Sibling media that also carried blur (common first-entry img+video paint).
    const img = document.createElement('img');
    const src = srcFor(POSITIVE_ID);
    img.src = src;
    img.dataset.mwSrc = src;
    img.dataset.mwModerated = 'blurred';
    img.classList.add('mw-blurred');
    img.style.setProperty('filter', 'blur(40px)', 'important');
    img.dataset.mwVeil = '1';
    card.appendChild(img);

    injection = injectScript();
    injection.probe.applyBlur(video, src, 'porn', 40, POSITIVE_ID, 'classifier_positive');
    expect(hasBlurFilter(video)).toBe(true);

    const btn = document.querySelector('.mw-reveal-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    btn.click();

    expect(hasBlurFilter(video)).toBe(false);
    expect(hasBlurFilter(img)).toBe(false);
    expect(img.dataset.mwModerated).toBe('revealed');
    expect(img.dataset.mwVeil).toBeUndefined();
    expect(img.classList.contains('mw-blurred')).toBe(false);
  });
});
