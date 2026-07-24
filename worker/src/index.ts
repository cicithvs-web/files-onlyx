import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Variables } from './types';
import auth, { seedAdmin } from './routes/auth';
import users from './routes/users';
import repos from './routes/repos';
import nodes from './routes/nodes';
import uploads from './routes/uploads';
import zip from './routes/zip';
import shares from './routes/shares';
import misc from './routes/misc';
import { cleanupTrash } from './cron/trash-cleanup';
import { JobRunner } from './durable-objects/job-runner';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', async (c, next) => {
  const corsMiddleware = cors({
    origin: (origin) => {
      if (!origin) return c.env.FRONTEND_ORIGIN;
      const allowed = [c.env.FRONTEND_ORIGIN, 'https://ce6c18de.files-onlyx.pages.dev', 'https://files.onlyx.top', 'http://localhost:5173', 'http://127.0.0.1:5173'];
      return allowed.includes(origin) ? origin : c.env.FRONTEND_ORIGIN;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Share-Password'],
    maxAge: 86400,
  });
  return corsMiddleware(c, next);
});

app.get('/', (c) => c.json({ name: c.env.APP_NAME, status: 'ok', version: '1.0.0' }));
app.get('/health', (c) => c.json({ status: 'healthy' }));
app.get('/api/health', (c) => c.json({ status: 'healthy' }));

app.route('/api/auth', auth);
app.route('/api/users', users);
app.route('/api/repos', repos);
app.route('/api/nodes', nodes);
app.route('/api/uploads', uploads);
app.route('/api/zip', zip);
app.route('/api/shares', shares);
app.route('/api', misc);

app.notFound((c) => c.json({ success: false, error: { message: 'Endpoint tidak ditemukan', code: 'not_found' } }, 404));
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ success: false, error: { message: 'Terjadi kesalahan pada server', code: 'internal' } }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(cleanupTrash(env));
  },
};

export { JobRunner };
