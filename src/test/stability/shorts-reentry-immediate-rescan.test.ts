import { afterEach, describe, expect, it } from 'vitest';
import { injectScript, tick, type InjectionResult } from './harness';

const POSITIVE_ID = 'dQw4w9WgXcQ';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function buildActiveShortsFrame(id: string): { player: HTMLDivElement; frame: HTMLElement; video: HTMLVideoElement; src: string } {
  const src = srcFor(id);
  const player = document.createElement('div');
  player.id = 'shorts-player';

  const frame = document.createElement('ytm-reel-video-renderer');
  frame.setAttribute('selected', '');
  frame.setAttribute('aria-hidden', 'false');
  frame.setAttribute('is-active', '');

  const video = document.createElement('video');
  video.poster = src;
  frame.appendChild(video);
  player.appendChild(frame);
  document.body.appendChild(player);

  return { player, frame, video, src };
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/');
});

describe.skipIf(window.location.hostname !== 'm.youtube.com')('Active Shorts reentry rescan', () => {
  it('forces an immediate active-container rescan when Shorts freshness is rehydrated', async () => {
    window.history.pushState({}, '', `/shorts/${POSITIVE_ID}`);
    buildActiveShortsFrame(POSITIVE_ID);
    injection = injectScript();

    const refreshed = injection.probe.refreshShortsFreshnessOnReentry('test_reentry_immediate');

    expect(refreshed).toBe(true);

    await tick();

    const logs = injection.logs.join('\n');
    expect(logs).toContain('reentry_immediate:test_reentry_immediate');
    expect(logs).toContain('reason=adaptive:reentry_immediate:test_reentry_immediate');
    expect(logs).toContain('discovered count=1');
  });
});
