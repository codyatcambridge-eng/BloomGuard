/**
 * Flash Shield Shorts veil identity — characterization (Step 0 regression net).
 *
 * KNOWN DEFECT pinned here (P1 of the veil work, NOT yet in this lineage):
 * getFlashShieldShortsIdentity includes the media source (currentSrc/src/
 * poster) in the veil identity. During normal playback YouTube churns the
 * media source without changing the Short — every churn mints a new identity,
 * the veil re-arms, and a SAFE Short gets a transient full-screen blur flash
 * mid-playback ("variable blur" symptom).
 *
 * The fix (commit 0828899a on parked/native-webview-recovery) removes the
 * media source from the identity. When that fix is ported (C1), invert the
 * assertions marked [INVERT-ON-C1-P1] — do not delete them.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildActiveShortsPlayer,
  injectScript,
  pushShortsUrl,
  restoreMainFeedUrl,
  type InjectionResult,
} from './harness';

const SHORTS_ID = 'VeilShort001';

let injection: InjectionResult | undefined;

afterEach(() => {
  injection?.cleanup();
  injection = undefined;
  restoreMainFeedUrl();
});

describe('Shorts veil identity — media-source churn [KNOWN DEFECT]', () => {
  it('identity is stable when nothing changes', () => {
    pushShortsUrl(SHORTS_ID);
    const { frame, video } = buildActiveShortsPlayer(SHORTS_ID);
    injection = injectScript();

    const a = injection.probe.getFlashShieldShortsIdentity(frame, video);
    const b = injection.probe.getFlashShieldShortsIdentity(frame, video);
    expect(a).toBe(b);
    expect(a).toContain(SHORTS_ID);
  });

  it('identity is STABLE when only the media source changes mid-playback (C1/P1)', () => {
    // Historical defect (inverted by the C1/P1 port): the identity included
    // the media source, so normal playback source churn (poster -> blob,
    // quality swaps) minted a new veil identity, wiped the verdict, and
    // re-veiled a SAFE Short mid-playback — the full-screen blur flash.
    pushShortsUrl(SHORTS_ID);
    const { frame, video } = buildActiveShortsPlayer(SHORTS_ID);
    injection = injectScript();

    const before = injection.probe.getFlashShieldShortsIdentity(frame, video);
    // Same Short, same URL id — YouTube swaps the stream source during playback.
    video.src = 'https://redirector.googlevideo.com/videoplayback?id=segment2';

    const after = injection.probe.getFlashShieldShortsIdentity(frame, video);

    expect(after).toBe(before);
  });

  it('identity DOES change when the Shorts URL id changes (this part must survive the C1 port)', () => {
    pushShortsUrl(SHORTS_ID);
    const { frame, video } = buildActiveShortsPlayer(SHORTS_ID);
    injection = injectScript();

    const before = injection.probe.getFlashShieldShortsIdentity(frame, video);
    pushShortsUrl('VeilShort002');
    const after = injection.probe.getFlashShieldShortsIdentity(frame, video);

    // A real swipe (new Shorts URL id) must always produce a new identity —
    // the C1 port must NOT flatten this into identity reuse.
    expect(after).not.toBe(before);
  });
});
