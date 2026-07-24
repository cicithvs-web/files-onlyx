// Password hashing (PBKDF2-SHA256, Worker-compatible via WebCrypto)
// and JWT HS256 sign/verify.

const encoder = new TextEncoder();

function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const PBKDF2_ITERATIONS = 100_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bufToHex(salt.buffer)}$${bufToHex(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iterStr, saltHex, hashHex] = stored.split('$');
    if (scheme !== 'pbkdf2') return false;
    const iterations = parseInt(iterStr, 10);
    const salt = hexToBuf(saltHex);
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
      key,
      256
    );
    const computed = bufToHex(bits);
    // constant-time compare
    if (computed.length !== hashHex.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hashHex.charCodeAt(i);
    return diff === 0;
  } catch (err) {
    console.error('[verifyPassword] Error:', err);
    return false;
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return bufToHex(digest);
}

// ---------- JWT (HS256) ----------

function b64urlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64urlEncode(JSON.stringify(payload));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${body}`));
  return `${header}.${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifyJwt<T = Record<string, unknown>>(token: string, secret: string): Promise<T | null> {
  try {
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecode(sig) as unknown as BufferSource,
      encoder.encode(`${header}.${body}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as T & { exp?: number };
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload as T;
  } catch {
    return null;
  }
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function generateToken(bytes = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return bufToHex(arr.buffer);
}
