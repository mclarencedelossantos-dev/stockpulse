const crypto = require('crypto');

function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let output = '';
  let bits = 0;
  let value = 0;

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = String(secret).replace(/=+$/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 secret.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function generateTOTPSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function generateTOTP(secret, timestamp = Date.now()) {
  const period = 30;
  const digits = 6;
  const key = base32Decode(secret);
  let counter = Math.floor(timestamp / 1000 / period);
  const buffer = Buffer.alloc(8);
  for (let index = 7; index >= 0; index -= 1) {
    buffer[index] = counter & 255;
    counter = Math.floor(counter / 256);
  }

  const digest = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const code = ((digest[offset] & 127) << 24)
    | ((digest[offset + 1] & 255) << 16)
    | ((digest[offset + 2] & 255) << 8)
    | (digest[offset + 3] & 255);

  return (code % 10 ** digits).toString().padStart(digits, '0');
}

function verifyTOTP(secret, token, windowSize = 1) {
  if (!secret || !String(token || '').trim()) return false;
  const normalizedToken = String(token).trim();
  const window = Math.max(0, Number(windowSize) || 1);
  const currentTime = Date.now();

  try {
    for (let offset = -window; offset <= window; offset += 1) {
      const generated = generateTOTP(secret, currentTime + offset * 30_000);
      if (generated === normalizedToken) {
        return true;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

function getTOTPUri(email, secret, issuer = 'STOCKPULSE') {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const formattedIssuer = encodeURIComponent(issuer);
  const secretValue = encodeURIComponent(secret);
  return `otpauth://totp/${label}?secret=${secretValue}&issuer=${formattedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = {
  base32Decode,
  base32Encode,
  generateTOTP,
  generateTOTPSecret,
  getTOTPUri,
  verifyTOTP
};
