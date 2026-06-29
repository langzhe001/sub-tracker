const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const RECURRING_DATE_REGEX = /^R:\d{2}-\d{2}$/;
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
 * 支持两种格式：
 * - 非周期模式：YYYY-MM-DD（如 2026-12-31）
 * - 周期模式：R:MM-DD（如 R:12-31，每年重复）
 */
function validateDate(date: unknown): { valid: boolean; error?: string } {
  if (!date || typeof date !== 'string') {
    return { valid: false, error: 'Invalid date format' };
  }

  // 周期模式 R:MM-DD
  if (date.startsWith('R:')) {
    if (!RECURRING_DATE_REGEX.test(date)) {
      return { valid: false, error: 'Invalid recurring date format, use R:MM-DD' };
    }
    const [monthStr, dayStr] = date.slice(2).split('-');
    const month = Number(monthStr);
    const day = Number(dayStr);
    if (month < 1 || month > 12) {
      return { valid: false, error: 'Invalid month (1-12)' };
    }
    // 简单校验日范围（不区分大小月，允许 1-31）
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

export {
  validateUUID,
  validateDate,
  sanitizeString,
  sanitizeLongString,
  validateNumber,
  validateReminderDay,
  validateChannelType,
  validateRenewalPeriod,
  validateConfig,
  MAX_TEXT_LENGTH,
  MAX_LONG_TEXT_LENGTH,
  UUID_REGEX
};
