import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SafeBrowser from '@/pages/SafeBrowser';

describe('SafeBrowser route', () => {
  it('renders without throwing', () => {
    expect(() => {
      render(
        <MemoryRouter initialEntries={['/browser']}>
          <Routes>
            <Route path="/browser" element={<SafeBrowser />} />
          </Routes>
        </MemoryRouter>,
      );
    }).not.toThrow();
  });
});
