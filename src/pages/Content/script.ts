import {
  ActiveInputElementWriteData,
  GenerationResponseData,
  Message,
  MessageType,
  ReservationRequestData,
  ReservationResponseData,
} from '../../messages';
import { v4 as uuidv4 } from 'uuid';
import './index.css';
import browser from 'webextension-polyfill';
import { getBrowserStorageValue } from '../../storage';
import { SIGNED_OUT_CTA_COPY } from '../Background/constants';

const EMAIL_INPUT_QUERY_STRING =
  'input[type="email"], input[name="email"], input[id="email"]';

const ICLOUD_URL = 'https://www.icloud.com';

// A unique CSS class prefix is used to guarantee that the style injected
// by the extension does not interfere with the existing style of
// a web page.
const STYLE_CLASS_PREFIX = 'd1691f0f-b8f0-495e-9ffb-fe4e6f84b518';

const className = (shortName: string): string =>
  `${STYLE_CLASS_PREFIX}-${shortName}`;

// Lucide icons (ISC license): loader, mail, log-in, circle-alert.
const ICON_PATHS = {
  loader:
    '<path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  logIn:
    '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/>',
  alert:
    '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
};

type SuggestionState =
  | { kind: 'loading' }
  | { kind: 'ready'; hme: string }
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string };

const suggestionView = (
  state: SuggestionState
): { icon: keyof typeof ICON_PATHS; text: string; hint?: string } => {
  switch (state.kind) {
    case 'loading':
      return { icon: 'loader', text: 'Hide My Email — asking iCloud…' };
    case 'ready':
      return { icon: 'mail', text: state.hme, hint: 'Click to fill' };
    case 'signed-out':
      return {
        icon: 'logIn',
        text: 'Sign in to iCloud to use Hide My Email',
        hint: 'Open icloud.com',
      };
    case 'error':
      return { icon: 'alert', text: state.message };
  }
};

const renderSuggestion = (
  btn: HTMLButtonElement,
  state: SuggestionState
): void => {
  const view = suggestionView(state);

  btn.dataset.state = state.kind;
  btn.dataset.hme = state.kind === 'ready' ? state.hme : '';
  btn.disabled = state.kind === 'loading' || state.kind === 'error';

  const icon = document.createElement('span');
  icon.className = className('icon');
  icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${
    ICON_PATHS[view.icon]
  }</svg>`;

  const text = document.createElement('span');
  text.className = className('text');
  text.textContent = view.text;

  btn.replaceChildren(icon, text);

  if (view.hint) {
    const hint = document.createElement('span');
    hint.className = className('hint');
    hint.textContent = view.hint;
    btn.append(hint);
  }
};

type AutofillableInputElement = {
  inputElement: HTMLInputElement;
  buttonSupport?: {
    btnElement: HTMLButtonElement;
    inputOnFocusCallback: (ev: FocusEvent) => void;
    inputOnBlurCallback: (ev: FocusEvent) => void;
    btnOnMousedownCallback: (ev: MouseEvent) => void;
  };
};

const makeButtonSupport = (
  inputElement: HTMLInputElement
): AutofillableInputElement['buttonSupport'] => {
  const btnElement = document.createElement('button');
  const btnElementId = uuidv4();
  btnElement.setAttribute('id', btnElementId);
  btnElement.setAttribute('type', 'button');
  btnElement.classList.add(className('button'));

  renderSuggestion(btnElement, { kind: 'loading' });

  const inputOnFocusCallback = async () => {
    renderSuggestion(btnElement, { kind: 'loading' });
    inputElement.parentNode?.insertBefore(btnElement, inputElement.nextSibling);

    await browser.runtime.sendMessage({
      type: MessageType.GenerateRequest,
      data: btnElementId,
    });
  };

  inputElement.addEventListener('focus', inputOnFocusCallback);

  const inputOnBlurCallback = () => {
    renderSuggestion(btnElement, { kind: 'loading' });
    btnElement.remove();
  };

  inputElement.addEventListener('blur', inputOnBlurCallback);

  const btnOnMousedownCallback = async (ev: MouseEvent) => {
    ev.preventDefault();

    if (btnElement.dataset.state === 'signed-out') {
      window.open(ICLOUD_URL, '_blank', 'noopener');
      return;
    }

    const hme = btnElement.dataset.hme;
    if (btnElement.dataset.state !== 'ready' || !hme) {
      return;
    }

    renderSuggestion(btnElement, { kind: 'loading' });
    await browser.runtime.sendMessage({
      type: MessageType.ReservationRequest,
      data: { hme, label: window.location.host, elementId: btnElement.id },
    } as Message<ReservationRequestData>);
  };

  btnElement.addEventListener('mousedown', btnOnMousedownCallback);

  return {
    btnElement,
    inputOnFocusCallback,
    inputOnBlurCallback,
    btnOnMousedownCallback,
  };
};

const removeButtonSupport = (
  inputElement: HTMLInputElement,
  buttonSupport: NonNullable<AutofillableInputElement['buttonSupport']>
): void => {
  const { btnElement, inputOnFocusCallback, inputOnBlurCallback } =
    buttonSupport;
  inputElement.removeEventListener('focus', inputOnFocusCallback);
  inputElement.removeEventListener('blur', inputOnBlurCallback);
  btnElement.remove();
};

export default async function main(): Promise<void> {
  const emailInputElements = document.querySelectorAll<HTMLInputElement>(
    EMAIL_INPUT_QUERY_STRING
  );

  const options = await getBrowserStorageValue('iCloudHmeOptions');
  const mutedSites = (await getBrowserStorageValue('mutedSites')) ?? [];
  const isButtonEnabled =
    options?.autofill.button !== false &&
    !mutedSites.includes(window.location.hostname);

  const makeAutofillableInputElement = (
    inputElement: HTMLInputElement
  ): AutofillableInputElement => ({
    inputElement,
    buttonSupport: isButtonEnabled
      ? makeButtonSupport(inputElement)
      : undefined,
  });

  const autofillableInputElements = Array.from(emailInputElements).map(
    makeAutofillableInputElement
  );

  const mutationCallback: MutationCallback = (mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) {
          return;
        }

        const addedElements = node.querySelectorAll<HTMLInputElement>(
          EMAIL_INPUT_QUERY_STRING
        );
        addedElements.forEach((el) => {
          const elementExists = autofillableInputElements.some((item) =>
            el.isEqualNode(item.inputElement)
          );
          if (!elementExists) {
            autofillableInputElements.push(makeAutofillableInputElement(el));
          }
        });
      });

      mutation.removedNodes.forEach((node) => {
        if (!(node instanceof Element)) {
          return;
        }

        const removedElements = node.querySelectorAll<HTMLInputElement>(
          EMAIL_INPUT_QUERY_STRING
        );
        removedElements.forEach((el) => {
          const foundIndex = autofillableInputElements.findIndex((item) =>
            el.isEqualNode(item.inputElement)
          );
          if (foundIndex !== -1) {
            const [{ inputElement, buttonSupport }] =
              autofillableInputElements.splice(foundIndex, 1);

            if (buttonSupport) {
              removeButtonSupport(inputElement, buttonSupport);
            }
          }
        });
      });
    });
  };

  const observer = new MutationObserver(mutationCallback);
  observer.observe(document.body, {
    childList: true,
    attributes: false,
    subtree: true,
  });

  browser.runtime.onMessage.addListener((uncastedMessage: unknown) => {
    const message = uncastedMessage as Message<unknown>;

    switch (message.type) {
      case MessageType.Autofill:
        autofillableInputElements.forEach(({ inputElement, buttonSupport }) => {
          inputElement.value = message.data as string;
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
          if (buttonSupport) {
            removeButtonSupport(inputElement, buttonSupport);
          }
        });
        return Promise.resolve(autofillableInputElements.length);
      case MessageType.GenerateResponse:
        {
          const { hme, elementId, error } =
            message.data as GenerationResponseData;

          const element = document.getElementById(elementId);

          if (!element || !(element instanceof HTMLButtonElement)) {
            break;
          }

          if (error) {
            renderSuggestion(
              element,
              error === SIGNED_OUT_CTA_COPY
                ? { kind: 'signed-out' }
                : { kind: 'error', message: error }
            );
            break;
          }

          if (!hme) {
            break;
          }

          renderSuggestion(element, { kind: 'ready', hme });
        }
        break;
      case MessageType.ReservationResponse:
        {
          const { hme, error, elementId } =
            message.data as ReservationResponseData;

          const btnElement = document.getElementById(elementId);

          if (!btnElement || !(btnElement instanceof HTMLButtonElement)) {
            break;
          }

          if (error) {
            renderSuggestion(btnElement, { kind: 'error', message: error });
            break;
          }

          if (!hme) {
            break;
          }

          const found = autofillableInputElements.find(
            (ael) => ael.buttonSupport?.btnElement.id === btnElement.id
          );
          if (!found) {
            break;
          }

          const { inputElement, buttonSupport } = found;
          inputElement.value = hme;
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
          inputElement.dispatchEvent(new Event('change', { bubbles: true }));

          if (buttonSupport) {
            removeButtonSupport(inputElement, buttonSupport);
          }
        }
        break;
      case MessageType.ActiveInputElementWrite:
        {
          const { activeElement } = document;
          if (!activeElement || !(activeElement instanceof HTMLInputElement)) {
            break;
          }

          const {
            data: { text, copyToClipboard },
          } = message as Message<ActiveInputElementWriteData>;
          activeElement.value = text;
          activeElement.dispatchEvent(new Event('input', { bubbles: true }));
          activeElement.dispatchEvent(new Event('change', { bubbles: true }));
          if (copyToClipboard) {
            navigator.clipboard.writeText(text);
          }

          // Remove button if it exists. This should rarely happen as context menu
          // users are expected to have turned off button support.
          const found = autofillableInputElements.find((ael) =>
            ael.inputElement.isEqualNode(activeElement)
          );
          const buttonSupport = found?.buttonSupport;
          if (buttonSupport) {
            removeButtonSupport(activeElement, buttonSupport);
          }
        }
        break;
      default:
        break;
    }

    return undefined;
  });
}
