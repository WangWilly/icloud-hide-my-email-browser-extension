import { beforeEach, describe, expect, it, vi } from 'vitest';
import ICloudClient, {
  CN_SETUP_URL,
  DEFAULT_SETUP_URL,
  DeactivateHmeException,
  DeleteHmeException,
  GenerateHmeException,
  PremiumMailSettings,
  ReactivateHmeException,
  ReserveHmeException,
  UnsuccessfulRequestError,
  UpdateFwdToHmeException,
  UpdateHmeMetadataException,
} from '../src/iCloudClient';
import { FakeICloud, PMS_URLS, SetupUrl, hmeEmail } from './fakes/icloud';

let icloud: FakeICloud;

beforeEach(() => {
  icloud = new FakeICloud();
  vi.stubGlobal('fetch', icloud.fetch);
});

const signedInClient = async (setupUrl: SetupUrl = DEFAULT_SETUP_URL) => {
  icloud.signIn(setupUrl);
  const client = new ICloudClient(setupUrl);
  await client.validateToken();
  return { client, pms: new PremiumMailSettings(client) };
};

describe('ICloudClient session', () => {
  it('reports a live session as authenticated and an expired one as not, without throwing', async () => {
    const client = new ICloudClient(DEFAULT_SETUP_URL);
    await expect(client.isAuthenticated()).resolves.toBe(false);

    icloud.signIn();
    await expect(client.isAuthenticated()).resolves.toBe(true);
  });

  it('treats a network failure as signed out instead of rejecting', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    await expect(
      new ICloudClient(DEFAULT_SETUP_URL).isAuthenticated()
    ).resolves.toBe(false);
  });

  it('checks the session against its own realm, so a .com.cn session does not count for .com', async () => {
    icloud.signIn(CN_SETUP_URL);
    await expect(
      new ICloudClient(DEFAULT_SETUP_URL).isAuthenticated()
    ).resolves.toBe(false);
    await expect(
      new ICloudClient(CN_SETUP_URL).isAuthenticated()
    ).resolves.toBe(true);
  });

  it('learns the Hide My Email service URL from /validate (missing it would make every address call fail)', async () => {
    const { client } = await signedInClient(CN_SETUP_URL);
    expect(client.webserviceUrl('premiummailsettings')).toBe(
      PMS_URLS[CN_SETUP_URL]
    );
  });

  it('refuses to build Hide My Email calls before the service URL is known', () => {
    expect(
      () => new PremiumMailSettings(new ICloudClient(DEFAULT_SETUP_URL))
    ).toThrow('webservices have not been initialised');
  });

  it('describes a failed request with method, URL and status, the format the popup parses into "HTTP 421 from host"', async () => {
    const request = new ICloudClient(DEFAULT_SETUP_URL).validateToken();
    await expect(request).rejects.toThrow(UnsuccessfulRequestError);
    await expect(request).rejects.toThrow(
      `Request to POST ${DEFAULT_SETUP_URL}/validate failed with status code 421`
    );
  });

  it('signs out without trusting the browser by default, and ends the session', async () => {
    const { client } = await signedInClient();
    await client.signOut();

    expect(icloud.requestsTo('POST /logout')[0].body).toEqual({
      trustBrowsers: false,
      allBrowsers: false,
    });
    await expect(client.isAuthenticated()).resolves.toBe(false);
  });

  it('forwards the trust choice to /logout for both flags', async () => {
    const { client } = await signedInClient();
    await client.signOut({ trust: true });
    expect(icloud.requestsTo('POST /logout')[0].body).toEqual({
      trustBrowsers: true,
      allBrowsers: true,
    });
  });

  it('never rejects sign-out when iCloud fails, so the extension can still clear local state', async () => {
    const { client } = await signedInClient();
    icloud.fail('POST /logout', { status: 500 });
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    await expect(client.signOut()).resolves.toBeUndefined();
  });
});

describe('PremiumMailSettings', () => {
  it('lists the address book with the forwarding settings', async () => {
    icloud.hmeEmails = [hmeEmail({ hme: 'a@privaterelay.appleid.com' })];
    const { pms } = await signedInClient();

    await expect(pms.listHme()).resolves.toEqual({
      hmeEmails: icloud.hmeEmails,
      selectedForwardTo: 'me@icloud.com',
      forwardToEmails: ['me@icloud.com', 'other@example.com'],
    });
  });

  it('generates a fresh address each time', async () => {
    const { pms } = await signedInClient();
    const first = await pms.generateHme();
    const second = await pms.generateHme();
    expect(first).toMatch(/@privaterelay\.appleid\.com$/);
    expect(second).not.toBe(first);
  });

  it("surfaces iCloud's reason when generation is refused", async () => {
    const { pms } = await signedInClient();
    icloud.fail('POST /v1/hme/generate', {
      errorMessage: 'You have reached the limit',
    });
    const generation = pms.generateHme();
    await expect(generation).rejects.toThrow(GenerateHmeException);
    await expect(generation).rejects.toThrow('You have reached the limit');
  });

  it('reserves a generated address with the label and the extension default note', async () => {
    const { pms } = await signedInClient();
    const hme = await pms.generateHme();

    const reserved = await pms.reserveHme(hme, 'shop.example.com');

    expect(reserved).toMatchObject({ hme, label: 'shop.example.com' });
    expect(icloud.address(hme)).toMatchObject({
      label: 'shop.example.com',
      note: 'Generated through the iCloud Hide My Email browser extension',
    });
  });

  it('reserves with a caller-provided note instead of the default', async () => {
    const { pms } = await signedInClient();
    const hme = await pms.generateHme();
    await pms.reserveHme(hme, 'shop.example.com', 'Used on shop.example.com');
    expect(icloud.address(hme)?.note).toBe('Used on shop.example.com');
  });

  it("surfaces iCloud's reason when a reservation is refused", async () => {
    const { pms } = await signedInClient();
    const reservation = pms.reserveHme('never-generated@x.com', 'label');
    await expect(reservation).rejects.toThrow(ReserveHmeException);
    await expect(reservation).rejects.toThrow(
      'never-generated@x.com is not available'
    );
  });

  it('updates the label and note of an address', async () => {
    icloud.hmeEmails = [hmeEmail({ anonymousId: 'id-1', label: 'old' })];
    const { pms } = await signedInClient();
    await pms.updateHmeMetadata('id-1', 'new label', 'new note');
    expect(icloud.hmeEmails[0]).toMatchObject({
      label: 'new label',
      note: 'new note',
    });
  });

  it('deactivates and reactivates an address', async () => {
    icloud.hmeEmails = [hmeEmail({ anonymousId: 'id-1', isActive: true })];
    const { pms } = await signedInClient();

    await pms.deactivateHme('id-1');
    expect(icloud.hmeEmails[0].isActive).toBe(false);

    await pms.reactivateHme('id-1');
    expect(icloud.hmeEmails[0].isActive).toBe(true);
  });

  it('deletes only the given address', async () => {
    icloud.hmeEmails = [
      hmeEmail({ anonymousId: 'keep', hme: 'keep@x.com' }),
      hmeEmail({ anonymousId: 'drop', hme: 'drop@x.com' }),
    ];
    const { pms } = await signedInClient();
    await pms.deleteHme('drop');
    expect(icloud.hmeEmails.map((e) => e.hme)).toEqual(['keep@x.com']);
  });

  it('changes where new mail is forwarded', async () => {
    const { pms } = await signedInClient();
    await pms.updateForwardToHme('other@example.com');
    expect(icloud.selectedForwardTo).toBe('other@example.com');
  });

  it.each([
    [
      'updateHmeMetadata',
      (pms: PremiumMailSettings) => pms.updateHmeMetadata('missing', 'label'),
      UpdateHmeMetadataException,
    ],
    [
      'deactivateHme',
      (pms: PremiumMailSettings) => pms.deactivateHme('missing'),
      DeactivateHmeException,
    ],
    [
      'reactivateHme',
      (pms: PremiumMailSettings) => pms.reactivateHme('missing'),
      ReactivateHmeException,
    ],
    [
      'deleteHme',
      (pms: PremiumMailSettings) => pms.deleteHme('missing'),
      DeleteHmeException,
    ],
    [
      'updateForwardToHme',
      (pms: PremiumMailSettings) => pms.updateForwardToHme('unverified@x.com'),
      UpdateFwdToHmeException,
    ],
  ])(
    '%s rejects with its own error when iCloud answers success: false (otherwise the UI would report success)',
    async (_, call, ErrorClass) => {
      const { pms } = await signedInClient();
      await expect(call(pms)).rejects.toThrow(ErrorClass);
    }
  );

  it('rejects an address call on an expired session with the HTTP status', async () => {
    const { pms } = await signedInClient();
    icloud.expireSession();
    await expect(pms.listHme()).rejects.toThrow(
      `Request to GET ${PMS_URLS[DEFAULT_SETUP_URL]}/v2/hme/list failed with status code 421`
    );
  });
});
