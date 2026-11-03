// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://shop.example.com/signup"}
import React from 'react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETUP_URL } from '../src/iCloudClient';
import { PopupState } from '../src/pages/Popup/stateMachine';
import { FakeExtension } from './fakes/extension';
import { FakeICloud, PMS_URLS } from './fakes/icloud';
import {
  detachContentScriptObservers,
  loadIn,
  setup,
  startBackground,
  stubClipboard,
} from './harness';

const MENU_ID = 'test-extension-id/hme_generation_and_reservation';

let ext: FakeExtension;
let icloud: FakeICloud;
let clipboard: string[];

beforeEach(() => {
  ({ ext, icloud } = setup());
  clipboard = stubClipboard();
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

// A fresh <body> leaves RTL's `screen` bound to the old body, so query through
// render().
afterEach(detachContentScriptObservers);

const signIn = () => {
  icloud.signIn();
  ext.storage.clientState = {
    setupUrl: DEFAULT_SETUP_URL,
    webservices: {
      premiummailsettings: { url: PMS_URLS[DEFAULT_SETUP_URL], status: '' },
    },
  };
  ext.storage.popupState = PopupState.Authenticated;
};

const startExtension = async (html = '<form><input type="email"></form>') => {
  await startBackground(ext);
  document.body.innerHTML = html;
  const { tab, content } = ext.openTab(window.location.href);
  const { default: main } = await loadIn(
    content,
    () => import('../src/pages/Content/script')
  );
  await main();
  return tab;
};

const emailField = () =>
  document.querySelector<HTMLInputElement>(
    'input[type="email"]'
  ) as HTMLInputElement;

const suggestion = () =>
  document.querySelector<HTMLButtonElement>('button[data-state]');

describe('suggestion button', () => {
  it('suggests an address on focus, then reserves it for the site and fills the field on click', async () => {
    signIn();
    await startExtension();

    emailField().focus();
    await vi.waitFor(() => expect(suggestion()?.dataset.state).toBe('ready'));
    const hme = icloud.generated[0];
    expect(suggestion()?.dataset.hme).toBe(hme);

    suggestion()?.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    );

    await vi.waitFor(() => expect(emailField().value).toBe(hme));
    expect(icloud.address(hme)?.label).toBe('shop.example.com');
    expect(suggestion()).toBeNull();
  });

  it('turns into a sign-in prompt for a signed-out user, reserving nothing and opening no tab', async () => {
    const tab = await startExtension();

    emailField().focus();

    await vi.waitFor(() =>
      expect(suggestion()?.dataset.state).toBe('signed-out')
    );
    expect(icloud.hmeEmails).toEqual([]);
    expect(ext.tabs.map((t) => t.url)).toEqual([tab.url]);
  });
});

describe('context menu', () => {
  it('writes a reserved address into the focused field and onto the clipboard', async () => {
    signIn();
    ext.storage.iCloudHmeOptions = {
      autofill: { button: false, contextMenu: true },
    };
    const tab = await startExtension();
    emailField().focus();

    await ext.clickMenuItem(MENU_ID, tab);

    await vi.waitFor(() =>
      expect(emailField().value).toBe(icloud.generated[0])
    );
    const hme = icloud.generated[0];
    expect(clipboard).toEqual([hme]);
    expect(icloud.address(hme)?.label).toBe('shop.example.com');
  });
});

describe('popup', () => {
  it('"Create and fill" reserves an address titled after the site and fills the page', async () => {
    signIn();
    await startExtension();
    const popup = ext.context({ kind: 'page', page: 'popup' });
    const { default: Popup } = await loadIn(
      popup,
      () => import('../src/pages/Popup/Popup')
    );
    const view = render(<Popup />);
    const user = userEvent.setup();

    await user.click(await view.findByText('Create and fill'));

    expect(await view.findByText('Created and filled in')).toBeTruthy();
    const hme = icloud.generated[0];
    expect(emailField().value).toBe(hme);
    expect(icloud.address(hme)).toMatchObject({
      label: 'shop.example.com',
      note: 'Used on shop.example.com',
    });
  });
});
