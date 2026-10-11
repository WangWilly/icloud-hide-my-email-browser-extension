import browser from 'webextension-polyfill';
import ICloudClient, {
  CN_SETUP_URL,
  DEFAULT_SETUP_URL,
} from '../../iCloudClient';

const WEB_APP_URLS: Record<ICloudClient['setupUrl'], string> = {
  [DEFAULT_SETUP_URL]: 'https://www.icloud.com/',
  [CN_SETUP_URL]: 'https://www.icloud.com.cn/',
};

const POLL_INTERVAL_MS = 1500;
const TIMEOUT_MS = 20000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// When the browser still holds the "Keep me signed in" cookies, loading the
// icloud.com web app renews an expired session without asking for a password
// or 2FA. We let Apple's own page do that in a background tab.
const renewInBackgroundTab = async (
  setupUrl: ICloudClient['setupUrl']
): Promise<ICloudClient | undefined> => {
  const client = new ICloudClient(setupUrl);
  const tab = await browser.tabs.create({
    url: WEB_APP_URLS[setupUrl],
    active: false,
  });

  try {
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      if (await client.isAuthenticated()) {
        return client;
      }
    }
    return undefined;
  } finally {
    if (tab.id !== undefined) {
      browser.tabs.remove(tab.id).catch(console.debug);
    }
  }
};

let inFlightRenewal: Promise<ICloudClient | undefined> | undefined;

export const renewSession = (
  setupUrl: ICloudClient['setupUrl']
): Promise<ICloudClient | undefined> => {
  inFlightRenewal ??= renewInBackgroundTab(setupUrl).finally(() => {
    inFlightRenewal = undefined;
  });
  return inFlightRenewal;
};
