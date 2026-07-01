/**
 * 订阅到期日期工具函数
 *
 * 支持三种存储格式：
 * - 周期模式（每年重复）：`R:MM-DD`，例如 `R:12-31` 表示每年 12 月 31 日到期
 * - 周期模式（续期后，保留年份）：`R:YYYY-MM-DD`，例如 `R:2027-12-31`
 * - 非周期模式（一次性）：`YYYY-MM-DD`，例如 `2026-12-31` 表示 2026 年 12 月 31 日到期
 *
 * `R:MM-DD` 会自动滚动到"距今最近的未来日期"来计算剩余天数。
 * `R:YYYY-MM-DD` 使用显式日期，不滚动（续期后保留年份）。
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
 * 周期模式是否包含年份（R:YYYY-MM-DD）
 */
export function isRecurringWithYear(expireDate: string): boolean {
  return isRecurring(expireDate) && expireDate.slice(RECURRING_PREFIX.length).length === 10
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
 * 获取到期日期的显示文本
 * - 周期模式 R:MM-DD：`每年 12月31日`
 * - 周期模式 R:YYYY-MM-DD：显示具体日期（续期后的下次到期日）
 * - 非周期模式：`2026年12月31日`
 */
export function formatExpireDate(expireDate: string): string {
  if (!expireDate) return ''

  if (isRecurring(expireDate)) {
    // R:YYYY-MM-DD：显示具体日期
    if (isRecurringWithYear(expireDate)) {
      const dateStr = expireDate.slice(RECURRING_PREFIX.length)
      const date = new Date(dateStr)
      if (isNaN(date.getTime())) return expireDate
      return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
    }

    // R:MM-DD
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
 * 周期模式下：
 * - `R:MM-DD`：滚动到距今最近的未来日期
 * - `R:YYYY-MM-DD`：使用显式日期，不滚动
 *
 * @returns 负数表示已过期；正数表示未来到期；0 表示今天到期
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
    const month = Number(monthStr) - 1 // JS 月份从 0 开始
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
