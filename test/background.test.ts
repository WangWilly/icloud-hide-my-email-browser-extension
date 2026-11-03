import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CN_SETUP_URL, DEFAULT_SETUP_URL } from '../src/iCloudClient';
import { MessageType } from '../src/messages';
import {
  LOADING_COPY,
  SIGNED_IN_CTA_COPY,
  SIGNED_OUT_CTA_COPY,
} from '../src/pages/Background/constants';
import { PopupState } from '../src/pages/Popup/stateMachine';
import { ExtensionContext, FakeExtension, Tab } from './fakes/extension';
import { FakeICloud, PMS_URLS, SetupUrl } from './fakes/icloud';
import { settle, setup, startBackground } from './harness';

const MENU_ID = 'test-extension-id/hme_generation_and_reservation';

let ext: FakeExtension;
let icloud: FakeICloud;

beforeEach(() => {
  ({ ext, icloud } = setup());
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

const storedClient = (setupUrl: SetupUrl = DEFAULT_SETUP_URL) => ({
  setupUrl,
  webservices: {
    premiummailsettings: { url: PMS_URLS[setupUrl], status: 'active' },
  },
});

const openPage = (url = 'https://shop.example.com/signup') => {
  const { tab, content } = ext.openTab(url);
  return { tab, content, inbox: content.record() };
};

const requestGeneration = (content: ExtensionContext, elementId = 'btn-1') =>
  content.browser.runtime.sendMessage({
    type: MessageType.GenerateRequest,
    data: elementId,
  });

describe('suggestion requests from a page', () => {
  it('answers a generate request with a fresh address for that button', async () => {
    icloud.signIn();
    ext.storage.clientState = storedClient();
    await startBackground(ext);
    const { content, inbox } = openPage();

    await requestGeneration(content, 'btn-1');

    expect(inbox).toEqual([
      {
        type: MessageType.GenerateResponse,
        data: { hme: icloud.generated[0], elementId: 'btn-1' },
      },
    ]);
  });

  it('remembers a session found without stored state, so later requests skip discovery', async () => {
    icloud.signIn();
    await startBackground(ext);
    const { content } = openPage();

    await requestGeneration(content);
    await settle();

    expect(ext.storage.clientState).toEqual(storedClient());
  });

  it('tells the page to sign in, without opening icloud.com, when nobody ever signed in', async () => {
    await startBackground(ext);
    const { content, inbox } = openPage();
    const tabsBefore = ext.tabs.length;

    await requestGeneration(content, 'btn-1');

    expect(inbox).toEqual([
      {
        type: MessageType.GenerateResponse,
        data: { error: SIGNED_OUT_CTA_COPY, elementId: 'btn-1' },
      },
    ]);
    expect(ext.tabs).toHaveLength(tabsBefore);
    expect(ext.removedTabs).toEqual([]);
  });

  it("passes iCloud's refusal to the page as the button's error", async () => {
    icloud.signIn().fail('POST /v1/hme/generate', {
      errorMessage: 'Limit reached',
    });
    ext.storage.clientState = storedClient();
    await startBackground(ext);
    const { content, inbox } = openPage();

    await requestGeneration(content, 'btn-1');

    expect(inbox).toEqual([
      {
        type: MessageType.GenerateResponse,
        data: { error: 'Error: Limit reached', elementId: 'btn-1' },
      },
    ]);
  });

  it('reserves the clicked address under the page label with the default note', async () => {
    icloud.signIn();
    ext.storage.clientState = storedClient();
    await startBackground(ext);
    const { content, inbox } = openPage();
    await requestGeneration(content);
    const hme = icloud.generated[0];

    await content.browser.runtime.sendMessage({
      type: MessageType.ReservationRequest,
      data: { hme, label: 'shop.example.com', elementId: 'btn-1' },
    });

    expect(icloud.address(hme)).toMatchObject({
      label: 'shop.example.com',
      note: 'Generated through the iCloud Hide My Email browser extension',
    });
    expect(inbox.at(-1)).toEqual({
      type: MessageType.ReservationResponse,
      data: { hme, elementId: 'btn-1' },
    });
  });

  it('reports a failed reservation to the page instead of filling an unreserved address', async () => {
    icloud.signIn();
    ext.storage.clientState = storedClient();
    await startBackground(ext);
    const { content, inbox } = openPage();

    await content.browser.runtime.sendMessage({
      type: MessageType.ReservationRequest,
      data: { hme: 'stale@x.com', label: 'shop', elementId: 'btn-1' },
    });

    expect(inbox).toEqual([
      {
        type: MessageType.ReservationResponse,
        data: {
          error: 'Error: stale@x.com is not available',
          elementId: 'btn-1',
        },
      },
    ]);
    expect(icloud.hmeEmails).toEqual([]);
  });

  it.fails(
    'answers the tab that asked even when another tab has focus (known bug: replies go to the active tab)',
    async () => {
      icloud.signIn();
      ext.storage.clientState = storedClient();
      await startBackground(ext);
      const asking = openPage('https://asking.example.com/');
      const focused = openPage('https://focused.example.com/');

      await requestGeneration(asking.content, 'btn-1');

      expect(focused.inbox).toEqual([]);
      expect(asking.inbox).toHaveLength(1);
    }
  );
});

describe('session renewal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  const renewWhenWebAppLoads = (webAppUrl: string, setupUrl: SetupUrl) => {
    ext.onTabCreated = (tab) => {
      if (tab.url === webAppUrl) {
        icloud.signIn(setupUrl);
      }
    };
  };

  it('renews an expired session in a background tab, closes the tab, and answers with an address', async () => {
    ext.storage.clientState = storedClient();
    renewWhenWebAppLoads('https://www.icloud.com/', DEFAULT_SETUP_URL);
    await startBackground(ext);
    const { content, inbox } = openPage();

    const request = requestGeneration(content, 'btn-1');
    await vi.advanceTimersByTimeAsync(1500);
    await request;
    await settle();

    expect(inbox).toEqual([
      {
        type: MessageType.GenerateResponse,
        data: { hme: icloud.generated[0], elementId: 'btn-1' },
      },
    ]);
    expect(ext.removedTabs).toEqual([
      expect.objectContaining({
        url: 'https://www.icloud.com/',
        active: false,
      }),
    ]);
    expect(ext.tabs.map((t) => t.url)).not.toContain('https://www.icloud.com/');
  });

  it('renews a .com.cn session through icloud.com.cn', async () => {
    ext.storage.clientState = storedClient(CN_SETUP_URL);
    renewWhenWebAppLoads('https://www.icloud.com.cn/', CN_SETUP_URL);
    await startBackground(ext);
    const { content, inbox } = openPage();

    const request = requestGeneration(content);
    await vi.advanceTimersByTimeAsync(1500);
    await request;

    expect(inbox[0]).toMatchObject({ data: { hme: icloud.generated[0] } });
    expect(ext.removedTabs.map((t) => t.url)).toEqual([
      'https://www.icloud.com.cn/',
    ]);
  });

  it('opens one renewal tab for concurrent requests', async () => {
    ext.storage.clientState = storedClient();
    const opened: Tab[] = [];
    ext.onTabCreated = (tab) => {
      opened.push(tab);
      icloud.signIn();
    };
    await startBackground(ext);
    const { content, inbox } = openPage();

    const requests = [
      requestGeneration(content, 'btn-1'),
      requestGeneration(content, 'btn-2'),
    ];
    await vi.advanceTimersByTimeAsync(1500);
    await Promise.all(requests);

    expect(opened).toHaveLength(1);
    expect(
      inbox.map((m) => (m as { data: { hme?: string } }).data.hme)
    ).toEqual([expect.any(String), expect.any(String)]);
  });

  it('keeps polling while the web app takes several seconds to renew the session', async () => {
    ext.storage.clientState = storedClient();
    ext.onTabCreated = () => {
      setTimeout(() => icloud.signIn(), 4000);
    };
    await startBackground(ext);
    const { content, inbox } = openPage();

    const request = requestGeneration(content, 'btn-1');
    await vi.advanceTimersByTimeAsync(4500);
    await request;

    expect(inbox).toEqual([
      {
        type: MessageType.GenerateResponse,
        data: { hme: icloud.generated[0], elementId: 'btn-1' },
      },
    ]);
  });

  it('opens a new renewal tab when the session expires again, instead of reusing the finished renewal', async () => {
    ext.storage.clientState = storedClient();
    const opened: Tab[] = [];
    ext.onTabCreated = (tab) => {
      opened.push(tab);
      icloud.signIn();
    };
    await startBackground(ext);
    const { content, inbox } = openPage();
    const first = requestGeneration(content, 'btn-1');
    await vi.advanceTimersByTimeAsync(1500);
    await first;

    icloud.expireSession();
    const second = requestGeneration(content, 'btn-2');
    await vi.advanceTimersByTimeAsync(1500);
    await second;

    expect(opened).toHaveLength(2);
    expect(inbox.at(-1)).toEqual({
      type: MessageType.GenerateResponse,
      data: { hme: icloud.generated[1], elementId: 'btn-2' },
    });
  });

  it('gives up after 20 s, closes the tab, signs out, and tells the page to sign in', async () => {
    await startBackground(ext);
    await ext.install('update');
    await settle();
    ext.storage.clientState = storedClient();
    ext.storage.popupState = PopupState.Authenticated;
    const { content, inbox } = openPage();

    const request = requestGeneration(content, 'btn-1');
    await vi.advanceTimersByTimeAsync(19_999);
    expect(ext.removedTabs).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_501);
    await request;
    await settle();

    expect(inbox).toEqual([
      {
        type: MessageType.GenerateResponse,
        data: { error: SIGNED_OUT_CTA_COPY, elementId: 'btn-1' },
      },
    ]);
    expect(ext.removedTabs.map((t) => t.url)).toEqual([
      'https://www.icloud.com/',
    ]);
    expect('clientState' in ext.storage).toBe(false);
    expect(ext.storage.popupState).toBe(PopupState.SignedOut);
    expect(ext.menuItem(MENU_ID)).toMatchObject({
      title: SIGNED_OUT_CTA_COPY,
      enabled: false,
    });
  });

  it('signs out instead of hanging when the browser refuses to open the renewal tab', async () => {
    ext.storage.clientState = storedClient();
    ext.failTabCreation = true;
    await startBackground(ext);
    const { content, inbox } = openPage();

    await requestGeneration(content, 'btn-1');
    await settle();

    expect(inbox[0]).toMatchObject({ data: { error: SIGNED_OUT_CTA_COPY } });
    expect('clientState' in ext.storage).toBe(false);
  });

  it('replies to the popup with the renewed client state', async () => {
    ext.storage.clientState = storedClient();
    renewWhenWebAppLoads('https://www.icloud.com/', DEFAULT_SETUP_URL);
    await startBackground(ext);
    const popup = ext.context({ kind: 'page', page: 'popup' });

    const reply = popup.browser.runtime.sendMessage({
      type: MessageType.RenewSessionRequest,
      data: undefined,
    });
    await vi.advanceTimersByTimeAsync(1500);

    await expect(reply).resolves.toEqual(storedClient());
  });

  it('replies to the popup with nothing when no session can be found', async () => {
    await startBackground(ext);
    const popup = ext.context({ kind: 'page', page: 'popup' });

    await expect(
      popup.browser.runtime.sendMessage({
        type: MessageType.RenewSessionRequest,
        data: undefined,
      })
    ).resolves.toBeUndefined();
  });
});

describe('context menu', () => {
  it('on install, adds an item to editable fields and enables it for a signed-in user', async () => {
    icloud.signIn();
    await startBackground(ext);

    await ext.install('install');
    await settle();

    expect(ext.menuItem(MENU_ID)).toEqual({
      id: MENU_ID,
      title: SIGNED_IN_CTA_COPY,
      contexts: ['editable'],
      enabled: true,
      visible: true,
    });
  });

  it('on install, disables the item with a sign-in prompt for a signed-out user', async () => {
    await startBackground(ext);

    await ext.install('install');
    await settle();

    expect(ext.menuItem(MENU_ID)).toMatchObject({
      title: SIGNED_OUT_CTA_COPY,
      enabled: false,
    });
  });

  it('creates the item hidden when the user turned the context menu off', async () => {
    ext.storage.iCloudHmeOptions = {
      autofill: { button: true, contextMenu: false },
    };
    await startBackground(ext);
    await ext.install('update');
    expect(ext.menuItem(MENU_ID)?.visible).toBe(false);
  });

  it('hides and shows the item as the context menu option is toggled', async () => {
    await startBackground(ext);
    await ext.install('update');
    const options = ext.context({ kind: 'page', page: 'options' });

    await options.browser.storage.local.set({
      iCloudHmeOptions: { autofill: { button: true, contextMenu: false } },
    });
    await settle();
    expect(ext.menuItem(MENU_ID)?.visible).toBe(false);

    await options.browser.storage.local.set({
      iCloudHmeOptions: { autofill: { button: true, contextMenu: true } },
    });
    await settle();
    expect(ext.menuItem(MENU_ID)?.visible).toBe(true);
  });

  it('on click, shows loading in the field, then writes and copies a reserved address labelled with the site', async () => {
    icloud.signIn();
    ext.storage.clientState = storedClient();
    await startBackground(ext);
    const { tab, inbox } = openPage('https://shop.example.com/signup');

    await ext.clickMenuItem(MENU_ID, tab);
    await settle();

    const hme = icloud.generated[0];
    expect(inbox).toEqual([
      {
        type: MessageType.ActiveInputElementWrite,
        data: { text: LOADING_COPY },
      },
      {
        type: MessageType.ActiveInputElementWrite,
        data: { text: hme, copyToClipboard: true },
      },
    ]);
    expect(icloud.address(hme)?.label).toBe('shop.example.com');
  });

  it('on click while signed out, writes the sign-in prompt without copying it', async () => {
    await startBackground(ext);
    const { tab, inbox } = openPage();

    await ext.clickMenuItem(MENU_ID, tab);
    await settle();

    expect(inbox.at(-1)).toEqual({
      type: MessageType.ActiveInputElementWrite,
      data: { text: SIGNED_OUT_CTA_COPY, copyToClipboard: false },
    });
  });

  it('on click, writes the failure without copying it and reserves nothing', async () => {
    icloud.signIn().fail('POST /v1/hme/generate', { errorMessage: 'Nope' });
    ext.storage.clientState = storedClient();
    await startBackground(ext);
    const { tab, inbox } = openPage();

    await ext.clickMenuItem(MENU_ID, tab);
    await settle();

    expect(inbox.at(-1)).toEqual({
      type: MessageType.ActiveInputElementWrite,
      data: { text: 'Error: Nope', copyToClipboard: false },
    });
    expect(icloud.hmeEmails).toEqual([]);
  });

  it("ignores clicks on other extensions' menu items", async () => {
    icloud.signIn();
    await startBackground(ext);
    const { tab, inbox } = openPage();

    await ext.clickMenuItem('someone-else', tab);
    await settle();

    expect(inbox).toEqual([]);
    expect(icloud.generated).toEqual([]);
  });

  it('creates the item at startup on Firefox, which forgets menus across restarts', async () => {
    ({ ext, icloud } = setup({ browser: 'firefox' }));
    await startBackground(ext);
    expect(ext.menuItem(MENU_ID)).toBeDefined();
  });

  it('waits for onInstalled on Chrome, which persists menus across restarts', async () => {
    await startBackground(ext);
    expect(ext.menuItem(MENU_ID)).toBeUndefined();
  });
});

describe('install and icloud.com sign-in sync', () => {
  it('opens the user guide on first install only', async () => {
    await startBackground(ext);

    await ext.install('update');
    expect(ext.tabs.map((t) => t.url)).toEqual([]);

    await ext.install('install');
    await settle();
    expect(ext.tabs.map((t) => t.url)).toEqual([
      'chrome-extension://test-extension-id/userguide.html',
    ]);
  });

  it('on install, notifies a user who is already signed in and stores their session', async () => {
    icloud.signIn();
    await startBackground(ext);

    await ext.install('install');
    await settle();

    expect(ext.notifications).toEqual([
      expect.objectContaining({
        title: 'iCloud HideMyEmail Extension',
        message: 'The iCloud HideMyEmail extension is ready to use!',
      }),
    ]);
    expect(ext.storage.clientState).toEqual(storedClient());
  });

  it('picks up a sign-in on icloud.com: stores the session, enables the menu, notifies', async () => {
    await startBackground(ext);
    await ext.install('update');
    icloud.signIn();

    await ext.respond(`${DEFAULT_SETUP_URL}/accountLogin?clientId=1`, 200);
    await settle();

    expect(ext.storage.clientState).toEqual(storedClient());
    expect(ext.menuItem(MENU_ID)).toMatchObject({
      title: SIGNED_IN_CTA_COPY,
      enabled: true,
    });
    expect(ext.notifications).toHaveLength(1);
  });

  it('ignores an accountLogin response that did not produce a session', async () => {
    await startBackground(ext);

    await ext.respond(`${CN_SETUP_URL}/accountLogin`, 200);
    await settle();

    expect('clientState' in ext.storage).toBe(false);
    expect(ext.notifications).toEqual([]);
  });

  it('picks up a sign-out on icloud.com: forgets the session and disables the menu', async () => {
    icloud.signIn();
    ext.storage.clientState = storedClient();
    ext.storage.popupState = PopupState.AuthenticatedAndManaging;
    await startBackground(ext);
    await ext.install('update');
    await settle();

    await ext.respond(`${DEFAULT_SETUP_URL}/logout?clientId=1`, 200);
    await settle();

    expect('clientState' in ext.storage).toBe(false);
    expect(ext.storage.popupState).toBe(PopupState.SignedOut);
    expect(ext.menuItem(MENU_ID)).toMatchObject({
      title: SIGNED_OUT_CTA_COPY,
      enabled: false,
    });
  });

  it.fails(
    'keeps the session when the icloud.com logout request fails (known bug: inverted status guard at Background/index.ts:337)',
    async () => {
      icloud.signIn();
      ext.storage.clientState = storedClient();
      await startBackground(ext);

      await ext.respond(`${DEFAULT_SETUP_URL}/logout`, 500);
      await settle();

      expect(ext.storage.clientState).toEqual(storedClient());
    }
  );
});
