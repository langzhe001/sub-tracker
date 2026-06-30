import { Hono } from 'hono';
import { cors } from 'hono/cors';

import authRoute from './routes/auth';
import subscriptionsRoute from './routes/subscriptions';
import groupsRoute from './routes/groups';
import channelsRoute from './routes/channels';
import notificationsRoute from './routes/notifications';
import migrateRoute from './routes/migrate';
import { verifyToken, MIN_SECRET_LENGTH } from './services/jwt';
import { MIN_ENCRYPTION_KEY_LENGTH } from './services/crypto';
import { runScheduledJob } from './services/scheduler';
import type { Env, JwtPayload } from './types';

declare module 'hono' {
  interface ContextVariables {
    jwtPayload: JwtPayload;
  }
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-DNS-Prefetch-Control', 'off');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
  c.header('Cross-Origin-Resource-Policy', 'same-origin');
  c.header('Origin-Agent-Cluster', '?1');
  await next();
});

app.use('*', cors({
  origin: (origin) => {
    if (!origin) {
      return null;
    }
    try {
      const url = new URL(origin);
      if (
        url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname.endsWith('.pages.dev') ||
        url.hostname.endsWith('.workers.dev')
      ) {
        return origin;
      }
      return null;
    } catch {
      return null;
    }
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Accept'],
  exposeHeaders: ['Content-Type', 'Content-Length'],
  maxAge: 86400,
  credentials: false
}));

/**
 * 统一检查服务端必要配置（D1 绑定 + Secrets）
 * 若缺失则返回 503，提示用户到 Dashboard 补充
 */
function checkServerConfig(env: Env): { ok: boolean; missing: string[] } {
  const missing: string[] = [];

  if (!env.DB) {
    missing.push('D1 Database binding (DB)');
  }
  if (!env.JWT_SECRET || env.JWT_SECRET.length < MIN_SECRET_LENGTH) {
    missing.push('Secret: JWT_SECRET（至少 32 字符）');
  }
  if (!env.ENCRYPTION_KEY || env.ENCRYPTION_KEY.length < MIN_ENCRYPTION_KEY_LENGTH) {
    missing.push('Secret: ENCRYPTION_KEY（至少 32 字符）');
  }

  return { ok: missing.length === 0, missing };
}

app.use('/api/*', async (c, next) => {
  const path = c.req.path;
  const publicPaths = ['/api/auth/login', '/api/auth/register'];
  const migrationPaths = ['/api/migrate/encrypt-channels', '/api/migrate/encrypt-all-fields'];

  // 部署后未配置完成时，即使是公开接口也返回提示，避免用户误以为功能可用
  const configCheck = checkServerConfig(c.env);
  if (!configCheck.ok) {
    return c.json({
      success: false,
      error: '服务器配置未完成。请在 Cloudflare Dashboard → Workers → Settings → Variables and Secrets 中完成以下配置：',
      missing: configCheck.missing
    }, 503);
  }

  if (publicPaths.includes(path) || migrationPaths.includes(path)) {
    await next();
    return;
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice(7).trim();
  if (!token || token.length > 8192) {
    return c.json({ success: false, error: 'Invalid token format' }, 401);
  }

  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET!);
    if (!payload || !payload.userId || !payload.email) {
      return c.json({ success: false, error: 'Invalid or expired token' }, 401);
    }
    c.set('jwtPayload', payload);
  } catch {
    return c.json({ success: false, error: 'Invalid token' }, 401);
  }

  await next();
});

app.route('/api/auth', authRoute);
app.route('/api/subscriptions', subscriptionsRoute);
app.route('/api/groups', groupsRoute);
app.route('/api/channels', channelsRoute);
app.route('/api/notifications', notificationsRoute);
app.route('/api/migrate', migrateRoute);

// 静态资源由 Workers Static Assets binding（env.ASSETS）直接处理
// 非 /api 路径全部交给 ASSETS，SPA fallback 由 wrangler [assets].not_found_handling 处理
app.all('*', (c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  if (!c.env.ASSETS) {
    return c.json({ success: false, error: 'Static assets not configured' }, 503);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((err, c) => {
  console.error('Server error:', err?.message || String(err));
  return c.json({ success: false, error: 'Internal server error' }, 500);
});

export default {
  fetch: app.fetch,
  // Cloudflare Workers Cron Triggers 触发入口
  scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const configCheck = checkServerConfig(env);
    if (!configCheck.ok) {
      console.warn('Cron skipped: server config incomplete', configCheck.missing);
      return;
    }
    ctx.waitUntil(runScheduledJob(env).catch((err) => {
      console.error('scheduler job failed:', err instanceof Error ? err.message : String(err));
    }));
  }
};
