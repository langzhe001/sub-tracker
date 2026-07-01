const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const RECURRING_DATE_REGEX = /^R:\d{2}-\d{2}$/;
const RECURRING_ISO_DATE_REGEX = /^R:\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT_LENGTH = 200;
const MAX_LONG_TEXT_LENGTH = 500;

function validateUUID(id: unknown): { valid: boolean; error?: string } {
  if (!id || typeof id !== 'string') {
    return { valid: false, error: 'Invalid ID format' };
  }
  if (id.length > 64) {
    return { valid: false, error: 'ID too long' };
  }
  if (!UUID_REGEX.test(id)) {
    return { valid: false, error: 'Invalid ID format' };
  }
  return { valid: true };
}

/**
 * 验证到期日期格式
 * 支持三种格式：
 * - 非周期模式：YYYY-MM-DD（如 2026-12-31）
 * - 周期模式：R:MM-DD（如 R:12-31，每年重复）
 * - 周期模式（续期后）：R:YYYY-MM-DD（如 R:2027-12-31，保留年份）
 */
function validateDate(date: unknown): { valid: boolean; error?: string } {
  if (!date || typeof date !== 'string') {
    return { valid: false, error: 'Invalid date format' };
  }

  // 周期模式
  if (date.startsWith('R:')) {
    // R:YYYY-MM-DD（续期后保留年份）
    if (RECURRING_ISO_DATE_REGEX.test(date)) {
      const d = new Date(date.slice(2));
      if (isNaN(d.getTime())) {
        return { valid: false, error: 'Invalid recurring ISO date' };
      }
      return { valid: true };
    }

    // R:MM-DD
    if (!RECURRING_DATE_REGEX.test(date)) {
      return { valid: false, error: 'Invalid recurring date format, use R:MM-DD or R:YYYY-MM-DD' };
    }
    const [monthStr, dayStr] = date.slice(2).split('-');
    const month = Number(monthStr);
    const day = Number(dayStr);
    if (month < 1 || month > 12) {
      return { valid: false, error: 'Invalid month (1-12)' };
    }
    if (day < 1 || day > 31) {
      return { valid: false, error: 'Invalid day (1-31)' };
    }
    return { valid: true };
  }

  // 非周期模式 YYYY-MM-DD
  if (!DATE_REGEX.test(date)) {
    return { valid: false, error: 'Invalid date format, use YYYY-MM-DD or R:MM-DD' };
  }
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    return { valid: false, error: 'Invalid date' };
  }
  return { valid: true };
}

function sanitizeString(input: unknown, maxLength: number = MAX_TEXT_LENGTH): string {
  if (typeof input !== 'string') {
    return '';
  }
  const trimmed = input.trim();
  if (trimmed.length > maxLength) {
    return trimmed.slice(0, maxLength);
  }
  return trimmed;
}

function sanitizeLongString(input: unknown): string {
  return sanitizeString(input, MAX_LONG_TEXT_LENGTH);
}

function validateNumber(num: unknown, min: number = 0, max: number = Number.MAX_SAFE_INTEGER): { valid: boolean; value?: number; error?: string } {
  if (num === undefined || num === null) {
    return { valid: true };
  }
  const n = Number(num);
  if (isNaN(n) || !isFinite(n)) {
    return { valid: false, error: 'Invalid number' };
  }
  if (n < min || n > max) {
    return { valid: false, error: `Number out of range (${min} - ${max})` };
  }
  return { valid: true, value: n };
}

function validateReminderDay(day: unknown): { valid: boolean; value: number; error?: string } {
  if (day === undefined || day === null) {
    return { valid: true, value: 7 };
  }
  const n = Number(day);
  if (isNaN(n) || !isFinite(n) || n < 1 || n > 365) {
    return { valid: false, value: 7, error: 'Reminder day must be between 1 and 365' };
  }
  return { valid: true, value: Math.floor(n) };
}

function validateChannelType(type: unknown): { valid: boolean; error?: string } {
  if (!type || typeof type !== 'string') {
    return { valid: false, error: 'Channel type is required' };
  }
  const validTypes = ['email', 'telegram', 'feishu', 'wechat', 'notifyx'];
  if (!validTypes.includes(type)) {
    return { valid: false, error: 'Invalid channel type' };
  }
  return { valid: true };
}

function validateRenewalPeriod(period: unknown): { valid: boolean; value: string; error?: string } {
  if (!period || typeof period !== 'string') {
    return { valid: true, value: 'monthly' };
  }
  const validPeriods = ['monthly', 'yearly', 'custom'];
  if (!validPeriods.includes(period)) {
    return { valid: false, value: 'monthly', error: 'Invalid renewal period' };
  }
  return { valid: true, value: period };
}

/**
 * 验证延续模式
 * - expire: 以当前到期日期为基准延续
 * - current: 以当前日期为基准延续
 */
function validateExtendMode(mode: unknown): { valid: boolean; value: string; error?: string } {
  if (mode === undefined || mode === null || mode === '') {
    return { valid: true, value: 'expire' };
  }
  if (typeof mode !== 'string') {
    return { valid: false, value: 'expire', error: 'Invalid extend mode' };
  }
  const validModes = ['expire', 'current'];
  if (!validModes.includes(mode)) {
    return { valid: false, value: 'expire', error: 'Invalid extend mode' };
  }
  return { valid: true, value: mode };
}

/**
 * 验证自定义续费天数（续费周期为 custom 时使用）
 * 范围 1-3650 天，默认 30
 */
function validateCustomRenewalDays(day: unknown): { valid: boolean; value: number; error?: string } {
  if (day === undefined || day === null || day === '') {
    return { valid: true, value: 30 };
  }
  const n = Number(day);
  if (isNaN(n) || !isFinite(n) || n < 1 || n > 3650) {
    return { valid: false, value: 30, error: 'Custom renewal days must be between 1 and 3650' };
  }
  return { valid: true, value: Math.floor(n) };
}

function validateConfig(config: unknown, type: string): { valid: boolean; value: Record<string, string>; error?: string } {
  const result: Record<string, string> = {};
  if (!config || typeof config !== 'object') {
    return { valid: false, value: result, error: 'Invalid config format' };
  }

  const configObj = config as Record<string, unknown>;
  const keys = Object.keys(configObj);
  if (keys.length > 20) {
    return { valid: false, value: result, error: 'Too many config fields' };
  }

  for (const key of keys) {
    const value = configObj[key];
    if (typeof value !== 'string') {
      return { valid: false, value: result, error: `Config field "${key}" must be a string` };
    }
    if (value.length > 8192) {
      return { valid: false, value: result, error: `Config field "${key}" is too long` };
    }
    result[key] = value;
  }

  const requiredFields: Record<string, string[]> = {
    email: ['smtpServer', 'smtpPort', 'email', 'password', 'toEmail'],
    telegram: ['botToken', 'chatId'],
    feishu: ['webhookUrl'],
    wechat: ['webhookUrl'],
    notifyx: ['apiKey']
  };

  const required = requiredFields[type] || [];
  for (const field of required) {
    if (!result[field]) {
      return { valid: false, value: result, error: `Missing required field: ${field}` };
    }
  }

  // 校验 webhookUrl 必须为 HTTPS
  if (result.webhookUrl) {
    try {
      const webhookUrl = new URL(result.webhookUrl);
      if (webhookUrl.protocol !== 'https:') {
        return { valid: false, value: result, error: 'Webhook URL must use HTTPS' };
      }
    } catch {
      return { valid: false, value: result, error: 'Invalid webhook URL' };
    }
  }

  return { valid: true, value: result };
}

/* =========================================================================
 * 任务管理模块验证
 * ========================================================================= */

/**
 * 验证任务优先级（0-3）
 */
function validateTaskPriority(priority: unknown): { valid: boolean; value: number; error?: string } {
  if (priority === undefined || priority === null || priority === '') {
    return { valid: true, value: 0 };
  }
  const n = Number(priority);
  if (isNaN(n) || n < 0 || n > 3 || !Number.isInteger(n)) {
    return { valid: false, value: 0, error: 'Priority must be 0, 1, 2, or 3' };
  }
  return { valid: true, value: n };
}

/**
 * 验证任务状态
 */
function validateTaskStatus(status: unknown): { valid: boolean; value: string; error?: string } {
  if (status === undefined || status === null || status === '') {
    return { valid: true, value: 'todo' };
  }
  if (typeof status !== 'string') {
    return { valid: false, value: 'todo', error: 'Invalid task status' };
  }
  const validStatuses = ['todo', 'done'];
  if (!validStatuses.includes(status)) {
    return { valid: false, value: 'todo', error: 'Invalid task status (must be todo or done)' };
  }
  return { valid: true, value: status };
}

/**
 * 验证任务到期日期（YYYY-MM-DD，不支持周期模式）
 */
function validateDueDate(date: unknown): { valid: boolean; value: string | null; error?: string } {
  if (date === undefined || date === null || date === '') {
    return { valid: true, value: null };
  }
  if (typeof date !== 'string') {
    return { valid: false, value: null, error: 'Invalid due date format' };
  }
  if (!DATE_REGEX.test(date)) {
    return { valid: false, value: null, error: 'Due date must be in YYYY-MM-DD format' };
  }
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    return { valid: false, value: null, error: 'Invalid due date' };
  }
  return { valid: true, value: date };
}

/**
 * 验证提醒时间（ISO 8601 datetime，如 2026-12-31T09:00:00）
 */
function validateRemindAt(date: unknown): { valid: boolean; value: string | null; error?: string } {
  if (date === undefined || date === null || date === '') {
    return { valid: true, value: null };
  }
  if (typeof date !== 'string') {
    return { valid: false, value: null, error: 'Invalid remind time format' };
  }
  if (date.length > 32) {
    return { valid: false, value: null, error: 'Remind time too long' };
  }
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    return { valid: false, value: null, error: 'Invalid remind time' };
  }
  return { valid: true, value: date };
}

/* =========================================================================
 * 习惯打卡模块验证
 * ========================================================================= */

/**
 * 验证习惯频率
 */
function validateHabitFrequency(freq: unknown): { valid: boolean; value: string; error?: string } {
  if (freq === undefined || freq === null || freq === '') {
    return { valid: true, value: 'daily' };
  }
  if (typeof freq !== 'string') {
    return { valid: false, value: 'daily', error: 'Invalid habit frequency' };
  }
  const validFreqs = ['daily', 'weekly', 'custom'];
  if (!validFreqs.includes(freq)) {
    return { valid: false, value: 'daily', error: 'Invalid habit frequency (must be daily, weekly, or custom)' };
  }
  return { valid: true, value: freq };
}

/**
 * 验证每周打卡天数（"1,3,5" 格式，1-7）
 */
function validateWeeklyDays(days: unknown): { valid: boolean; value: string | null; error?: string } {
  if (days === undefined || days === null || days === '') {
    return { valid: true, value: null };
  }
  if (typeof days !== 'string') {
    return { valid: false, value: null, error: 'Invalid weekly days format' };
  }
  const parts = days.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { valid: true, value: null };
  }
  if (parts.length > 7) {
    return { valid: false, value: null, error: 'Too many weekly days' };
  }
  for (const p of parts) {
    const n = Number(p);
    if (isNaN(n) || n < 1 || n > 7 || !Number.isInteger(n)) {
      return { valid: false, value: null, error: 'Weekly day must be 1-7' };
    }
  }
  return { valid: true, value: parts.join(',') };
}

/**
 * 验证提醒时间 HH:MM
 */
function validateTimeHM(time: unknown): { valid: boolean; value: string | null; error?: string } {
  if (time === undefined || time === null || time === '') {
    return { valid: true, value: null };
  }
  if (typeof time !== 'string') {
    return { valid: false, value: null, error: 'Invalid time format' };
  }
  if (!/^\d{1,2}:\d{2}$/.test(time)) {
    return { valid: false, value: null, error: 'Time must be in HH:MM format' };
  }
  const [h, m] = time.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    return { valid: false, value: null, error: 'Invalid time value' };
  }
  return { valid: true, value: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
}

export {
  validateUUID,
  validateDate,
  sanitizeString,
  sanitizeLongString,
  validateNumber,
  validateReminderDay,
  validateChannelType,
  validateRenewalPeriod,
  validateExtendMode,
  validateCustomRenewalDays,
  validateConfig,
  validateTaskPriority,
  validateTaskStatus,
  validateDueDate,
  validateRemindAt,
  validateHabitFrequency,
  validateWeeklyDays,
  validateTimeHM,
  MAX_TEXT_LENGTH,
  MAX_LONG_TEXT_LENGTH,
  UUID_REGEX
};
