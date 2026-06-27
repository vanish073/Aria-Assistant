'use strict';
const Groq = require('groq-sdk');
const { query } = require('../db/postgres');

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const COPILOT_MODEL = process.env.GROQ_COPILOT_MODEL || process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

// ── Load all user context for the prompt ─────────────────────────
async function loadContext(userId) {
  const [emailsRes, calRes, analyticsRes, auditRes] = await Promise.allSettled([
    query(`SELECT from_name, from_address, subject, triage_label, triage_priority,
                  triage_summary, triage_actions, status, received_at
           FROM emails WHERE user_id=$1
           ORDER BY triage_priority ASC NULLS LAST, received_at DESC LIMIT 30`, [userId]),

    query(`SELECT title, start_time, end_time, attendees, status, ai_scheduled, google_meet_link
           FROM calendar_events WHERE user_id=$1
             AND start_time >= NOW() AND start_time <= NOW() + INTERVAL '7 days'
           ORDER BY start_time ASC LIMIT 10`, [userId]),

    query(`SELECT
             COUNT(*)::int AS total_emails,
             COUNT(*) FILTER (WHERE triage_label='urgent')::int AS urgent,
             COUNT(*) FILTER (WHERE triage_label='meeting')::int AS meeting_requests,
             COUNT(*) FILTER (WHERE status='pending')::int AS pending,
             COUNT(*) FILTER (WHERE status='triaged')::int AS triaged,
             COALESCE(SUM(ai_tokens_used),0)::int AS tokens_used
           FROM emails WHERE user_id=$1`, [userId]),

    query(`SELECT actor, action, resource_type, created_at
           FROM audit_logs WHERE user_id=$1
           ORDER BY created_at DESC LIMIT 15`, [userId])
  ]);

  const emails  = emailsRes.status  === 'fulfilled' ? emailsRes.value.rows  : [];
  const events  = calRes.status     === 'fulfilled' ? calRes.value.rows     : [];
  const stats   = analyticsRes.status === 'fulfilled' ? analyticsRes.value.rows[0] : {};
  const audit   = auditRes.status   === 'fulfilled' ? auditRes.value.rows   : [];

  return { emails, events, stats, audit };
}

function formatEmails(emails) {
  if (!emails.length) return 'No emails loaded yet.';
  return emails.map((e, i) => {
    const time = e.received_at ? new Date(e.received_at).toLocaleString() : 'unknown';
    const actions = (() => {
      try { return JSON.parse(e.triage_actions || '[]').join(', ') || 'none'; } catch { return 'none'; }
    })();
    return `${i + 1}. FROM: ${e.from_name || e.from_address} | SUBJECT: ${e.subject || '(no subject)'} | LABEL: ${e.triage_label || 'pending'} | PRIORITY: ${e.triage_priority || '?'}/10 | SUMMARY: ${e.triage_summary || e.snippet || 'not triaged'} | ACTIONS: ${actions} | TIME: ${time}`;
  }).join('\n');
}

function formatCalendar(events) {
  if (!events.length) return 'No upcoming events in the next 7 days.';
  return events.map((e, i) => {
    const start = new Date(e.start_time).toLocaleString();
    const attendees = Array.isArray(e.attendees) ? e.attendees.length : 0;
    return `${i + 1}. TITLE: ${e.title} | TIME: ${start} | ATTENDEES: ${attendees} | STATUS: ${e.status}${e.ai_scheduled ? ' | AI-SCHEDULED' : ''}`;
  }).join('\n');
}

// ── Main chat function ────────────────────────────────────────────
async function copilotChat(userId, userName, userMessage, history = []) {
  const ctx = await loadContext(userId);
  const now = new Date().toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

  const systemPrompt = `You are ARIA, an AI executive assistant. You are concise, professional, and actionable.

CURRENT TIME: ${now}
USER: ${userName} (good ${greeting})

=== INBOX (${ctx.stats.total_emails || 0} total) ===
Urgent: ${ctx.stats.urgent || 0} | Meeting requests: ${ctx.stats.meeting_requests || 0} | Pending triage: ${ctx.stats.pending || 0} | Triaged: ${ctx.stats.triaged || 0}

EMAILS:
${formatEmails(ctx.emails)}

=== CALENDAR (next 7 days) ===
${formatCalendar(ctx.events)}

=== INSTRUCTIONS ===
- Be concise. Use bullet points for lists. 
- For counts/summaries, lead with the number.
- When the user asks to draft a reply, write a complete professional email.
- When suggesting actions, be specific (e.g. "Archive the 3 newsletters from X, Y, Z").
- Respond in plain text only. No markdown headers. No asterisks for bold.
- Always return valid JSON in this exact format:
{
  "reply": "your response text here",
  "actions": []
}

Actions (only include when genuinely useful):
- { "type": "archive", "label": "Archive newsletters", "ids": ["email_id"] }
- { "type": "draft-reply", "label": "Draft reply to X", "subject": "Re: ...", "body": "..." }
- { "type": "schedule", "label": "Schedule meeting", "title": "...", "time": "..." }
- { "type": "mark-urgent", "label": "Mark as urgent", "ids": ["email_id"] }

Keep actions array empty [] if no action is clearly warranted.`;

  // Build messages array with conversation history
  // System prompt must be first message in the array (Groq/OpenAI spec)
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-8).map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: userMessage }
  ];

  const completion = await client.chat.completions.create({
    model: COPILOT_MODEL,
    max_tokens: 1024,
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages
  });

  const raw = (completion.choices[0]?.message?.content || '{}')
    .replace(/```json|```/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { reply: raw || 'Sorry, I could not generate a response. Please try again.', actions: [] };
  }

  return {
    reply: parsed.reply || 'No response generated.',
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    tokensUsed: completion.usage?.total_tokens || 0,
    model: completion.model
  };
}

module.exports = { copilotChat };
