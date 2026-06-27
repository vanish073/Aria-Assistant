# ARIA — AI Executive Assistant

AI-powered email triage and calendar management built with Node.js, PostgreSQL, Redis, and Groq (free AI).

---

## What it does

- Connects to your Gmail and Google Calendar via OAuth
- Automatically triages emails: labels, priority score, one-line summary, suggested actions
- Syncs calendar events and can schedule meetings via AI
- Runs a background job queue (BullMQ) for async processing
- Dashboard to view triaged emails and upcoming events

---

## Tech stack

| Layer | Local dev | Free cloud (production) |
|---|---|---|
| App server | Node.js | Railway or Render |
| Database | Docker (PostgreSQL) | Neon |
| Queue / cache | Docker (Redis) | Upstash |
| AI | Groq API | Groq API |
| Auth | Google OAuth | Google OAuth |

---

## Running locally

### 1 — Install prerequisites

**Node.js 18+**: https://nodejs.org (download the LTS version)

**Docker Desktop**: https://www.docker.com/products/docker-desktop  
Install it, open the app, and let it start fully before continuing.

Verify Node works — open a terminal and type:
```
node --version
```
You should see `v18.x.x` or higher.

---

### 2 — Unzip and open the project

Unzip the file. Move the `aria-production` folder anywhere (Desktop is fine).

Open a terminal inside that folder:
- **Mac**: right-click the folder → "New Terminal at Folder"
- **Windows**: click the address bar, type `cmd`, press Enter

All commands below are run in that terminal.

---

### 3 — Install dependencies

```
npm install
```

Takes about 30 seconds. A lot of text scrolls past — that is normal.

---

### 4 — Get your credentials (do all three)

#### A — Groq API key (free)
1. Go to https://console.groq.com and sign up
2. Click **API Keys** → **Create API Key**
3. Copy the key — it starts with `gsk_`

#### B — Generate an encryption key
Run this in your terminal:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the 64-character result.

#### C — Google OAuth (takes ~10 minutes)
1. Go to https://console.cloud.google.com — sign in with your Google account
2. Click the project dropdown at the top → **New Project** → name it `aria` → **Create**
3. Make sure your new project is selected
4. Left menu → **APIs & Services → Library**
   - Search **Gmail API** → Enable
   - Search **Google Calendar API** → Enable
5. Left menu → **APIs & Services → OAuth consent screen**
   - Choose **External** → **Create**
   - Fill in App name (`ARIA`) and your email for both contact fields
   - Click **Save and Continue** through every screen
   - On the **Test users** screen → **Add Users** → add your own Gmail → **Save**
6. Left menu → **APIs & Services → Credentials**
   - **+ Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Under **Authorized redirect URIs** → **Add URI**:
     ```
     http://localhost:3000/auth/google/callback
     ```
   - Click **Create**
7. Copy the **Client ID** and **Client Secret** from the popup

---

### 5 — Create your .env file

```
cp .env.example .env
```

Open `.env` in any text editor (Notepad, TextEdit, VS Code) and fill in:

```
SESSION_SECRET=any-random-words-you-like-the-longer-the-better
GROQ_API_KEY=gsk_...              ← from step 4A
GOOGLE_CLIENT_ID=...              ← from step 4C
GOOGLE_CLIENT_SECRET=...          ← from step 4C
ENCRYPTION_KEY=...                ← from step 4B
```

Leave everything else as-is for local dev. Save the file.

---

### 6 — Start the database and Redis

Make sure Docker Desktop is open and running, then:
```
npm run docker:up
```

Wait 15 seconds for the containers to be ready.

---

### 7 — Run the app

```
npm run dev
```

You should see:
```
✓ PostgreSQL connected
✓ Redis connected
✓ BullMQ workers started
✓ Cron jobs scheduled

🤖 ARIA running at http://localhost:3000
```

Open http://localhost:3000 in your browser.

---

### 8 — Log in

Click the login button. Google will show a warning — "App not verified".  
Click **Advanced → Go to ARIA (unsafe)**.  
This is expected for personal developer apps that haven't been submitted to Google for review.

After login, click **Sync Now** on the dashboard to pull in your first batch of emails.

---

### Everyday commands

| Action | Command |
|---|---|
| Start the app | `npm run dev` |
| Stop the app | `Ctrl + C` |
| Stop Docker | `npm run docker:down` |
| Restart everything | `npm run docker:up` then `npm run dev` |
| Wipe all data | `npm run docker:reset` |

---

## Deploying to the cloud (free)

### Services you need

| Service | Purpose | Sign up |
|---|---|---|
| Railway | Hosts the Node.js app | railway.app |
| Neon | PostgreSQL database | neon.tech |
| Upstash | Redis | upstash.com |
| Groq | AI (already set up) | console.groq.com |

### Step 1 — Set up Neon (database)

1. Go to https://neon.tech → sign up → **New Project** → name it `aria`
2. Copy the **Connection string** — it looks like:
   ```
   postgresql://user:pass@ep-xxx.region.neon.tech/neondb?sslmode=require
   ```
3. Open that connection in any PostgreSQL client (or use Neon's built-in SQL editor)
4. Paste and run the contents of `config/init.sql` to create the tables

### Step 2 — Set up Upstash (Redis)

1. Go to https://upstash.com → sign up → **Create Database**
2. Region: pick one close to your Railway region (US East is a safe default)
3. Copy the **Redis URL** — it starts with `rediss://` (note the double s — that's TLS)

### Step 3 — Deploy on Railway

1. Go to https://railway.app → sign up → **New Project → Deploy from GitHub repo**
   - Push your code to a GitHub repo first, or use **Deploy from local** with the Railway CLI
2. Railway will detect Node.js automatically and run `npm start`
3. In your Railway project → **Variables** tab, add every variable from your `.env` file:

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | Neon connection string |
   | `REDIS_URL` | Upstash rediss:// URL |
   | `SESSION_SECRET` | any long random string |
   | `GROQ_API_KEY` | your Groq key |
   | `GROQ_MODEL` | `llama-3.1-8b-instant` |
   | `GOOGLE_CLIENT_ID` | your Google client ID |
   | `GOOGLE_CLIENT_SECRET` | your Google client secret |
   | `ENCRYPTION_KEY` | your 64-char hex key |
   | `GOOGLE_REDIRECT_URI` | `https://your-app.railway.app/auth/google/callback` |

4. Railway gives you a URL like `https://aria-production.railway.app`

### Step 4 — Update Google OAuth redirect URI

1. Go back to https://console.cloud.google.com
2. **APIs & Services → Credentials** → click your OAuth client
3. Under **Authorized redirect URIs**, add your Railway URL:
   ```
   https://your-app.railway.app/auth/google/callback
   ```
4. Click **Save**

### Step 5 — Verify deployment

Visit `https://your-app.railway.app/health` — you should see:
```json
{ "status": "ok", "postgres": "ok", "redis": "ok", "groq": "ok" }
```

Then go to the root URL and log in with Google.

---

## Troubleshooting

**`Missing required environment variables` on startup**  
Open your `.env` file and make sure `SESSION_SECRET`, `GROQ_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ENCRYPTION_KEY` are all filled in.

**`Cannot connect to Docker` / `ECONNREFUSED 5432`**  
Docker Desktop isn't running. Open it, wait for the whale icon to stop animating, then try again.

**Google login shows `redirect_uri_mismatch`**  
The URI in Google Cloud must exactly match what's in your `.env`. For local dev it must be `http://localhost:3000/auth/google/callback` (no trailing slash).

**Google warning "App not verified"**  
Click **Advanced → Go to ARIA (unsafe)**. This is normal for personal developer apps.

**Emails triaged but no summary showing**  
Check your Groq API key in `.env`. You can test it at https://console.groq.com/playground.

**Port 3000 already in use**  
Add `PORT=3001` to your `.env`, and update the Google OAuth redirect URI to use port 3001 too.

**Changes to code not appearing**  
`npm run dev` auto-reloads on file saves (nodemon). If it seems stuck, press `Ctrl+C` and restart.
