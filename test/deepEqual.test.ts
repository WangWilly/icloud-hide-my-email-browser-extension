import assert from 'node:assert/strict';
import { test } from 'vitest';
import { deepEqual } from '../src/deepEqual';

type PlainData = Parameters<typeof deepEqual>[0];

const cases: [string, PlainData, PlainData, boolean][] = [
  ['equal strings', 'SignedOut', 'SignedOut', true],
  ['different strings', 'SignedOut', 'SignedIn', false],
  ['different primitive types', false, 0, false],
  ['equal booleans', true, true, true],
  ['different booleans', true, false, false],
  ['equal numbers', 12, 12, true],
  ['different numbers', 12, 13, false],
  ['NaN values', NaN, NaN, true],
  ['signed zero', 0, -0, true],
  ['null values', null, null, true],
  ['undefined values', undefined, undefined, true],
  ['null and undefined', null, undefined, false],
  ['null and an object', null, {}, false],
  ['an object and a primitive', {}, '', false],
  ['empty objects', {}, {}, true],
  ['empty arrays', [], [], true],
  ['an array and an object', [], {}, false],
  ['an array and numeric object keys', ['a'], { 0: 'a' }, false],
  ['arrays with different lengths', ['a'], ['a', 'b'], false],
  [
    'ordered addresses',
    ['a@example.com', 'b@example.com'],
    ['a@example.com', 'b@example.com'],
    true,
  ],
  [
    'reordered addresses',
    ['a@example.com', 'b@example.com'],
    ['b@example.com', 'a@example.com'],
    false,
  ],
  ['changed addresses', ['a@example.com'], ['c@example.com'], false],
  ['sparse and undefined array entries', Array(1), [undefined], true],
  ['different sparse array lengths', Array(1), Array(2), false],
  [
    'nested arrays',
    [{ values: [1, null, undefined] }],
    [{ values: [1, null, undefined] }],
    true,
  ],
  ['changed nested arrays', [{ values: [1] }], [{ values: [2] }], false],
  [
    'object key order',
    { button: true, contextMenu: false },
    { contextMenu: false, button: true },
    true,
  ],
  [
    'nested settings',
    { autofill: { button: true, contextMenu: true } },
    { autofill: { contextMenu: true, button: true } },
    true,
  ],
  [
    'changed settings',
    { autofill: { button: true, contextMenu: true } },
    { autofill: { button: false, contextMenu: true } },
    false,
  ],
  ['extra keys', { button: true }, { button: true, contextMenu: false }, false],
  [
    'different keys with undefined values',
    { button: undefined },
    { contextMenu: undefined },
    false,
  ],
  ['missing and undefined keys', {}, { webservices: undefined }, false],
  [
    'inherited and own keys',
    { toString: undefined },
    { valueOf: undefined },
    false,
  ],
  [
    'shadowed hasOwnProperty',
    { hasOwnProperty: null },
    { hasOwnProperty: null },
    true,
  ],
  [
    'null-prototype records',
    Object.assign(Object.create(null), { button: true }),
    { button: true },
    true,
  ],
  [
    'client state',
    {
      setupUrl: 'https://www.icloud.com',
      webservices: {
        premium: { url: 'https://example.com', status: 'active' },
      },
    },
    {
      webservices: {
        premium: { status: 'active', url: 'https://example.com' },
      },
      setupUrl: 'https://www.icloud.com',
    },
    true,
  ],
];

for (const [name, left, right, expected] of cases) {
  test(name, () => {
    assert.equal(deepEqual(left, right), expected);
    assert.equal(deepEqual(right, left), expected);
  });
}

test('comparing settings leaves both inputs unchanged', () => {
  const left = {
    autofill: { button: true, contextMenu: false },
    mutedSites: ['example.com'],
  };
  const right = {
    mutedSites: ['example.com'],
    autofill: { contextMenu: false, button: true },
  };
  Object.freeze(left);
  Object.freeze(left.autofill);
  Object.freeze(left.mutedSites);
  Object.freeze(right);
  Object.freeze(right.autofill);
  Object.freeze(right.mutedSites);

  assert.equal(deepEqual(left, right), true);
  assert.deepEqual(left.mutedSites, ['example.com']);
  assert.deepEqual(right.autofill, { contextMenu: false, button: true });
});
