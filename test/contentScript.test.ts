// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://shop.example.com/signup"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageType } from '../src/messages';
import { SIGNED_OUT_CTA_COPY } from '../src/pages/Background/constants';
import { FakeExtension, Tab } from './fakes/extension';
import {
  detachContentScriptObservers,
  loadIn,
  settle,
  setup,
  stubClipboard,
} from './harness';

let ext: FakeExtension;
let clipboard: string[];

beforeEach(() => {
  ({ ext } = setup());
  clipboard = stubClipboard();
});

afterEach(detachContentScriptObservers);

type Page = {
  tab: Tab;
  sent: unknown[];
  deliver: (type: MessageType, data: unknown) => Promise<unknown>;
};

const loadPage = async (html: string): Promise<Page> => {
  document.body.innerHTML = html;
  const { tab, content } = ext.openTab(window.location.href);
  const extension = ext.context({ kind: 'page', page: 'popup' });
  const sent = extension.record();
  const { default: main } = await loadIn(
    content,
    () => import('../src/pages/Content/script')
  );
  await main();
  return {
    tab,
    sent,
    deliver: (type, data) =>
      extension.browser.tabs.sendMessage(tab.id, { type, data }),
  };
};

const input = (selector = 'input') =>
  document.querySelector<HTMLInputElement>(selector) as HTMLInputElement;

const suggestion = () =>
  document.querySelector<HTMLButtonElement>('button[data-state]');

const mousedown = (el: Element) =>
  el.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  );

const eventsOn = (el: HTMLElement) => {
  const fired: string[] = [];
  ['input', 'change'].forEach((type) =>
    el.addEventListener(type, () => fired.push(type))
  );
  return fired;
};

describe('suggestion button', () => {
  it.each([
    ['type="email"', '<input type="email">'],
    ['name="email"', '<input type="text" name="email">'],
    ['id="email"', '<input type="text" id="email">'],
  ])(
    'appears right after a focused %s field and asks the extension for an address',
    async (_, html) => {
      const page = await loadPage(`<form>${html}<input name="next"></form>`);

      input().focus();
      await settle();

      const button = suggestion();
      expect(input().nextElementSibling).toBe(button);
      expect(button?.dataset.state).toBe('loading');
      expect(button?.disabled).toBe(true);
      expect(page.sent).toEqual([
        { type: MessageType.GenerateRequest, data: button?.id },
      ]);
    }
  );

  it('does not appear on fields that are not email fields', async () => {
    const page = await loadPage('<input type="text" name="username">');

    input().focus();
    await settle();

    expect(suggestion()).toBeNull();
    expect(page.sent).toEqual([]);
  });

  it.each([
    [
      'the user turned the button off',
      { iCloudHmeOptions: { autofill: { button: false, contextMenu: true } } },
    ],
    ['the user muted this site', { mutedSites: ['shop.example.com'] }],
  ])('does not appear when %s', async (_, stored) => {
    Object.assign(ext.storage, stored);
    const page = await loadPage('<input type="email">');

    input().focus();
    await settle();

    expect(suggestion()).toBeNull();
    expect(page.sent).toEqual([]);
  });

  it('still appears when a different site is muted', async () => {
    ext.storage.mutedSites = ['other.example.com'];
    await loadPage('<input type="email">');
    input().focus();
    await settle();
    expect(suggestion()).not.toBeNull();
  });

  it('shows the generated address as a clickable suggestion', async () => {
    const page = await loadPage('<input type="email">');
    input().focus();
    await settle();

    await page.deliver(MessageType.GenerateResponse, {
      hme: 'new@privaterelay.appleid.com',
      elementId: suggestion()?.id,
    });

    expect(suggestion()?.disabled).toBe(false);
    expect(suggestion()?.textContent).toBe(
      'new@privaterelay.appleid.comClick to fill'
    );
  });

  it('shows a sign-in prompt that opens icloud.com when the user is signed out', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const page = await loadPage('<input type="email">');
    input().focus();
    await settle();

    await page.deliver(MessageType.GenerateResponse, {
      error: SIGNED_OUT_CTA_COPY,
      elementId: suggestion()?.id,
    });
    expect(suggestion()?.textContent).toContain(
      'Sign in to iCloud to use Hide My Email'
    );

    mousedown(suggestion() as HTMLButtonElement);
    await settle();

    expect(open).toHaveBeenCalledWith(
      'https://www.icloud.com',
      '_blank',
      'noopener'
    );
    expect(page.sent).toHaveLength(1);
  });

  it('shows other failures as a disabled error that cannot be clicked', async () => {
    const page = await loadPage('<input type="email">');
    input().focus();
    await settle();

    await page.deliver(MessageType.GenerateResponse, {
      error: 'Error: Limit reached',
      elementId: suggestion()?.id,
    });
    mousedown(suggestion() as HTMLButtonElement);
    await settle();

    expect(suggestion()?.disabled).toBe(true);
    expect(suggestion()?.textContent).toBe('Error: Limit reached');
    expect(page.sent).toHaveLength(1);
  });

  it('asks to reserve the suggested address for this site when clicked', async () => {
    const page = await loadPage('<input type="email">');
    input().focus();
    await settle();
    const elementId = suggestion()?.id;
    await page.deliver(MessageType.GenerateResponse, {
      hme: 'new@privaterelay.appleid.com',
      elementId,
    });

    mousedown(suggestion() as HTMLButtonElement);
    await settle();

    expect(page.sent.at(-1)).toEqual({
      type: MessageType.ReservationRequest,
      data: {
        hme: 'new@privaterelay.appleid.com',
        label: 'shop.example.com',
        elementId,
      },
    });
    expect(suggestion()?.dataset.state).toBe('loading');
  });

  it('does nothing when clicked while still loading', async () => {
    const page = await loadPage('<input type="email">');
    input().focus();
    await settle();

    mousedown(suggestion() as HTMLButtonElement);
    await settle();

    expect(page.sent).toHaveLength(1);
  });

  it('fills the field with the reserved address, notifies the page, and goes away for good', async () => {
    const page = await loadPage('<input type="email">');
    const fired = eventsOn(input());
    input().focus();
    await settle();
    const elementId = suggestion()?.id;

    await page.deliver(MessageType.ReservationResponse, {
      hme: 'new@privaterelay.appleid.com',
      elementId,
    });

    expect(input().value).toBe('new@privaterelay.appleid.com');
    expect(fired).toEqual(['input', 'change']);
    expect(suggestion()).toBeNull();

    input().blur();
    input().focus();
    await settle();
    expect(suggestion()).toBeNull();
    expect(page.sent).toHaveLength(1);
  });

  it('shows a failed reservation on the button and leaves the field empty', async () => {
    const page = await loadPage('<input type="email">');
    input().focus();
    await settle();

    await page.deliver(MessageType.ReservationResponse, {
      error: 'Error: taken',
      elementId: suggestion()?.id,
    });

    expect(suggestion()?.textContent).toBe('Error: taken');
    expect(input().value).toBe('');
  });

  it('disappears when the field loses focus', async () => {
    await loadPage('<input type="email">');
    input().focus();
    await settle();

    input().blur();

    expect(suggestion()).toBeNull();
  });
});

describe('fields added and removed after load', () => {
  it('tracks email fields inside inserted markup', async () => {
    await loadPage('<main></main>');
    const container = document.createElement('div');
    container.innerHTML = '<input type="email">';
    document.querySelector('main')?.append(container);
    await settle();

    input().focus();
    await settle();

    expect(suggestion()).not.toBeNull();
  });

  it('stops filling email fields whose markup was removed', async () => {
    const page = await loadPage(
      '<div id="a"><input type="email" name="a"></div><div id="b"><input type="email" name="b"></div>'
    );
    document.getElementById('a')?.remove();
    await settle();

    await expect(page.deliver(MessageType.Autofill, 'x@y.com')).resolves.toBe(
      1
    );
  });

  it.fails(
    'tracks an email field appended directly to the page (known bug: observer only searches descendants of added nodes)',
    async () => {
      await loadPage('<main></main>');
      const field = document.createElement('input');
      field.type = 'email';
      document.body.append(field);
      await settle();

      field.focus();
      await settle();

      expect(suggestion()).not.toBeNull();
    }
  );

  it.fails(
    'tracks two identical email fields inserted together (known bug: fields are deduplicated with isEqualNode)',
    async () => {
      const page = await loadPage('<main></main>');
      const container = document.createElement('div');
      container.innerHTML = '<input type="email"><input type="email">';
      document.querySelector('main')?.append(container);
      await settle();

      await expect(page.deliver(MessageType.Autofill, 'x@y.com')).resolves.toBe(
        2
      );
    }
  );
});

describe('messages from the popup and context menu', () => {
  it('autofills every email field, notifies the page, and reports how many it filled', async () => {
    const page = await loadPage(
      '<input type="email" name="a"><input type="email" name="b"><input name="other">'
    );
    const fired = eventsOn(input('[name="b"]'));

    const filled = await page.deliver(MessageType.Autofill, 'x@y.com');

    expect(filled).toBe(2);
    expect(input('[name="a"]').value).toBe('x@y.com');
    expect(input('[name="b"]').value).toBe('x@y.com');
    expect(input('[name="other"]').value).toBe('');
    expect(fired).toEqual(['input']);
  });

  it('reports zero filled fields on a page without email fields, so the popup offers copying instead', async () => {
    const page = await loadPage('<input name="search">');
    await expect(page.deliver(MessageType.Autofill, 'x@y.com')).resolves.toBe(
      0
    );
  });

  it('autofills even when the suggestion button is turned off', async () => {
    ext.storage.iCloudHmeOptions = {
      autofill: { button: false, contextMenu: true },
    };
    const page = await loadPage('<input type="email">');
    await expect(page.deliver(MessageType.Autofill, 'x@y.com')).resolves.toBe(
      1
    );
    expect(input().value).toBe('x@y.com');
  });

  it('writes context-menu text into the focused field and copies it when asked', async () => {
    const page = await loadPage('<input name="anything">');
    const fired = eventsOn(input());
    input().focus();

    await page.deliver(MessageType.ActiveInputElementWrite, {
      text: 'new@privaterelay.appleid.com',
      copyToClipboard: true,
    });

    expect(input().value).toBe('new@privaterelay.appleid.com');
    expect(fired).toEqual(['input', 'change']);
    expect(clipboard).toEqual(['new@privaterelay.appleid.com']);
  });

  it('writes status text into the focused field without touching the clipboard', async () => {
    const page = await loadPage('<input name="anything">');
    input().focus();

    await page.deliver(MessageType.ActiveInputElementWrite, {
      text: SIGNED_OUT_CTA_COPY,
      copyToClipboard: false,
    });

    expect(input().value).toBe(SIGNED_OUT_CTA_COPY);
    expect(clipboard).toEqual([]);
  });

  it('writes nothing when the focused element is not an input', async () => {
    const page = await loadPage('<textarea></textarea>');
    document.querySelector('textarea')?.focus();

    await page.deliver(MessageType.ActiveInputElementWrite, {
      text: 'x@y.com',
      copyToClipboard: true,
    });

    expect(document.querySelector('textarea')?.value).toBe('');
    expect(clipboard).toEqual([]);
  });
});
