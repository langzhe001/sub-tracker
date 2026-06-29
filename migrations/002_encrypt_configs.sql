/**
 * 数据迁移脚本：加密已有的明文通知渠道配置
 *
 * 使用方法：
 *   npx wrangler d1 execute sub-tracker --remote --file=./migrations/002_encrypt_configs.sql
 *
 * 注意：此 SQL 脚本仅用于标记迁移版本。
 * 实际的加密操作需要通过 API 端点 /api/admin/migrate-encryption 执行，
 * 因为 SQL 本身无法执行 AES-GCM 加密。
 *
 * 迁移步骤：
 * 1. 部署包含加密功能的新版本代码
 * 2. 设置 ENCRYPTION_KEY 环境变量
 * 3. 调用迁移 API 端点（需要管理员权限）
 * 4. 验证数据已正确加密
 */

-- 迁移版本记录表
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  executed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- 记录加密迁移
INSERT OR IGNORE INTO schema_migrations (name) VALUES ('002_encrypt_configs');
