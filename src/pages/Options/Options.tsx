import React, { useState, useEffect } from 'react';
import './Options.css';
import browser from 'webextension-polyfill';
import { useBrowserStorageState } from '../../hooks';
import ICloudClient, { PremiumMailSettings } from '../../iCloudClient';
import {
  Eyebrow,
  Header,
  Headline,
  Hint,
  PrimaryButton,
  Record,
  PageRow,
  Section,
  Spinner,
  TextLink,
  Toggle,
} from '../../commonComponents';
import isEqual from 'lodash.isequal';
import { Autofill, DEFAULT_STORE } from '../../storage';

const SOURCE_URL =
  'https://github.com/dedoussis/icloud-hide-my-email-browser-extension';

const SIGNED_OUT_COPY =
  'Sign in through the extension pop-up to change where mail goes.';

const SelectFwdToForm = () => {
  const [selectedFwdToEmail, setSelectedFwdToEmail] = useState<string>();
  const [currentFwdToEmail, setCurrentFwdToEmail] = useState<string>();
  const [fwdToEmails, setFwdToEmails] = useState<string[]>();
  const [isFetching, setIsFetching] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [listHmeError, setListHmeError] = useState<string>();
  const [updateFwdToError, setUpdateFwdToError] = useState<string>();
  const [clientState, , isClientStateLoading] = useBrowserStorageState(
    'clientState',
    undefined
  );

  useEffect(() => {
    const fetchHmeList = async () => {
      setListHmeError(undefined);
      setIsFetching(true);

      if (clientState?.setupUrl === undefined) {
        setListHmeError(SIGNED_OUT_COPY);
        setIsFetching(false);
        return;
      }

      const client = new ICloudClient(clientState.setupUrl);
      const isClientAuthenticated = await client.isAuthenticated();
      if (!isClientAuthenticated) {
        setListHmeError(SIGNED_OUT_COPY);
        setIsFetching(false);
        return;
      }

      try {
        const pms = new PremiumMailSettings(client);
        const result = await pms.listHme();
        setFwdToEmails((prevState) =>
          isEqual(prevState, result.forwardToEmails)
            ? prevState
            : result.forwardToEmails
        );
        setSelectedFwdToEmail(result.selectedForwardTo);
        setCurrentFwdToEmail(result.selectedForwardTo);
      } catch (e) {
        setListHmeError(e.toString());
      } finally {
        setIsFetching(false);
      }
    };

    if (!isClientStateLoading) {
      fetchHmeList();
    }
  }, [clientState?.setupUrl, isClientStateLoading]);

  const onSelectedFwdToSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    setIsSubmitting(true);
    setUpdateFwdToError(undefined);
    if (clientState === undefined) {
      // Entering this branch of the control flow should not be possible
      // as the client state is validated prior to rendering the form that
      // triggered this event handler.
      console.error('onSelectedFwdToSubmit: clientState is undefined');
      setUpdateFwdToError(SIGNED_OUT_COPY);
    } else if (selectedFwdToEmail) {
      try {
        const client = new ICloudClient(
          clientState.setupUrl,
          clientState.webservices
        );
        const pms = new PremiumMailSettings(client);
        await pms.updateForwardToHme(selectedFwdToEmail);
        setCurrentFwdToEmail(selectedFwdToEmail);
      } catch (e) {
        setUpdateFwdToError(e.toString());
      }
    } else {
      setUpdateFwdToError('No Forward To address has been selected.');
    }
    setIsSubmitting(false);
  };

  if (isFetching) {
    return (
      <Record>
        <PageRow label="Loading" muted>
          <Spinner />
        </PageRow>
      </Record>
    );
  }

  if (listHmeError !== undefined) {
    return (
      <Record>
        <PageRow label="Unavailable" muted>
          {listHmeError}
        </PageRow>
      </Record>
    );
  }

  return (
    <form className="flex flex-col gap-3.5" onSubmit={onSelectedFwdToSubmit}>
      <Record>
        {fwdToEmails?.map((fwdToEmail) => (
          <label
            key={fwdToEmail}
            className="flex items-center gap-3 py-3 border-b border-line cursor-pointer"
          >
            <input
              type="radio"
              name="fwdto"
              checked={fwdToEmail === selectedFwdToEmail}
              disabled={isSubmitting}
              onChange={() => setSelectedFwdToEmail(fwdToEmail)}
              className="size-4 accent-ink cursor-pointer"
            />
            <span className="flex-1 min-w-0 truncate font-mono text-[14px]">
              {fwdToEmail}
            </span>
            {fwdToEmail === currentFwdToEmail && (
              <span className="text-[12px] text-muted">Current</span>
            )}
          </label>
        ))}
      </Record>
      <PrimaryButton
        type="submit"
        loading={isSubmitting}
        disabled={selectedFwdToEmail === currentFwdToEmail}
      >
        Update forwarding address
      </PrimaryButton>
      {updateFwdToError && (
        <p role="alert" className="text-[12px] text-ink">
          {updateFwdToError}
        </p>
      )}
      <TextLink href="https://www.icloud.com/settings/" arrow>
        Add or verify addresses on icloud.com
      </TextLink>
    </form>
  );
};

const AUTOFILL_ROWS: {
  [K in keyof Autofill]: { label: string; description: string };
} = {
  button: {
    label: 'Email fields',
    description: 'Show a suggestion under any focused email field.',
  },
  contextMenu: {
    label: 'Right-click menu',
    description: 'Add Hide My Email to the context menu of text fields.',
  },
};

const AutofillForm = () => {
  const [options, setOptions] = useBrowserStorageState(
    'iCloudHmeOptions',
    DEFAULT_STORE.iCloudHmeOptions
  );

  return (
    <Record>
      {(Object.keys(AUTOFILL_ROWS) as (keyof Autofill)[]).map((key) => (
        <PageRow
          key={key}
          label={AUTOFILL_ROWS[key].label}
          trailing={
            <Toggle
              aria-label={AUTOFILL_ROWS[key].label}
              checked={options.autofill[key]}
              onChange={(checked) =>
                setOptions({
                  ...options,
                  autofill: { ...options.autofill, [key]: checked },
                })
              }
            />
          }
        >
          {AUTOFILL_ROWS[key].description}
        </PageRow>
      ))}
    </Record>
  );
};

const MutedSites = () => {
  const [mutedSites, setMutedSites] = useBrowserStorageState(
    'mutedSites',
    DEFAULT_STORE.mutedSites
  );

  return (
    <Record>
      {mutedSites.length === 0 ? (
        <PageRow label="Muted sites" muted>
          None
        </PageRow>
      ) : (
        mutedSites.map((site, idx) => (
          <PageRow
            key={site}
            label={idx === 0 ? 'Muted sites' : ''}
            mono
            trailing={
              <button
                type="button"
                className="text-[12px] text-muted hover:text-ink"
                onClick={() =>
                  setMutedSites((prev) => prev.filter((s) => s !== site))
                }
              >
                Unmute
              </button>
            }
          >
            {site}
          </PageRow>
        ))
      )}
    </Record>
  );
};

const About = () => (
  <Record>
    <PageRow label="Version" mono>
      {browser.runtime.getManifest().version}
    </PageRow>
    <PageRow label="Developer">
      Dimitrios Dedoussis. Not endorsed by or affiliated with Apple.
    </PageRow>
    <PageRow label="Source" mono>
      <a
        href={SOURCE_URL}
        target="_blank"
        rel="noreferrer"
        className="break-all hover:underline"
      >
        github.com/dedoussis/icloud-hide-my-email-browser-extension
      </a>
    </PageRow>
    <PageRow label="License">
      MIT, for both the source and the extension.
    </PageRow>
  </Record>
);

const Options = () => {
  return (
    <main className="max-w-[640px] mx-auto px-4 py-12 flex flex-col gap-10">
      <Header>
        <Eyebrow
          left="Hide My Email · Settings"
          right={
            <a href="./userguide.html" className="hover:text-ink">
              Quickstart guide
            </a>
          }
        />
        <Headline>Where mail goes, and when to offer an address.</Headline>
      </Header>
      <Section title="Forwards to">
        <SelectFwdToForm />
      </Section>
      <Section title="Autofill">
        <AutofillForm />
      </Section>
      <Section
        title="Suggestions"
        hint={
          <Hint>
            Sites muted with &apos;Don&apos;t suggest on this site&apos; in the
            pop-up.
          </Hint>
        }
      >
        <MutedSites />
      </Section>
      <Section title="About">
        <About />
      </Section>
    </main>
  );
};

export default Options;
