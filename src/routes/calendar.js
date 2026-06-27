'use strict';
const express = require('express');
const { query } = require('../db/postgres');
const { syncCalendarEvents, createCalendarEvent, checkConflicts } = require('../services/calendarService');

const router = express.Router();

// GET /api/calendar — upcoming events
router.get('/', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const start = from ? new Date(from) : new Date();
    const end = to ? new Date(to) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const result = await query(
      `SELECT id, google_event_id, title, description, location,
              start_time, end_time, attendees, google_meet_link, status, ai_scheduled
       FROM calendar_events
       WHERE user_id = $1 AND start_time >= $2 AND start_time <= $3
       ORDER BY start_time ASC`,
      [req.session.userId, start, end]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/calendar/sync — sync from Google Calendar
router.post('/sync', async (req, res, next) => {
  try {
    const result = await syncCalendarEvents(req.session.userId);
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

// POST /api/calendar/events — create event
router.post('/events', async (req, res, next) => {
  try {
    const { title, description, startTime, endTime, attendeeEmails } = req.body;
    if (!title || !startTime || !endTime) {
      return res.status(400).json({ error: 'title, startTime, endTime are required' });
    }

    const conflicts = await checkConflicts(req.session.userId, startTime, endTime);
    if (conflicts.length > 0) {
      return res.status(409).json({ error: 'Schedule conflict', conflicts });
    }

    const event = await createCalendarEvent(req.session.userId, {
      title, description, startTime, endTime, attendeeEmails
    });

    // Store locally
    await query(
      `INSERT INTO calendar_events
        (user_id, google_event_id, title, description, start_time, end_time,
         attendees, google_meet_link, ai_scheduled, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW())
       ON CONFLICT (user_id, google_event_id) DO UPDATE SET
         title = EXCLUDED.title,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         attendees = EXCLUDED.attendees,
         google_meet_link = EXCLUDED.google_meet_link,
         synced_at = NOW()`,
      [
        req.session.userId, event.id, title, description || null,
        new Date(startTime), new Date(endTime),
        JSON.stringify((attendeeEmails || []).map(e => ({ email: e }))),
        event.hangoutLink || null
      ]
    );

    res.status(201).json({ ok: true, event });
  } catch (err) { next(err); }
});

// GET /api/calendar/conflicts — check time slot
router.get('/conflicts', async (req, res, next) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end required' });
    const conflicts = await checkConflicts(req.session.userId, start, end);
    res.json({ hasConflict: conflicts.length > 0, conflicts });
  } catch (err) { next(err); }
});

module.exports = router;
