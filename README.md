# Meeting Prep Automation — Setup Guide

## What this does
Every hour (configurable), this checks your Google Calendar for meetings in
the next 24 hours, searches Gmail and Drive for related context, asks Claude
to write a short prep brief for each meeting, and emails the combined digest
to yourself via Gmail. It also saves a copy as a markdown file in this repo.

## One-time setup

### 1. Google Cloud project + OAuth credentials
1. Go to console.cloud.google.com → create a new project (using your
   **personal** Google account)
2. APIs & Services → Library → enable:
   - Google Calendar API
   - Gmail API
   - Google Drive API
   - Google Docs API
   - Google Sheets API
3. APIs & Services → Credentials → Create Credentials → OAuth Client ID
   → Application type: **Desktop app** → note the Client ID and Client Secret
4. You'll likely also need to configure the **OAuth consent screen** (APIs &
   Services → OAuth consent screen) — choose "External," fill in basic app
   info, and add yourself as a test user if prompted. Since this is just for
   your own personal use, it's fine to leave the app in "Testing" mode.

### 2. Get a refresh token (run locally, once)
```bash
npm install googleapis open
export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
node get-refresh-token.js
```
This opens a browser, you log in and approve access, and it prints a refresh
token in your terminal. Copy it — you'll need it in the next step.

### 3. Add GitHub Secrets
In your repo: Settings → Secrets and variables → Actions → New repository secret.
Add each of:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_BASE_URL`
- `MY_EMAIL` (the Gmail address you want the digest sent to — your own)

### 4. Push this repo to GitHub
```bash
git init
git add .
git commit -m "Initial meeting prep automation"
git remote add origin <your-repo-url>
git push -u origin main
```

### 5. Test it manually
Go to the **Actions** tab in your repo → "Meeting Prep" workflow →
**Run workflow** (works thanks to the `workflow_dispatch` trigger) → check the
logs and your Gmail inbox to confirm it worked before waiting for the schedule.

## Notes
- Adjust `LOOKAHEAD_HOURS` in `meeting-prep.js` and the cron schedule in
  `.github/workflows/meeting-prep.yml` to fit your needs.
- All Google scopes used are **read-only** except Gmail send, which is needed
  only to email you the digest — this script cannot modify your calendar,
  delete emails, or edit Drive files.
- Drive file matching is currently a simple keyword match on the meeting
  title. You may want to refine this (e.g. matching by attendee sharing, or a
  specific folder) once you see how well it performs.
- If you used a personal Anthropic API key/token from Claude Code, double
  check it's intended for this kind of standalone scripted use.
