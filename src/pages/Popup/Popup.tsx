import React, {
  useState,
  Dispatch,
  useEffect,
  ReactElement,
  useCallback,
  SetStateAction,
} from 'react';
import ICloudClient, {
  PremiumMailSettings,
  HmeEmail,
  ListHmeResult,
  DEFAULT_SETUP_URL,
  CN_SETUP_URL,
} from '../../iCloudClient';
import './Popup.css';
import { useBrowserStorageState } from '../../hooks';
import {
  BookOpen,
  Check,
  Copy,
  List,
  LogOut,
  Power,
  RefreshCw,
  Search,
  Settings,
  Trash2,
} from 'lucide-react';
import { MessageType, sendMessageToTab } from '../../messages';
import {
  Actions,
  Address,
  EditableRecordRow,
  Eyebrow,
  Footer,
  Header,
  Headline,
  Hint,
  Icon,
  IconButton,
  ListRow,
  PrimaryButton,
  Record,
  RecordRow,
  Rule,
  Screen,
  SecondaryButton,
  Spinner,
  TextButton,
  TextLink,
} from '../../commonComponents';
import { DEFAULT_STORE, setBrowserStorageValue, Store } from '../../storage';

import browser from 'webextension-polyfill';
import Fuse from 'fuse.js';
import {
  PopupAction,
  PopupState,
  AuthenticatedAction,
  STATE_MACHINE_TRANSITIONS,
  AuthenticatedAndManagingAction,
} from './stateMachine';
import {
  CONTEXT_MENU_ITEM_ID,
  SIGNED_IN_CTA_COPY,
  SIGNED_OUT_CTA_COPY,
} from '../Background/constants';
import { isFirefox } from '../../browserUtils';

type TransitionCallback<T extends PopupAction> = (action: T) => void;

const ICLOUD_URL = 'https://www.icloud.com';
const MANAGE_PREVIEW_SIZE = 5;

const errorMessage = (e: unknown): string => {
  const message = e instanceof Error ? e.message : String(e);
  const failedRequest = message.match(
    /^Request to \w+ (\S+) failed with status code (\d+)$/
  );
  return failedRequest
    ? `HTTP ${failedRequest[2]} from ${new URL(failedRequest[1]).hostname}`
    : message;
};

const sameSite = (a: string, b: string): boolean =>
  a.replace(/^www\./, '').toLowerCase() ===
  b.replace(/^www\./, '').toLowerCase();

const isSavedForSite = (hme: HmeEmail, host: string): boolean =>
  hme.isActive &&
  host !== '' &&
  [hme.label, hme.domain].some((value) => value && sameSite(value, host));

const formatDay = (timestamp: number): string => {
  const date = new Date(timestamp);
  const isThisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: isThisYear ? undefined : 'numeric',
  });
};

const formatDateTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const day = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const time = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${day} · ${time}`;
};

const openUserguide = () =>
  browser.tabs.create({ url: browser.runtime.getURL('userguide.html') });

const openOptions = () => browser.runtime.openOptionsPage();

const openICloud = () => browser.tabs.create({ url: ICLOUD_URL });

// Resolves to whether the page had at least one email field to fill.
const fillOnPage = async (hme: string): Promise<boolean> => {
  try {
    const filledCount = await sendMessageToTab(MessageType.Autofill, hme);
    return typeof filledCount === 'number' && filledCount > 0;
  } catch {
    return false;
  }
};

const useTabHost = (): string => {
  const [tabHost, setTabHost] = useState('');

  useEffect(() => {
    browser.tabs
      .query({ active: true, lastFocusedWindow: true })
      .then(([tab]) => {
        if (tab?.url !== undefined) {
          setTabHost(new URL(tab.url).hostname);
        }
      })
      .catch(console.error);
  }, []);

  return tabHost;
};

const useHmeList = (
  client: ICloudClient
): [
  ListHmeResult | undefined,
  string | undefined,
  Dispatch<SetStateAction<ListHmeResult | undefined>>
] => {
  const [list, setList] = useState<ListHmeResult>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    new PremiumMailSettings(client)
      .listHme()
      .then((result) =>
        setList({
          ...result,
          hmeEmails: [...result.hmeEmails].sort(
            (a, b) => b.createTimestamp - a.createTimestamp
          ),
        })
      )
      .catch((e) => setError(errorMessage(e)));
  }, [client]);

  return [list, error, setList];
};

const useCopy = (): [boolean, (text: string) => Promise<void>] => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timeout = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [copied]);

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  };

  return [copied, copy];
};

const MuteSiteButton = (props: { host: string }) => {
  const [mutedSites, setMutedSites] = useBrowserStorageState(
    'mutedSites',
    DEFAULT_STORE.mutedSites
  );

  if (!props.host) {
    return null;
  }

  const isMuted = mutedSites.includes(props.host);

  return (
    <button
      type="button"
      className="hover:text-ink"
      aria-pressed={isMuted}
      onClick={() =>
        setMutedSites((prev) =>
          prev.includes(props.host)
            ? prev.filter((site) => site !== props.host)
            : [...prev, props.host]
        )
      }
    >
      {isMuted ? 'Suggest on this site again' : "Don't suggest on this site"}
    </button>
  );
};

async function performDeauthSideEffects(): Promise<void> {
  await browser.contextMenus
    .update(CONTEXT_MENU_ITEM_ID, {
      title: SIGNED_OUT_CTA_COPY,
      enabled: false,
    })
    .catch(console.debug);
}

const SignOutButton = (props: {
  callback: TransitionCallback<'SIGN_OUT'>;
  client: ICloudClient;
}) => {
  return (
    <TextButton
      icon={LogOut}
      onClick={async () => {
        await props.client.signOut();
        // TODO: call the react state setter instead
        setBrowserStorageValue('clientState', undefined);
        performDeauthSideEffects();
        props.callback('SIGN_OUT');
      }}
    >
      Sign out
    </TextButton>
  );
};

const SignInInstructions = (props: {
  onSignedIn: (client: ICloudClient) => void;
}) => {
  const [check, setCheck] = useState<'idle' | 'checking' | 'signed-out'>(
    'idle'
  );

  const onCheckAgainClick = async () => {
    setCheck('checking');
    for (const setupUrl of [DEFAULT_SETUP_URL, CN_SETUP_URL] as const) {
      const client = new ICloudClient(setupUrl);
      if (await client.isAuthenticated()) {
        props.onSignedIn(client);
        return;
      }
    }
    setCheck('signed-out');
  };

  const checkAgainCopy = {
    idle: 'Already signed in? Check again',
    checking: 'Checking…',
    'signed-out': 'Still signed out. Check again',
  }[check];

  return (
    <Screen>
      <Header>
        <Eyebrow
          left="Not signed in"
          right={
            <button
              type="button"
              className="hover:text-ink"
              onClick={openUserguide}
            >
              Quickstart guide
            </button>
          }
        />
        <Headline>Sign in to iCloud, then come back here.</Headline>
      </Header>
      <Record>
        <RecordRow label="Step 1">Open icloud.com and sign in</RecordRow>
        <RecordRow label="Step 2">Finish two-factor authentication</RecordRow>
        <RecordRow label="Step 3">Choose Trust This Browser</RecordRow>
        {isFirefox && (
          <RecordRow label="Containers">
            Sign in from a tab outside any container
          </RecordRow>
        )}
        <RecordRow label="Tip" muted>
          Tick Keep me signed in so this lasts
        </RecordRow>
      </Record>
      <Actions>
        <PrimaryButton onClick={openICloud}>Open icloud.com</PrimaryButton>
        <TextButton
          arrow={check !== 'checking'}
          disabled={check === 'checking'}
          onClick={onCheckAgainClick}
        >
          {checkAgainCopy}
        </TextButton>
      </Actions>
      <Footer
        left={
          <TextButton icon={BookOpen} onClick={openUserguide}>
            Quickstart guide
          </TextButton>
        }
        right={
          <TextButton icon={Settings} onClick={openOptions}>
            Settings
          </TextButton>
        }
      />
    </Screen>
  );
};

const MetadataRows = (props: {
  hme: HmeEmail;
  client: ICloudClient;
  onChange: (hme: HmeEmail) => void;
  onError: (error: string) => void;
}) => {
  const { hme, client, onChange, onError } = props;

  const save = async (patch: Partial<Pick<HmeEmail, 'label' | 'note'>>) => {
    const updated = { ...hme, ...patch };
    if (!updated.label) {
      return;
    }
    onChange(updated);
    try {
      await new PremiumMailSettings(client).updateHmeMetadata(
        updated.anonymousId,
        updated.label,
        updated.note
      );
    } catch (e) {
      onChange(hme);
      onError(errorMessage(e));
    }
  };

  return (
    <>
      <EditableRecordRow
        label="Title"
        mono
        value={hme.label}
        onCommit={(label) => save({ label })}
      />
      <RecordRow label="Forwards to">{hme.forwardToEmail}</RecordRow>
      <EditableRecordRow
        label="Note"
        value={hme.note || ''}
        placeholder="Add a note"
        onCommit={(note) => save({ note })}
      />
    </>
  );
};

const ErrorHint = (props: { children?: string }) =>
  props.children ? (
    <p role="alert" className="text-[12px] text-ink">
      {props.children}
    </p>
  ) : null;

type Draft =
  | { status: 'generating' }
  | { status: 'ready'; hme: string }
  | { status: 'creating'; hme: string }
  | { status: 'failed'; error: string; hme?: string }
  | { status: 'created'; hme: HmeEmail; filled: boolean };

const HmeGenerator = (props: {
  callback: TransitionCallback<AuthenticatedAction>;
  client: ICloudClient;
}) => {
  const { client, callback } = props;
  const tabHost = useTabHost();
  const [list] = useHmeList(client);
  const [draft, setDraft] = useState<Draft>({ status: 'generating' });
  const [view, setView] = useState<'draft' | 'saved'>('draft');
  const [title, setTitle] = useState<string>();
  const [note, setNote] = useState<string>();
  const [copied, copy] = useCopy();
  const [metadataError, setMetadataError] = useState<string>();

  const label = title ?? tabHost;
  const noteValue = note ?? (tabHost ? `Used on ${tabHost}` : '');
  const savedForSite =
    list?.hmeEmails.filter((hme) => isSavedForSite(hme, tabHost)) ?? [];

  const generate = useCallback(async () => {
    setDraft({ status: 'generating' });
    try {
      const hme = await new PremiumMailSettings(client).generateHme();
      setDraft({ status: 'ready', hme });
    } catch (e) {
      setDraft({ status: 'failed', error: errorMessage(e) });
    }
  }, [client]);

  useEffect(() => {
    generate();
  }, [generate]);

  const create = async (hme: string) => {
    setDraft({ status: 'creating', hme });
    try {
      const reserved = await new PremiumMailSettings(client).reserveHme(
        hme,
        label || hme,
        noteValue || undefined
      );
      const filled = await fillOnPage(reserved.hme);
      setDraft({ status: 'created', hme: reserved, filled });
    } catch (e) {
      setDraft({ status: 'failed', error: errorMessage(e), hme });
    }
  };

  const createAnother = () => {
    setTitle(undefined);
    setNote(undefined);
    setMetadataError(undefined);
    generate();
  };

  const footer = (
    <Footer
      left={
        <TextButton icon={List} onClick={() => callback('MANAGE')}>
          Manage addresses
        </TextButton>
      }
      right={<SignOutButton {...props} />}
    />
  );

  if (view === 'saved') {
    return (
      <Screen>
        <Header>
          <Eyebrow
            left={`Saved for ${tabHost}`}
            right={
              <button
                type="button"
                className="hover:text-ink"
                onClick={() => setView('draft')}
              >
                Back
              </button>
            }
          />
          <Headline>Fill in one you already use here.</Headline>
        </Header>
        <div className="flex flex-col w-full">
          <Rule />
          {savedForSite.map((hme) => (
            <ListRow
              key={hme.anonymousId}
              title={hme.hme}
              meta={`${hme.note || hme.label} · ${formatDay(
                hme.createTimestamp
              )}`}
              onClick={async () => {
                if (await fillOnPage(hme.hme)) {
                  window.close();
                } else {
                  await copy(hme.hme);
                }
              }}
            />
          ))}
        </div>
        <Actions>
          <PrimaryButton onClick={() => setView('draft')}>
            Create a new address instead
          </PrimaryButton>
          <Hint>
            {copied
              ? 'No email field on this page. Address copied instead.'
              : 'Tap an address to fill it in on this page.'}
          </Hint>
        </Actions>
        {footer}
      </Screen>
    );
  }

  if (draft.status === 'failed') {
    return (
      <Screen>
        <Header>
          <Eyebrow
            left="Couldn't create an address"
            right={<MuteSiteButton host={tabHost} />}
          />
          <Headline>iCloud didn&apos;t answer. Nothing was created.</Headline>
        </Header>
        <Record>
          <RecordRow label="Reason" mono>
            {draft.error}
          </RecordRow>
          {list && (
            <RecordRow label="Forwards to">{list.selectedForwardTo}</RecordRow>
          )}
          <RecordRow label="Title" mono>
            {label}
          </RecordRow>
        </Record>
        <Actions>
          <PrimaryButton
            onClick={() =>
              draft.hme !== undefined ? create(draft.hme) : generate()
            }
          >
            Try again
          </PrimaryButton>
          <TextLink href={ICLOUD_URL} arrow>
            Open icloud.com to check your session
          </TextLink>
        </Actions>
        {footer}
      </Screen>
    );
  }

  if (draft.status === 'created') {
    const { hme, filled } = draft;
    return (
      <Screen>
        <Header>
          <Eyebrow
            left={
              <span className="flex items-center gap-1.5 text-ink">
                <Icon icon={Check} />
                {filled ? 'Created and filled in' : 'Created'}
              </span>
            }
            right="Just now"
          />
          <Address
            action={
              <IconButton
                icon={copied ? Check : Copy}
                aria-label="Copy address"
                onClick={() => copy(hme.hme)}
              />
            }
          >
            {hme.hme}
          </Address>
        </Header>
        <Record>
          <MetadataRows
            hme={hme}
            client={client}
            onChange={(updated) => setDraft({ ...draft, hme: updated })}
            onError={setMetadataError}
          />
        </Record>
        <Actions>
          <SecondaryButton
            icon={copied ? Check : Copy}
            onClick={() => copy(hme.hme)}
          >
            {copied ? 'Copied' : 'Copy address'}
          </SecondaryButton>
          {!filled && (
            <Hint>No email field on this page. Copy the address instead.</Hint>
          )}
          <ErrorHint>{metadataError}</ErrorHint>
          <TextButton arrow onClick={createAnother}>
            Create another for this site
          </TextButton>
        </Actions>
        {footer}
      </Screen>
    );
  }

  const isGenerating = draft.status === 'generating';
  const isCreating = draft.status === 'creating';

  return (
    <Screen>
      <Header>
        <Eyebrow
          left="You're about to create"
          right={<MuteSiteButton host={tabHost} />}
        />
        <Address
          action={
            <IconButton
              icon={RefreshCw}
              spin={isGenerating}
              disabled={isGenerating || isCreating}
              aria-label="Generate a different address"
              onClick={generate}
            />
          }
        >
          {isGenerating ? (
            <span className="block w-[264px] h-3.5 rounded bg-wash animate-pulse" />
          ) : (
            draft.hme
          )}
        </Address>
      </Header>
      <Record>
        <EditableRecordRow
          label="Title"
          mono
          value={label}
          placeholder="Title"
          disabled={isCreating}
          onCommit={(value) => setTitle(value || tabHost)}
        />
        <RecordRow label="Forwards to" muted={!list}>
          {list?.selectedForwardTo ?? '…'}
        </RecordRow>
        <EditableRecordRow
          label="Note"
          value={noteValue}
          placeholder="Add a note"
          disabled={isCreating}
          onCommit={setNote}
        />
      </Record>
      <Actions>
        {isGenerating ? (
          <PrimaryButton disabled>Asking iCloud for an address…</PrimaryButton>
        ) : (
          <PrimaryButton loading={isCreating} onClick={() => create(draft.hme)}>
            {isCreating ? 'Creating…' : 'Create and fill'}
          </PrimaryButton>
        )}
        {savedForSite.length > 0 && (
          <TextButton arrow onClick={() => setView('saved')}>
            {savedForSite.length === 1
              ? 'Or use the address saved for this site'
              : `Or use one of ${savedForSite.length} addresses saved for this site`}
          </TextButton>
        )}
      </Actions>
      {footer}
    </Screen>
  );
};

const HmeDetail = (props: {
  hme: HmeEmail;
  client: ICloudClient;
  onBack: () => void;
  onChange: (hme: HmeEmail) => void;
  onDelete: () => void;
  signOut: ReactElement;
}) => {
  const { hme, client } = props;
  const [busy, setBusy] = useState<'activation' | 'deletion'>();
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, copy] = useCopy();

  const toggleActivation = async () => {
    setBusy('activation');
    setError(undefined);
    try {
      const pms = new PremiumMailSettings(client);
      if (hme.isActive) {
        await pms.deactivateHme(hme.anonymousId);
      } else {
        await pms.reactivateHme(hme.anonymousId);
      }
      props.onChange({ ...hme, isActive: !hme.isActive });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  };

  const onDeleteClick = async () => {
    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      return;
    }
    setBusy('deletion');
    setError(undefined);
    try {
      await new PremiumMailSettings(client).deleteHme(hme.anonymousId);
      props.onDelete();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(undefined);
    }
  };

  const onFillClick = async () => {
    if (await fillOnPage(hme.hme)) {
      window.close();
    } else {
      setError('No email field on this page.');
    }
  };

  return (
    <Screen>
      <Header>
        <Eyebrow
          left={`Address · ${hme.isActive ? 'Active' : 'Deactivated'}`}
          right={
            <button
              type="button"
              className="hover:text-ink"
              onClick={props.onBack}
            >
              Back
            </button>
          }
        />
        <Address
          small
          muted={!hme.isActive}
          action={
            <IconButton
              icon={copied ? Check : Copy}
              aria-label="Copy address"
              onClick={() => copy(hme.hme)}
            />
          }
        >
          {hme.hme}
        </Address>
      </Header>
      <Record>
        <MetadataRows
          hme={hme}
          client={client}
          onChange={props.onChange}
          onError={setError}
        />
        <RecordRow label="Created" muted>
          {formatDateTime(hme.createTimestamp)}
        </RecordRow>
        <RecordRow
          label="Status"
          trailing={
            <button
              type="button"
              aria-label={hme.isActive ? 'Deactivate' : 'Reactivate'}
              title={hme.isActive ? 'Deactivate' : 'Reactivate'}
              className="text-faint hover:text-ink disabled:cursor-not-allowed"
              disabled={busy !== undefined}
              onClick={toggleActivation}
            >
              <Icon icon={Power} />
            </button>
          }
        >
          {hme.isActive
            ? 'Active · receiving mail'
            : 'Deactivated · mail is rejected'}
        </RecordRow>
      </Record>
      <Actions>
        {hme.isActive ? (
          <>
            <PrimaryButton onClick={onFillClick}>
              Fill in on this page
            </PrimaryButton>
            <TextButton
              arrow={busy !== 'activation'}
              disabled={busy !== undefined}
              onClick={toggleActivation}
            >
              {busy === 'activation'
                ? 'Deactivating…'
                : 'Deactivate this address'}
            </TextButton>
          </>
        ) : (
          <>
            <PrimaryButton
              loading={busy === 'activation'}
              disabled={busy !== undefined}
              onClick={toggleActivation}
            >
              Reactivate
            </PrimaryButton>
            <SecondaryButton
              icon={Trash2}
              loading={busy === 'deletion'}
              disabled={busy !== undefined}
              onClick={onDeleteClick}
              onBlur={() => setIsConfirmingDelete(false)}
            >
              {isConfirmingDelete ? 'Click again to delete' : 'Delete address'}
            </SecondaryButton>
          </>
        )}
        <ErrorHint>{error}</ErrorHint>
      </Actions>
      <Footer
        left={
          <TextButton icon={List} onClick={props.onBack}>
            Manage addresses
          </TextButton>
        }
        right={props.signOut}
      />
    </Screen>
  );
};

const searchHmeEmails = (query: string, hmeEmails: HmeEmail[]): HmeEmail[] =>
  new Fuse(hmeEmails, { keys: ['label', 'hme', 'note'], threshold: 0.4 })
    .search(query)
    .map((result) => result.item);

const HmeManager = (props: {
  callback: TransitionCallback<AuthenticatedAndManagingAction>;
  client: ICloudClient;
}) => {
  const { client, callback } = props;
  const tabHost = useTabHost();
  const [list, listError, setList] = useHmeList(client);
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const signOut = <SignOutButton {...props} />;
  const footer = (
    <Footer
      left={
        <TextButton icon={Settings} onClick={openOptions}>
          Settings
        </TextButton>
      }
      right={signOut}
    />
  );

  const hmeEmails = list?.hmeEmails ?? [];
  const selected = hmeEmails.find((hme) => hme.anonymousId === selectedId);

  const replaceHme = (updated: HmeEmail) =>
    setList(
      (prev) =>
        prev && {
          ...prev,
          hmeEmails: prev.hmeEmails.map((hme) =>
            hme.anonymousId === updated.anonymousId ? updated : hme
          ),
        }
    );

  const removeHme = (anonymousId: string) => {
    setSelectedId(undefined);
    setList(
      (prev) =>
        prev && {
          ...prev,
          hmeEmails: prev.hmeEmails.filter(
            (hme) => hme.anonymousId !== anonymousId
          ),
        }
    );
  };

  if (selected) {
    return (
      <HmeDetail
        hme={selected}
        client={client}
        onBack={() => setSelectedId(undefined)}
        onChange={replaceHme}
        onDelete={() => removeHme(selected.anonymousId)}
        signOut={signOut}
      />
    );
  }

  if (listError) {
    return (
      <Screen>
        <Header>
          <Eyebrow left="Addresses" />
          <Headline>Couldn&apos;t load your addresses.</Headline>
        </Header>
        <Record>
          <RecordRow label="Reason" mono>
            {listError}
          </RecordRow>
        </Record>
        {footer}
      </Screen>
    );
  }

  if (!list) {
    return (
      <Screen>
        <Header>
          <Eyebrow
            left={
              <>
                <Spinner />
                Loading addresses
              </>
            }
          />
        </Header>
        {footer}
      </Screen>
    );
  }

  const createLabel = tabHost ? `Create one for ${tabHost}` : 'Create one';

  if (hmeEmails.length === 0) {
    return (
      <Screen>
        <Header>
          <Eyebrow left="0 addresses" />
          <Headline>Nothing here yet.</Headline>
        </Header>
        <Record>
          <RecordRow label="How">
            Open any email field on a site and pick the suggestion, or use the
            toolbar icon.
          </RecordRow>
          <RecordRow label="Forwards to">{list.selectedForwardTo}</RecordRow>
        </Record>
        <PrimaryButton onClick={() => callback('GENERATE')}>
          {createLabel}
        </PrimaryButton>
        {footer}
      </Screen>
    );
  }

  const deactivatedCount = hmeEmails.filter((hme) => !hme.isActive).length;
  const results = query ? searchHmeEmails(query, hmeEmails) : hmeEmails;
  const isTruncated =
    !query && !showAll && results.length > MANAGE_PREVIEW_SIZE;
  const visible = isTruncated ? results.slice(0, MANAGE_PREVIEW_SIZE) : results;

  return (
    <Screen>
      <Header>
        <Eyebrow
          left={[
            `${hmeEmails.length} ${
              hmeEmails.length === 1 ? 'address' : 'addresses'
            }`,
            deactivatedCount > 0 && `${deactivatedCount} deactivated`,
          ]
            .filter(Boolean)
            .join(' · ')}
          right={
            <button
              type="button"
              className="hover:text-ink"
              onClick={() => callback('GENERATE')}
            >
              Create for this site
            </button>
          }
        />
        <label className="flex items-center gap-2 px-2.5 py-[9px] border border-line rounded focus-within:border-ink">
          <Icon icon={Search} className="text-faint" />
          <input
            type="search"
            className="flex-1 min-w-0 bg-transparent outline-none text-[13px] placeholder:text-faint"
            placeholder="Search addresses or sites"
            aria-label="Search addresses or sites"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </Header>
      <div className="flex flex-col w-full">
        <Rule />
        {visible.map((hme) => (
          <ListRow
            key={hme.anonymousId}
            title={hme.hme}
            muted={!hme.isActive}
            meta={
              hme.isActive
                ? `${hme.label} · ${formatDay(hme.createTimestamp)}`
                : `Deactivated · ${hme.label}`
            }
            onClick={() => setSelectedId(hme.anonymousId)}
          />
        ))}
        {query && results.length === 0 && (
          <p className="py-3 text-[13px] text-muted break-words">
            No addresses match &quot;{query}&quot;.
          </p>
        )}
      </div>
      {isTruncated && (
        <TextButton arrow onClick={() => setShowAll(true)}>
          Show all {results.length}
        </TextButton>
      )}
      {footer}
    </Screen>
  );
};

const constructClient = (clientState: Store['clientState']): ICloudClient => {
  if (clientState === undefined) {
    throw new Error('Cannot construct client when client state is undefined');
  }

  return new ICloudClient(clientState.setupUrl, clientState.webservices);
};

const transitionToNextStateElement = (
  state: PopupState,
  setState: Dispatch<PopupState>,
  clientState: Store['clientState'],
  setClientState: Dispatch<Store['clientState']>
): ReactElement => {
  switch (state) {
    case PopupState.SignedOut: {
      const onSignedIn = (client: ICloudClient) => {
        setClientState({
          setupUrl: client.setupUrl,
          webservices: client.webservices,
        });
        browser.contextMenus
          .update(CONTEXT_MENU_ITEM_ID, {
            title: SIGNED_IN_CTA_COPY,
            enabled: true,
          })
          .catch(console.debug);
        setState(STATE_MACHINE_TRANSITIONS[state].AUTHENTICATE);
      };
      return <SignInInstructions onSignedIn={onSignedIn} />;
    }
    case PopupState.Authenticated: {
      const callback = (action: AuthenticatedAction) =>
        setState(STATE_MACHINE_TRANSITIONS[state][action]);
      return (
        <HmeGenerator
          callback={callback}
          client={constructClient(clientState)}
        />
      );
    }
    case PopupState.AuthenticatedAndManaging: {
      const callback = (action: AuthenticatedAndManagingAction) =>
        setState(STATE_MACHINE_TRANSITIONS[state][action]);
      return (
        <HmeManager callback={callback} client={constructClient(clientState)} />
      );
    }
    default: {
      const exhaustivenessCheck: never = state;
      throw new Error(`Unhandled PopupState case: ${exhaustivenessCheck}`);
    }
  }
};

const Popup = () => {
  const [state, setState, isStateLoading] = useBrowserStorageState(
    'popupState',
    PopupState.SignedOut
  );

  const [clientState, setClientState, isClientStateLoading] =
    useBrowserStorageState('clientState', undefined);
  const [clientAuthStateSynced, setClientAuthStateSynced] = useState(false);
  const [isRenewingSession, setIsRenewingSession] = useState(false);

  useEffect(() => {
    const liveClientState = async (): Promise<Store['clientState']> => {
      if (clientState === undefined) {
        return undefined;
      }
      if (await new ICloudClient(clientState.setupUrl).isAuthenticated()) {
        return clientState;
      }
      setIsRenewingSession(true);
      return (await browser.runtime.sendMessage({
        type: MessageType.RenewSessionRequest,
        data: undefined,
      })) as Store['clientState'];
    };

    const syncClientAuthState = async () => {
      const synced = await liveClientState();

      if (synced) {
        setClientState(synced);
        setState((prevState) =>
          prevState === PopupState.SignedOut
            ? PopupState.Authenticated
            : prevState
        );
      } else {
        setState(PopupState.SignedOut);
        setClientState(undefined);
        performDeauthSideEffects();
      }

      setIsRenewingSession(false);
      setClientAuthStateSynced(true);
    };

    if (!isClientStateLoading && !clientAuthStateSynced) {
      syncClientAuthState();
    }
  }, [
    setState,
    setClientState,
    clientAuthStateSynced,
    clientState,
    isClientStateLoading,
  ]);

  if (isStateLoading || !clientAuthStateSynced) {
    return (
      <Screen>
        <Eyebrow
          left={
            <>
              <Spinner />
              {isRenewingSession
                ? 'Reconnecting to iCloud…'
                : 'Checking your iCloud session'}
            </>
          }
        />
      </Screen>
    );
  }

  return transitionToNextStateElement(
    state,
    setState,
    clientState,
    setClientState
  );
};

export default Popup;
