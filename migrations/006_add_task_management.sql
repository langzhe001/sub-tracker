/**
 * 数据迁移脚本：创建任务管理模块相关表
 * 对标滴答清单第一阶段：任务管理基础
 *
 * 使用方法：
 *   npx wrangler d1 execute sub-tracker --remote --file=./migrations/006_add_task_management.sql
 *   npx wrangler d1 execute sub-tracker --local  --file=./migrations/006_add_task_management.sql
 *
 * 表清单：
 * - task_folders：任务文件夹（组织多个清单）
 * - task_lists：任务清单（组织任务，可属于文件夹）
 * - tasks：任务（核心实体，支持优先级、状态、到期日、提醒、置顶）
 * - subtasks：子任务
 * - tags：标签（跨清单分类）
 * - task_tags：任务-标签多对多关联
 *
 * 敏感字段（title/description/dueDate/remindAt/name）使用 AES-GCM 加密存储，
 * 与现有 subscriptions 模块的加密策略保持一致。
 */

-- 任务文件夹
CREATE TABLE IF NOT EXISTS task_folders (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  user_id TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 任务清单
CREATE TABLE IF NOT EXISTS task_lists (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366F1',
  icon TEXT,
  folder_id TEXT,
  sort_order INTEGER DEFAULT 0,
  user_id TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY (folder_id) REFERENCES task_folders(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 任务
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  list_id TEXT,
  priority INTEGER DEFAULT 0,
  status TEXT DEFAULT 'todo',
  due_date TEXT,
  remind_at TEXT,
  sort_order INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0,
  completed_at INTEGER,
  user_id TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY (list_id) REFERENCES task_lists(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 子任务
CREATE TABLE IF NOT EXISTS subtasks (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'todo',
  sort_order INTEGER DEFAULT 0,
  user_id TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 标签
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366F1',
  user_id TEXT NOT NULL,
  created_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 任务-标签关联
CREATE TABLE IF NOT EXISTS task_tags (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 常用查询索引
CREATE INDEX IF NOT EXISTS idx_task_lists_user_id ON task_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_task_lists_folder_id ON task_lists(folder_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_list_id ON tasks(list_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_subtasks_task_id ON subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_task_id ON task_tags(task_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag_id ON task_tags(tag_id);

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('006_add_task_management');
