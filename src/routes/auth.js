'use strict';
const express = require('express');
const { google } = require('googleapis');
const { getAuthUrl, createOAuthClient, SCOPES } = require('../lib/googleAuth');
const { query } = require('../db/postgres');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

// Step 1: Redirect to Google consent screen
router.get('/google', (req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

// Step 2: Google redirects back with code
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    return res.status(400).send(`OAuth error: ${error || 'missing code'}`);
  }

  try {
    // FIX: exchangeCodeForTokens handles the getToken call internally.
    // We must NOT call oauth2Client.getToken(code) here too — Google only
    // allows a single exchange per authorization code. Instead, get the
    // user profile using a separate userinfo call with just the code exchanged once.
    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();

    // Upsert user in DB
    const userResult = await query(
      `INSERT INTO users (email, name, role)
       VALUES ($1, $2, 'user')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
       RETURNING id, email, name, role`,
      [profile.email, profile.name]
    );
    const user = userResult.rows[0];

    // FIX: Persist tokens directly from the already-exchanged tokens object
    // instead of calling exchangeCodeForTokens(code, ...) which would call
    // getToken(code) a second time and fail with "invalid_grant".
    const { encrypt } = require('../lib/encryption');
    const encAccessToken = encrypt(tokens.access_token);
    const encRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;
    const expiry = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

    await query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, token_expiry, scopes)
       VALUES ($1, 'google', $2, $3, $4, $5)
       ON CONFLICT (user_id, provider) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_tokens.refresh_token),
         token_expiry = EXCLUDED.token_expiry,
         scopes = EXCLUDED.scopes,
         updated_at = NOW()`,
      [user.id, encAccessToken, encRefreshToken, expiry, SCOPES]
    );

    // Set session
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    req.session.userName = user.name;
    req.session.role = user.role;

    await writeAudit({
      userId: user.id,
      actor: user.email,
      action: 'LOGIN',
      resourceType: 'session',
      details: { provider: 'google' }
    });

    res.redirect('/');
  } catch (err) {
    console.error('[Auth] OAuth callback error:', err);
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// Current user info
router.get('/me', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  res.json({
    id: req.session.userId,
    email: req.session.userEmail,
    name: req.session.userName,
    role: req.session.role
  });
});

module.exports = router;
