import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBsuid, normalizePhone } from '../src/lib/phone.js';

test('normalizePhone keeps full international numbers', () => {
  assert.equal(normalizePhone('+91 98765 43210'), '919876543210');
  assert.equal(normalizePhone('919876543210'), '919876543210');
  assert.equal(normalizePhone('0044 20 7946 0958'), '442079460958');
  assert.equal(normalizePhone('+1 (415) 555-2671'), '14155552671');
});

test('normalizePhone applies the default country code to local numbers', () => {
  assert.equal(normalizePhone('98765 43210', '91'), '919876543210');
  assert.equal(normalizePhone('09876543210', '91'), '919876543210');
  assert.equal(normalizePhone('9876543210', '+91'), '919876543210');
  // already international: left alone
  assert.equal(normalizePhone('+14155552671', '91'), '14155552671');
});

test('normalizePhone rejects junk', () => {
  for (const bad of ['', '   ', 'abc', '12345', null, undefined, '0000000000', '1234567890123456']) {
    assert.equal(normalizePhone(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test('isBsuid recognises business-scoped user IDs', () => {
  assert.equal(isBsuid('IN.13491208655302741918'), true);
  assert.equal(isBsuid('US.ENT.11815799212886844830'), true);
  assert.equal(isBsuid('919876543210'), false);
  assert.equal(isBsuid(undefined), false);
});
