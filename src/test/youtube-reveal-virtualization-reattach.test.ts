import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('YouTube reveal virtualization reattach', () => {
  it('watches ytm-media-item churn and rebinds capture listeners', () => {
    const content = readFileSync('src/lib/webview-injection-script.ts', 'utf8');
    expect(content).toMatch(/const activeOverlays =/);
    expect(content).toMatch(/__MW_OVERLAY_MEDIA_IDENTITY_OBSERVER__/);
    expect(content).toMatch(/__MW_YTM_REVEAL_VIRTUAL_OBSERVER__/);
    expect(content).toMatch(/scheduleYtmVirtualRevealHeal\(/);
    expect(content).toMatch(/healMissingRevealButtonsInYtmMediaItem\(/);
    expect(content).toMatch(/attributeFilter:\s*\['src',\s*'poster',\s*'currentSrc'\]/);
    expect(content).toMatch(/activeOverlays\.set\(/);
    expect(content).toMatch(/reparentRevealOverlayToNode\(/);
    expect(content).toMatch(/nodeIsCurrentEpochAndVideoScopedForReveal\(/);
    expect(content).toMatch(/ensureRevealWindowTouchCapture\(/);
    expect(content).toMatch(/window\.addEventListener\('touchstart'[\s\S]*capture:\s*true/);
    expect(content).toMatch(/e\.stopImmediatePropagation\(\)/);
    expect(content).toMatch(/btn\.addEventListener\('pointerdown'[\s\S]*\{\s*capture:\s*true\s*\}\)/);
    expect(content).toMatch(/btn\.addEventListener\('click'[\s\S]*\{\s*capture:\s*true\s*\}\)/);
  });
});
