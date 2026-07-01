/**
 * 数据迁移脚本：为 subscriptions 添加 custom_renewal_days 列（自定义续费周期天数）
 *
 * 使用方法：
 *   npx wrangler d1 execute sub-tracker --remote --file=./migrations/005_add_custom_renewal_days.sql
 *   npx wrangler d1 execute sub-tracker --local  --file=./migrations/005_add_custom_renewal_days.sql
 *
 * custom_renewal_days：续费周期为 custom 时使用的自定义天数（续期时按此天数推后）。
 * 旧数据使用默认值 '30'。
 */

ALTER TABLE subscriptions ADD COLUMN custom_renewal_days TEXT DEFAULT '30';

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('005_add_custom_renewal_days');
