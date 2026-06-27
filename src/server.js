'use strict';
require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const session    = require('express-session');
const path       = require('path');

const { connectDB, pool } = require('./db/postgres');
const { redisClient }     = require('./lib/redis');
const { startWorkers }    = require('./jobs/workers');
const { startCronJobs }   = require('./jobs/cron');

const authRoutes      = require('./routes/auth');
const emailRoutes     = require('./routes/emails');
const calendarRoutes  = require('./routes/calendar');
const jobRoutes       = require('./routes/jobs');
const analyticsRoutes = require('./routes/analytics');
const copilotRoutes   = require('./routes/copilot');
const dashboardRoutes = require('./routes/dashboard');

const { requireAuth }  = require('./middleware/auth');
const { auditLogger }  = require('./middleware/audit');
const { rateLimiter }  = require('./middleware/rateLimit');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security & compression ────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:       ["'self'", 'https://fonts.gstatic.com'],
      
      imgSrc:     ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"]
    }
  }
}));
app.use(compression());

// ── Trust Railway / Render proxy so req.ip / secure cookies work ──
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// ── Body parsing ──────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Session (stored in Redis) ─────────────────────────────────────
const RedisStore = require('connect-redis').default;
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge:   7 * 24 * 60 * 60 * 1000  // 7 days
  }
}));

// ── Static files ──────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Global middleware ─────────────────────────────────────────────
app.use(rateLimiter);
app.use(auditLogger);

// ── Routes ────────────────────────────────────────────────────────
app.use('/auth',          authRoutes);
app.use('/api/emails',    requireAuth, emailRoutes);
app.use('/api/calendar',  requireAuth, calendarRoutes);
app.use('/api/jobs',      requireAuth, jobRoutes);
app.use('/api/analytics', requireAuth, analyticsRoutes);
app.use('/api/copilot',  requireAuth, copilotRoutes);
app.use('/',              dashboardRoutes);

// ── Health check ──────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  const status = { postgres: 'ok', redis: 'ok', groq: 'ok' };
  let httpStatus = 200;

  try { await pool.query('SELECT 1'); }
  catch { status.postgres = 'error'; httpStatus = 503; }

  try { await redisClient.ping(); }
  catch { status.redis = 'error'; httpStatus = 503; }

  // Verify Groq API key is present (we don't call the API to avoid wasting quota)
  if (!process.env.GROQ_API_KEY) {
    status.groq = 'missing GROQ_API_KEY';
    httpStatus = 503;
  }

  res.status(httpStatus).json({
    status: httpStatus === 200 ? 'ok' : 'degraded',
    model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
    ...status,
    ts: new Date().toISOString()
  });
});

// ── 404 handler ───────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// ── Boot ──────────────────────────────────────────────────────────
async function boot() {
  // Guard required env vars at startup — fail fast with a clear message
  const required = ['SESSION_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'ENCRYPTION_KEY', 'GROQ_API_KEY'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`\n❌ Missing required environment variables:\n   ${missing.join(', ')}\n   Copy .env.example to .env and fill them in.\n`);
    process.exit(1);
  }

  try {
    await connectDB();
    console.log('✓ PostgreSQL connected');

    await redisClient.ping();
    console.log('✓ Redis connected');

    await startWorkers();
    console.log('✓ BullMQ workers started');

    startCronJobs();
    console.log('✓ Cron jobs scheduled');

    const server = app.listen(PORT, () => {
      console.log(`\n🤖 ARIA running at http://localhost:${PORT}`);
      console.log(`   Health : http://localhost:${PORT}/health`);
      console.log(`   Login  : http://localhost:${PORT}/auth/google\n`);
    });

    // ── Graceful shutdown ─────────────────────────────────────────
    const shutdown = async (signal) => {
      console.log(`\n${signal} received — shutting down gracefully…`);
      server.close(async () => {
        await pool.end();
        await redisClient.quit();
        console.log('✓ Shutdown complete');
        process.exit(0);
      });
      // Force-exit after 10 s if something hangs
      setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

  } catch (err) {
    console.error('Boot failed:', err.message);
    process.exit(1);
  }
}

boot();
