// @vitest-environment jsdom
import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent, { UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CN_SETUP_URL, DEFAULT_SETUP_URL, HmeEmail } from '../src/iCloudClient';
import { MessageType } from '../src/messages';
import {
  SIGNED_IN_CTA_COPY,
  SIGNED_OUT_CTA_COPY,
} from '../src/pages/Background/constants';
import { PopupState } from '../src/pages/Popup/stateMachine';
import { FakeExtension } from './fakes/extension';
import { FakeICloud, PMS_URLS, SetupUrl, hmeEmail } from './fakes/icloud';
import { loadIn, settle, setup, startBackground } from './harness';

const MENU_ID = 'test-extension-id/hme_generation_and_reservation';

let ext: FakeExtension;
let icloud: FakeICloud;
let user: UserEvent;
let autofills: string[];

beforeEach(() => {
  ({ ext, icloud } = setup());
  user = userEvent.setup();
  autofills = [];
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

const storedClient = (setupUrl: SetupUrl = DEFAULT_SETUP_URL) => ({
  setupUrl,
  webservices: {
    premiummailsettings: { url: PMS_URLS[setupUrl], status: 'active' },
  },
});

const signedIn = (popupState: PopupState) => {
  icloud.signIn();
  ext.storage.clientState = storedClient();
  ext.storage.popupState = popupState;
};

const openPopup = async (
  options: { tabUrl?: string; emailFields?: number } = {}
) => {
  const { tabUrl = 'https://shop.example.com/signup', emailFields = 1 } =
    options;
  ext.createMenuItem({ id: MENU_ID });
  const { content } = ext.openTab(tabUrl);
  content.onMessage.addListener((message) => {
    const { type, data } = message as { type: MessageType; data: string };
    if (type !== MessageType.Autofill) {
      return undefined;
    }
    autofills.push(data);
    return Promise.resolve(emailFields);
  });

  const popup = ext.context({ kind: 'page', page: 'popup' });
  const { default: Popup } = await loadIn(
    popup,
    () => import('../src/pages/Popup/Popup')
  );
  // No StrictMode: production builds do not double-run effects, and a doubled
  // generate request would hide or fake bugs in request counting.
  render(<Popup />);
};

const closeSpy = () =>
  vi.spyOn(window, 'close').mockImplementation(() => undefined);

describe('signed out', () => {
  it('shows sign-in instructions when no session is stored', async () => {
    await openPopup();
    expect(
      await screen.findByText('Sign in to iCloud, then come back here.')
    ).toBeTruthy();
    expect(ext.storage.popupState).toBe(PopupState.SignedOut);
  });

  it('"Check again" finds a .com.cn session, stores it, enables the menu, and moves on', async () => {
    await openPopup();
    icloud.signIn(CN_SETUP_URL);

    await user.click(await screen.findByText('Already signed in? Check again'));

    expect(await screen.findByText("You're about to create")).toBeTruthy();
    expect(ext.storage.clientState).toEqual(storedClient(CN_SETUP_URL));
    expect(ext.storage.popupState).toBe(PopupState.Authenticated);
    expect(ext.menuItem(MENU_ID)).toMatchObject({
      title: SIGNED_IN_CTA_COPY,
      enabled: true,
    });
  });

  it('"Check again" says so when there is still no session anywhere', async () => {
    await openPopup();
    await user.click(await screen.findByText('Already signed in? Check again'));
    expect(
      await screen.findByText('Still signed out. Check again')
    ).toBeTruthy();
    expect('clientState' in ext.storage).toBe(false);
  });

  it('falls back to signed out when the stored session expired and the background cannot renew it', async () => {
    ext.storage.clientState = storedClient();
    ext.storage.popupState = PopupState.Authenticated;

    await openPopup();

    expect(
      await screen.findByText('Sign in to iCloud, then come back here.')
    ).toBeTruthy();
    expect(ext.storage.popupState).toBe(PopupState.SignedOut);
    expect('clientState' in ext.storage).toBe(false);
    expect(ext.menuItem(MENU_ID)).toMatchObject({
      title: SIGNED_OUT_CTA_COPY,
      enabled: false,
    });
  });

  it('reconnects through the background worker when the stored session expired', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    ext.storage.clientState = storedClient();
    ext.storage.popupState = PopupState.Authenticated;
    ext.onTabCreated = () => void icloud.signIn();
    await startBackground(ext);

    await openPopup();
    await act(() => settle());
    expect(screen.getByText('Reconnecting to iCloud…')).toBeTruthy();

    await act(() => vi.advanceTimersByTimeAsync(1500));

    await vi.waitFor(() =>
      expect(screen.getByText("You're about to create")).toBeTruthy()
    );
    expect(ext.storage.popupState).toBe(PopupState.Authenticated);
  });
});

describe('creating an address', () => {
  beforeEach(() => signedIn(PopupState.Authenticated));

  const shownAddress = async () => {
    await screen.findByText(/^generated-1@/);
    return icloud.generated[0];
  };

  it('opens on the generator for a popupState of 0 persisted by earlier versions', async () => {
    ext.storage.popupState = 0;
    await openPopup();
    expect(await screen.findByText("You're about to create")).toBeTruthy();
  });

  it('reserves the shown address titled with the site, fills it on the page, and says so', async () => {
    await openPopup();
    const hme = await shownAddress();

    await user.click(screen.getByText('Create and fill'));

    expect(await screen.findByText('Created and filled in')).toBeTruthy();
    expect(icloud.address(hme)).toMatchObject({
      label: 'shop.example.com',
      note: 'Used on shop.example.com',
    });
    expect(autofills).toEqual([hme]);
  });

  it('says it only created the address when the page has no email field', async () => {
    await openPopup({ emailFields: 0 });
    await shownAddress();

    await user.click(screen.getByText('Create and fill'));

    expect(await screen.findByText('Created')).toBeTruthy();
    expect(
      screen.getByText('No email field on this page. Copy the address instead.')
    ).toBeTruthy();
  });

  it('copies the created address', async () => {
    await openPopup({ emailFields: 0 });
    const hme = await shownAddress();
    await user.click(screen.getByText('Create and fill'));

    await user.click(await screen.findByText('Copy address'));

    expect(await navigator.clipboard.readText()).toBe(hme);
    expect(screen.getByText('Copied')).toBeTruthy();
  });

  it('reserves under an edited title', async () => {
    await openPopup();
    const hme = await shownAddress();

    await user.click(screen.getByRole('button', { name: 'Edit title' }));
    await user.clear(screen.getByRole('textbox', { name: 'Title' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Title' }),
      ' Shop {Enter}'
    );
    await user.click(screen.getByText('Create and fill'));

    await screen.findByText('Created and filled in');
    expect(icloud.address(hme)?.label).toBe('Shop');
  });

  it('falls back to the site as title when the title is cleared', async () => {
    await openPopup();
    const hme = await shownAddress();

    await user.click(screen.getByRole('button', { name: 'Edit title' }));
    await user.clear(screen.getByRole('textbox', { name: 'Title' }));
    await user.keyboard('{Enter}');
    await user.click(screen.getByText('Create and fill'));

    await screen.findByText('Created and filled in');
    expect(icloud.address(hme)?.label).toBe('shop.example.com');
  });

  it('shows a different address on refresh', async () => {
    await openPopup();
    await shownAddress();

    await user.click(
      screen.getByRole('button', { name: 'Generate a different address' })
    );

    expect(await screen.findByText(/^generated-2@/)).toBeTruthy();
  });

  it('explains a failed reservation and retries the same address, not a new one', async () => {
    icloud.fail('POST /v1/hme/reserve', { status: 503 });
    await openPopup();
    const hme = await shownAddress();

    await user.click(screen.getByText('Create and fill'));
    expect(
      await screen.findByText('HTTP 503 from p68-maildomainws.icloud.com')
    ).toBeTruthy();
    expect(icloud.hmeEmails).toEqual([]);

    icloud.recover('POST /v1/hme/reserve');
    await user.click(screen.getByText('Try again'));

    expect(await screen.findByText('Created and filled in')).toBeTruthy();
    expect(icloud.generated).toEqual([hme]);
    expect(icloud.address(hme)).toBeDefined();
  });

  it('retries generation when generation failed', async () => {
    icloud.fail('POST /v1/hme/generate', { errorMessage: 'Limit reached' });
    await openPopup();
    expect(await screen.findByText('Limit reached')).toBeTruthy();

    icloud.recover('POST /v1/hme/generate');
    await user.click(screen.getByText('Try again'));

    expect(await screen.findByText(/^generated-1@/)).toBeTruthy();
  });

  it('mutes and unmutes suggestions on the current site', async () => {
    ext.storage.mutedSites = ['other.example.com'];
    await openPopup();

    await user.click(await screen.findByText("Don't suggest on this site"));
    expect(ext.storage.mutedSites).toEqual([
      'other.example.com',
      'shop.example.com',
    ]);

    await user.click(screen.getByText('Suggest on this site again'));
    expect(ext.storage.mutedSites).toEqual(['other.example.com']);
  });
});

describe('addresses saved for the current site', () => {
  beforeEach(() => {
    signedIn(PopupState.Authenticated);
    icloud.hmeEmails = [
      hmeEmail({ hme: 'saved@x.com', label: 'www.Shop.Example.com' }),
      hmeEmail({
        hme: 'by-domain@x.com',
        label: 'misc',
        domain: 'shop.example.com',
      }),
      hmeEmail({
        hme: 'off@x.com',
        label: 'shop.example.com',
        isActive: false,
      }),
      hmeEmail({ hme: 'elsewhere@x.com', label: 'other.example.com' }),
    ];
  });

  it('offers only active addresses whose label or domain is this site, ignoring www and case', async () => {
    await openPopup();

    await user.click(
      await screen.findByText('Or use one of 2 addresses saved for this site')
    );

    const rows = screen
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
      .filter((t) => t.includes('@x.com'));
    expect(rows.map((t) => t.split('@x.com')[0])).toEqual([
      'saved',
      'by-domain',
    ]);
  });

  it('fills a saved address and closes the popup', async () => {
    const close = closeSpy();
    await openPopup();
    await user.click(
      await screen.findByText('Or use one of 2 addresses saved for this site')
    );

    await user.click(screen.getByText('saved@x.com'));

    expect(autofills).toEqual(['saved@x.com']);
    expect(close).toHaveBeenCalled();
  });

  it('copies a saved address instead when the page has no email field', async () => {
    const close = closeSpy();
    await openPopup({ emailFields: 0 });
    await user.click(
      await screen.findByText('Or use one of 2 addresses saved for this site')
    );

    await user.click(screen.getByText('saved@x.com'));

    expect(await navigator.clipboard.readText()).toBe('saved@x.com');
    expect(
      await screen.findByText(
        'No email field on this page. Address copied instead.'
      )
    ).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });
});

describe('managing addresses', () => {
  const address = (n: number, overrides: Partial<HmeEmail> = {}) =>
    hmeEmail({
      hme: `addr-${n}@x.com`,
      anonymousId: `id-${n}`,
      label: `site-${n}.com`,
      createTimestamp: Date.UTC(2024, 0, n),
      ...overrides,
    });

  beforeEach(() => signedIn(PopupState.AuthenticatedAndManaging));

  const addressRows = () =>
    screen
      .getAllByRole('button')
      .map((b) => b.textContent?.match(/^addr-\d+@x\.com/)?.[0])
      .filter(Boolean);

  it('opens the manager for a popupState of 2 persisted by earlier versions', async () => {
    ext.storage.popupState = 2;
    await openPopup();
    expect(await screen.findByText('Nothing here yet.')).toBeTruthy();
  });

  it('lists the five newest first and reveals the rest on demand', async () => {
    icloud.hmeEmails = [1, 7, 3, 5, 2, 6, 4].map((n) =>
      address(n, { isActive: n !== 4 })
    );
    await openPopup();

    expect(await screen.findByText('7 addresses · 1 deactivated')).toBeTruthy();
    expect(addressRows()).toEqual([
      'addr-7@x.com',
      'addr-6@x.com',
      'addr-5@x.com',
      'addr-4@x.com',
      'addr-3@x.com',
    ]);

    await user.click(screen.getByText('Show all 7'));
    expect(addressRows()).toHaveLength(7);
  });

  it('searches every address by title, not just the first five', async () => {
    icloud.hmeEmails = [1, 2, 3, 4, 5, 6].map((n) => address(n));
    icloud.hmeEmails[0].label = 'bakery.example';
    await openPopup();
    await screen.findByText('6 addresses');

    await user.type(
      screen.getByRole('searchbox', { name: 'Search addresses or sites' }),
      'bakery'
    );

    expect(addressRows()).toEqual(['addr-1@x.com']);
  });

  it('says when nothing matches the search', async () => {
    icloud.hmeEmails = [address(1)];
    await openPopup();
    await user.type(
      await screen.findByRole('searchbox', {
        name: 'Search addresses or sites',
      }),
      'zzzzzz'
    );
    expect(screen.getByText('No addresses match "zzzzzz".')).toBeTruthy();
  });

  it('shows why the list could not load', async () => {
    icloud.fail('GET /v2/hme/list', { status: 500 });
    await openPopup();
    expect(
      await screen.findByText('HTTP 500 from p68-maildomainws.icloud.com')
    ).toBeTruthy();
  });

  it('goes to the generator from an empty list', async () => {
    await openPopup();
    await user.click(
      await screen.findByText('Create one for shop.example.com')
    );
    expect(await screen.findByText("You're about to create")).toBeTruthy();
    expect(ext.storage.popupState).toBe(PopupState.Authenticated);
  });

  it('deactivates and reactivates an address', async () => {
    icloud.hmeEmails = [address(1)];
    await openPopup();
    await user.click(await screen.findByText('addr-1@x.com'));

    await user.click(screen.getByText('Deactivate this address'));
    expect(
      await screen.findByText('Deactivated · mail is rejected')
    ).toBeTruthy();
    expect(icloud.hmeEmails[0].isActive).toBe(false);

    await user.click(screen.getByText('Reactivate'));
    expect(await screen.findByText('Active · receiving mail')).toBeTruthy();
    expect(icloud.hmeEmails[0].isActive).toBe(true);
  });

  it('keeps the address active and shows why when deactivation fails', async () => {
    icloud.hmeEmails = [address(1)];
    icloud.fail('POST /v1/hme/deactivate', { errorMessage: 'nope' });
    await openPopup();
    await user.click(await screen.findByText('addr-1@x.com'));

    await user.click(screen.getByText('Deactivate this address'));

    expect(await screen.findByText('Failed to deactivate HME')).toBeTruthy();
    expect(screen.getByText('Active · receiving mail')).toBeTruthy();
  });

  it('deletes a deactivated address only on the second click', async () => {
    icloud.hmeEmails = [address(1, { isActive: false }), address(2)];
    await openPopup();
    await user.click(await screen.findByText('addr-1@x.com'));

    await user.click(screen.getByText('Delete address'));
    expect(icloud.hmeEmails).toHaveLength(2);

    await user.click(screen.getByText('Click again to delete'));

    expect(await screen.findByText('1 address')).toBeTruthy();
    expect(icloud.hmeEmails.map((e) => e.hme)).toEqual(['addr-2@x.com']);
    expect(addressRows()).toEqual(['addr-2@x.com']);
  });

  it('forgets a pending delete confirmation once focus moves away', async () => {
    icloud.hmeEmails = [address(1, { isActive: false })];
    await openPopup();
    await user.click(await screen.findByText('addr-1@x.com'));
    await user.click(screen.getByText('Delete address'));

    await user.tab();
    await user.click(screen.getByText('Delete address'));

    expect(screen.getByText('Click again to delete')).toBeTruthy();
    expect(icloud.requestsTo('POST /v1/hme/delete')).toEqual([]);
    expect(icloud.hmeEmails).toHaveLength(1);
  });

  it('keeps the address and shows why when deletion fails', async () => {
    icloud.hmeEmails = [address(1, { isActive: false })];
    icloud.fail('POST /v1/hme/delete', { errorMessage: 'nope' });
    await openPopup();
    await user.click(await screen.findByText('addr-1@x.com'));

    await user.click(screen.getByText('Delete address'));
    await user.click(screen.getByText('Click again to delete'));

    expect(await screen.findByText('Failed to delete HME')).toBeTruthy();
    expect(screen.getByText('Deactivated · mail is rejected')).toBeTruthy();
    expect(icloud.hmeEmails).toHaveLength(1);
  });

  it('saves an edited note to iCloud', async () => {
    icloud.hmeEmails = [address(1)];
    await openPopup();
    await user.click(await screen.findByText('addr-1@x.com'));

    await user.click(screen.getByRole('button', { name: 'Edit note' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Note' }),
      'newsletter{Enter}'
    );

    await vi.waitFor(() => expect(icloud.hmeEmails[0].note).toBe('newsletter'));
    expect(screen.getByText('newsletter')).toBeTruthy();
  });

  it('rolls an edited title back and shows the error when iCloud rejects it', async () => {
    icloud.hmeEmails = [address(1)];
    icloud.fail('POST /v1/hme/updateMetaData', { errorMessage: 'nope' });
    await openPopup();
    await user.click(await screen.findByText('addr-1@x.com'));

    await user.click(screen.getByRole('button', { name: 'Edit title' }));
    await user.clear(screen.getByRole('textbox', { name: 'Title' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Title' }),
      'renamed{Enter}'
    );

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Failed to update HME metadata'
    );
    expect(screen.getByText('site-1.com')).toBeTruthy();
    expect(screen.queryByText('renamed')).toBeNull();
    expect(icloud.hmeEmails[0].label).toBe('site-1.com');
  });

  it('fills the address on the page and closes, or says the page has no email field', async () => {
    icloud.hmeEmails = [address(1)];
    const close = closeSpy();
    await openPopup({ emailFields: 0 });
    await user.click(await screen.findByText('addr-1@x.com'));

    await user.click(screen.getByText('Fill in on this page'));

    expect(autofills).toEqual(['addr-1@x.com']);
    expect(
      await screen.findByText('No email field on this page.')
    ).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });
});

describe('signing out', () => {
  it('ends the iCloud session, forgets it locally, and returns to the instructions', async () => {
    signedIn(PopupState.Authenticated);
    await openPopup();

    const footer = await screen.findByText('Manage addresses');
    await user.click(
      within(footer.closest('div')?.parentElement as HTMLElement).getByText(
        'Sign out'
      )
    );

    expect(
      await screen.findByText('Sign in to iCloud, then come back here.')
    ).toBeTruthy();
    expect(icloud.requestsTo('POST /logout')).toHaveLength(1);
    expect(icloud.sessions.size).toBe(0);
    expect('clientState' in ext.storage).toBe(false);
    expect(ext.storage.popupState).toBe(PopupState.SignedOut);
    expect(ext.menuItem(MENU_ID)).toMatchObject({
      title: SIGNED_OUT_CTA_COPY,
      enabled: false,
    });
  });
});
