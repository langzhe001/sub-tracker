import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import { createNotificationService } from '../services/notification';
import { validateNumber } from '../services/validation';
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

const notifications = new Hono<{ Bindings: Env }>();

function getPayload(c: any): AuthPayload | undefined {
  return c.get('jwtPayload') as AuthPayload | undefined;
}

notifications.use('/*', async (c, next) => {
  const payload = getPayload(c);
  if (!payload || !payload.userId) {
    return c.json<ApiResponse>({ success: false, error: 'Unauthorized' }, 401);
  }
  if (!c.env.ENCRYPTION_KEY || c.env.ENCRYPTION_KEY.length < MIN_ENCRYPTION_KEY_LENGTH) {
    return c.json<ApiResponse>({ success: false, error: 'Encryption key not configured' }, 500);
  }
  await next();
});

notifications.get('/', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const limitStr = c.req.query('limit') || '50';
  const limitCheck = validateNumber(limitStr, 1, 200);
  const limit = limitCheck.value ? Math.floor(limitCheck.value as number) : 50;

  const db = drizzle(c.env.DB!, { schema });
  const service = createNotificationService(db, c.env.ENCRYPTION_KEY);

  const logs = await service.getLogs(payload.userId, limit);

  return c.json<ApiResponse>({
    success: true,
    data: logs.map((log: any) => ({
      id: log.log.id,
      subscriptionId: log.log.subscriptionId,
      subscriptionName: log.subscription,
      channelId: log.log.channelId,
      channelType: log.log.channelType,
      success: log.log.success === 1,
      sentAt: log.log.sentAt
    }))
  });
});

export default notifications;
