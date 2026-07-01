/**
 * 数据迁移脚本：创建习惯打卡模块相关表
 * 对标滴答清单第二阶段：习惯养成
 *
 * 使用方法：
 *   npx wrangler d1 execute sub-tracker --remote --file=./migrations/007_add_habits.sql
 *   npx wrangler d1 execute sub-tracker --local  --file=./migrations/007_add_habits.sql
 *
 * 表清单：
 * - habits：习惯（支持每日/每周/自定义频率，目标次数，提醒时间）
 * - habit_records：打卡记录（按日期聚合，可多次打卡）
 *
 * 敏感字段（name/description）使用 AES-GCM 加密存储。
 */

-- 习惯
CREATE TABLE IF NOT EXISTS habits (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6366F1',
  icon TEXT,
  frequency TEXT DEFAULT 'daily',       -- daily | weekly | custom
  weekly_days TEXT,                      -- "1,3,5" 周一三五
  custom_days INTEGER DEFAULT 1,         -- 每 N 天一次
  goal INTEGER DEFAULT 1,               -- 每日目标次数
  remind_time TEXT,                      -- HH:MM
  archived INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  user_id TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 习惯打卡记录
CREATE TABLE IF NOT EXISTS habit_records (
  id TEXT PRIMARY KEY NOT NULL,
  habit_id TEXT NOT NULL,
  date TEXT NOT NULL,                    -- YYYY-MM-DD
  count INTEGER DEFAULT 1,
  note TEXT,
  user_id TEXT NOT NULL,
  created_at INTEGER,
  FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_habits_user_id ON habits(user_id);
CREATE INDEX IF NOT EXISTS idx_habit_records_habit_id ON habit_records(habit_id);
CREATE INDEX IF NOT EXISTS idx_habit_records_user_id ON habit_records(user_id);
CREATE INDEX IF NOT EXISTS idx_habit_records_date ON habit_records(date);
CREATE INDEX IF NOT EXISTS idx_habit_records_habit_date ON habit_records(habit_id, date);

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('007_add_habits');
