import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import { createGroupService } from '../services/group';
import { validateUUID, sanitizeString } from '../services/validation';
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

const groups = new Hono<{ Bindings: Env }>();

function getPayload(c: any): AuthPayload | undefined {
  return c.get('jwtPayload') as AuthPayload | undefined;
}

groups.use('/*', async (c, next) => {
  const payload = getPayload(c);
  if (!payload || !payload.userId) {
    return c.json<ApiResponse>({ success: false, error: 'Unauthorized' }, 401);
  }
  if (!c.env.ENCRYPTION_KEY || c.env.ENCRYPTION_KEY.length < MIN_ENCRYPTION_KEY_LENGTH) {
    return c.json<ApiResponse>({ success: false, error: 'Server encryption configuration error' }, 500);
  }
  await next();
});

groups.get('/', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const db = drizzle(c.env.DB!, { schema });
  const service = createGroupService(db, c.env.ENCRYPTION_KEY);

  const data = await service.getAll(payload.userId);
  return c.json<ApiResponse>({ success: true, data });
});

groups.get('/:id', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createGroupService(db, c.env.ENCRYPTION_KEY);

  const group = await service.getById(id, payload.userId);
  if (!group) {
    return c.json<ApiResponse>({ success: false, error: 'Group not found' }, 404);
  }

  return c.json<ApiResponse>({ success: true, data: group });
});

groups.post('/', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiResponse>({ success: false, error: 'Invalid request body' }, 400);
  }

  const name = sanitizeString(body.name);
  if (!name) {
    return c.json<ApiResponse>({ success: false, error: 'Name is required' }, 400);
  }
  const color = sanitizeString(body.color, 20);
  const icon = sanitizeString(body.icon, 16);

  const db = drizzle(c.env.DB!, { schema });
  const service = createGroupService(db, c.env.ENCRYPTION_KEY);

  const group = await service.create(payload.userId, { name, color, icon });
  return c.json<ApiResponse>({ success: true, data: group }, 201);
});

groups.put('/:id', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

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
  if (body.color !== undefined) {
    updateData.color = sanitizeString(body.color, 20);
  }
  if (body.icon !== undefined) {
    updateData.icon = sanitizeString(body.icon, 16);
  }

  if (Object.keys(updateData).length === 0) {
    return c.json<ApiResponse>({ success: false, error: 'No valid fields provided' }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createGroupService(db, c.env.ENCRYPTION_KEY);

  const group = await service.update(id, payload.userId, updateData);
  if (!group) {
    return c.json<ApiResponse>({ success: false, error: 'Group not found' }, 404);
  }

  return c.json<ApiResponse>({ success: true, data: group });
});

groups.delete('/:id', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createGroupService(db, c.env.ENCRYPTION_KEY);

  await service.delete(id, payload.userId);
  return c.json<ApiResponse>({ success: true });
});

export default groups;
