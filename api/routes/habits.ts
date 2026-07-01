import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import { createHabitService } from '../services/habit';
import {
  validateUUID,
  sanitizeString,
  sanitizeLongString,
  validateHabitFrequency,
  validateWeeklyDays,
  validateTimeHM,
  validateDueDate,
  MAX_TEXT_LENGTH
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

const habits = new Hono<{ Bindings: Env }>();

function getPayload(c: any): AuthPayload | undefined {
  return c.get('jwtPayload') as AuthPayload | undefined;
}

// 鉴权与加密配置中间件
habits.use('/*', async (c, next) => {
  const payload = getPayload(c);
  if (!payload || !payload.userId) {
    return c.json<ApiResponse>({ success: false, error: 'Unauthorized' }, 401);
  }
  if (!c.env.ENCRYPTION_KEY || c.env.ENCRYPTION_KEY.length < MIN_ENCRYPTION_KEY_LENGTH) {
    return c.json<ApiResponse>({ success: false, error: 'Server encryption configuration error' }, 500);
  }
  await next();
});

/* =========================================================================
 * 统计（静态路由，优先定义）
 * ========================================================================= */

// 获取习惯统计
habits.get('/stats', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const db = drizzle(c.env.DB!, { schema });
  const service = createHabitService(db, c.env.ENCRYPTION_KEY);
  const stats = await service.getStats(payload.userId);
  return c.json<ApiResponse>({ success: true, data: stats });
});

/* =========================================================================
 * 打卡记录（静态路由，优先定义）
 * ========================================================================= */

// 获取某习惯的打卡记录（查询参数：startDate, endDate）
habits.get('/records/:habitId', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const habitId = c.req.param('habitId');
  const idCheck = validateUUID(habitId);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  const db = drizzle(c.env.DB!, { schema });
  const service = createHabitService(db, c.env.ENCRYPTION_KEY);
  const data = await service.getRecords(habitId, payload.userId, startDate || undefined, endDate || undefined);
  return c.json<ApiResponse>({ success: true, data });
});

// 批量获取用户所有习惯在日期范围内的打卡记录
// 返回 { [habitId]: HabitRecord[] }
habits.get('/records', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  if (!startDate || !endDate) {
    return c.json<ApiResponse>({ success: false, error: 'startDate and endDate are required' }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createHabitService(db, c.env.ENCRYPTION_KEY);
  const map = await service.getAllRecordsByDateRange(payload.userId, startDate, endDate);
  const result: Record<string, any[]> = {};
  for (const [habitId, records] of map.entries()) {
    result[habitId] = records;
  }
  return c.json<ApiResponse>({ success: true, data: result });
});

// 创建打卡记录
habits.post('/records', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiResponse>({ success: false, error: 'Invalid request body' }, 400);
  }

  const habitIdCheck = validateUUID(body.habitId);
  if (!habitIdCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: 'Invalid habit ID' }, 400);
  }

  const dateCheck = validateDueDate(body.date);
  if (!dateCheck.valid || !dateCheck.value) {
    return c.json<ApiResponse>({ success: false, error: 'Invalid date (YYYY-MM-DD)' }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createHabitService(db, c.env.ENCRYPTION_KEY);
  const record = await service.createRecord(payload.userId, {
    habitId: body.habitId,
    date: dateCheck.value,
    count: Number(body.count) || 1,
    note: sanitizeLongString(body.note) || undefined
  });

  if (!record) {
    return c.json<ApiResponse>({ success: false, error: 'Failed to create record' }, 500);
  }
  return c.json<ApiResponse>({ success: true, data: record }, 201);
});

// 删除打卡记录
habits.delete('/records/:id', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createHabitService(db, c.env.ENCRYPTION_KEY);
  await service.deleteRecord(id, payload.userId);
  return c.json<ApiResponse>({ success: true });
});

/**
 * 撤销某习惯某天的全部打卡
 * DELETE /api/habits/:id/records?date=YYYY-MM-DD
 */
habits.delete('/:id/records', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const date = c.req.query('date');
  const dateCheck = validateDueDate(date);
  if (!dateCheck.valid || !dateCheck.value) {
    return c.json<ApiResponse>({ success: false, error: 'Invalid date' }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createHabitService(db, c.env.ENCRYPTION_KEY);
  const deleted = await service.deleteRecordsByDate(id, dateCheck.value, payload.userId);
  return c.json<ApiResponse>({ success: true, data: { deleted } });
});

/* =========================================================================
 * 习惯 CRUD（动态路由）
 * ========================================================================= */

// 获取所有习惯
habits.get('/', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const includeArchived = c.req.query('archived') === '1';

  const db = drizzle(c.env.DB!, { schema });
  const service = createHabitService(db, c.env.ENCRYPTION_KEY);
  const data = await service.getAll(payload.userId, includeArchived);
  return c.json<ApiResponse>({ success: true, data });
});

// 创建习惯
habits.post('/', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiResponse>({ success: false, error: 'Invalid request body' }, 400);
  }

  const name = sanitizeString(body.name, MAX_TEXT_LENGTH);
  if (!name) {
    return c.json<ApiResponse>({ success: false, error: 'Habit name is required' }, 400);
  }

  const freqCheck = validateHabitFrequency(body.frequency);
  if (!freqCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: freqCheck.error }, 400);
  }

  const weeklyDaysCheck = validateWeeklyDays(body.weeklyDays);
  if (!weeklyDaysCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: weeklyDaysCheck.error }, 400);
  }

  const remindTimeCheck = validateTimeHM(body.remindTime);
  if (!remindTimeCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: remindTimeCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createHabitService(db, c.env.ENCRYPTION_KEY);
  const habit = await service.create(payload.userId, {
    name,
    description: sanitizeLongString(body.description) || undefined,
    color: sanitizeString(body.color, 20) || undefined,
    icon: sanitizeString(body.icon, 16) || undefined,
    frequency: freqCheck.value as 'daily' | 'weekly' | 'custom',
    weeklyDays: weeklyDaysCheck.value || undefined,
    customDays: Number(body.customDays) || 1,
    goal: Number(body.goal) || 1,
    remindTime: remindTimeCheck.value || undefined,
    sortOrder: Number(body.sortOrder) || 0
  });

  if (!habit) {
    return c.json<ApiResponse>({ success: false, error: 'Failed to create habit' }, 500);
  }
  return c.json<ApiResponse>({ success: true, data: habit }, 201);
});

// 获取单个习惯
habits.get('/:id', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createHabitService(db, c.env.ENCRYPTION_KEY);
  const habit = await service.getById(id, payload.userId);
  if (!habit) {
    return c.json<ApiResponse>({ success: false, error: 'Habit not found' }, 404);
  }
  return c.json<ApiResponse>({ success: true, data: habit });
});

// 更新习惯
habits.put('/:id', async (c) => {
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
    const name = sanitizeString(body.name, MAX_TEXT_LENGTH);
    if (!name) {
      return c.json<ApiResponse>({ success: false, error: 'Habit name cannot be empty' }, 400);
    }
    updateData.name = name;
  }
  if (body.description !== undefined) {
    updateData.description = sanitizeLongString(body.description);
  }
  if (body.color !== undefined) updateData.color = sanitizeString(body.color, 20);
  if (body.icon !== undefined) updateData.icon = sanitizeString(body.icon, 16);
  if (body.frequency !== undefined) {
    const freqCheck = validateHabitFrequency(body.frequency);
    if (!freqCheck.valid) {
      return c.json<ApiResponse>({ success: false, error: freqCheck.error }, 400);
    }
    updateData.frequency = freqCheck.value;
  }
  if (body.weeklyDays !== undefined) {
    const weeklyDaysCheck = validateWeeklyDays(body.weeklyDays);
    if (!weeklyDaysCheck.valid) {
      return c.json<ApiResponse>({ success: false, error: weeklyDaysCheck.error }, 400);
    }
    updateData.weeklyDays = weeklyDaysCheck.value;
  }
  if (body.customDays !== undefined) updateData.customDays = Number(body.customDays) || 1;
  if (body.goal !== undefined) updateData.goal = Number(body.goal) || 1;
  if (body.remindTime !== undefined) {
    const remindTimeCheck = validateTimeHM(body.remindTime);
    if (!remindTimeCheck.valid) {
      return c.json<ApiResponse>({ success: false, error: remindTimeCheck.error }, 400);
    }
    updateData.remindTime = remindTimeCheck.value;
  }
  if (body.archived !== undefined) updateData.archived = !!body.archived;
  if (body.sortOrder !== undefined) updateData.sortOrder = Number(body.sortOrder) || 0;

  const db = drizzle(c.env.DB!, { schema });
  const service = createHabitService(db, c.env.ENCRYPTION_KEY);
  const habit = await service.update(id, payload.userId, updateData);
  if (!habit) {
    return c.json<ApiResponse>({ success: false, error: 'Habit not found' }, 404);
  }
  return c.json<ApiResponse>({ success: true, data: habit });
});

// 删除习惯
habits.delete('/:id', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createHabitService(db, c.env.ENCRYPTION_KEY);
  await service.delete(id, payload.userId);
  return c.json<ApiResponse>({ success: true });
});

export default habits;
