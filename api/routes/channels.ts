import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import { createChannelService } from '../services/channel';
import { validateUUID, sanitizeString, validateChannelType, validateConfig } from '../services/validation';
import { MIN_ENCRYPTION_KEY_LENGTH } from '../services/crypto';
import type { Env } from '../types';

interface AuthPayload {
  userId: string;
  email: string;
}

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

const channels = new Hono<{ Bindings: Env }>();

function getPayload(c: any): AuthPayload | undefined {
  return c.get('jwtPayload') as AuthPayload | undefined;
}

/**
 * 校验加密密钥是否已正确配置
 */
function validateEncryptionKey(env: Env): string | null {
  if (!env.ENCRYPTION_KEY || env.ENCRYPTION_KEY.length < MIN_ENCRYPTION_KEY_LENGTH) {
    return null;
  }
  return env.ENCRYPTION_KEY;
}

channels.use('/*', async (c, next) => {
  const payload = getPayload(c);
  if (!payload || !payload.userId) {
    return c.json<ApiResponse>({ success: false, error: 'Unauthorized' }, 401);
  }

  // 校验加密密钥
  if (!validateEncryptionKey(c.env)) {
    return c.json<ApiResponse>({ success: false, error: 'Server encryption configuration error' }, 500);
  }

  await next();
});

channels.get('/', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const encryptionKey = validateEncryptionKey(c.env);
  if (!encryptionKey) return;

  const db = drizzle(c.env.DB!, { schema });
  const service = createChannelService(db, encryptionKey);

  const data = (await service.getAll(payload.userId)) as unknown as any[];
  return c.json<ApiResponse>({
    success: true,
    data: data.map(ch => ({
      id: ch.id,
      name: ch.name,
      type: ch.type,
      enabled: ch.enabled === 1,
      createdAt: ch.createdAt,
      isConfigured: ch.config && ch.config !== '{}'
    }))
  });
});

channels.get('/:id', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const encryptionKey = validateEncryptionKey(c.env);
  if (!encryptionKey) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createChannelService(db, encryptionKey);

  const channel = await service.getById(id, payload.userId);
  if (!channel) {
    return c.json<ApiResponse>({ success: false, error: 'Channel not found' }, 404);
  }

  const ch = channel as any;
  return c.json<ApiResponse>({
    success: true,
    data: {
      id: ch.id,
      name: ch.name,
      type: ch.type,
      config: JSON.parse(ch.config || '{}'),
      enabled: ch.enabled === 1,
      createdAt: ch.createdAt
    }
  });
});

channels.post('/', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const encryptionKey = validateEncryptionKey(c.env);
  if (!encryptionKey) return;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiResponse>({ success: false, error: 'Invalid request body' }, 400);
  }

  const typeCheck = validateChannelType(body.type);
  if (!typeCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: typeCheck.error }, 400);
  }

  const name = sanitizeString(body.name);
  if (!name) {
    return c.json<ApiResponse>({ success: false, error: 'Name is required' }, 400);
  }

  if (!body.config || typeof body.config !== 'object') {
    return c.json<ApiResponse>({ success: false, error: 'Config is required' }, 400);
  }

  const configCheck = validateConfig(body.config, body.type);
  if (!configCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: configCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createChannelService(db, encryptionKey);

  const channel = await service.create(payload.userId, {
    name,
    type: body.type,
    config: configCheck.value,
    enabled: typeof body.enabled === 'boolean' ? body.enabled : true
  });

  const ch = channel as any;
  return c.json<ApiResponse>({
    success: true,
    data: {
      id: ch.id,
      name: ch.name,
      type: ch.type,
      enabled: ch.enabled === 1,
      createdAt: ch.createdAt
    }
  }, 201);
});

channels.put('/:id', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const encryptionKey = validateEncryptionKey(c.env);
  if (!encryptionKey) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiResponse>({ success: false, error: 'Invalid request body' }, 400);
  }

  const updateData: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = sanitizeString(body.name);
    if (!name) {
      return c.json<ApiResponse>({ success: false, error: 'Name cannot be empty' }, 400);
    }
    updateData.name = name;
  }

  if (body.type !== undefined) {
    const typeCheck = validateChannelType(body.type);
    if (!typeCheck.valid) {
      return c.json<ApiResponse>({ success: false, error: typeCheck.error }, 400);
    }
    updateData.type = body.type;
  }

  if (body.config !== undefined) {
    const typeForConfig = body.type || 'email';
    const configCheck = validateConfig(body.config, typeForConfig);
    if (!configCheck.valid) {
      return c.json<ApiResponse>({ success: false, error: configCheck.error }, 400);
    }
    updateData.config = configCheck.value;
  }

  if (body.enabled !== undefined && typeof body.enabled === 'boolean') {
    updateData.enabled = body.enabled;
  }

  if (Object.keys(updateData).length === 0) {
    return c.json<ApiResponse>({ success: false, error: 'No valid fields provided' }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createChannelService(db, encryptionKey);

  const channel = await service.update(id, payload.userId, updateData);
  if (!channel) {
    return c.json<ApiResponse>({ success: false, error: 'Channel not found' }, 404);
  }

  const ch = channel as any;
  return c.json<ApiResponse>({
    success: true,
    data: {
      id: ch.id,
      name: ch.name,
      type: ch.type,
      enabled: ch.enabled === 1,
      createdAt: ch.createdAt
    }
  });
});

channels.delete('/:id', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const encryptionKey = validateEncryptionKey(c.env);
  if (!encryptionKey) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createChannelService(db, encryptionKey);

  await service.delete(id, payload.userId);
  return c.json<ApiResponse>({ success: true });
});

channels.post('/:id/test', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const encryptionKey = validateEncryptionKey(c.env);
  if (!encryptionKey) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createChannelService(db, encryptionKey);

  const result = await service.testChannel(id, payload.userId);
  return c.json<ApiResponse>(result as any);
});

export default channels;
