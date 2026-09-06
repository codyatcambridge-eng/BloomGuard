#!/usr/bin/env node
/**
 * Protected-region guard for the MVP freeze (see FROZEN.md).
 *
 * Verifies the immutable SACRED100 refs and fails (exit 1) when an uncommitted
 * diff touches protected files, or when a commit in the selected range touches
 * protected files without its own `FREEZE-OVERRIDE:` trailer.
 *
 * Dependency-free — Node built-ins + git only.
 *
 *   node scripts/check-frozen.mjs                       # working tree vs HEAD
 *   node scripts/check-frozen.mjs --range A..B          # a commit range
 *
 * NOTE: this is a coarse FILE-level guard (the frozen functions live in large
 * files). It is intentionally conservative: any change to a frozen file trips it,
 * which is the desired "make me prove I meant to do this" behavior for sacred code.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SACRED100_SHA = '9986d613cc1e797d12d509d30fe652331c1c51fd';

// Files that contain frozen functions. Keep in sync with FROZEN.md.
const FROZEN_FILES = [
  'src/lib/webview-injection-script.ts',
  'src/components/browser/NativeWebViewBrowser.tsx',
  'src/hooks/useNativeWebView.ts',
  'src/lib/injection-readiness.ts',
  'src/lib/protection-mode.ts',
  'src/hooks/useSettings.ts',
  'src/hooks/useLocalSettings.ts',
];

const FROZEN_PREFIXES = ['src/test/stability/'];

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

function isFrozen(file) {
  return FROZEN_FILES.includes(file) || FROZEN_PREFIXES.some(prefix => file.startsWith(prefix));
}

function verifyControl() {
  const tagCommit = git(['rev-parse', 'SACRED100^{}']).trim();
  const branchCommit = git(['rev-parse', 'sacred/SACRED100']).trim();
  if (tagCommit !== SACRED100_SHA || branchCommit !== SACRED100_SHA) {
    console.error('[check-frozen] BLOCKED — SACRED100 control ref mismatch.');
    console.error(`  expected: ${SACRED100_SHA}`);
    console.error(`  tag:      ${tagCommit}`);
    console.error(`  branch:   ${branchCommit}`);
    process.exit(1);
  }
  try {
    git(['merge-base', '--is-ancestor', SACRED100_SHA, 'HEAD']);
  } catch {
    console.error('[check-frozen] BLOCKED — HEAD is not a descendant of SACRED100.');
    process.exit(1);
  }
}

function requestedRange() {
  const rangeArg = process.argv.indexOf('--range');
  if (rangeArg !== -1 && !process.argv[rangeArg + 1]) {
    console.error('[check-frozen] --range requires A..B.');
    process.exit(2);
  }
  return rangeArg !== -1 ? process.argv[rangeArg + 1] : 'SACRED100..HEAD';
}

function lines(value) {
  return value.split('\n').map(s => s.trim()).filter(Boolean);
}

verifyControl();

const range = requestedRange();
const uncommitted = lines(git(['diff', '--name-only', 'HEAD'])).filter(isFrozen);
if (uncommitted.length > 0) {
  console.error('[check-frozen] BLOCKED — uncommitted protected files were modified:');
  uncommitted.forEach(file => console.error('   - ' + file));
  console.error('Commit nothing until the change has explicit freeze-break approval.');
  process.exit(1);
}

let commits;
try {
  commits = lines(git(['rev-list', '--reverse', range]));
} catch (error) {
  console.error('[check-frozen] git range failed:', error.message);
  process.exit(2);
}

const violations = [];
for (const commit of commits) {
  const touched = lines(git(['diff-tree', '--no-commit-id', '--name-only', '-r', commit])).filter(isFrozen);
  if (touched.length === 0) continue;
  const message = git(['show', '-s', '--format=%B', commit]);
  if (!/^FREEZE-OVERRIDE:\s*\S.+$/m.test(message)) {
    violations.push({ commit, touched });
  }
}

if (violations.length > 0) {
  console.error(`[check-frozen] BLOCKED — unauthorized SACRED100 changes in ${range}:`);
  for (const violation of violations) {
    console.error(`   ${violation.commit}`);
    violation.touched.forEach(file => console.error('      - ' + file));
  }
  console.error('Each protected change requires Cody approval and its own FREEZE-OVERRIDE trailer.');
  process.exit(1);
}

console.log(`[check-frozen] OK — SACRED100 refs verified; no unauthorized protected changes in ${range} or the working tree.`);
