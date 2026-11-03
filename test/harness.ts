import { vi } from 'vitest';
import { ExtensionContext, FakeExtension } from './fakes/extension';
import { FakeICloud } from './fakes/icloud';

export async function loadIn<T>(
  context: ExtensionContext,
  load: () => Promise<T>
): Promise<T> {
  vi.resetModules();
  vi.doMock('webextension-polyfill', () => ({ default: context.browser }));
  vi.stubGlobal('chrome', { tabs: context.browser.tabs });
  return load();
}

export function setup(options: { browser?: 'chrome' | 'firefox' } = {}) {
  const ext = new FakeExtension(options);
  const icloud = new FakeICloud();
  vi.stubGlobal('fetch', icloud.fetch);
  return { ext, icloud };
}

export async function startBackground(ext: FakeExtension) {
  const background = ext.context({ kind: 'background' });
  await loadIn(background, () => import('../src/pages/Background/index'));
  return background;
}

export const detachContentScriptObservers = (): void => {
  document.body.replaceWith(document.createElement('body'));
};

export const stubClipboard = (): string[] => {
  const written: string[] = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => void written.push(text) },
  });
  return written;
};

// Uses a real macrotask, so keep `setImmediate` out of fake timers.
export const settle = async (rounds = 5): Promise<void> => {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
