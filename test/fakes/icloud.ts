import {
  CN_SETUP_URL,
  DEFAULT_SETUP_URL,
  type HmeEmail,
} from '../../src/iCloudClient';

export type SetupUrl = typeof DEFAULT_SETUP_URL | typeof CN_SETUP_URL;

export type RecordedRequest = {
  method: string;
  url: string;
  body: Record<string, unknown> | undefined;
};

type Failure = { status: number } | { errorMessage: string };

export const PMS_URLS: Record<SetupUrl, string> = {
  [DEFAULT_SETUP_URL]: 'https://p68-maildomainws.icloud.com',
  [CN_SETUP_URL]: 'https://p68-maildomainws.icloud.com.cn',
};

export type Endpoint =
  | 'POST /validate'
  | 'POST /logout'
  | 'GET /v2/hme/list'
  | 'POST /v1/hme/generate'
  | 'POST /v1/hme/reserve'
  | 'POST /v1/hme/updateMetaData'
  | 'POST /v1/hme/deactivate'
  | 'POST /v1/hme/reactivate'
  | 'POST /v1/hme/delete'
  | 'POST /v1/hme/updateForwardTo';

export const hmeEmail = (overrides: Partial<HmeEmail> = {}): HmeEmail => ({
  origin: 'ON_DEMAND',
  anonymousId: `anon-${overrides.hme ?? 'x'}`,
  domain: '',
  forwardToEmail: 'me@icloud.com',
  hme: 'existing@privaterelay.appleid.com',
  isActive: true,
  label: 'example.com',
  note: '',
  createTimestamp: Date.UTC(2024, 0, 1),
  recipientMailId: '',
  ...overrides,
});

export class FakeICloud {
  readonly sessions = new Set<SetupUrl>();
  readonly requests: RecordedRequest[] = [];
  hmeEmails: HmeEmail[] = [];
  forwardToEmails = ['me@icloud.com', 'other@example.com'];
  selectedForwardTo = 'me@icloud.com';
  readonly generated: string[] = [];

  private failures = new Map<Endpoint, Failure>();
  private generatedCount = 0;

  signIn(setupUrl: SetupUrl = DEFAULT_SETUP_URL): this {
    this.sessions.add(setupUrl);
    return this;
  }

  expireSession(setupUrl: SetupUrl = DEFAULT_SETUP_URL): this {
    this.sessions.delete(setupUrl);
    return this;
  }

  fail(endpoint: Endpoint, failure: Failure): this {
    this.failures.set(endpoint, failure);
    return this;
  }

  recover(endpoint: Endpoint): this {
    this.failures.delete(endpoint);
    return this;
  }

  requestsTo(endpoint: Endpoint): RecordedRequest[] {
    const [method, path] = endpoint.split(' ');
    return this.requests.filter(
      (r) => r.method === method && new URL(r.url).pathname.endsWith(path)
    );
  }

  address(hme: string): HmeEmail | undefined {
    return this.hmeEmails.find((e) => e.hme === hme);
  }

  readonly fetch = async (
    input: string | URL | Request,
    init: RequestInit = {}
  ): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body =
      typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    this.requests.push({ method, url: url.toString(), body });

    const realm = this.realmOf(url);
    if (realm === undefined) {
      return json(404, {});
    }
    const setupPath = new URL(realm).pathname;
    const path = url.pathname.startsWith(setupPath)
      ? url.pathname.slice(setupPath.length)
      : url.pathname;
    const endpoint = `${method} ${path}` as Endpoint;

    const failure = this.failures.get(endpoint);
    if (failure && 'status' in failure) {
      return json(failure.status, {});
    }

    if (endpoint === 'POST /logout') {
      this.sessions.delete(realm);
      return json(200, { success: true });
    }
    if (!this.sessions.has(realm)) {
      return json(421, { error: 'Misdirected Request' });
    }
    if (endpoint === 'POST /validate') {
      return json(200, {
        webservices: {
          premiummailsettings: { url: PMS_URLS[realm], status: 'active' },
        },
      });
    }
    if (failure) {
      return json(200, { success: false, error: failure });
    }
    return this.premiumMailSettings(endpoint, body ?? {});
  };

  private premiumMailSettings(
    endpoint: Endpoint,
    body: Record<string, unknown>
  ): Response {
    const byId = () =>
      this.hmeEmails.find((e) => e.anonymousId === body.anonymousId);

    switch (endpoint) {
      case 'GET /v2/hme/list':
        return ok({
          hmeEmails: this.hmeEmails,
          selectedForwardTo: this.selectedForwardTo,
          forwardToEmails: this.forwardToEmails,
        });
      case 'POST /v1/hme/generate': {
        const hme = `generated-${++this
          .generatedCount}@privaterelay.appleid.com`;
        this.generated.push(hme);
        return ok({ hme });
      }
      case 'POST /v1/hme/reserve': {
        const hme = String(body.hme);
        if (!this.generated.includes(hme) || this.address(hme)) {
          return json(200, {
            success: false,
            error: { errorMessage: `${hme} is not available` },
          });
        }
        const reserved = hmeEmail({
          hme,
          anonymousId: `anon-${hme}`,
          label: String(body.label),
          note: body.note === undefined ? '' : String(body.note),
          forwardToEmail: this.selectedForwardTo,
          createTimestamp: Date.now(),
        });
        this.hmeEmails.push(reserved);
        return ok({ hme: reserved });
      }
      case 'POST /v1/hme/updateMetaData':
        return this.mutate(byId(), (e) => {
          e.label = String(body.label);
          e.note = body.note === undefined ? e.note : String(body.note);
        });
      case 'POST /v1/hme/deactivate':
        return this.mutate(byId(), (e) => (e.isActive = false));
      case 'POST /v1/hme/reactivate':
        return this.mutate(byId(), (e) => (e.isActive = true));
      case 'POST /v1/hme/delete':
        return this.mutate(byId(), (e) => {
          this.hmeEmails = this.hmeEmails.filter((x) => x !== e);
        });
      case 'POST /v1/hme/updateForwardTo': {
        const forwardTo = String(body.forwardToEmail);
        if (!this.forwardToEmails.includes(forwardTo)) {
          return json(200, { success: false });
        }
        this.selectedForwardTo = forwardTo;
        return ok({});
      }
      default:
        return json(404, {});
    }
  }

  private mutate(
    target: HmeEmail | undefined,
    apply: (e: HmeEmail) => void
  ): Response {
    if (target === undefined) {
      return json(200, { success: false });
    }
    apply(target);
    return ok({});
  }

  private realmOf(url: URL): SetupUrl | undefined {
    return ([DEFAULT_SETUP_URL, CN_SETUP_URL] as const).find(
      (setupUrl) =>
        url.toString().startsWith(setupUrl) ||
        url.origin === new URL(PMS_URLS[setupUrl]).origin
    );
  }
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const ok = (result: unknown): Response => json(200, { success: true, result });
