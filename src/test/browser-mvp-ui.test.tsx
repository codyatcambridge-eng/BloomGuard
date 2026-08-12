import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BrowserHeader } from '@/components/browser/BrowserHeader';
import { SafeBrowserHomepage } from '@/components/browser/SafeBrowserHomepage';

describe('Focus Browser MVP UI', () => {
  it('offers the supported social quick launches', () => {
    const onSearch = vi.fn();
    render(<SafeBrowserHomepage onSearch={onSearch} />);

    for (const label of ['YouTube', 'Instagram', 'TikTok', 'Snapchat', 'Facebook', 'X', 'Reddit']) {
      expect(screen.getByRole('button', { name: `Open ${label}` })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Open TikTok' }));
    expect(onSearch).toHaveBeenCalledWith('https://www.tiktok.com');
  });

  it('does not render development markers or decorative shield icons', () => {
    const { container } = render(<SafeBrowserHomepage onSearch={vi.fn()} />);

    expect(screen.queryByText(/FUN HOME MARKER/i)).not.toBeInTheDocument();
    expect(container.querySelector('[data-lucide="shield"]')).not.toBeInTheDocument();
  });

  it('keeps browser protection status without a decorative header shield', () => {
    const { container } = render(
      <BrowserHeader
        currentView="home"
        displayUrl=""
        urlInput=""
        onUrlChange={vi.fn()}
        onSubmit={vi.fn()}
        onBack={vi.fn()}
        onForward={vi.fn()}
        onRefresh={vi.fn()}
        onHome={vi.fn()}
        canGoBack={false}
        canGoForward={false}
        isProtected
      />,
    );

    expect(screen.getByText('PROTECTED')).toBeInTheDocument();
    expect(container.querySelector('[data-lucide="shield"]')).not.toBeInTheDocument();
  });

  it('does not mount the legacy in-browser shield control', () => {
    const browserSource = readFileSync(
      resolve(process.cwd(), 'src/components/browser/NativeWebViewBrowser.tsx'),
      'utf8',
    );

    expect(browserSource).not.toContain('<BlurShieldOverlay');
    expect(browserSource).not.toContain("from './BlurShieldOverlay'");
  });

  it('reasserts authoritative controls after an existing injection accepts host sync', () => {
    const browserSource = readFileSync(
      resolve(process.cwd(), 'src/components/browser/NativeWebViewBrowser.tsx'),
      'utf8',
    );
    const syncBranch = browserSource.slice(
      browserSource.indexOf('if (syncApplied)'),
      browserSource.indexOf('const config =', browserSource.indexOf('if (syncApplied)')),
    );

    expect(syncBranch).toContain('window.__MW_APPLY_SENSITIVITY__');
    expect(syncBranch).toContain("'host_context_sync'");
    expect(syncBranch).toContain('window.__MW_FLASH_SHIELD_SET__');
  });
});
