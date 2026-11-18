const encoder = new TextEncoder();
const decoder = new TextDecoder();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PASS_CHARS = 'SUITE0123456789';

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function randomIntRange(min: number, maxExclusive: number): number {
  const span = maxExclusive - min;
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return min + (arr[0] % span);
}

export function generateServerSuiteCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += CODE_CHARS[randomIntRange(0, CODE_CHARS.length)];
  }
  return s;
}

export function generateServerSuitePass(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let p = '';
    for (let i = 0; i < 4; i++) {
      p += PASS_CHARS[randomIntRange(0, PASS_CHARS.length)];
    }
    if (/\d/.test(p) && /[SUITE]/.test(p)) return p;
  }
  return 'S1U8';
}

export function generateOtpCode(): string {
  return String(randomIntRange(100000, 1000000));
}

export async function hashPassword(
  password: string,
  existingSalt?: string,
): Promise<{ hash: string; salt: string }> {
  const salt = existingSalt || randomHex(16);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  return { hash: bytesToHex(new Uint8Array(derivedBits)), salt };
}

export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): Promise<boolean> {
  if (!password || !expectedHash) return false;
  let actualSalt = salt || '';
  let actualExpected = expectedHash;

  if (!actualSalt && actualExpected.includes(':')) {
    const idx = actualExpected.indexOf(':');
    actualSalt = actualExpected.slice(0, idx);
    actualExpected = actualExpected.slice(idx + 1);
  }

  // Legacy SHA-256 hex support if migrated without salt
  if (!actualSalt && actualExpected.length === 64) {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(password));
    const shaHex = bytesToHex(new Uint8Array(digest));
    return constantTimeEqual(hexToBytes(shaHex), hexToBytes(actualExpected));
  }

  if (!actualSalt) return false;
  const { hash } = await hashPassword(password, actualSalt);
  return constantTimeEqual(hexToBytes(hash), hexToBytes(actualExpected));
}

export async function signTokenPayload(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(encodedPayload));
  const encodedSig = toBase64Url(new Uint8Array(signature));
  return `${encodedPayload}.${encodedSig}`;
}

export async function verifyTokenPayload<T extends Record<string, unknown>>(
  token: string,
  secret: string,
): Promise<T | null> {
  if (!token || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [encodedPayload, encodedSig] = parts;

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const sigBytes = fromBase64Url(encodedSig);
    const sigCopy = new Uint8Array(sigBytes.length);
    sigCopy.set(sigBytes);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigCopy,
      encoder.encode(encodedPayload),
    );
    if (!valid) return null;

    const payloadBytes = fromBase64Url(encodedPayload);
    return JSON.parse(decoder.decode(payloadBytes)) as T;
  } catch {
    return null;
  }
}
