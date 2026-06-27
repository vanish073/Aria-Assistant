'use strict';
const Redis = require('ioredis');

function buildRedisConfig() {
  const base = { maxRetriesPerRequest: null, enableReadyCheck: false };

  if (process.env.REDIS_URL) {
    const url = new URL(process.env.REDIS_URL);
    const cfg = {
      ...base,
      host: url.hostname,
      port: parseInt(url.port) || 6379,
    };
    if (url.password) cfg.password = decodeURIComponent(url.password);
    if (url.protocol === 'rediss:') cfg.tls = {};  // Upstash TLS
    return cfg;
  }

  // Local Docker fallback — auto-connects, no lazyConnect needed
  const cfg = {
    ...base,
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  };
  if (process.env.REDIS_PASSWORD?.trim()) cfg.password = process.env.REDIS_PASSWORD;
  return cfg;
}

const redisConfig = buildRedisConfig();

// No lazyConnect — ioredis connects on creation, no manual .connect() needed
const redisClient = new Redis(redisConfig);

redisClient.on('connect', () => console.log('[Redis] Connected'));
redisClient.on('error',   (err) => console.error('[Redis]', err.message));

function createRedisConnection() {
  return new Redis(redisConfig);
}

module.exports = { redisClient, createRedisConnection };
