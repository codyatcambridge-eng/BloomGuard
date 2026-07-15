#!/usr/bin/env node
/**
 * Protected-region guard for the Phase 0 lifecycle + blur freeze (see FROZEN.md).
 *
 * Active freeze tip: phase0-mvp-lifecycle-2026-07-15 @ 2a6d9c23 (nosoft + p0off).
 *
 * Fails (exit 1) if a git diff touches any file listed as frozen in FROZEN.md,
 * UNLESS the latest commit message contains `FREEZE-OVERRIDE:`.
 *
 * Dependency-free — Node built-ins + git only.
 *
 *   node scripts/check-frozen.mjs                       # working tree vs HEAD
 *   node scripts/check-frozen.mjs --range A..B          # a commit range
 *   node scripts/check-frozen.mjs --range phase0-mvp-lifecycle-2026-07-15..HEAD
 *
 * NOTE: this is a coarse FILE-level guard (the frozen functions live in large
 * files). It is intentionally conservative: any change to a frozen file trips it,
 * which is the desired "make me prove I meant to do this" behavior for sacred code.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Files that contain frozen functions. Keep in sync with FROZEN.md.
const FROZEN_FILES = [
  'src/lib/webview-injection-script.ts',
  'src/components/browser/NativeWebViewBrowser.tsx',
  'src/hooks/useNativeWebView.ts',
];

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
    return git(`diff ${diffSpec}`).split('\n').map(s => s.trim()).filter(Boolean);
  } catch (e) {
    console.error('[check-frozen] git diff failed:', e.message);
    process.exit(2);
  }
}

function latestCommitMessage() {
  try {
    return git('log -1 --format=%B');
  } catch {
    return '';
  }
}

const touched = changedFiles().filter(f => FROZEN_FILES.includes(f));

if (touched.length === 0) {
  console.log('[check-frozen] OK — no frozen files touched.');
  process.exit(0);
}

const hasOverride = /FREEZE-OVERRIDE:/.test(latestCommitMessage());

if (hasOverride) {
  console.log('[check-frozen] FROZEN files touched but FREEZE-OVERRIDE present — allowed:');
  touched.forEach(f => console.log('   - ' + f));
  process.exit(0);
}

console.error('\n[check-frozen] BLOCKED — frozen (sacred) files were modified:');
touched.forEach(f => console.error('   - ' + f));
console.error(
  '\nThese files contain Phase 0 frozen logic (reveal / positive stability / Active Shorts /\n' +
    'exit lifecycle / nosoft soft ban / Off→On re-arm). See FROZEN.md.\n' +
    'Baseline: phase0-mvp-lifecycle-2026-07-15.\n' +
    'If this change is intentional and reviewed, add a line to your commit body:\n\n' +
    '    FREEZE-OVERRIDE: <why this sacred change is safe>\n\n' +
    'Then re-run:\n' +
    '    npx vitest run --config vitest.stability.config.ts\n' +
    '    device lifecycle matrix (refresh, Shorts exit, Off→On, dial)\n',
);
process.exit(1);
