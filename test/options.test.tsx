// @vitest-environment jsdom
import React from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent, { UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETUP_URL } from '../src/iCloudClient';
import { FakeExtension } from './fakes/extension';
import { FakeICloud, PMS_URLS } from './fakes/icloud';
import { loadIn, settle, setup } from './harness';

let ext: FakeExtension;
let icloud: FakeICloud;
let user: UserEvent;

beforeEach(() => {
  ({ ext, icloud } = setup());
  user = userEvent.setup();
});

const openOptions = async () => {
  const page = ext.context({ kind: 'page', page: 'options' });
  const { default: Options } = await loadIn(
    page,
    () => import('../src/pages/Options/Options')
  );
  render(<Options />);
};

describe('autofill settings', () => {
  it('starts with both suggestion surfaces on when nothing is stored', async () => {
    await openOptions();
    for (const name of ['Email fields', 'Right-click menu']) {
      expect(
        screen.getByRole('switch', { name }).getAttribute('aria-checked')
      ).toBe('true');
    }
  });

  it('turns one surface off without touching the other', async () => {
    ext.storage.iCloudHmeOptions = {
      autofill: { button: true, contextMenu: false },
    };
    await openOptions();
    const button = screen.getByRole('switch', { name: 'Email fields' });
    await act(() => settle());

    await user.click(button);

    expect(ext.storage.iCloudHmeOptions).toEqual({
      autofill: { button: false, contextMenu: false },
    });
    expect(button.getAttribute('aria-checked')).toBe('false');
  });

  it('turns the context menu back on and keeps the button setting', async () => {
    ext.storage.iCloudHmeOptions = {
      autofill: { button: false, contextMenu: false },
    };
    await openOptions();
    await act(() => settle());

    await user.click(screen.getByRole('switch', { name: 'Right-click menu' }));

    expect(ext.storage.iCloudHmeOptions).toEqual({
      autofill: { button: false, contextMenu: true },
    });
  });
});

describe('muted sites', () => {
  it('unmutes only the chosen site', async () => {
    ext.storage.mutedSites = ['a.example.com', 'b.example.com'];
    await openOptions();

    const [first] = await screen.findAllByText('Unmute');
    await user.click(first);

    expect(ext.storage.mutedSites).toEqual(['b.example.com']);
    expect(screen.queryByText('a.example.com')).toBeNull();
  });

  it('says when no site is muted', async () => {
    await openOptions();
    expect(screen.getByText('None')).toBeTruthy();
  });
});

describe('forwarding address', () => {
  const signIn = () => {
    icloud.signIn();
    ext.storage.clientState = {
      setupUrl: DEFAULT_SETUP_URL,
      webservices: {
        premiummailsettings: { url: PMS_URLS[DEFAULT_SETUP_URL], status: '' },
      },
    };
  };

  it('asks a signed-out user to sign in through the popup', async () => {
    await openOptions();
    expect(
      await screen.findByText(
        'Sign in through the extension pop-up to change where mail goes.'
      )
    ).toBeTruthy();
  });

  it('switches where new mail goes and marks it current', async () => {
    signIn();
    await openOptions();
    const other = await screen.findByRole('radio', {
      name: /other@example\.com/,
    });
    const update = screen.getByText('Update forwarding address');
    expect(update.closest('button')?.disabled).toBe(true);

    await user.click(other);
    await user.click(update);

    expect(icloud.selectedForwardTo).toBe('other@example.com');
    const current = await screen.findByRole<HTMLInputElement>('radio', {
      name: /other@example\.com\s*Current/,
    });
    expect(current.checked).toBe(true);
  });

  it('shows why the forwarding address could not change', async () => {
    signIn();
    icloud.fail('POST /v1/hme/updateForwardTo', { errorMessage: 'nope' });
    await openOptions();

    await user.click(
      await screen.findByRole('radio', { name: /other@example\.com/ })
    );
    await user.click(screen.getByText('Update forwarding address'));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Error: Failed to update the Forward To email.'
    );
    expect(icloud.selectedForwardTo).toBe('me@icloud.com');
  });
});

describe('useBrowserStorageState', () => {
  const loadHook = async () => {
    const page = ext.context({ kind: 'page', page: 'options' });
    return (await loadIn(page, () => import('../src/hooks')))
      .useBrowserStorageState;
  };

  it('starts from the initial value, then shows the stored one', async () => {
    ext.storage.mutedSites = ['stored.example.com'];
    const useBrowserStorageState = await loadHook();
    const { result } = renderHook(() =>
      useBrowserStorageState('mutedSites', [])
    );
    expect(result.current[0]).toEqual([]);
    expect(result.current[2]).toBe(true);

    await act(() => settle());

    expect(result.current[0]).toEqual(['stored.example.com']);
    expect(result.current[2]).toBe(false);
  });

  it('removes the key from storage when set to undefined', async () => {
    ext.storage.clientState = { setupUrl: DEFAULT_SETUP_URL };
    const useBrowserStorageState = await loadHook();
    const { result } = renderHook(() =>
      useBrowserStorageState('clientState', undefined)
    );
    await act(() => settle());

    act(() => result.current[1](undefined));
    await act(() => settle());

    expect('clientState' in ext.storage).toBe(false);
  });

  it.fails(
    'keeps a value set before the stored one finished loading (known bug: the late load overwrites it)',
    async () => {
      ext.storage.mutedSites = ['old.example.com'];
      const useBrowserStorageState = await loadHook();
      const { result } = renderHook(() =>
        useBrowserStorageState('mutedSites', [])
      );

      act(() => result.current[1](['new.example.com']));
      await act(() => settle());

      expect(ext.storage.mutedSites).toEqual(['new.example.com']);
      expect(result.current[0]).toEqual(['new.example.com']);
    }
  );
});
