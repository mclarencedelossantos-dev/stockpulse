const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTOTPSecret, generateTOTP, getTOTPUri, verifyTOTP } = require('../auth/totp.js');

const secret = generateTOTPSecret();

test('generateTOTPSecret creates a usable base32 secret', () => {
  assert.match(secret, /^[A-Z2-7]+$/);
  assert.ok(secret.length >= 16);
});

test('getTOTPUri builds a Google Authenticator compatible otpauth URI', () => {
  const uri = getTOTPUri('user@example.com', secret, 'STOCKPULSE');
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /secret=/);
  assert.match(uri, /issuer=STOCKPULSE/);
});

test('verifyTOTP accepts a valid token and rejects an invalid one', () => {
  const code = generateTOTP(secret);
  assert.equal(verifyTOTP(secret, code), true);
  assert.equal(verifyTOTP(secret, '000000'), false);
});
