#!/usr/bin/env node
/**
 * Strict protected-region guard for the Positive Blur Stability Core freeze.
 * See FROZEN.md.
 *
 * Fails (exit 1) if a git diff touches ANY file listed as frozen.
 *
 * STRICT POLICY: FREEZE-OVERRIDE is NOT accepted. Frozen files are zero-edit.
 * Emergency MVP blockers require a NEW freeze tag after human device matrix
 * sign-off — not a magic commit string.
 *
 * Dependency-free — Node built-ins + git only.
 *
 *   node scripts/check-frozen.mjs                       # working tree vs HEAD
 *   node scripts/check-frozen.mjs --range A..B          # a commit range
 *   node scripts/check-frozen.mjs --range phase0-behavior-nosoft-p0off-2a6d9c23..HEAD
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Files that contain the Positive Blur Stability Core. Keep in sync with FROZEN.md. */
const FROZEN_FILES = [
  'src/lib/webview-injection-script.ts',
  'src/components/browser/NativeWebViewBrowser.tsx',
  'src/hooks/useNativeWebView.ts',
];

/** Strict freeze seal (banners + zero-edit policy). Behavior tip remains 2a6d9c23. */
const FREEZE_TAG = 'phase0-positive-blur-strict-freeze-2026-07-15';
/** Functional behavior tip (nosoft + p0off) this seal protects. */
const BEHAVIOR_TIP = '2a6d9c23daddd519db8d8133c2623b0a99c79ed5';
const BEHAVIOR_TAG = 'phase0-behavior-nosoft-p0off-2a6d9c23';

function git(args) {
  return execSync(`git ${args}`, { cwd: repoRoot, encoding: 'utf8' });
}

function changedFiles() {
  const rangeArg = process.argv.indexOf('--range');
  const diffSpec =
    rangeArg !== -1 && process.argv[rangeArg + 1]
      ? `--name-only ${process.argv[rangeArg + 1]}`
      : '--name-only HEAD';
  try {
    return git(`diff ${diffSpec}`).split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (e) {
    console.error('[check-frozen] git diff failed:', e.message);
    process.exit(2);
  }
}

const touched = changedFiles().filter((f) => FROZEN_FILES.includes(f));

if (touched.length === 0) {
  console.log('[check-frozen] OK — no frozen files touched.');
  console.log(
    '[check-frozen] seal=' +
      FREEZE_TAG +
      ' behavior=' +
      BEHAVIOR_TAG +
      ' (' +
      BEHAVIOR_TIP.slice(0, 8) +
      ')',
  );
  process.exit(0);
}

console.error('\n[check-frozen] BLOCKED — frozen Positive Blur Stability Core files were modified:');
touched.forEach((f) => console.error('   - ' + f));
console.error(
  '\nSTRICT FREEZE (see FROZEN.md):\n' +
    '  Seal tag:     ' +
    FREEZE_TAG +
    '\n' +
    '  Behavior tip: ' +
    BEHAVIOR_TAG +
    ' @ ' +
    BEHAVIOR_TIP.slice(0, 8) +
    '\n\n' +
    'These files are ZERO-EDIT. FREEZE-OVERRIDE is not accepted.\n' +
    'Allowed work (accuracy thr, dial UI/settings, narrow cold-load host policy)\n' +
    'must land OUTSIDE these files, on a branch from the seal tag.\n\n' +
    'Emergency MVP blocker process:\n' +
    '  1. Branch from ' +
    FREEZE_TAG +
    '\n' +
    '  2. Minimal patch + golden suite + full device matrix\n' +
    '  3. Human sign-off\n' +
    '  4. New freeze tag (do not keep editing the sealed tip in place)\n\n' +
    '  npx vitest run --config vitest.stability.config.ts\n' +
    '  node scripts/check-frozen.mjs --range ' +
    FREEZE_TAG +
    '..HEAD\n',
);
process.exit(1);
