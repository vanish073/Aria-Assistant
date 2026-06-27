'use strict';
const { google } = require('googleapis');
const { query } = require('../db/postgres');
const { encrypt, decrypt } = require('./encryption');

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

/**
 * Generate the Google OAuth consent URL
 */
function getAuthUrl() {
  const oauth2Client = createOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent' // always get refresh_token
  });
}

/**
 * Exchange authorization code for tokens, persist encrypted to DB
 */
async function exchangeCodeForTokens(code, userId) {
  const oauth2Client = createOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);

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
    [userId, encAccessToken, encRefreshToken, expiry, SCOPES]
  );

  return tokens;
}

/**
 * Get an authenticated OAuth2 client for a user, refreshing if needed
 */
async function getAuthenticatedClient(userId) {
  const result = await query(
    `SELECT access_token, refresh_token, token_expiry FROM oauth_tokens
     WHERE user_id = $1 AND provider = 'google'`,
    [userId]
  );

  if (!result.rows.length) {
    throw new Error('No OAuth tokens found for user. Please re-authenticate.');
  }

  const { access_token, refresh_token, token_expiry } = result.rows[0];
  const oauth2Client = createOAuthClient();

  oauth2Client.setCredentials({
    access_token: decrypt(access_token),
    refresh_token: refresh_token ? decrypt(refresh_token) : undefined,
    expiry_date: token_expiry ? new Date(token_expiry).getTime() : undefined
  });

  // Auto-refresh and persist new tokens
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await query(
        `UPDATE oauth_tokens SET access_token = $1, token_expiry = $2, updated_at = NOW()
         WHERE user_id = $3 AND provider = 'google'`,
        [encrypt(tokens.access_token), tokens.expiry_date ? new Date(tokens.expiry_date) : null, userId]
      );
    }
  });

  return oauth2Client;
}

module.exports = { getAuthUrl, exchangeCodeForTokens, getAuthenticatedClient, createOAuthClient, SCOPES };
