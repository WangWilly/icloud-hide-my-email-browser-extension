type AnyFn = (...args: never[]) => unknown;

export class FakeEvent<F extends AnyFn> {
  private listeners: F[] = [];

  addListener(listener: F): void {
    this.listeners.push(listener);
  }

  hasListeners(): boolean {
    return this.listeners.length > 0;
  }

  async dispatch(...args: Parameters<F>): Promise<void> {
    await Promise.allSettled(this.listeners.map((l) => l(...args)));
  }

  // runtime.onMessage semantics (webextension-polyfill): the first listener
  // that returns a promise owns the reply.
  async dispatchMessage(...args: Parameters<F>): Promise<unknown> {
    const replies = this.listeners
      .map((l) => l(...args))
      .filter((reply) => reply !== undefined);
    return replies.length > 0 ? await replies[0] : undefined;
  }
}

export type Tab = {
  id: number;
  windowId: number;
  url: string;
  active: boolean;
};

export type MenuItem = {
  id: string;
  title?: string;
  contexts?: string[];
  enabled?: boolean;
  visible?: boolean;
};

export type Notification = {
  type: string;
  title: string;
  message: string;
  iconUrl: string;
};

export type ContextKind =
  | { kind: 'background' }
  | { kind: 'page'; page: 'popup' | 'options' }
  | { kind: 'content'; tabId: number };

type MessageSender = { id: string; tab?: Tab };
type MessageListener = (message: unknown, sender: MessageSender) => unknown;
type StorageChanges = Record<
  string,
  { oldValue?: unknown; newValue?: unknown }
>;
type ResponseStartedDetails = { url: string; statusCode: number };
type ResponseStartedListener = (details: ResponseStartedDetails) => unknown;

const NO_RECEIVER =
  'Could not establish connection. Receiving end does not exist.';

const globToRegExp = (pattern: string): RegExp =>
  new RegExp(
    `^${pattern
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`
  );

export class ExtensionContext {
  readonly onMessage = new FakeEvent<MessageListener>();
  readonly browser: ReturnType<ExtensionContext['makeBrowser']>;

  constructor(readonly ext: FakeExtension, readonly kind: ContextKind) {
    this.browser = this.makeBrowser();
  }

  private makeBrowser() {
    const { ext } = this;
    return {
      runtime: {
        id: ext.id,
        getURL: (path: string) => `${ext.origin}${path}`,
        getManifest: () => ({ version: ext.version }),
        openOptionsPage: async () => undefined,
        onMessage: this.onMessage,
        onInstalled: ext.onInstalled,
        sendMessage: (message: unknown) =>
          ext.sendRuntimeMessage(this, message),
      },
      storage: {
        local: {
          get: async (keys?: string | string[] | null) => ext.readStorage(keys),
          set: async (items: Record<string, unknown>) =>
            ext.writeStorage(items),
          remove: async (keys: string | string[]) => ext.removeStorage(keys),
        },
        onChanged: ext.onStorageChanged,
      },
      tabs: {
        query: async (query: {
          active?: boolean;
          lastFocusedWindow?: boolean;
        }) => ext.queryTabs(query),
        create: async (props: { url: string; active?: boolean }) =>
          ext.createTab(props),
        remove: async (tabId: number) => ext.removeTab(tabId),
        sendMessage: (tabId: number, message: unknown) =>
          ext.sendTabMessage(tabId, message),
      },
      contextMenus: {
        create: (props: MenuItem, callback?: () => void) =>
          ext.createMenuItem(props, callback),
        update: async (id: string, props: Partial<MenuItem>) =>
          ext.updateMenuItem(id, props),
        onClicked: ext.onMenuClicked,
      },
      notifications: {
        create: async (options: Notification) => {
          ext.notifications.push(options);
          return `notification-${ext.notifications.length}`;
        },
      },
      webRequest: {
        onResponseStarted: {
          addListener: (
            listener: ResponseStartedListener,
            filter: { urls: string[] }
          ) => ext.responseStartedListeners.push({ listener, filter }),
        },
      },
    };
  }

  record(): unknown[] {
    const inbox: unknown[] = [];
    this.onMessage.addListener((message) => {
      inbox.push(message);
      return undefined;
    });
    return inbox;
  }
}

export class FakeExtension {
  readonly id = 'test-extension-id';
  readonly version = '9.9.9';
  readonly origin: string;

  storage: Record<string, unknown> = {};
  readonly tabs: Tab[] = [];
  readonly removedTabs: Tab[] = [];
  readonly menuItems = new Map<string, MenuItem>();
  readonly notifications: Notification[] = [];
  focusedWindowId = 1;

  readonly onInstalled = new FakeEvent<
    (details: { reason: string }) => unknown
  >();
  readonly onStorageChanged = new FakeEvent<
    (changes: StorageChanges, areaName: string) => unknown
  >();
  readonly onMenuClicked = new FakeEvent<
    (info: { menuItemId: string; pageUrl?: string }, tab?: Tab) => unknown
  >();
  readonly responseStartedListeners: {
    listener: ResponseStartedListener;
    filter: { urls: string[] };
  }[] = [];

  onTabCreated: (tab: Tab) => void | Promise<void> = () => undefined;
  failTabCreation = false;

  private contexts: ExtensionContext[] = [];
  private nextTabId = 100;

  constructor(options: { browser?: 'chrome' | 'firefox' } = {}) {
    this.origin =
      options.browser === 'firefox'
        ? `moz-extension://${this.id}/`
        : `chrome-extension://${this.id}/`;
  }

  context(kind: ContextKind): ExtensionContext {
    const context = new ExtensionContext(this, kind);
    this.contexts.push(context);
    return context;
  }

  openTab(url: string, options: { active?: boolean; windowId?: number } = {}) {
    const { active = true, windowId = this.focusedWindowId } = options;
    if (active) {
      this.tabs
        .filter((t) => t.windowId === windowId)
        .forEach((t) => (t.active = false));
    }
    const tab: Tab = { id: this.nextTabId++, windowId, url, active };
    this.tabs.push(tab);
    return { tab, content: this.context({ kind: 'content', tabId: tab.id }) };
  }

  menuItem(id: string): MenuItem | undefined {
    return this.menuItems.get(id);
  }

  async install(reason: 'install' | 'update' | 'browser_update') {
    await this.onInstalled.dispatch({ reason });
  }

  async clickMenuItem(menuItemId: string, tab: Tab) {
    await this.onMenuClicked.dispatch({ menuItemId, pageUrl: tab.url }, tab);
  }

  async respond(url: string, statusCode: number) {
    await Promise.allSettled(
      this.responseStartedListeners
        .filter(({ filter }) =>
          filter.urls.some((pattern) => globToRegExp(pattern).test(url))
        )
        .map(({ listener }) => listener({ url, statusCode }))
    );
  }

  async sendRuntimeMessage(from: ExtensionContext, message: unknown) {
    await Promise.resolve();
    const receivers = this.contexts.filter(
      (c) =>
        c !== from && c.kind.kind !== 'content' && c.onMessage.hasListeners()
    );
    if (receivers.length === 0) {
      throw new Error(NO_RECEIVER);
    }
    const sender: MessageSender = {
      id: this.id,
      tab:
        from.kind.kind === 'content'
          ? this.tabById((from.kind as { tabId: number }).tabId)
          : undefined,
    };
    const replies = await Promise.all(
      receivers.map((c) =>
        c.onMessage.dispatchMessage(structuredClone(message), sender)
      )
    );
    return replies.find((reply) => reply !== undefined);
  }

  async sendTabMessage(tabId: number, message: unknown) {
    await Promise.resolve();
    const receivers = this.contexts.filter(
      (c) =>
        c.kind.kind === 'content' &&
        c.kind.tabId === tabId &&
        c.onMessage.hasListeners()
    );
    if (receivers.length === 0) {
      throw new Error(NO_RECEIVER);
    }
    const replies = await Promise.all(
      receivers.map((c) =>
        c.onMessage.dispatchMessage(structuredClone(message), { id: this.id })
      )
    );
    return replies.find((reply) => reply !== undefined);
  }

  readStorage(keys?: string | string[] | null): Record<string, unknown> {
    const wanted =
      keys === undefined || keys === null
        ? Object.keys(this.storage)
        : Array.isArray(keys)
        ? keys
        : [keys];
    return structuredClone(
      Object.fromEntries(
        wanted.filter((k) => k in this.storage).map((k) => [k, this.storage[k]])
      )
    );
  }

  async writeStorage(items: Record<string, unknown>) {
    const changes: StorageChanges = {};
    for (const [key, value] of Object.entries(structuredClone(items))) {
      changes[key] = { oldValue: this.storage[key], newValue: value };
      this.storage[key] = value;
    }
    void this.onStorageChanged.dispatch(structuredClone(changes), 'local');
  }

  async removeStorage(keys: string | string[]) {
    const changes: StorageChanges = {};
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      if (key in this.storage) {
        changes[key] = { oldValue: this.storage[key] };
        delete this.storage[key];
      }
    }
    if (Object.keys(changes).length > 0) {
      void this.onStorageChanged.dispatch(structuredClone(changes), 'local');
    }
  }

  queryTabs(query: { active?: boolean; lastFocusedWindow?: boolean }): Tab[] {
    return this.tabs
      .filter((t) => query.active === undefined || t.active === query.active)
      .filter(
        (t) => !query.lastFocusedWindow || t.windowId === this.focusedWindowId
      )
      .map((t) => ({ ...t }));
  }

  async createTab(props: { url: string; active?: boolean }): Promise<Tab> {
    if (this.failTabCreation) {
      throw new Error('Tabs cannot be edited right now.');
    }
    const { tab } = this.openTab(props.url, { active: props.active ?? true });
    await this.onTabCreated(tab);
    return { ...tab };
  }

  removeTab(tabId: number) {
    const index = this.tabs.findIndex((t) => t.id === tabId);
    if (index === -1) {
      throw new Error(`No tab with id: ${tabId}.`);
    }
    this.removedTabs.push(...this.tabs.splice(index, 1));
  }

  createMenuItem(props: MenuItem, callback?: () => void) {
    if (!this.menuItems.has(props.id)) {
      this.menuItems.set(props.id, { ...props });
    }
    if (callback) {
      queueMicrotask(callback);
    }
    return props.id;
  }

  updateMenuItem(id: string, props: Partial<MenuItem>) {
    const item = this.menuItems.get(id);
    if (item === undefined) {
      throw new Error(`Cannot find menu item with id ${id}`);
    }
    this.menuItems.set(id, { ...item, ...props });
  }

  private tabById(tabId: number): Tab | undefined {
    const tab = this.tabs.find((t) => t.id === tabId);
    return tab && { ...tab };
  }
}
