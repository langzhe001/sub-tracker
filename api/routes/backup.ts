import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import { createBackupService } from '../services/backup';
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

const backup = new Hono<{ Bindings: Env }>();

function getPayload(c: any): AuthPayload | undefined {
  return c.get('jwtPayload') as AuthPayload | undefined;
}

// 鉴权与加密配置中间件
backup.use('/*', async (c, next) => {
  const payload = getPayload(c);
  if (!payload || !payload.userId) {
    return c.json<ApiResponse>({ success: false, error: 'Unauthorized' }, 401);
  }
  if (!c.env.ENCRYPTION_KEY || c.env.ENCRYPTION_KEY.length < MIN_ENCRYPTION_KEY_LENGTH) {
    return c.json<ApiResponse>({ success: false, error: 'Server encryption configuration error' }, 500);
  }
  await next();
});

/**
 * 导出全量备份：订阅 + 分组 + 通知渠道 + 任务模块（文件夹/清单/任务/子任务/标签/关联）
 * GET /api/backup/export
 */
backup.get('/export', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const db = drizzle(c.env.DB!, { schema });
  const service = createBackupService(db, c.env.ENCRYPTION_KEY);

  try {
    const data = await service.exportAllData(payload.userId);
    return c.json<ApiResponse>({ success: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json<ApiResponse>({ success: false, error: msg }, 500);
  }
});

/**
 * 恢复全量备份
 * POST /api/backup/import
 * 请求体：{ backup: { ...全量数据 }, mode?: 'replace' | 'merge' }
 */
backup.post('/import', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiResponse>({ success: false, error: 'Invalid request body' }, 400);
  }

  const backupData = body?.backup ?? body;
  if (!backupData || typeof backupData !== 'object') {
    return c.json<ApiResponse>({ success: false, error: 'Invalid backup data format' }, 400);
  }

  // 至少包含一个数据数组
  const hasData = ['subscriptions', 'groups', 'channels', 'taskFolders', 'taskLists', 'tasks', 'subtasks', 'tags', 'taskTags']
    .some((k) => Array.isArray(backupData[k]));
  if (!hasData) {
    return c.json<ApiResponse>({ success: false, error: 'Backup data must contain at least one data array' }, 400);
  }

  const mode: 'replace' | 'merge' = body?.mode === 'merge' ? 'merge' : 'replace';

  const db = drizzle(c.env.DB!, { schema });
  const service = createBackupService(db, c.env.ENCRYPTION_KEY);

  try {
    const result = await service.importAllData(payload.userId, backupData, mode);
    return c.json<ApiResponse>({ success: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json<ApiResponse>({ success: false, error: msg }, 400);
  }
});

export default backup;
