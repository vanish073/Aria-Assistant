'use strict';
const { Pool } = require('pg');

// Neon (and most managed Postgres) requires SSL in production.
// The pg driver reads sslmode from the connection string automatically,
// but we also set ssl: true as an explicit fallback.
const sslConfig = process.env.NODE_ENV === 'production'
  ? { rejectUnauthorized: false } // Neon uses self-signed certs
  : false;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

async function connectDB() {
  const client = await pool.connect();
  try {
    await client.query('SELECT NOW()');
  } finally {
    client.release();
  }
}

async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development' && duration > 500) {
    console.warn(`[DB] Slow query (${duration}ms):`, text.substring(0, 80));
  }
  return res;
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, connectDB, query, withTransaction };
