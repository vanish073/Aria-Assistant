'use strict';
const Groq = require('groq-sdk');
const { query } = require('../db/postgres');
const { writeAudit } = require('../middleware/audit');

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

const TRIAGE_SYSTEM_PROMPT = `You are ARIA, an AI executive assistant specializing in email triage.
Analyze each email and return ONLY valid JSON with this exact structure:
{
  "label": "urgent|meeting|action|info|newsletter|spam",
  "priority": <integer 1-10, 1=highest>,
  "summary": "<one sentence summary>",
  "actions": ["<action1>", "<action2>"],
  "meeting_requested": <true|false>,
  "requires_response": <true|false>,
  "sentiment": "positive|neutral|negative|urgent"
}
No markdown, no explanation, only the JSON object.`;

/**
 * Triage a single email using Groq (free tier: 14,400 requests/day)
 */
async function triageEmail({ subject, fromAddress, fromName, snippet, bodyText }) {
  const start = Date.now();

  const userMessage = `
From: ${fromName || fromAddress} <${fromAddress}>
Subject: ${subject || '(no subject)'}
---
${(bodyText || snippet || '').substring(0, 2000)}
`.trim();

  const completion = await client.chat.completions.create({
    model: GROQ_MODEL,
    max_tokens: 512,
    temperature: 0.1,             // Low temp = consistent JSON output
    response_format: { type: 'json_object' }, // Forces valid JSON from Groq
    messages: [
      { role: 'system', content: TRIAGE_SYSTEM_PROMPT },
      { role: 'user',   content: userMessage }
    ]
  });

  const latencyMs = Date.now() - start;
  // Strip markdown fences as a safety fallback
  const rawText = (completion.choices[0]?.message?.content || '{}')
    .replace(/```json|```/g, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = { label: 'info', priority: 5, summary: 'Could not parse AI response', actions: [] };
  }

  return {
    ...parsed,
    aiModel: completion.model || GROQ_MODEL,
    tokensUsed: completion.usage?.total_tokens || 0,
    latencyMs
  };
}

/**
 * Batch triage emails for a user (called by BullMQ worker)
 */
async function batchTriageEmails(userId, emailIds = []) {
  const results = { processed: 0, failed: 0, tokensUsed: 0 };

  for (const emailId of emailIds) {
    try {
      const emailRes = await query(
        'SELECT * FROM emails WHERE id = $1 AND user_id = $2',
        [emailId, userId]
      );
      if (!emailRes.rows.length) continue;

      const triage = await triageEmail(emailRes.rows[0]);

      await query(
        `UPDATE emails SET
          triage_label = $1, triage_priority = $2, triage_summary = $3,
          triage_actions = $4, ai_model = $5, ai_tokens_used = $6,
          ai_latency_ms = $7, status = 'triaged', processed_at = NOW()
         WHERE id = $8`,
        [
          triage.label, triage.priority, triage.summary,
          JSON.stringify(triage.actions || []),
          triage.aiModel, triage.tokensUsed, triage.latencyMs,
          emailId
        ]
      );

      results.processed++;
      results.tokensUsed += triage.tokensUsed || 0;

      // Respect Groq free tier: ~30 req/min
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`[Triage] Failed email ${emailId}:`, err.message);
      results.failed++;
    }
  }

  await writeAudit({
    userId,
    actor: 'agent:email-triage',
    action: 'BATCH_TRIAGE',
    resourceType: 'email',
    details: results
  });

  return results;
}

module.exports = { triageEmail, batchTriageEmails };
