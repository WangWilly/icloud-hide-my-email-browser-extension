import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CN_SETUP_URL, DEFAULT_SETUP_URL } from '../src/iCloudClient';
import { PMS_URLS } from './fakes/icloud';

const require = createRequire(import.meta.url);
const CONFIG = require.resolve('../webpack.config.js');
const SOURCE = readFileSync(
  new URL('../src/manifest.json', import.meta.url),
  'utf8'
);

type CopyPattern = {
  from: string;
  transform?: (content: Buffer) => Buffer;
};

type WebpackConfig = {
  entry: Record<string, string>;
  plugins: { patterns?: CopyPattern[]; userOptions?: { filename?: string } }[];
};

const webpackConfig = (browser: 'chrome' | 'firefox'): WebpackConfig => {
  vi.stubEnv('FIREFOX', browser === 'firefox' ? 'true' : '');
  vi.stubEnv('npm_package_version', '1.2.3');
  delete require.cache[CONFIG];
  return require(CONFIG);
};

const builtManifest = (browser: 'chrome' | 'firefox') => {
  const config = webpackConfig(browser);
  const pattern = config.plugins
    .flatMap((plugin) => plugin.patterns ?? [])
    .find((p) => p.from === 'src/manifest.json');
  return JSON.parse(
    String(pattern?.transform?.(Buffer.from(SOURCE)))
  ) as Record<string, unknown>;
};

afterEach(() => {
  vi.unstubAllEnvs();
  delete require.cache[CONFIG];
});

describe('built manifest.json', () => {
  it('ships the source manifest unchanged for Chrome, stamped with the package version', () => {
    expect(builtManifest('chrome')).toEqual({
      ...JSON.parse(SOURCE),
      version: '1.2.3',
    });
  });

  it('runs the background as an event page and pins the add-on id for Firefox, which has no MV3 service workers', () => {
    const { background: sourceBackground, ...rest } = JSON.parse(SOURCE);
    expect(sourceBackground).toEqual({
      service_worker: 'background.bundle.js',
    });

    expect(builtManifest('firefox')).toEqual({
      ...rest,
      version: '1.2.3',
      background: { scripts: ['background.bundle.js'] },
      browser_specific_settings: {
        gecko: {
          id: '@icloud-hide-my-email.wangwilly',
          strict_min_version: '113.0',
        },
      },
    });
  });
});

describe('manifest wiring', () => {
  const manifest = JSON.parse(SOURCE);

  it('names only files the build emits, so the package never points at a missing script, page, or icon', () => {
    const config = webpackConfig('chrome');
    const emitted = new Set([
      ...Object.keys(config.entry).flatMap((name) => [
        `${name}.bundle.js`,
        `${name}.css`,
      ]),
      ...config.plugins.flatMap((p) => p.userOptions?.filename ?? []),
      ...config.plugins
        .flatMap((p) => p.patterns ?? [])
        .map((p) => p.from.split('/').at(-1)),
    ]);

    const referenced: string[] = [
      manifest.background.service_worker,
      ...manifest.content_scripts.flatMap(
        (script: { js: string[]; css: string[] }) => [
          ...script.js,
          ...script.css,
        ]
      ),
      manifest.action.default_popup,
      manifest.action.default_icon,
      manifest.options_page,
      ...Object.values<string>(manifest.icons),
      ...manifest.declarative_net_request.rule_resources.map(
        (r: { path: string }) => r.path
      ),
      'userguide.html',
    ];
    expect(referenced.filter((file) => !emitted.has(file))).toEqual([]);
  });

  // Chrome match-pattern semantics for `scheme://*.host/*`: the host itself or
  // any subdomain of it, any path.
  const permits = (url: string) =>
    (manifest.host_permissions as string[]).some((pattern) => {
      if (pattern === '<all_urls>') {
        return true;
      }
      const [, scheme, host, path] =
        pattern.match(/^(\w+):\/\/([^/]+)(\/.*)$/) ?? [];
      const target = new URL(url);
      const hostMatches = host.startsWith('*.')
        ? target.hostname === host.slice(2) ||
          target.hostname.endsWith(host.slice(1))
        : target.hostname === host;
      const pathMatches = new RegExp(
        `^${path.split('*').map(escapeRegExp).join('.*')}$`
      ).test(target.pathname);
      return target.protocol === `${scheme}:` && hostMatches && pathMatches;
    });

  it.each([
    `${DEFAULT_SETUP_URL}/validate`,
    `${CN_SETUP_URL}/validate`,
    `${PMS_URLS[DEFAULT_SETUP_URL]}/v2/hme/list`,
    `${PMS_URLS[CN_SETUP_URL]}/v1/hme/generate`,
  ])(
    'grants host access to %s, without which the call and its header rewrite are blocked',
    (url) => {
      expect(permits(url)).toBe(true);
    }
  );

  it('asks for no hosts beyond iCloud', () => {
    expect(permits('https://example.com/')).toBe(false);
    expect(permits('https://icloud.com.evil.example/')).toBe(false);
  });
});

describe('rules.json', () => {
  type Rule = {
    action: { requestHeaders: unknown[] };
    condition: {
      urlFilter: string;
      resourceTypes: string[];
      excludedInitiatorDomains: string[];
    };
  };
  const rules: Rule[] = JSON.parse(
    readFileSync(new URL('../src/rules.json', import.meta.url), 'utf8')
  );

  it.each([
    ['icloud.com', 'apple.com'],
    ['icloud.com.cn', 'apple.com.cn'],
  ])(
    "makes the extension's calls to *.%s look like that region's web app, and leaves Apple's own pages alone",
    (domain, appleDomain) => {
      const rule = rules.find(
        (r) => r.condition.urlFilter === `|https://*.${domain}/*`
      );
      expect(rule?.action.requestHeaders).toEqual([
        { header: 'Origin', operation: 'set', value: `https://www.${domain}` },
        {
          header: 'Referer',
          operation: 'set',
          value: `https://www.${domain}/`,
        },
      ]);
      expect(rule?.condition).toMatchObject({
        resourceTypes: ['xmlhttprequest'],
        excludedInitiatorDomains: [appleDomain, domain],
      });
    }
  );
});

function escapeRegExp(text: string) {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}
