import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      id: 'static-import',
      getURL: (path: string) => `chrome-extension://static-import/${path}`,
    },
  },
}));

afterEach(() => {
  vi.useRealTimers();
  if (typeof document !== 'undefined') {
    cleanup();
    document.body.replaceChildren();
  }
});
