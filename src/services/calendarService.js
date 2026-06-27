'use strict';
const { google } = require('googleapis');
const { getAuthenticatedClient } = require('../lib/googleAuth');
const { query } = require('../db/postgres');

/**
 * Sync upcoming calendar events from Google Calendar
 */
async function syncCalendarEvents(userId) {
  const auth = await getAuthenticatedClient(userId);
  const calendar = google.calendar({ version: 'v3', auth });

  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: weekAhead.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 100
  });

  const events = res.data.items || [];
  let synced = 0;

  for (const evt of events) {
    try {
      const startTime = evt.start?.dateTime || evt.start?.date;
      const endTime = evt.end?.dateTime || evt.end?.date;
      if (!startTime || !endTime) continue;

      const attendees = (evt.attendees || []).map(a => ({
        email: a.email,
        name: a.displayName,
        status: a.responseStatus
      }));

      const meetLink = evt.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri || null;

      await query(
        `INSERT INTO calendar_events
          (user_id, google_event_id, title, description, location,
           start_time, end_time, attendees, google_meet_link, status, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (user_id, google_event_id) DO UPDATE SET
           title = EXCLUDED.title,
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
           attendees = EXCLUDED.attendees,
           status = EXCLUDED.status,
           synced_at = NOW()`,
        [
          userId, evt.id, evt.summary || '(No title)',
          evt.description || null, evt.location || null,
          new Date(startTime), new Date(endTime),
          JSON.stringify(attendees), meetLink,
          evt.status || 'confirmed'
        ]
      );
      synced++;
    } catch (err) {
      console.error(`[Calendar] Error syncing event ${evt.id}:`, err.message);
    }
  }

  return { total: events.length, synced };
}

/**
 * Create a calendar event via Google Calendar API
 */
async function createCalendarEvent(userId, { title, description, startTime, endTime, attendeeEmails }) {
  const auth = await getAuthenticatedClient(userId);
  const calendar = google.calendar({ version: 'v3', auth });

  const event = {
    summary: title,
    description,
    start: { dateTime: new Date(startTime).toISOString(), timeZone: 'UTC' },
    end: { dateTime: new Date(endTime).toISOString(), timeZone: 'UTC' },
    attendees: (attendeeEmails || []).map(email => ({ email })),
    conferenceData: {
      createRequest: { requestId: `aria-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } }
    }
  };

  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: event,
    conferenceDataVersion: 1,
    sendUpdates: 'all'
  });

  return res.data;
}

/**
 * Check for scheduling conflicts in a time range
 */
async function checkConflicts(userId, startTime, endTime) {
  const res = await query(
    `SELECT id, title, start_time, end_time FROM calendar_events
     WHERE user_id = $1
       AND status != 'cancelled'
       AND tstzrange(start_time, end_time) && tstzrange($2::timestamptz, $3::timestamptz)`,
    [userId, new Date(startTime), new Date(endTime)]
  );
  return res.rows;
}

module.exports = { syncCalendarEvents, createCalendarEvent, checkConflicts };
