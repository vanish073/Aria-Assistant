'use strict';
const { query } = require('../db/postgres');
const { emailQueue, calendarQueue } = require('./queues');
const { syncGmailInbox } = require('../services/gmailService');

function startCronJobs() {
  const emailInterval    = parseInt(process.env.EMAIL_SYNC_INTERVAL_MS    || '300000');
  const calendarInterval = parseInt(process.env.CALENDAR_SYNC_INTERVAL_MS || '300000');

  // ── Running flags — prevent overlapping runs if a sync takes longer than the interval
  let emailSyncRunning    = false;
  let calendarSyncRunning = false;
  let metricsSyncRunning  = false;

  // ── Email Sync ────────────────────────────────────────────────────
  setInterval(async () => {
    if (emailSyncRunning) {
      console.warn('[Cron:email] Previous run still in progress — skipping');
      return;
    }
    emailSyncRunning = true;
    console.log('[Cron] Running email sync…');
    try {
      const users = await query(
        `SELECT DISTINCT u.id FROM users u
         JOIN oauth_tokens t ON t.user_id = u.id AND t.provider = 'google'`
      );
      for (const { id: userId } of users.rows) {
        try {
          await syncGmailInbox(userId, parseInt(process.env.MAX_EMAILS_PER_BATCH || '50'));
        } catch (userErr) {
          console.error(`[Cron:email] Failed for user ${userId}:`, userErr.message);
        }
      }
    } catch (err) {
      console.error('[Cron:email] Error:', err.message);
    } finally {
      emailSyncRunning = false;
    }
  }, emailInterval);

  // ── Calendar Sync ─────────────────────────────────────────────────
  setInterval(async () => {
    if (calendarSyncRunning) {
      console.warn('[Cron:calendar] Previous run still in progress — skipping');
      return;
    }
    calendarSyncRunning = true;
    console.log('[Cron] Running calendar sync…');
    try {
      const users = await query(
        `SELECT DISTINCT u.id FROM users u
         JOIN oauth_tokens t ON t.user_id = u.id AND t.provider = 'google'`
      );
      for (const { id: userId } of users.rows) {
        try {
          await calendarQueue.add('sync', { userId }, { jobId: `cal-sync-${userId}-${Date.now()}` });
        } catch (userErr) {
          console.error(`[Cron:calendar] Failed for user ${userId}:`, userErr.message);
        }
      }
    } catch (err) {
      console.error('[Cron:calendar] Error:', err.message);
    } finally {
      calendarSyncRunning = false;
    }
  }, calendarInterval);

  // ── Metrics Snapshot (hourly) ─────────────────────────────────────
  setInterval(async () => {
    if (metricsSyncRunning) return;
    metricsSyncRunning = true;
    try {
      await query(
        `INSERT INTO metrics_snapshots
          (period, emails_processed, emails_triaged, meetings_scheduled, tokens_used, avg_latency_ms, error_count)
         SELECT
           'hourly',
           COUNT(*) FILTER (WHERE status != 'pending'),
           COUNT(*) FILTER (WHERE status = 'triaged'),
           (SELECT COUNT(*) FROM calendar_events WHERE ai_scheduled = true AND created_at >= NOW() - INTERVAL '1 hour'),
           COALESCE(SUM(ai_tokens_used), 0),
           COALESCE(AVG(ai_latency_ms)::int, 0),
           (SELECT COUNT(*) FROM job_logs WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '1 hour')
         FROM emails WHERE created_at >= NOW() - INTERVAL '1 hour'`
      );
    } catch (err) {
      console.error('[Cron:metrics] Error:', err.message);
    } finally {
      metricsSyncRunning = false;
    }
  }, 60 * 60 * 1000);

  console.log(`[Cron] Email every ${emailInterval/1000}s · Calendar every ${calendarInterval/1000}s · Metrics hourly`);
}

module.exports = { startCronJobs };
