/**
 * 数据迁移脚本：为 subscriptions 添加 extend_mode 列（周期模式延续设置）
 *
 * 使用方法：
 *   npx wrangler d1 execute sub-tracker --remote --file=./migrations/004_add_extend_mode.sql
 *   npx wrangler d1 execute sub-tracker --local  --file=./migrations/004_add_extend_mode.sql
 *
 * extend_mode 取值：
 *   'expire'  - 以当前到期日期为基准延续一个周期（默认）
 *   'current' - 以当前日期为基准延续一个周期
 *
 * 旧数据使用默认值 'expire'。该字段会在写入时加密，旧数据保持明文 'expire' 也不影响读取
 * （decryptField 对未加密字符串会原样返回）。
 */

-- 添加 extend_mode 列，默认 'expire'
ALTER TABLE subscriptions ADD COLUMN extend_mode TEXT DEFAULT 'expire';

-- 记录迁移版本
INSERT OR IGNORE INTO schema_migrations (name) VALUES ('004_add_extend_mode');
