'use strict';
const express = require('express');
const { copilotChat } = require('../services/copilotService');
const { aiRateLimiter } = require('../middleware/rateLimit');
const { query } = require('../db/postgres');

const router = express.Router();

// Apply strict AI rate limit to this endpoint (20 req/min)
// Prevents a single user burning the entire Groq free tier
router.use(aiRateLimiter);

// POST /api/copilot/chat
router.post('/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    const userId = req.session?.userId;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }
    if (message.length > 1000) {
      return res.status(400).json({ error: 'message too long (max 1000 chars)' });
    }
    if (!Array.isArray(history)) {
      return res.status(400).json({ error: 'history must be an array' });
    }

    const userRes  = await query('SELECT name, email FROM users WHERE id=$1', [userId]);
    const user     = userRes.rows[0];
    const userName = user?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'there';

    const result = await copilotChat(userId, userName, message.trim(), history);

    res.json(result);
  } catch (err) {
    console.error('[Copilot] Error:', err.message);
    if (err.message?.includes('API key')) {
      return res.status(503).json({ error: 'AI service not configured. Check GROQ_API_KEY.' });
    }
    if (err.status === 429) {
      return res.status(429).json({ error: 'Rate limit reached. Please wait a moment.' });
    }
    res.status(500).json({ error: 'Copilot error. Please try again.' });
  }
});

module.exports = router;
