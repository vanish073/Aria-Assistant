'use strict';
const { google } = require('googleapis');
const { getAuthenticatedClient } = require('../lib/googleAuth');
const { query } = require('../db/postgres');
const { emailQueue } = require('../jobs/queues');

/**
 * Fetch recent emails from Gmail and store in DB
 */
async function syncGmailInbox(userId, maxResults = 50) {
  const auth = await getAuthenticatedClient(userId);
  const gmail = google.gmail({ version: 'v1', auth });

  // Get list of recent messages
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    q: 'is:inbox -category:promotions -category:social'
  });

  const messages = listRes.data.messages || [];
  if (!messages.length) return { fetched: 0 };

  const newEmailIds = [];

  for (const { id: msgId } of messages) {
    try {
      // Check if already stored
      const exists = await query(
        'SELECT id FROM emails WHERE gmail_message_id = $1',
        [msgId]
      );
      if (exists.rows.length) continue;

      // Fetch full message
      const msgRes = await gmail.users.messages.get({
        userId: 'me',
        id: msgId,
        format: 'full'
      });
      const msg = msgRes.data;
      const headers = msg.payload?.headers || [];

      const getHeader = (name) =>
        headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

      const subject = getHeader('Subject');
      const from = getHeader('From');
      const dateStr = getHeader('Date');

      // Parse from header: "Name <email>"
      const fromMatch = from.match(/^(.*?)\s*<(.+?)>$/);
      const fromName = fromMatch ? fromMatch[1].replace(/"/g, '').trim() : from;
      const fromAddress = fromMatch ? fromMatch[2] : from;

      // Get body text
      let bodyText = '';
      const extractText = (part) => {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          bodyText += Buffer.from(part.body.data, 'base64').toString('utf8');
        }
        if (part.parts) part.parts.forEach(extractText);
      };
      if (msg.payload) extractText(msg.payload);

      const insertRes = await query(
        `INSERT INTO emails
          (user_id, gmail_message_id, gmail_thread_id, from_address, from_name,
           subject, snippet, body_text, received_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
         ON CONFLICT (gmail_message_id) DO NOTHING
         RETURNING id`,
        [
          userId, msgId, msg.threadId,
          fromAddress, fromName, subject,
          msg.snippet || '', bodyText.substring(0, 10000),
          dateStr ? new Date(dateStr) : new Date()
        ]
      );

      if (insertRes.rows.length) {
        newEmailIds.push(insertRes.rows[0].id);
      }
    } catch (err) {
      console.error(`[Gmail] Error fetching message ${msgId}:`, err.message);
    }
  }

  // Queue triage job if new emails found
  if (newEmailIds.length > 0) {
    await emailQueue.add('triage_batch', {
      userId,
      emailIds: newEmailIds
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 }
    });
  }

  return { fetched: messages.length, newEmails: newEmailIds.length };
}

module.exports = { syncGmailInbox };
