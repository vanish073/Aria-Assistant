'use strict';
const express = require('express');
const { query } = require('../db/postgres');
const { syncGmailInbox } = require('../services/gmailService');
const { triageEmail } = require('../agents/emailTriage');

const router = express.Router();

// GET /api/emails — list triaged emails
router.get('/', async (req, res, next) => {
  try {
    const { label, status, limit = 50, offset = 0 } = req.query;
    const conditions = ['user_id = $1'];
    const filterParams = [req.session.userId];
    let i = 2;

    if (label) { conditions.push(`triage_label = $${i++}`); filterParams.push(label); }
    if (status) { conditions.push(`status = $${i++}`); filterParams.push(status); }

    // FIX: Keep filter params separate so count query uses the same params
    // without the pagination (limit/offset) appended.
    const result = await query(
      `SELECT id, gmail_message_id, from_address, from_name, subject, snippet,
              received_at, triage_label, triage_priority, triage_summary,
              triage_actions, status, processed_at
       FROM emails WHERE ${conditions.join(' AND ')}
       ORDER BY triage_priority ASC, received_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...filterParams, parseInt(limit), parseInt(offset)]
    );

    // FIX: Use filterParams directly (not a broken slice) for the count query
    const countResult = await query(
      `SELECT COUNT(*) FROM emails WHERE ${conditions.join(' AND ')}`,
      filterParams
    );

    res.json({ emails: result.rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) { next(err); }
});

// FIX: Declare specific sub-routes BEFORE /:id to prevent Express from
// treating 'sync' and 'stats' as the :id parameter.

// POST /api/emails/sync — trigger Gmail sync now
router.post('/sync', async (req, res, next) => {
  try {
    const result = await syncGmailInbox(req.session.userId, 50);
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

// GET /api/emails/stats/summary — count by label
// FIX: moved above /:id route so Express doesn't swallow 'stats' as an id param
router.get('/stats/summary', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT triage_label, COUNT(*) as count,
              AVG(ai_latency_ms)::int as avg_latency,
              SUM(ai_tokens_used) as total_tokens
       FROM emails WHERE user_id = $1 AND processed_at >= NOW() - INTERVAL '24 hours'
       GROUP BY triage_label`,
      [req.session.userId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/emails/:id — get single email with full body
router.get('/:id', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM emails WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Email not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// POST /api/emails/:id/triage — re-triage a single email with AI
router.post('/:id/triage', async (req, res, next) => {
  try {
    const emailRes = await query(
      'SELECT * FROM emails WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.userId]
    );
    if (!emailRes.rows.length) return res.status(404).json({ error: 'Not found' });

    const email = emailRes.rows[0];
    const triage = await triageEmail(email);

    await query(
      `UPDATE emails SET triage_label=$1, triage_priority=$2, triage_summary=$3,
       triage_actions=$4, ai_model=$5, ai_tokens_used=$6, ai_latency_ms=$7,
       status='triaged', processed_at=NOW() WHERE id=$8`,
      [triage.label, triage.priority, triage.summary,
       JSON.stringify(triage.actions), triage.aiModel,
       triage.tokensUsed, triage.latencyMs, req.params.id]
    );

    res.json({ ok: true, triage });
  } catch (err) { next(err); }
});

// PATCH /api/emails/:id/status — update status
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const valid = ['pending', 'triaged', 'archived', 'actioned'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    await query(
      'UPDATE emails SET status=$1 WHERE id=$2 AND user_id=$3',
      [status, req.params.id, req.session.userId]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
