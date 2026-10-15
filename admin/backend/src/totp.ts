// TOTP (RFC 6238) compatível com Google Authenticator: SHA1, 6 dígitos, 30s.
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const base32 = (buf: Buffer) => {
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  return (bits.match(/.{1,5}/g) ?? []).map((c) => ALPHABET[parseInt(c.padEnd(5, '0'), 2)]).join('');
};

const unbase32 = (s: string) => {
  const bits = [...s.toUpperCase()].map((c) => ALPHABET.indexOf(c).toString(2).padStart(5, '0')).join('');
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
};

export const newSecret = () => base32(randomBytes(20));

export const hotp = (secret: string, step: number) => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', unbase32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
};

/** devolve o step aceito (±1 de tolerância de relógio) ou null; step <= lastStep = código já usado */
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()) {
  const current = Math.floor(now / 30_000);
  for (const step of [current - 1, current, current + 1]) {
    if (lastStep != null && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(code.padEnd(6).slice(0, 6)))) return step;
  }
  return null;
}

export const otpauthUri = (email: string, secret: string) =>
  `otpauth://totp/Incentiva%2B:${encodeURIComponent(email)}?secret=${secret}&issuer=Incentiva%2B`;
