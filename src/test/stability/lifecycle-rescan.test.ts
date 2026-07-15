/**
 * Lifecycle rescan hooks for first-entry / refresh rediscovery.
 * Does not assert sacred blur/reveal bodies — only inject rediscovery API.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { buildCard, injectScript, type InjectionResult } from './harness';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
});

describe('Lifecycle rescan (first entry / refresh)', () => {
  it('exposes __MW_LIFECYCLE_RESCAN__ and returns OK', () => {
    injection = injectScript();
    const rescan = (window as unknown as { __MW_LIFECYCLE_RESCAN__?: (r: string) => string })
      .__MW_LIFECYCLE_RESCAN__;
    expect(typeof rescan).toBe('function');
    const result = rescan!('test_load_end');
    expect(String(result)).toMatch(/^OK/);
  });

  it('lifecycle rescan keeps soft pre-blur on main surface nodes', () => {
    const { video } = buildCard('ytm-rich-item-renderer', 'dQw4w9WgXcQ');
    injection = injectScript();
    const src = srcFor('dQw4w9WgXcQ');
    video.dataset.mwOrigPoster = src;
    video.dataset.mwModerated = 'softblur';
    video.classList.add('mw-softblur');
    video.style.setProperty('filter', 'blur(12px)', 'important');
    video.dataset.mwDecisionReason = 'model_not_ready_pending';

    const rescan = (window as unknown as { __MW_LIFECYCLE_RESCAN__?: (r: string) => string })
      .__MW_LIFECYCLE_RESCAN__;
    rescan!('test_soft_keep');

    expect(video.classList.contains('mw-softblur') || hasSoft(video)).toBe(true);
  });

  it('cold-start flush still works alongside lifecycle rescan', () => {
    injection = injectScript();
    const flush = (window as unknown as { __MW_COLD_START_FLUSH__?: (r: string) => string })
      .__MW_COLD_START_FLUSH__;
    const rescan = (window as unknown as { __MW_LIFECYCLE_RESCAN__?: (r: string) => string })
      .__MW_LIFECYCLE_RESCAN__;
    expect(typeof flush).toBe('function');
    expect(typeof rescan).toBe('function');
    expect(String(flush!('test'))).toMatch(/^OK/);
    expect(String(rescan!('test'))).toMatch(/^OK/);
  });
});

function hasSoft(el: HTMLElement): boolean {
  const f = (el.style.getPropertyValue('filter') || el.style.filter || '').toLowerCase();
  return f.includes('blur(') || el.dataset.mwModerated === 'softblur';
}
