import assert from 'node:assert/strict';
import { test } from 'node:test';
import { base32, hotp, verifyTotp } from './totp.ts';

// RFC 6238, apêndice B (SHA1): T=59s → 94287082, 6 últimos dígitos
const secret = base32(Buffer.from('12345678901234567890'));

test('totp', () => {
  assert.equal(hotp(secret, 1), '287082');
  assert.equal(verifyTotp(secret, '287082', null, 59_000), 1);
  assert.equal(verifyTotp(secret, '287082', 1, 59_000), null); // replay
  assert.equal(verifyTotp(secret, '000000', null, 59_000), null);
  assert.equal(verifyTotp(secret, '287082', null, 10 * 60_000), null); // expirado
});
