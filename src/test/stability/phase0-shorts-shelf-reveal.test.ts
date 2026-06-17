import { afterEach, describe, expect, it } from 'vitest';
import {
  injectScript,
  tick,
  type InjectionResult,
} from './harness';

const HOME_ID = 'ShelfHome01';
const RESULTS_ID = 'ShelfResult02';
const OTHER_ID = 'ShelfOther03';

interface ShelfFixture {
  lockup: HTMLElement;
  image: HTMLImageElement;
}

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function buildShelfShort(id: string): ShelfFixture {
  const lockup = document.createElement('ytm-shorts-lockup-view-model');
  const anchor = document.createElement('a');
  const image = document.createElement('img');

  anchor.href = `/shorts/${id}`;
  image.src = srcFor(id);
  image.dataset.mwSourceType = 'img';
  anchor.appendChild(image);
  lockup.appendChild(anchor);
  document.body.appendChild(lockup);

  return { lockup, image };
}

function buildResultsShelfWithGenericLockups(): {
  shelf: HTMLElement;
  first: ShelfFixture;
  second: ShelfFixture;
} {
  const shelf = document.createElement('ytm-rich-shelf-renderer');
  const buildLockup = (id: string): ShelfFixture => {
    const lockup = document.createElement('yt-lockup-view-model');
    const anchor = document.createElement('a');
    const image = document.createElement('img');
    anchor.href = `/shorts/${id}`;
    image.src = srcFor(id);
    image.dataset.mwSourceType = 'img';
    anchor.appendChild(image);
    lockup.appendChild(anchor);
    shelf.appendChild(lockup);
    return { lockup, image };
  };
  const first = buildLockup(RESULTS_ID);
  const second = buildLockup(OTHER_ID);
  document.body.appendChild(shelf);
  return { shelf, first, second };
}

function revealButtons(lockup?: Element): HTMLButtonElement[] {
  const root = lockup || document;
  return Array.from(root.querySelectorAll<HTMLButtonElement>('.mw-reveal-btn'));
}

function applyPositive(injection: InjectionResult, fixture: ShelfFixture, id: string): void {
  injection.probe.applyBlur(
    fixture.image,
    srcFor(id),
    'porn',
    40,
    id,
    'classifier_positive',
  );
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
  history.replaceState({}, '', '/');
});

describe('Phase 0: Shorts shelf reveal', () => {
  it.each([
    ['home', '/', HOME_ID],
    ['results', '/results?search_query=phase0', RESULTS_ID],
  ])('%s shelf gets one reveal button and reveal works', (_surface, path, id) => {
    history.replaceState({}, '', path);
    const fixture = buildShelfShort(id);
    injection = injectScript();

    applyPositive(injection, fixture, id);

    expect(fixture.image.dataset.mwModerated).toBe('blurred');
    expect(revealButtons(fixture.lockup)).toHaveLength(1);

    revealButtons(fixture.lockup)[0].dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(fixture.image.dataset.mwModerated).toBe('revealed');
    expect(fixture.image.style.getPropertyValue('filter')).not.toContain('blur(');
  });

  it('does not duplicate a shelf reveal button during blur reapply', () => {
    const fixture = buildShelfShort(HOME_ID);
    injection = injectScript();
    applyPositive(injection, fixture, HOME_ID);

    injection.probe.reapplyOwnedContainerBlur(fixture.lockup, 'test_scroll_rescan');
    injection.probe.applyBlur(
      fixture.image,
      srcFor(HOME_ID),
      'porn',
      40,
      HOME_ID,
      'classifier_positive',
    );

    expect(revealButtons(fixture.lockup)).toHaveLength(1);
  });

  it('retains one reveal button after scroll and lifecycle reapply', async () => {
    const fixture = buildShelfShort(HOME_ID);
    injection = injectScript();
    applyPositive(injection, fixture, HOME_ID);

    window.dispatchEvent(new Event('scroll'));
    injection.probe.reapplyOwnedContainerBlur(fixture.lockup, 'test_scroll');
    await tick();

    expect(fixture.image.dataset.mwModerated).toBe('blurred');
    expect(revealButtons(fixture.lockup)).toHaveLength(1);
  });

  it('revealing one shelf Short does not reveal another', () => {
    const first = buildShelfShort(HOME_ID);
    const second = buildShelfShort(OTHER_ID);
    injection = injectScript();
    applyPositive(injection, first, HOME_ID);
    applyPositive(injection, second, OTHER_ID);

    expect(revealButtons()).toHaveLength(2);
    revealButtons(first.lockup)[0].dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(first.image.dataset.mwModerated).toBe('revealed');
    expect(second.image.dataset.mwModerated).toBe('blurred');
    expect(revealButtons(second.lockup)).toHaveLength(1);
  });

  it('keeps Results shelf ownership scoped to one generic Shorts lockup', () => {
    history.replaceState({}, '', '/results?search_query=phase0');
    const fixture = buildResultsShelfWithGenericLockups();
    injection = injectScript();

    expect(injection.probe.getOwnedCardContainerFromNode(fixture.first.image))
      .toBe(fixture.first.lockup);
    expect(injection.probe.getOwnedCardContainerFromNode(fixture.first.image))
      .not.toBe(fixture.shelf);

    applyPositive(injection, fixture.first, RESULTS_ID);

    expect(fixture.first.image.dataset.mwModerated).toBe('blurred');
    expect(revealButtons(fixture.first.lockup)).toHaveLength(1);
    expect(fixture.second.image.dataset.mwModerated).not.toBe('blurred');
    expect(revealButtons(fixture.second.lockup)).toHaveLength(0);
    expect(fixture.shelf.classList.contains('mw-owned-positive-card')).toBe(false);
  });
});
