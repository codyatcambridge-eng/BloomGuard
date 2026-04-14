import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('YouTube adaptive polling budget', () => {
  it('uses active and idle polling delays with scroll activity', () => {
    const content = readFileSync('src/lib/webview-injection-script.ts', 'utf8');
    expect(content).toMatch(/LEGACY_RESULTS_ACTIVE_POLL_MS\s*=\s*250/);
    expect(content).toMatch(/LEGACY_RESULTS_IDLE_POLL_MS\s*=\s*1200/);
    expect(content).toMatch(/function noteUserScrollActivity\(/);
    expect(content).toMatch(/function getLegacyResultsPollDelayMs\(/);
    expect(content).toMatch(/setTimeout\(runLegacyResultsPollTick,\s*delay\)/);
  });
});
