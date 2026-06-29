/**
 * 后端到期日期工具函数
 *
 * 支持两种存储格式：
 * - 周期模式（每年重复）：`R:MM-DD`，例如 `R:12-31`
 * - 非周期模式（一次性）：`YYYY-MM-DD`，例如 `2026-12-31`
 */

const RECURRING_PREFIX = 'R:'

/**
 * 判断是否为周期模式
 */
export function isRecurring(expireDate: string): boolean {
  return typeof expireDate === 'string' && expireDate.startsWith(RECURRING_PREFIX)
}

/**
 * 从周期模式存储值中提取月日 `MM-DD`
 */
export function getRecurringMonthDay(expireDate: string): string {
  if (!isRecurring(expireDate)) return ''
  return expireDate.slice(RECURRING_PREFIX.length)
}

/**
 * 计算距到期日的剩余天数
 *
 * 周期模式下，找到今年该月日：
 * - 若今年的该日期还未过去，按今年计算
 * - 若已过去，按明年计算（返回正数，表示下一次到期）
 *
 * @returns 负数表示已过期；正数表示未来到期；0 表示今天到期；Infinity 表示无效日期
 */
export function getDaysUntilExpire(expireDate: string): number {
  if (!expireDate) return Infinity

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (isRecurring(expireDate)) {
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
