import type { JwtPayload } from '../types';

const JWT_EXPIRY_SECONDS = 60 * 60 * 24 * 7; // 7 days
const JWT_CLOCK_SKEW_SECONDS = 30;
const MIN_SECRET_LENGTH = 32;

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
  if (!str || typeof str !== 'string') {
    return new Uint8Array();
  }
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad) {
    base64 += '='.repeat(4 - pad);
  }
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return new Uint8Array();
  }
}

async function hmacSign(data: string, secret: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return new Uint8Array(signature);
}

async function hmacVerify(signature: Uint8Array, data: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  const expected = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const expectedBytes = new Uint8Array(expected);

  if (expectedBytes.length !== signature.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i++) {
    diff |= expectedBytes[i] ^ signature[i];
  }
  return diff === 0;
}

function generateJti(): string {
  const random = crypto.getRandomValues(new Uint8Array(16));
  return base64UrlEncode(random);
}

async function createToken(userId: string, email: string, secret: string): Promise<string> {
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error('JWT secret is too short or missing');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };
  const payload: JwtPayload & { iat: number; exp: number; jti: string } = {
    userId,
    email,
    iat: now,
    exp: now + JWT_EXPIRY_SECONDS,
    jti: generateJti()
  };

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = await hmacSign(signingInput, secret);
  const signatureB64 = base64UrlEncode(signature);

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

async function verifyToken(token: string, secret: string): Promise<JwtPayload | null> {
  if (!token || typeof token !== 'string') {
    return null;
  }

  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  for (const part of parts) {
    if (!part || /[^A-Za-z0-9\-_]/.test(part)) {
      return null;
    }
  }

  const signature = base64UrlDecode(signatureB64);
  if (signature.length === 0) {
    return null;
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  const isValid = await hmacVerify(signature, signingInput, secret);
  if (!isValid) {
    return null;
  }

  try {
    const headerStr = new TextDecoder().decode(base64UrlDecode(headerB64));
    const header = JSON.parse(headerStr);
    if (header.alg !== 'HS256') {
      return null;
    }
    if (header.typ !== 'JWT') {
      return null;
    }

    const payloadStr = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadStr) as JwtPayload & { iat: number; exp: number; jti: string };

    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp !== undefined) {
      if (typeof payload.exp !== 'number') {
        return null;
      }
      if (now > payload.exp + JWT_CLOCK_SKEW_SECONDS) {
        return null;
      }
    } else {
      return null;
    }

    if (payload.iat !== undefined && typeof payload.iat === 'number') {
      if (payload.iat > now + JWT_CLOCK_SKEW_SECONDS) {
        return null;
      }
    }

    if (!payload.userId || typeof payload.userId !== 'string') {
      return null;
    }

    if (!payload.email || typeof payload.email !== 'string') {
      return null;
    }

    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

export { createToken, verifyToken, JWT_EXPIRY_SECONDS, MIN_SECRET_LENGTH };
