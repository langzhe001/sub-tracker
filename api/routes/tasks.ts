import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import {
  createTaskFolderService,
  createTaskListService,
  createTaskService,
  createSubtaskService,
  createTagService
} from '../services/task';
import {
  validateUUID,
  sanitizeString,
  sanitizeLongString,
  validateTaskPriority,
  validateTaskStatus,
  validateDueDate,
  validateRemindAt,
  MAX_TEXT_LENGTH,
  MAX_LONG_TEXT_LENGTH
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

const tasks = new Hono<{ Bindings: Env }>();

function getPayload(c: any): AuthPayload | undefined {
  return c.get('jwtPayload') as AuthPayload | undefined;
}

// 鉴权与加密配置中间件
tasks.use('/*', async (c, next) => {
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
 * 任务文件夹（静态路由，优先定义）
 * ========================================================================= */

// 获取所有文件夹
tasks.get('/folders', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const db = drizzle(c.env.DB!, { schema });
  const service = createTaskFolderService(db, c.env.ENCRYPTION_KEY);
  const data = await service.getAll(payload.userId);
  return c.json<ApiResponse>({ success: true, data });
});

// 创建文件夹
tasks.post('/folders', async (c) => {
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
    return c.json<ApiResponse>({ success: false, error: 'Folder name is required' }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createTaskFolderService(db, c.env.ENCRYPTION_KEY);
  const folder = await service.create(payload.userId, {
    name,
    sortOrder: Number(body.sortOrder) || 0
  });

  if (!folder) {
    return c.json<ApiResponse>({ success: false, error: 'Failed to create folder' }, 500);
  }
  return c.json<ApiResponse>({ success: true, data: folder }, 201);
});

// 更新文件夹
tasks.put('/folders/:id', async (c) => {
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
      return c.json<ApiResponse>({ success: false, error: 'Folder name cannot be empty' }, 400);
    }
    updateData.name = name;
  }
  if (body.sortOrder !== undefined) {
    updateData.sortOrder = Number(body.sortOrder) || 0;
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createTaskFolderService(db, c.env.ENCRYPTION_KEY);
  const folder = await service.update(id, payload.userId, updateData);
  if (!folder) {
    return c.json<ApiResponse>({ success: false, error: 'Folder not found' }, 404);
  }
  return c.json<ApiResponse>({ success: true, data: folder });
});

// 删除文件夹
tasks.delete('/folders/:id', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createTaskFolderService(db, c.env.ENCRYPTION_KEY);
  await service.delete(id, payload.userId);
  return c.json<ApiResponse>({ success: true });
});

/* =========================================================================
 * 任务清单（静态路由）
 * ========================================================================= */

// 获取所有清单
tasks.get('/lists', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const db = drizzle(c.env.DB!, { schema });
  const service = createTaskListService(db, c.env.ENCRYPTION_KEY);
  const data = await service.getAll(payload.userId);
  return c.json<ApiResponse>({ success: true, data });
});

// 创建清单
tasks.post('/lists', async (c) => {
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
    return c.json<ApiResponse>({ success: false, error: 'List name is required' }, 400);
  }

  let folderId: string | null | undefined;
  if (body.folderId !== undefined) {
    if (body.folderId === null) {
      folderId = null;
    } else {
      const folderIdCheck = validateUUID(body.folderId);
      if (!folderIdCheck.valid) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid folder ID' }, 400);
      }
      folderId = body.folderId;
    }
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createTaskListService(db, c.env.ENCRYPTION_KEY);
  const list = await service.create(payload.userId, {
    name,
    color: sanitizeString(body.color, 20) || undefined,
    icon: sanitizeString(body.icon, 16) || undefined,
    folderId: folderId ?? null,
    sortOrder: Number(body.sortOrder) || 0
  });

  if (!list) {
    return c.json<ApiResponse>({ success: false, error: 'Failed to create list' }, 500);
  }
  return c.json<ApiResponse>({ success: true, data: list }, 201);
});

// 更新清单
tasks.put('/lists/:id', async (c) => {
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
      return c.json<ApiResponse>({ success: false, error: 'List name cannot be empty' }, 400);
    }
    updateData.name = name;
  }
  if (body.color !== undefined) {
    updateData.color = sanitizeString(body.color, 20);
  }
  if (body.icon !== undefined) {
    updateData.icon = sanitizeString(body.icon, 16);
  }
  if (body.sortOrder !== undefined) {
    updateData.sortOrder = Number(body.sortOrder) || 0;
  }
  if (body.folderId !== undefined) {
    if (body.folderId === null) {
      updateData.folderId = null;
    } else {
      const folderIdCheck = validateUUID(body.folderId);
      if (!folderIdCheck.valid) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid folder ID' }, 400);
      }
      updateData.folderId = body.folderId;
    }
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createTaskListService(db, c.env.ENCRYPTION_KEY);
  const list = await service.update(id, payload.userId, updateData);
  if (!list) {
    return c.json<ApiResponse>({ success: false, error: 'List not found' }, 404);
  }
  return c.json<ApiResponse>({ success: true, data: list });
});

// 删除清单
tasks.delete('/lists/:id', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createTaskListService(db, c.env.ENCRYPTION_KEY);
  await service.delete(id, payload.userId);
  return c.json<ApiResponse>({ success: true });
});

/* =========================================================================
 * 标签（静态路由）
 * ========================================================================= */

// 获取所有标签
tasks.get('/tags', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const db = drizzle(c.env.DB!, { schema });
  const service = createTagService(db, c.env.ENCRYPTION_KEY);
  const data = await service.getAll(payload.userId);
  return c.json<ApiResponse>({ success: true, data });
});

// 创建标签
tasks.post('/tags', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiResponse>({ success: false, error: 'Invalid request body' }, 400);
  }

  const name = sanitizeString(body.name, 100);
  if (!name) {
    return c.json<ApiResponse>({ success: false, error: 'Tag name is required' }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createTagService(db, c.env.ENCRYPTION_KEY);
  const tag = await service.create(payload.userId, {
    name,
    color: sanitizeString(body.color, 20) || undefined
  });

  if (!tag) {
    return c.json<ApiResponse>({ success: false, error: 'Failed to create tag' }, 500);
  }
  return c.json<ApiResponse>({ success: true, data: tag }, 201);
});

// 更新标签
tasks.put('/tags/:id', async (c) => {
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
    const name = sanitizeString(body.name, 100);
    if (!name) {
      return c.json<ApiResponse>({ success: false, error: 'Tag name cannot be empty' }, 400);
    }
    updateData.name = name;
  }
  if (body.color !== undefined) {
    updateData.color = sanitizeString(body.color, 20);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createTagService(db, c.env.ENCRYPTION_KEY);
  const tag = await service.update(id, payload.userId, updateData);
  if (!tag) {
    return c.json<ApiResponse>({ success: false, error: 'Tag not found' }, 404);
  }
  return c.json<ApiResponse>({ success: true, data: tag });
});

// 删除标签
tasks.delete('/tags/:id', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createTagService(db, c.env.ENCRYPTION_KEY);
  await service.delete(id, payload.userId);
  return c.json<ApiResponse>({ success: true });
});

/* =========================================================================
 * 子任务单独路由（静态路由，放在 /:id 之前避免冲突）
 * ========================================================================= */

// 更新子任务
tasks.put('/subtasks/:subId', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const subId = c.req.param('subId');
  const idCheck = validateUUID(subId);
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
  if (body.title !== undefined) {
    const title = sanitizeString(body.title, MAX_LONG_TEXT_LENGTH);
    if (!title) {
      return c.json<ApiResponse>({ success: false, error: 'Subtask title cannot be empty' }, 400);
    }
    updateData.title = title;
  }
  if (body.status !== undefined) {
    const statusCheck = validateTaskStatus(body.status);
    if (!statusCheck.valid) {
      return c.json<ApiResponse>({ success: false, error: statusCheck.error }, 400);
    }
    updateData.status = statusCheck.value;
  }
  if (body.sortOrder !== undefined) {
    updateData.sortOrder = Number(body.sortOrder) || 0;
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createSubtaskService(db, c.env.ENCRYPTION_KEY);
  const subtask = await service.update(subId, payload.userId, updateData);
  if (!subtask) {
    return c.json<ApiResponse>({ success: false, error: 'Subtask not found' }, 404);
  }
  return c.json<ApiResponse>({ success: true, data: subtask });
});

// 删除子任务
tasks.delete('/subtasks/:subId', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const subId = c.req.param('subId');
  const idCheck = validateUUID(subId);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createSubtaskService(db, c.env.ENCRYPTION_KEY);
  await service.delete(subId, payload.userId);
  return c.json<ApiResponse>({ success: true });
});

/* =========================================================================
 * 任务（动态路由，放在静态路由之后）
 * ========================================================================= */

// 获取任务列表
// 查询参数：listId（按清单过滤）、status（按状态过滤）
tasks.get('/', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const db = drizzle(c.env.DB!, { schema });
  const service = createTaskService(db, c.env.ENCRYPTION_KEY);

  const listId = c.req.query('listId');
  const status = c.req.query('status');

  let data: any[];
  if (listId) {
    const idCheck = validateUUID(listId);
    if (!idCheck.valid) {
      return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
    }
    data = await service.getByList(listId, payload.userId);
  } else {
    data = await service.getAll(payload.userId);
  }

  // 按状态过滤
  if (status === 'todo' || status === 'done') {
    data = data.filter((t) => t.status === status);
  }

  return c.json<ApiResponse>({ success: true, data });
});

// 创建任务
tasks.post('/', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiResponse>({ success: false, error: 'Invalid request body' }, 400);
  }

  const title = sanitizeString(body.title, MAX_LONG_TEXT_LENGTH);
  if (!title) {
    return c.json<ApiResponse>({ success: false, error: 'Task title is required' }, 400);
  }

  const priorityCheck = validateTaskPriority(body.priority);
  if (!priorityCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: priorityCheck.error }, 400);
  }

  const statusCheck = validateTaskStatus(body.status);
  if (!statusCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: statusCheck.error }, 400);
  }

  const dueDateCheck = validateDueDate(body.dueDate);
  if (!dueDateCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: dueDateCheck.error }, 400);
  }

  const remindAtCheck = validateRemindAt(body.remindAt);
  if (!remindAtCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: remindAtCheck.error }, 400);
  }

  let listId: string | null | undefined;
  if (body.listId !== undefined) {
    if (body.listId === null) {
      listId = null;
    } else {
      const listIdCheck = validateUUID(body.listId);
      if (!listIdCheck.valid) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid list ID' }, 400);
      }
      listId = body.listId;
    }
  }

  // 验证标签 ID
  let tagIds: string[] = [];
  if (Array.isArray(body.tagIds)) {
    for (const tid of body.tagIds) {
      const tidCheck = validateUUID(tid);
      if (!tidCheck.valid) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid tag ID' }, 400);
      }
      tagIds.push(tid);
    }
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createTaskService(db, c.env.ENCRYPTION_KEY);
  const task = await service.create(payload.userId, {
    title,
    description: sanitizeLongString(body.description) || undefined,
    listId: listId ?? null,
    priority: priorityCheck.value as 0 | 1 | 2 | 3,
    status: statusCheck.value as 'todo' | 'done',
    dueDate: dueDateCheck.value,
    remindAt: remindAtCheck.value,
    sortOrder: Number(body.sortOrder) || 0,
    pinned: !!body.pinned,
    tagIds
  });

  if (!task) {
    return c.json<ApiResponse>({ success: false, error: 'Failed to create task' }, 500);
  }
  return c.json<ApiResponse>({ success: true, data: { ...task, tagIds } }, 201);
});

// 获取单个任务（含标签 ID 列表）
tasks.get('/:id', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createTaskService(db, c.env.ENCRYPTION_KEY);
  const task = await service.getById(id, payload.userId);
  if (!task) {
    return c.json<ApiResponse>({ success: false, error: 'Task not found' }, 404);
  }

  const tagIds = await service.getTaskTagIds(id, payload.userId);
  return c.json<ApiResponse>({
    success: true,
    data: { ...task, tagIds }
  });
});

// 更新任务
tasks.put('/:id', async (c) => {
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

  if (body.title !== undefined) {
    const title = sanitizeString(body.title, MAX_LONG_TEXT_LENGTH);
    if (!title) {
      return c.json<ApiResponse>({ success: false, error: 'Task title cannot be empty' }, 400);
    }
    updateData.title = title;
  }
  if (body.description !== undefined) {
    updateData.description = sanitizeLongString(body.description);
  }
  if (body.priority !== undefined) {
    const priorityCheck = validateTaskPriority(body.priority);
    if (!priorityCheck.valid) {
      return c.json<ApiResponse>({ success: false, error: priorityCheck.error }, 400);
    }
    updateData.priority = priorityCheck.value;
  }
  if (body.status !== undefined) {
    const statusCheck = validateTaskStatus(body.status);
    if (!statusCheck.valid) {
      return c.json<ApiResponse>({ success: false, error: statusCheck.error }, 400);
    }
    updateData.status = statusCheck.value;
  }
  if (body.dueDate !== undefined) {
    const dueDateCheck = validateDueDate(body.dueDate);
    if (!dueDateCheck.valid) {
      return c.json<ApiResponse>({ success: false, error: dueDateCheck.error }, 400);
    }
    updateData.dueDate = dueDateCheck.value;
  }
  if (body.remindAt !== undefined) {
    const remindAtCheck = validateRemindAt(body.remindAt);
    if (!remindAtCheck.valid) {
      return c.json<ApiResponse>({ success: false, error: remindAtCheck.error }, 400);
    }
    updateData.remindAt = remindAtCheck.value;
  }
  if (body.sortOrder !== undefined) {
    updateData.sortOrder = Number(body.sortOrder) || 0;
  }
  if (body.pinned !== undefined) {
    updateData.pinned = !!body.pinned;
  }
  if (body.listId !== undefined) {
    if (body.listId === null) {
      updateData.listId = null;
    } else {
      const listIdCheck = validateUUID(body.listId);
      if (!listIdCheck.valid) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid list ID' }, 400);
      }
      updateData.listId = body.listId;
    }
  }

  // 处理标签
  let tagIds: string[] | undefined;
  if (Array.isArray(body.tagIds)) {
    tagIds = [];
    for (const tid of body.tagIds) {
      const tidCheck = validateUUID(tid);
      if (!tidCheck.valid) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid tag ID' }, 400);
      }
      tagIds.push(tid);
    }
    updateData.tagIds = tagIds;
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createTaskService(db, c.env.ENCRYPTION_KEY);
  const task = await service.update(id, payload.userId, updateData);
  if (!task) {
    return c.json<ApiResponse>({ success: false, error: 'Task not found' }, 404);
  }

  const finalTagIds = tagIds !== undefined ? tagIds : await service.getTaskTagIds(id, payload.userId);
  return c.json<ApiResponse>({
    success: true,
    data: { ...task, tagIds: finalTagIds }
  });
});

// 删除任务
tasks.delete('/:id', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createTaskService(db, c.env.ENCRYPTION_KEY);
  await service.delete(id, payload.userId);
  return c.json<ApiResponse>({ success: true });
});

/* =========================================================================
 * 任务的子任务（两段路径，不会与单段路由冲突）
 * ========================================================================= */

// 获取任务的所有子任务
tasks.get('/:id/subtasks', async (c) => {
  const payload = getPayload(c);
  if (!payload) return;

  const id = c.req.param('id');
  const idCheck = validateUUID(id);
  if (!idCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: idCheck.error }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createSubtaskService(db, c.env.ENCRYPTION_KEY);
  const data = await service.getByTask(id, payload.userId);
  return c.json<ApiResponse>({ success: true, data });
});

// 创建子任务
tasks.post('/:id/subtasks', async (c) => {
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

  const title = sanitizeString(body.title, MAX_LONG_TEXT_LENGTH);
  if (!title) {
    return c.json<ApiResponse>({ success: false, error: 'Subtask title is required' }, 400);
  }

  const db = drizzle(c.env.DB!, { schema });
  const service = createSubtaskService(db, c.env.ENCRYPTION_KEY);
  const subtask = await service.create(payload.userId, {
    taskId: id,
    title,
    sortOrder: Number(body.sortOrder) || 0
  });

  if (!subtask) {
    return c.json<ApiResponse>({ success: false, error: 'Failed to create subtask' }, 500);
  }
  return c.json<ApiResponse>({ success: true, data: subtask }, 201);
});

export default tasks;
