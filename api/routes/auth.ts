import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import { createAuthService } from '../services/auth';
import { validatePassword, validateEmail, MIN_PASSWORD_LENGTH } from '../services/password';
import { decrypt, isEncrypted, MIN_ENCRYPTION_KEY_LENGTH } from '../services/crypto';
import type { Env } from '../types';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface AuthPayload {
  userId: string;
  email: string;
}

const auth = new Hono<{ Bindings: Env }>();

function getPayload(c: any): AuthPayload | undefined {
  return c.get('jwtPayload') as AuthPayload | undefined;
}

auth.post('/register', async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiResponse>({ success: false, error: 'Invalid request body' }, 400);
  }

  const emailCheck = validateEmail(body.email);
  if (!emailCheck.valid) {
    return c.json<ApiResponse>({ success: false, error: emailCheck.error || 'Invalid email' }, 400);
  }

  const passwordCheck = validatePassword(body.password);
  if (!passwordCheck.valid) {
    return c.json<ApiResponse>(
      { success: false, error: passwordCheck.error || `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      400
    );
  }

  if (!c.env.ENCRYPTION_KEY || c.env.ENCRYPTION_KEY.length < MIN_ENCRYPTION_KEY_LENGTH) {
    return c.json<ApiResponse>({ success: false, error: 'Server encryption configuration error' }, 500);
  }

  const db = drizzle(c.env.DB!, { schema });
  const authService = createAuthService(db, c.env.ENCRYPTION_KEY);

  let result;
  try {
    result = await authService.register(body, c.env);
  } catch (err) {
    console.error('Register error:', err?.message || String(err));
    return c.json<ApiResponse>(
      { success: false, error: `Registration failed: ${err?.message || 'internal error'}` },
      500
    );
  }
  if (!result) {
    return c.json<ApiResponse>({ success: false, error: '该邮箱已被注册或邮箱/密码格式不正确' }, 409);
  }

  return c.json<ApiResponse>({
    success: true,
    data: { token: result.token, user: { id: result.user.id, email: result.user.email } }
  });
});

auth.post('/login', async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiResponse>({ success: false, error: 'Invalid request body' }, 400);
  }

  if (!body.email || !body.password) {
    return c.json<ApiResponse>({ success: false, error: 'Email and password are required' }, 400);
  }

  if (!c.env.ENCRYPTION_KEY || c.env.ENCRYPTION_KEY.length < MIN_ENCRYPTION_KEY_LENGTH) {
    return c.json<ApiResponse>({ success: false, error: 'Server encryption configuration error' }, 500);
  }

  const db = drizzle(c.env.DB!, { schema });
  const authService = createAuthService(db, c.env.ENCRYPTION_KEY);

  const result = await authService.login(body, c.env);
  if (!result) {
    return c.json<ApiResponse>({ success: false, error: 'Invalid credentials' }, 401);
  }

  return c.json<ApiResponse>({
    success: true,
    data: { token: result.token, user: { id: result.user.id, email: result.user.email } }
  });
});

auth.get('/me', async (c) => {
  const payload = getPayload(c);
  if (!payload || !payload.userId || !payload.email) {
    return c.json<ApiResponse>({ success: false, error: 'Unauthorized' }, 401);
  }

  const db = drizzle(c.env.DB!, { schema });
  const users = (await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, payload.userId))
    .all()) as unknown as Array<{ id: string; email: string; createdAt: Date | null }>;
  const user = users[0];

  if (!user) {
    return c.json<ApiResponse>({ success: false, error: 'User not found' }, 404);
  }

  // email 已加密存储，需要解密后返回
  let plainEmail = user.email;
  if (user.email && isEncrypted(user.email) && c.env.ENCRYPTION_KEY) {
    try {
      plainEmail = await decrypt(user.email, c.env.ENCRYPTION_KEY);
    } catch {
      plainEmail = payload.email;
    }
  }

  return c.json<ApiResponse>({
    success: true,
    data: { id: user.id, email: plainEmail, createdAt: user.createdAt?.toString() }
  });
});

export default auth;
