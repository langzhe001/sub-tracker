/**
 * AES-GCM 加密服务
 * 用于加密存储数据库中的敏感字段，防止平台侧数据泄露风险
 *
 * 加密格式: enc:v1:<base64(iv)>:<base64(ciphertext)>
 * 哈希格式: hmac:<base64(hmac)>
 * 使用 Web Crypto API，兼容 Cloudflare Workers 运行时
 */

const ENCRYPTION_VERSION = 'v1';
const ENCRYPTION_PREFIX = `enc:${ENCRYPTION_VERSION}:`;
const HMAC_PREFIX = 'hmac:';
const IV_LENGTH = 12; // AES-GCM 推荐 12 字节 IV
const KEY_LENGTH = 32; // 256 位密钥
const PBKDF2_ITERATIONS = 50000;
const MIN_ENCRYPTION_KEY_LENGTH = 32;

// 缓存已派生的密钥
let cachedEncKey: CryptoKey | null = null;
let cachedHmacKey: CryptoKey | null = null;
let cachedKeyIdentifier = '';

/**
 * Base64URL 编码
 */
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

/**
 * Base64URL 解码
 */
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

/**
 * 从主密钥派生 AES-GCM 加密密钥和 HMAC 签名密钥
 * 使用不同盐值派生两种密钥，确保密钥隔离
 */
async function deriveKeys(masterKey: string): Promise<{ encKey: CryptoKey; hmacKey: CryptoKey }> {
  // 使用密钥的 SHA-256 哈希作为缓存标识，避免明文密钥长期驻留内存
  const keyIdentifier = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(masterKey));
  const keyIdStr = Array.from(new Uint8Array(keyIdentifier)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (cachedEncKey && cachedHmacKey && cachedKeyIdentifier === keyIdStr) {
    return { encKey: cachedEncKey, hmacKey: cachedHmacKey };
  }

  const encoder = new TextEncoder();

  // PBKDF2 的 key material 与盐无关，只需 import 一次，复用于两次 deriveKey
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(masterKey),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  // 派生 AES-GCM 加密密钥
  const encKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('sub-tracker-enc-key-salt-v2'),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH * 8 },
    false,
    ['encrypt', 'decrypt']
  );

  // 派生 HMAC-SHA256 签名密钥（用于可搜索加密）
  const hmacKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('sub-tracker-hmac-key-salt-v2'),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  cachedEncKey = encKey;
  cachedHmacKey = hmacKey;
  cachedKeyIdentifier = keyIdStr;

  return { encKey, hmacKey };
}

/**
 * 加密字符串
 * @param plaintext 明文
 * @param encryptionKey 主加密密钥（来自环境变量）
 * @returns 加密后的字符串，格式: enc:v1:<base64(iv)>:<base64(ciphertext)>
 */
async function encrypt(plaintext: string, encryptionKey: string): Promise<string> {
  if (!plaintext) {
    return '';
  }

  if (!encryptionKey || encryptionKey.length < MIN_ENCRYPTION_KEY_LENGTH) {
    throw new Error('Encryption key is missing or too short (minimum 32 characters)');
  }

  if (isEncrypted(plaintext)) {
    return plaintext;
  }

  const { encKey } = await deriveKeys(encryptionKey);
  const encoder = new TextEncoder();

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    encKey,
    encoder.encode(plaintext)
  );

  const ivB64 = base64UrlEncode(iv);
  const ciphertextB64 = base64UrlEncode(ciphertext);

  return `${ENCRYPTION_PREFIX}${ivB64}:${ciphertextB64}`;
}

/**
 * 解密字符串
 * @param encryptedData 加密数据
 * @param encryptionKey 主加密密钥
 * @returns 解密后的明文
 */
async function decrypt(encryptedData: string, encryptionKey: string): Promise<string> {
  if (!encryptedData) {
    return '';
  }

  if (!isEncrypted(encryptedData)) {
    return encryptedData;
  }

  if (!encryptionKey || encryptionKey.length < MIN_ENCRYPTION_KEY_LENGTH) {
    throw new Error('Encryption key is missing or too short (minimum 32 characters)');
  }

  const parts = encryptedData.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted data format');
  }

  const [, version, ivB64, ciphertextB64] = parts;

  if (version !== ENCRYPTION_VERSION) {
    throw new Error(`Unsupported encryption version: ${version}`);
  }

  const { encKey } = await deriveKeys(encryptionKey);
  const iv = base64UrlDecode(ivB64);
  const ciphertext = base64UrlDecode(ciphertextB64);

  if (iv.length === 0 || ciphertext.length === 0) {
    throw new Error('Invalid encrypted data: IV or ciphertext is empty');
  }

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      encKey,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    throw new Error('Decryption failed: invalid key or corrupted data');
  }
}

/**
 * 生成 HMAC-SHA256 哈希（用于可搜索加密）
 * 对同一明文始终生成相同哈希，可用于数据库 WHERE 查询
 * @param plaintext 明文
 * @param encryptionKey 主密钥
 * @returns 哈希字符串，格式: hmac:<base64(hmac)>
 */
async function hmacHash(plaintext: string, encryptionKey: string): Promise<string> {
  if (!plaintext) {
    return '';
  }

  if (!encryptionKey || encryptionKey.length < MIN_ENCRYPTION_KEY_LENGTH) {
    throw new Error('Encryption key is missing or too short');
  }

  const { hmacKey } = await deriveKeys(encryptionKey);
  const encoder = new TextEncoder();

  const signature = await crypto.subtle.sign(
    'HMAC',
    hmacKey,
    encoder.encode(plaintext)
  );

  return `${HMAC_PREFIX}${base64UrlEncode(signature)}`;
}

/**
 * 检查字符串是否已加密
 */
function isEncrypted(data: string): boolean {
  if (!data || typeof data !== 'string') {
    return false;
  }
  return data.startsWith(ENCRYPTION_PREFIX);
}

/**
 * 检查字符串是否为 HMAC 哈希
 */
function isHmacHash(data: string): boolean {
  if (!data || typeof data !== 'string') {
    return false;
  }
  return data.startsWith(HMAC_PREFIX);
}

/**
 * 加密 JSON 对象
 */
async function encryptJSON(obj: unknown, encryptionKey: string): Promise<string> {
  const jsonStr = JSON.stringify(obj);
  return encrypt(jsonStr, encryptionKey);
}

/**
 * 解密 JSON 对象
 */
async function decryptJSON<T = unknown>(encryptedData: string, encryptionKey: string): Promise<T> {
  const jsonStr = await decrypt(encryptedData, encryptionKey);
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    throw new Error('Decrypted data is not valid JSON');
  }
}

/**
 * 加密单个字段，空值安全（null/undefined 返回原值）
 */
async function encryptField(value: string | null | undefined, encryptionKey: string): Promise<string | null> {
  if (value === null || value === undefined || value === '') {
    return value ?? null;
  }
  return encrypt(value, encryptionKey);
}

/**
 * 解密单个字段，空值安全
 */
async function decryptField(value: string | null | undefined, encryptionKey: string): Promise<string | null> {
  if (value === null || value === undefined || value === '') {
    return value ?? null;
  }
  if (!isEncrypted(value)) {
    return value;
  }
  try {
    return await decrypt(value, encryptionKey);
  } catch (err) {
    console.warn('decryptField failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * 批量加密记录的指定字段
 */
async function encryptFields(
  record: Record<string, unknown>,
  fields: string[],
  encryptionKey: string
): Promise<Record<string, unknown>> {
  const result = { ...record };
  for (const field of fields) {
    if (result[field] !== null && result[field] !== undefined && result[field] !== '') {
      result[field] = await encrypt(String(result[field]), encryptionKey);
    }
  }
  return result;
}

/**
 * 批量解密记录的指定字段（原地修改）
 */
async function decryptFields(
  record: Record<string, unknown>,
  fields: string[],
  encryptionKey: string
): Promise<void> {
  for (const field of fields) {
    if (record[field] && typeof record[field] === 'string') {
      const val = record[field] as string;
      if (isEncrypted(val)) {
        try {
          record[field] = await decrypt(val, encryptionKey);
        } catch {
          record[field] = null;
        }
      }
    }
  }
}

/**
 * 批量解密记录数组的指定字段
 */
async function decryptFieldsBatch(
  records: Record<string, unknown>[],
  fields: string[],
  encryptionKey: string
): Promise<void> {
  for (const record of records) {
    await decryptFields(record, fields, encryptionKey);
  }
}

/**
 * 批量解密通道配置（兼容旧接口）
 */
async function decryptChannelConfigs(
  channels: Array<{ config: string }>,
  encryptionKey: string
): Promise<void> {
  for (const channel of channels) {
    if (channel.config) {
      try {
        channel.config = await decrypt(channel.config, encryptionKey);
      } catch {
        // 解密失败时保留原始值
      }
    }
  }
}

export {
  encrypt,
  decrypt,
  isEncrypted,
  isHmacHash,
  hmacHash,
  encryptJSON,
  decryptJSON,
  encryptField,
  decryptField,
  encryptFields,
  decryptFields,
  decryptFieldsBatch,
  decryptChannelConfigs,
  MIN_ENCRYPTION_KEY_LENGTH,
  ENCRYPTION_PREFIX,
  HMAC_PREFIX
};
