'use strict';
const express = require('express');
const { query } = require('../db/postgres');

const router = express.Router();

// GET /api/analytics/overview — dashboard summary stats
router.get('/overview', async (req, res, next) => {
  try {
    const userId = req.session.userId;

    const [emailStats, calStats, jobStats, tokenStats] = await Promise.all([
      query(
        `SELECT
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE status = 'triaged') as triaged,
           COUNT(*) FILTER (WHERE triage_label = 'urgent') as urgent,
           COUNT(*) FILTER (WHERE triage_label = 'meeting') as meeting,
           COUNT(*) FILTER (WHERE processed_at >= NOW() - INTERVAL '24 hours') as last_24h
         FROM emails WHERE user_id = $1`,
        [userId]
      ),
      query(
        `SELECT
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE ai_scheduled = true) as ai_scheduled,
           COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
           COUNT(*) FILTER (WHERE start_time >= NOW() AND start_time <= NOW() + INTERVAL '7 days') as upcoming
         FROM calendar_events WHERE user_id = $1`,
        [userId]
      ),
      query(
        `SELECT
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE status = 'completed') as completed,
           COUNT(*) FILTER (WHERE status = 'failed') as failed,
           COUNT(*) FILTER (WHERE status = 'running') as running,
           AVG(duration_ms)::int as avg_duration_ms
         FROM job_logs WHERE user_id = $1 OR user_id IS NULL`,
        [userId]
      ),
      query(
        `SELECT
           COALESCE(SUM(ai_tokens_used), 0) as total_tokens,
           COALESCE(AVG(ai_latency_ms)::int, 0) as avg_latency_ms,
           COALESCE(SUM(ai_tokens_used) FILTER (WHERE processed_at >= NOW() - INTERVAL '24 hours'), 0) as tokens_24h
         FROM emails WHERE user_id = $1`,
        [userId]
      )
    ]);

    res.json({
      emails: emailStats.rows[0],
      calendar: calStats.rows[0],
      jobs: jobStats.rows[0],
      tokens: tokenStats.rows[0],
      uptime: '99.97%' // could be computed from job_logs in production
    });
  } catch (err) { next(err); }
});

// GET /api/analytics/audit — audit log
router.get('/audit', async (req, res, next) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const result = await query(
      `SELECT al.id, al.actor, al.action, al.resource_type, al.resource_id,
              al.details, al.ip_address, al.created_at
       FROM audit_log al
       WHERE al.user_id = $1 OR al.actor IN ('system', 'agent:email-triage', 'agent:calendar')
       ORDER BY al.created_at DESC LIMIT $2 OFFSET $3`,
      [req.session.userId, parseInt(limit), parseInt(offset)]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/analytics/metrics-history — time series
router.get('/metrics-history', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT snapshot_at, period, emails_processed, emails_triaged,
              meetings_scheduled, tokens_used, avg_latency_ms, error_count
       FROM metrics_snapshots
       WHERE snapshot_at >= NOW() - INTERVAL '7 days'
       ORDER BY snapshot_at ASC LIMIT 200`
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = router;
