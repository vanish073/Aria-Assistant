# ARIA — AI Executive Assistant

AI-powered email triage and calendar management built with Node.js, PostgreSQL, Redis, and Groq .

---

## What it does

- Connects to your Gmail and Google Calendar via OAuth
- Automatically triages emails: labels, priority score, one-line summary, suggested actions
- Syncs calendar events and can schedule meetings via AI
- Runs a background job queue (BullMQ) for async processing
- Dashboard to view triaged emails and upcoming events

---

## Tech stack


|---|---|---|
| App server | Node.js | Railway or Render |
| Database | Docker (PostgreSQL) | Neon |
| Queue / cache | Docker (Redis) | Upstash |
| AI | Groq API | Groq API |
| Auth | Google OAuth | Google OAuth |


