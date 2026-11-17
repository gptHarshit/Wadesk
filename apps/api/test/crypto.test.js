import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import { test } from 'node:test';

// config.js validates the environment on import, so set what it needs first.
process.env.DATABASE_URL ??= 'postgres://localhost/test';
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-1234';
process.env.ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const { decrypt, encrypt, safeEqual, sha256, verifyMetaSignature } = await import('../src/lib/crypto.js');

test('encrypt/decrypt round trip, with a fresh IV every time', () => {
  const a = encrypt('EAAG-secret-token');
  const b = encrypt('EAAG-secret-token');
  assert.notEqual(a, b);
  assert.ok(!a.includes('EAAG'));
  assert.equal(decrypt(a), 'EAAG-secret-token');
  assert.equal(decrypt(b), 'EAAG-secret-token');
});

test('tampered ciphertext is rejected', () => {
  const parts = encrypt('hello').split(':');
  parts[3] = Buffer.from('jello').toString('base64');
  assert.throws(() => decrypt(parts.join(':')));
  assert.throws(() => decrypt('not-a-ciphertext'));
});

test('verifyMetaSignature accepts only the right HMAC of the raw body', () => {
  const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));
  const good = 'sha256=' + nodeCrypto.createHmac('sha256', 'app-secret').update(body).digest('hex');
  assert.equal(verifyMetaSignature(body, good, 'app-secret'), true);
  assert.equal(verifyMetaSignature(body, good, 'other-secret'), false);
  assert.equal(verifyMetaSignature(Buffer.from('{"changed":true}'), good, 'app-secret'), false);
  assert.equal(verifyMetaSignature(body, undefined, 'app-secret'), false);
  assert.equal(verifyMetaSignature(body, 'sha1=abc', 'app-secret'), false);
  assert.equal(verifyMetaSignature(undefined, good, 'app-secret'), false);
});

test('helpers', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(sha256('x').length, 64);
});
