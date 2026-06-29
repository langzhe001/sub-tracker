/**
 * 订阅到期日期工具函数
 *
 * 支持两种存储格式：
 * - 周期模式（每年重复）：`R:MM-DD`，例如 `R:12-31` 表示每年 12 月 31 日到期
 * - 非周期模式（一次性）：`YYYY-MM-DD`，例如 `2026-12-31` 表示 2026 年 12 月 31 日到期
 *
 * 周期模式下，到期日会自动滚动到"距今最近的未来日期"来计算剩余天数。
 */

/** 周期模式存储前缀 */
export const RECURRING_PREFIX = 'R:'

/**
 * 判断是否为周期模式（每年重复）
 */
export function isRecurring(expireDate: string): boolean {
  return typeof expireDate === 'string' && expireDate.startsWith(RECURRING_PREFIX)
}

/**
 * 将周期模式的月日转换为存储格式
 * @param monthDay 格式 `MM-DD`，例如 `12-31`
 */
export function toRecurringValue(monthDay: string): string {
  return `${RECURRING_PREFIX}${monthDay}`
}

/**
 * 从周期模式存储值中提取月日 `MM-DD`
 */
export function getRecurringMonthDay(expireDate: string): string {
  if (!isRecurring(expireDate)) return ''
  return expireDate.slice(RECURRING_PREFIX.length)
}

/**
 * 获取到期日期的显示文本
 * - 周期模式：`每年 12月31日`
 * - 非周期模式：`2026年12月31日`
 */
export function formatExpireDate(expireDate: string): string {
  if (!expireDate) return ''

  if (isRecurring(expireDate)) {
    const md = getRecurringMonthDay(expireDate)
    const [m, d] = md.split('-')
    return `每年 ${Number(m)}月${Number(d)}日`
  }

  const date = new Date(expireDate)
  if (isNaN(date.getTime())) return expireDate
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

/**
 * 计算距到期日的剩余天数
 *
 * 周期模式下，找到今年该月日：
 * - 若今年的该日期还未过去，则按今年计算
 * - 若已过去，则按明年计算（返回正数，表示下一次到期）
 * - 若正好是今天，返回 0
 *
 * @returns 负数表示已过期；正数表示未来到期；0 表示今天到期
 */
export function getDaysUntilExpire(expireDate: string): number {
  if (!expireDate) return Infinity

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (isRecurring(expireDate)) {
    const md = getRecurringMonthDay(expireDate)
    const [monthStr, dayStr] = md.split('-')
    const month = Number(monthStr) - 1 // JS 月份从 0 开始
    const day = Number(dayStr)

    if (isNaN(month) || isNaN(day)) return Infinity

    // 先尝试今年的该日期
    let target = new Date(today.getFullYear(), month, day)
    target.setHours(0, 0, 0, 0)

    // 若已过去，用明年
    if (target.getTime() < today.getTime()) {
      target = new Date(today.getFullYear() + 1, month, day)
      target.setHours(0, 0, 0, 0)
    }

    return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  }

  // 非周期模式：直接计算
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

/**
 * 生成到期标签文本
 * 周期模式永远不会过期（自动滚动到下次到期），只显示距下次到期的天数
 */
export function expireLabel(expireDate: string): string {
  if (!expireDate) return '未设置到期日期'
  const days = getDaysUntilExpire(expireDate)
  if (days === Infinity) return '日期无效'
  if (days < 0) return '已过期'
  if (days === 0) return '今天到期'
  return `${days} 天后到期`
}
