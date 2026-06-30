import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import { createSubscriptionService } from '../services/subscription';
import {
  validateUUID,
  validateDate,
  sanitizeString,
  sanitizeLongString,
  validateNumber,
  validateReminderDay,
  validateRenewalPeriod,
  validateExtendMode
} from '../services/validation';
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

const subscriptions = new Hono<{ Bindings: Env }>();

function getPayload(c: any): AuthPayload | undefined {
  return c.get('jwtPayload') as AuthPayload | undefined;
}

subscriptions.use('/*', async (c, next) => {
  const payload = getPayload(c);
  if (!payload || !payload.userId) {
    return c.json<ApiResponse>({ success: false, error: 'Unauthorized' }, 401);
  }
  if (!c.env.ENCRYPTION_KEY || c.env.ENCRYPTION_KEY.length < MIN_ENCRYPTION_KEY_LENGTH) {
    return c.json<ApiResponse>({ success: false, error: 'Server encryption configuration error' }, 500);
  }
  await next();
});

subscriptions.get('/', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const groupId = c.req.query('groupId');
  if (groupId) {
    const idCheck = validateUUID(groupId);
    if (!idCheck.valid) {
      return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
    }
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createSubscriptionService(db, c.env.ENCRYPTION_KEY);

  let data: any[];
  if (groupId) {
    data = await service.getByGroup(groupId, payload.userId);
  } else {
    data = await service.getAll(payload.userId);
  }

  return c.json<ApiResponse>({
    success: true,
    data: (data as any[]).map((sub: any) => ({
      ...sub,
      amount: sub.amount !== null && sub.amount !== undefined ? Number(sub.amount) : null,
      reminderDays: Number(sub.reminderDays) || 7
    }))
  });
});

subscriptions.get('/stats', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const db = drizzle(c.env.DB!, { schema });
  const service = createSubscriptionService(db, c.env.ENCRYPTION_KEY);

  const stats = await service.getStats(payload.userId);
  return c.json<ApiResponse>({ success: true, data: stats });
});

subscriptions.get('/:id', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createSubscriptionService(db, c.env.ENCRYPTION_KEY);

  const subscription = await service.getById(id, payload.userId);
  if (!subscription) {
    return c.json<ApiResponse>({ success: false, error: 'Subscription not found' }, 404);
  }

  return c.json<ApiResponse>({
    success: true,
    data: {
      ...subscription,
      amount: subscription.amount !== null && subscription.amount !== undefined ? Number(subscription.amount) : null,
      reminderDays: Number((subscription as any).reminderDays) || 7
    }
  });
});

subscriptions.post('/', async (c) => {
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

  const dateCheck = validateDate(body.expireDate);
  if (!dateCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: dateCheck.error }, 400);
  }

  const reminderCheck = validateReminderDay(body.reminderDays);
  if (!reminderCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: reminderCheck.error }, 400);
  }

  const periodCheck = validateRenewalPeriod(body.renewalPeriod);
  if (!periodCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: periodCheck.error }, 400);
  }

  const extendModeCheck = validateExtendMode(body.extendMode);
  if (!extendModeCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: extendModeCheck.error }, 400);
  }

  const description = sanitizeLongString(body.description);
  const icon = sanitizeString(body.icon, 16);
  const amountCheck = validateNumber(body.amount, 0, 1_000_000);
  if (!amountCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: amountCheck.error }, 400);
  }

  let groupId: string | null | undefined;
  if (body.groupId !== undefined) {
    if (body.groupId === null) {
      groupId = null;
    } else {
      const groupIdCheck = validateUUID(body.groupId);
      if (!groupIdCheck.valid) {
        return c.json<ApiResponse>({ success: false, error: groupIdCheck.error }, 400);
      }
      groupId = body.groupId;
    }
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createSubscriptionService(db, c.env.ENCRYPTION_KEY);

  const subscription = await service.create(payload.userId, {
    name,
    description: description || undefined,
    icon: icon || undefined,
    amount: amountCheck.value,
    currency: sanitizeString(body.currency, 10) || 'CNY',
    renewalPeriod: periodCheck.value as 'monthly' | 'yearly' | 'custom',
    expireDate: body.expireDate,
    reminderDays: reminderCheck.value,
    extendMode: extendModeCheck.value as 'expire' | 'current',
    groupId
  });

  if (!subscription || !subscription.id) {
    console.error('create subscription returned no row:', { userId: payload.userId, name });
    return c.json<ApiResponse>({ success: false, error: 'Failed to persist subscription' }, 500);
  }

  return c.json<ApiResponse>({
    success: true,
    data: {
      ...subscription,
      amount: subscription.amount !== null && subscription.amount !== undefined ? Number(subscription.amount) : null,
      reminderDays: Number(subscription.reminderDays) || 7
    }
  }, 201);
});

subscriptions.put('/:id', async (c) => {
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

  if (body.expireDate !== undefined) {
    const dateCheck = validateDate(body.expireDate);
    if (!dateCheck.valid) {
      return c.json<ApiResponse>({ success: false, error: dateCheck.error }, 400);
    }
    updateData.expireDate = body.expireDate;
  }

  if (body.description !== undefined) {
    updateData.description = sanitizeLongString(body.description);
  }

  if (body.icon !== undefined) {
    updateData.icon = sanitizeString(body.icon, 16);
  }

  if (body.amount !== undefined) {
    const amountCheck = validateNumber(body.amount, 0, 1_000_000);
    if (!amountCheck.valid) {
      return c.json<ApiResponse>({ success: false, error: amountCheck.error }, 400);
    }
    updateData.amount = body.amount;
  }

  if (body.currency !== undefined) {
    updateData.currency = sanitizeString(body.currency, 10) || 'CNY';
  }

  if (body.renewalPeriod !== undefined) {
    const periodCheck = validateRenewalPeriod(body.renewalPeriod);
    if (!periodCheck.valid) {
      return c.json<ApiResponse>({ success: false, error: periodCheck.error }, 400);
    }
    updateData.renewalPeriod = periodCheck.value;
  }

  if (body.reminderDays !== undefined) {
    const reminderCheck = validateReminderDay(body.reminderDays);
    if (!reminderCheck.valid) {
      return c.json<ApiResponse>({ success: false, error: reminderCheck.error }, 400);
    }
    updateData.reminderDays = reminderCheck.value;
  }

  if (body.extendMode !== undefined) {
    const extendModeCheck = validateExtendMode(body.extendMode);
    if (!extendModeCheck.valid) {
      return c.json<ApiResponse>({ success: false, error: extendModeCheck.error }, 400);
    }
    updateData.extendMode = extendModeCheck.value;
  }

  if (body.groupId !== undefined) {
    if (body.groupId === null) {
      updateData.groupId = null;
    } else {
      const groupIdCheck = validateUUID(body.groupId);
      if (!groupIdCheck.valid) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid group ID' }, 400);
      }
      updateData.groupId = body.groupId;
    }
  }

  if (Object.keys(updateData).length === 0) {
    return c.json<ApiResponse>({ success: false, error: 'No valid fields provided' }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createSubscriptionService(db, c.env.ENCRYPTION_KEY);

  const subscription = await service.update(id, payload.userId, updateData);
  if (!subscription) {
    return c.json<ApiResponse>({ success: false, error: 'Subscription not found' }, 404);
  }

  return c.json<ApiResponse>({
    success: true,
    data: {
      ...subscription,
      amount: subscription.amount !== null && subscription.amount !== undefined ? Number(subscription.amount) : null,
      reminderDays: Number((subscription as any).reminderDays) || 7
    }
  });
});

subscriptions.delete('/:id', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createSubscriptionService(db, c.env.ENCRYPTION_KEY);

  await service.delete(id, payload.userId);
  return c.json<ApiResponse>({ success: true });
});

/**
 * 一键续期：按订阅的 extendMode 与 renewalPeriod 推后到期日期
 * POST /api/subscriptions/:id/extend
 */
subscriptions.post('/:id/extend', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createSubscriptionService(db, c.env.ENCRYPTION_KEY);

  try {
    const subscription = await service.extend(id, payload.userId);
    if (!subscription) {
      return c.json<ApiResponse>({ success: false, error: 'Subscription not found' }, 404);
    }
    return c.json<ApiResponse>({
      success: true,
      data: {
        ...subscription,
        amount: subscription.amount !== null && subscription.amount !== undefined ? Number(subscription.amount) : null,
        reminderDays: Number((subscription as any).reminderDays) || 7
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json<ApiResponse>({ success: false, error: msg }, 400);
  }
});

/**
 * 测试推送：使用订阅真实数据向该用户所有启用的通知渠道发送测试通知
 * POST /api/subscriptions/:id/test
 */
subscriptions.post('/:id/test', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createSubscriptionService(db, c.env.ENCRYPTION_KEY);

  const result = await service.testPush(id, payload.userId);
  if (result.total === 0) {
    return c.json<ApiResponse>({
      success: false,
      error: '未找到该订阅或未配置启用的通知渠道'
    }, 404);
  }
  return c.json<ApiResponse>({ success: true, data: result });
});

export default subscriptions;
