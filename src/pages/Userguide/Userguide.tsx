import React, { InputHTMLAttributes, useState } from 'react';
import { Check } from 'lucide-react';
import {
  Eyebrow,
  Header,
  Headline,
  Hint,
  Icon,
  Record,
  PageRow,
  Section,
} from '../../commonComponents';
import { isFirefox } from '../../browserUtils';

const SOURCE_URL =
  'https://github.com/dedoussis/icloud-hide-my-email-browser-extension';

const SignInInstructions = () => (
  <Section title="1 · Sign in to iCloud">
    <Record>
      <PageRow label="Step 1">
        Open{' '}
        <a
          href="https://www.icloud.com"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          icloud.com
        </a>{' '}
        in this browser and sign in with your Apple ID.
      </PageRow>
      <PageRow label="Step 2">Finish two-factor authentication.</PageRow>
      <PageRow label="Step 3">
        Choose Trust This Browser. Ticking Keep me signed in is optional but
        saves repeating this.
      </PageRow>
    </Record>
    <img
      src="./icloud-sign-in.webp"
      alt="Screenshots of the icloud.com sign-in flow"
      className="w-full rounded-lg border border-line"
    />
    <Record>
      <PageRow label="Already signed in?">
        Nothing to do. The extension is ready.
      </PageRow>
      {isFirefox && (
        <PageRow label="Firefox containers">
          Sign in from a tab outside any container. It then works in every tab.
        </PageRow>
      )}
    </Record>
  </Section>
);

const AutofillableDemoInput = (props: {
  inputAttributes: InputHTMLAttributes<HTMLInputElement>;
  label: string;
}) => {
  const [value, setValue] = useState<string>();

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={props.inputAttributes.id}
        className="flex items-center gap-1.5 text-[13px] text-muted"
      >
        {props.label}
        {value?.endsWith('@icloud.com') && (
          <Icon icon={Check} className="text-ink" />
        )}
      </label>
      <input
        className="w-full px-3 py-2.5 rounded border border-line bg-white text-[14px] placeholder:text-faint outline-none focus:border-ink"
        defaultValue={value}
        onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        {...props.inputAttributes}
      />
    </div>
  );
};

const UsageInstructions = () => (
  <Section title="2 · Use it">
    <Record>
      <PageRow label="Email fields">
        A suggestion appears under any focused email field. Click it to create
        an address and fill it in.
      </PageRow>
      <PageRow label="Right-click">
        On any text field, choose Hide My Email from the context menu.
      </PageRow>
      <PageRow label="Toolbar icon">
        Create an address, pick one you already use on this site, or manage all
        of them.
      </PageRow>
    </Record>
    <form className="flex flex-col gap-4 p-5 rounded-lg border border-line">
      <p className="text-[13px] text-muted">Try it here</p>
      <AutofillableDemoInput
        label="Email"
        inputAttributes={{
          id: 'autofill-by-button',
          name: 'email',
          type: 'email',
          placeholder: 'Click here',
        }}
      />
      <AutofillableDemoInput
        label="Any text field"
        inputAttributes={{
          id: 'autofill-by-right-click',
          type: 'text',
          placeholder: 'Right-click here and choose Hide My Email',
        }}
      />
      <Hint>
        Addresses you create here are real. Deactivate and delete them from
        Manage addresses afterwards.
      </Hint>
    </form>
  </Section>
);

const TechnicalOverview = () => (
  <Section title="3 · How it works">
    <Record>
      <PageRow label="Requests">
        The extension makes the same calls the icloud.com web app makes, using
        the icloud.com cookies already in your browser.
      </PageRow>
      <PageRow label="Permissions">
        Host permission on icloud.com only. The browser treats those requests as
        same-origin and includes your cookies.
      </PageRow>
      <PageRow label="Your password">
        Never seen by the extension. It only ever uses the session icloud.com
        created.
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
    </Record>
    <Hint>
      Prefer not to trust it? icloud.com works in any browser; this is only the
      shorter path.
    </Hint>
  </Section>
);

const Userguide = () => (
  <main className="max-w-[640px] mx-auto px-4 pt-12 pb-24 flex flex-col gap-10">
    <Header>
      <Eyebrow
        left="Hide My Email · Quickstart"
        right={
          <a href="./options.html" className="hover:text-ink">
            Settings
          </a>
        }
      />
      <Headline>Sign in once. After that it mostly works by itself.</Headline>
    </Header>
    <SignInInstructions />
    <UsageInstructions />
    <TechnicalOverview />
  </main>
);

export default Userguide;
