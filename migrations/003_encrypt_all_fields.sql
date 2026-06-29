/**
 * 数据迁移脚本：全字段加密（防止平台侧数据泄露）
 *
 * 使用方法：
 *   npx wrangler d1 execute sub-tracker --remote --file=./migrations/003_encrypt_all_fields.sql
 *
 * 此 SQL 仅执行 DDL 变更（添加 email_hash 列 + 唯一索引）。
 * 实际的数据加密（email、subscriptions、groups、channels.name、notification_logs.error_message）
 * 需要在部署后调用迁移 API 端点 POST /api/migrate/encrypt-all-fields 执行，
 * 因为 AES-GCM 加密无法在 SQL 层完成。
 *
 * 迁移步骤：
 * 1. 执行本 SQL（添加 email_hash 列）
 * 2. 部署包含全字段加密功能的新版本代码
 * 3. 确认 ENCRYPTION_KEY 环境变量已配置（≥32 字符）
 * 4. 调用迁移 API：POST /api/migrate/encrypt-all-fields（Header: X-Migration-Key）
 * 5. 验证数据库中所有敏感字段均已加密
 */

-- 添加 email_hash 列（HMAC-SHA256 哈希，用于登录/注册时的邮箱等值查询）
-- 旧数据先用空字符串占位，迁移 API 会回填真实哈希值
ALTER TABLE users ADD COLUMN email_hash TEXT NOT NULL DEFAULT '';

-- 创建 email_hash 唯一索引（用于快速查询 + 防止重复注册）
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_hash ON users(email_hash);

-- 记录迁移版本
INSERT OR IGNORE INTO schema_migrations (name) VALUES ('003_encrypt_all_fields');
