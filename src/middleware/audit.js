'use strict';
const { query } = require('../db/postgres');

/**
 * Middleware: log every mutating request to audit_log table
 */
async function auditLogger(req, res, next) {
  const LOGGED_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (!LOGGED_METHODS.includes(req.method)) return next();
  if (req.path === '/health') return next();

  const actor = req.session?.userEmail || 'anonymous';
  const userId = req.session?.userId || null;
  const ip = req.ip || req.headers['x-forwarded-for'] || null;

  // Non-blocking: fire and forget
  query(
    `INSERT INTO audit_log (user_id, actor, action, resource_type, resource_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      userId,
      actor,
      `${req.method} ${req.path}`,
      req.path.split('/')[2] || null,
      req.params?.id || null,
      JSON.stringify({ body: req.body, query: req.query }),
      ip
    ]
  ).catch(err => console.error('[Audit] Log error:', err.message));

  next();
}

/**
 * Manual audit entry — call from services/agents
 */
async function writeAudit({ userId, actor, action, resourceType, resourceId, details }) {
  try {
    await query(
      `INSERT INTO audit_log (user_id, actor, action, resource_type, resource_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId || null, actor || 'system', action, resourceType || null, resourceId || null, JSON.stringify(details || {})]
    );
  } catch (err) {
    console.error('[Audit] Write error:', err.message);
  }
}

module.exports = { auditLogger, writeAudit };
