import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Native Shorts veil lift gating', () => {
  it('keeps reinjectAndPing at 50ms and gates veil lift on hookStable', () => {
    const content = readFileSync('src/components/browser/NativeWebViewBrowser.tsx', 'utf8');
    expect(content).toMatch(/setTimeout\(reinjectAndPing,\s*50\)/);
    expect(content).toMatch(/onUrlChange:\s*\(url\)\s*=>\s*\{[\s\S]*markNavigation\('onUrlChange',\s*url\)/);
    expect(content).toMatch(/typedMessage\.type === 'MW_SHORTS_VERDICT_APPLIED'[\s\S]*relaxedEpochBypassHookStableRef\.current/);
    expect(content).toMatch(/typedMessage\.type === 'MW_SHORTS_VERDICT_APPLIED'[\s\S]*messageVideoId === activeVideoId/);
    expect(content).toMatch(/typedMessage\.type === 'MW_SHORTS_VERDICT_APPLIED'[\s\S]*drop_verdict_applied_epoch_mismatch/);
    expect(content).toMatch(/typedMessage\.type === 'MW_SHORTS_VERDICT_APPLIED'[\s\S]*command:\s*'LIFT_SHORTS_VEIL'/);
    expect(content).toMatch(/__MW_SHORTS_VERDICT_CACHE__/);
    expect(content).toMatch(/SKIP_NEUTRAL/);
  });
});
