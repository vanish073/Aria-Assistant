-- ARIA Database Schema
-- Runs automatically on first Docker Compose start

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users & Auth
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) NOT NULL DEFAULT 'user', -- admin | user | readonly
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Google OAuth tokens (encrypted)
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL DEFAULT 'google',
  access_token TEXT NOT NULL,        -- AES-256 encrypted
  refresh_token TEXT,                -- AES-256 encrypted
  token_expiry TIMESTAMPTZ,
  scopes TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- Email processing records
CREATE TABLE IF NOT EXISTS emails (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_message_id VARCHAR(255) UNIQUE NOT NULL,
  gmail_thread_id VARCHAR(255),
  from_address VARCHAR(500),
  from_name VARCHAR(255),
  subject TEXT,
  snippet TEXT,
  body_text TEXT,
  received_at TIMESTAMPTZ,
  -- AI triage results
  triage_label VARCHAR(100),         -- urgent | meeting | info | newsletter | action
  triage_priority INTEGER DEFAULT 5, -- 1 (highest) to 10 (lowest)
  triage_summary TEXT,
  triage_actions JSONB DEFAULT '[]',
  ai_model VARCHAR(100),
  ai_tokens_used INTEGER DEFAULT 0,
  ai_latency_ms INTEGER,
  -- Status
  status VARCHAR(50) DEFAULT 'pending', -- pending | triaged | archived | actioned
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emails_user_id ON emails(user_id);
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_triage_label ON emails(triage_label);

-- Calendar events
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_event_id VARCHAR(255),
  title TEXT NOT NULL,
  description TEXT,
  location VARCHAR(500),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  attendees JSONB DEFAULT '[]',
  google_meet_link VARCHAR(500),
  status VARCHAR(50) DEFAULT 'confirmed', -- confirmed | tentative | cancelled | conflict
  ai_scheduled BOOLEAN DEFAULT FALSE,
  ai_notes TEXT,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, google_event_id)
);

CREATE INDEX IF NOT EXISTS idx_events_user_id ON calendar_events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_start_time ON calendar_events(start_time);

-- Job queue audit log
CREATE TABLE IF NOT EXISTS job_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id VARCHAR(255),
  job_name VARCHAR(255) NOT NULL,
  job_type VARCHAR(100) NOT NULL, -- email_batch | calendar_sync | meeting_scheduler | draft_compose
  status VARCHAR(50) NOT NULL,    -- queued | running | completed | failed | retrying
  user_id UUID REFERENCES users(id),
  payload JSONB DEFAULT '{}',
  result JSONB,
  error_message TEXT,
  attempts INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_logs_status ON job_logs(status);
CREATE INDEX IF NOT EXISTS idx_job_logs_job_type ON job_logs(job_type);
CREATE INDEX IF NOT EXISTS idx_job_logs_created_at ON job_logs(created_at DESC);

-- Analytics / metrics snapshots
CREATE TABLE IF NOT EXISTS metrics_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  snapshot_at TIMESTAMPTZ DEFAULT NOW(),
  period VARCHAR(50) NOT NULL, -- hourly | daily
  emails_processed INTEGER DEFAULT 0,
  emails_triaged INTEGER DEFAULT 0,
  meetings_scheduled INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  avg_latency_ms INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  uptime_pct NUMERIC(5,2) DEFAULT 100.00
);

-- Audit log (immutable)
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  actor VARCHAR(255) NOT NULL,      -- user email or 'system' or 'agent'
  action VARCHAR(255) NOT NULL,
  resource_type VARCHAR(100),
  resource_id VARCHAR(255),
  details JSONB DEFAULT '{}',
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);

-- Seed a default admin user (update password hash in production)
INSERT INTO users (email, name, role) 
VALUES ('admin@aria.local', 'ARIA Admin', 'admin')
ON CONFLICT (email) DO NOTHING;
