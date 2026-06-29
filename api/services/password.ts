const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;
const HASH_VERSION = 'v2';
const MIN_PASSWORD_LENGTH = 6;

function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad) {
    base64 += '='.repeat(4 - pad);
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    KEY_LENGTH * 8
  );
  return new Uint8Array(derived);
}

async function hash(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const saltB64 = base64UrlEncode(salt);
  const keyB64 = base64UrlEncode(key);
  return `${HASH_VERSION}:${PBKDF2_ITERATIONS}:${saltB64}:${keyB64}`;
}

async function verify(passwordHash: string, password: string): Promise<boolean> {
  if (!passwordHash || typeof passwordHash !== 'string') {
    return false;
  }

  const parts = passwordHash.split(':');

  if (parts[0] === 'sha256') {
    const storedHash = parts[1];
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(password));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return storedHash === hashHex;
  }

  if (parts[0] === HASH_VERSION) {
    const [, iterationsStr, saltB64, keyB64] = parts;
    const iterations = parseInt(iterationsStr, 10);
    const salt = base64UrlDecode(saltB64);
    const storedKey = base64UrlDecode(keyB64);
    const computedKey = await deriveKey(password, salt, iterations);

    if (computedKey.length !== storedKey.length) {
      return false;
    }

    let diff = 0;
    for (let i = 0; i < computedKey.length; i++) {
      diff |= computedKey[i] ^ storedKey[i];
    }
    return diff === 0;
  }

  return false;
}

function validatePassword(password: string): { valid: boolean; error?: string } {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  if (password.length > 256) {
    return { valid: false, error: 'Password is too long' };
  }
  return { valid: true };
}

function validateEmail(email: string): { valid: boolean; error?: string } {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' };
  }
  if (email.length > 254) {
    return { valid: false, error: 'Email is too long' };
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }
  return { valid: true };
}

export {
  hash,
  verify,
  validatePassword,
  validateEmail,
  MIN_PASSWORD_LENGTH
};
