'use strict';
const express = require('express');
const { query } = require('../db/postgres');
const { emailQueue, calendarQueue } = require('../jobs/queues');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/jobs — recent job logs
router.get('/', async (req, res, next) => {
  try {
    const { status, type, limit = 50 } = req.query;
    const conditions = [];
    const params = [];
    let i = 1;

    if (status) { conditions.push(`status = $${i++}`); params.push(status); }
    if (type) { conditions.push(`job_type = $${i++}`); params.push(type); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await query(
      `SELECT id, job_id, job_name, job_type, status, started_at, completed_at,
              duration_ms, tokens_used, error_message, attempts
       FROM job_logs ${where}
       ORDER BY created_at DESC LIMIT $${i}`,
      [...params, parseInt(limit)]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/jobs/queue-stats — live BullMQ stats
router.get('/queue-stats', async (req, res, next) => {
  try {
    const [emailCounts, calCounts] = await Promise.all([
      emailQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      calendarQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed')
    ]);
    res.json({
      emailTriage: emailCounts,
      calendarSync: calCounts
    });
  } catch (err) { next(err); }
});

// POST /api/jobs/trigger/email-sync — manual trigger (admin only)
router.post('/trigger/email-sync', requireRole('admin'), async (req, res, next) => {
  try {
    const { userId } = req.body;
    const targetUser = userId || req.session.userId;
    const job = await emailQueue.add('manual_sync', { userId: targetUser, emailIds: [] });
    res.json({ ok: true, jobId: job.id });
  } catch (err) { next(err); }
});

module.exports = router;
