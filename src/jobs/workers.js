'use strict';
const { Worker } = require('bullmq');
const { createRedisConnection } = require('../lib/redis');
const { batchTriageEmails } = require('../agents/emailTriage');
const { syncCalendarEvents } = require('../services/calendarService');
const { query } = require('../db/postgres');

async function startWorkers() {
  const conn = createRedisConnection();

  // ── Email Triage Worker ───────────────────────────────────────────
  const emailWorker = new Worker('email-triage', async (job) => {
    const { userId } = job.data;
    const emailIds = job.data.emailIds || [];
    console.log(`[Worker:email] Processing ${emailIds.length} emails for user ${userId}`);

    const logRes = await query(
      `INSERT INTO job_logs (job_id, job_name, job_type, status, user_id, payload, started_at)
       VALUES ($1, $2, 'email_batch', 'running', $3, $4, NOW()) RETURNING id`,
      [job.id, job.name, userId, JSON.stringify({ emailCount: emailIds.length })]
    );
    const logId = logRes.rows[0]?.id;

    try {
      const result = await batchTriageEmails(userId, emailIds);
      await query(
        `UPDATE job_logs SET status='completed', result=$1, completed_at=NOW(),
         duration_ms=EXTRACT(EPOCH FROM (NOW()-started_at))*1000, tokens_used=$2
         WHERE id=$3`,
        [JSON.stringify(result), result.tokensUsed, logId]
      );
      return result;
    } catch (err) {
      await query(
        `UPDATE job_logs SET status='failed', error_message=$1, completed_at=NOW() WHERE id=$2`,
        [err.message, logId]
      );
      throw err;
    }
  }, {
    connection: conn,
    concurrency: parseInt(process.env.MAX_CONCURRENT_AI_JOBS || '3')
  });

  // ── Calendar Sync Worker ──────────────────────────────────────────
  const calendarWorker = new Worker('calendar-sync', async (job) => {
    const { userId } = job.data;
    console.log(`[Worker:calendar] Syncing for user ${userId}`);

    const logRes = await query(
      `INSERT INTO job_logs (job_id, job_name, job_type, status, user_id, started_at)
       VALUES ($1, $2, 'calendar_sync', 'running', $3, NOW()) RETURNING id`,
      [job.id, job.name, userId]
    );
    const logId = logRes.rows[0]?.id;

    try {
      const result = await syncCalendarEvents(userId);
      await query(
        `UPDATE job_logs SET status='completed', result=$1, completed_at=NOW(),
         duration_ms=EXTRACT(EPOCH FROM (NOW()-started_at))*1000 WHERE id=$2`,
        [JSON.stringify(result), logId]
      );
      return result;
    } catch (err) {
      await query(
        `UPDATE job_logs SET status='failed', error_message=$1, completed_at=NOW() WHERE id=$2`,
        [err.message, logId]
      );
      throw err;
    }
  }, { connection: createRedisConnection(), concurrency: 5 });

  // Error handlers
  emailWorker.on('failed', (job, err) =>
    console.error(`[Worker:email] Job ${job?.id} failed:`, err.message));
  calendarWorker.on('failed', (job, err) =>
    console.error(`[Worker:calendar] Job ${job?.id} failed:`, err.message));

  console.log('[Workers] email-triage and calendar-sync workers online');
}

module.exports = { startWorkers };
