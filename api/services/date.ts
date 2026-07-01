/**
 * 后端到期日期工具函数
 *
 * 支持三种存储格式：
 * - 周期模式（每年重复）：`R:MM-DD`，例如 `R:12-31`
 * - 周期模式（续期后，保留年份）：`R:YYYY-MM-DD`，例如 `R:2027-12-31`
 * - 非周期模式（一次性）：`YYYY-MM-DD`，例如 `2026-12-31`
 *
 * `R:YYYY-MM-DD` 由一键续期生成，保留年份确保剩余天数计算正确，
 * 同时保留 `R:` 前缀使其仍被识别为周期模式。
 */

const RECURRING_PREFIX = 'R:'

/**
 * 判断是否为周期模式
 */
export function isRecurring(expireDate: string): boolean {
  return typeof expireDate === 'string' && expireDate.startsWith(RECURRING_PREFIX)
}

/**
 * 周期模式是否包含年份（R:YYYY-MM-DD）
 */
function isRecurringWithYear(expireDate: string): boolean {
  return isRecurring(expireDate) && expireDate.slice(RECURRING_PREFIX.length).length === 10
}

/**
 * 从周期模式存储值中提取月日 `MM-DD`
 * - `R:MM-DD` → `MM-DD`
 * - `R:YYYY-MM-DD` → `MM-DD`（跳过年份）
 */
export function getRecurringMonthDay(expireDate: string): string {
  if (!isRecurring(expireDate)) return ''
  const after = expireDate.slice(RECURRING_PREFIX.length)
  // R:YYYY-MM-DD → 提取 MM-DD
  if (after.length === 10) return after.slice(5)
  // R:MM-DD
  return after
}

/**
 * 计算距到期日的剩余天数
 *
 * 周期模式下：
 * - `R:MM-DD`：滚动到距今最近的未来日期
 * - `R:YYYY-MM-DD`：使用显式日期，不滚动
 *
 * @returns 负数表示已过期；正数表示未来到期；0 表示今天到期；Infinity 表示无效日期
 */
export function getDaysUntilExpire(expireDate: string): number {
  if (!expireDate) return Infinity

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (isRecurring(expireDate)) {
    // R:YYYY-MM-DD：使用显式日期，不滚动
    if (isRecurringWithYear(expireDate)) {
      const dateStr = expireDate.slice(RECURRING_PREFIX.length)
      const target = new Date(dateStr)
      target.setHours(0, 0, 0, 0)
      if (isNaN(target.getTime())) return Infinity
      return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    }

    // R:MM-DD：滚动到最近的未来日期
    const md = getRecurringMonthDay(expireDate)
    const [monthStr, dayStr] = md.split('-')
    const month = Number(monthStr) - 1
    const day = Number(dayStr)

    if (isNaN(month) || isNaN(day)) return Infinity

    let target = new Date(today.getFullYear(), month, day)
    target.setHours(0, 0, 0, 0)

    if (target.getTime() < today.getTime()) {
      target = new Date(today.getFullYear() + 1, month, day)
      target.setHours(0, 0, 0, 0)
    }

    return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  }

  // 非周期模式
  const target = new Date(expireDate)
  target.setHours(0, 0, 0, 0)
  if (isNaN(target.getTime())) return Infinity

  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

/**
 * 获取到期状态
 */
export function getExpireStatus(expireDate: string): 'expired' | 'critical' | 'warning' | 'normal' {
  const days = getDaysUntilExpire(expireDate)
  if (days < 0) return 'expired'
  if (days <= 3) return 'critical'
  if (days <= 7) return 'warning'
  return 'normal'
}
