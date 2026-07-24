# FAOne — BDF Q3 Finance Tracker

A password-gated web app that replaces manual editing of `FAOne_BDF_Finance_Tracker.xlsx`
with a live, shared tool — while still letting you export a fresh Excel copy anytime.

## What's editable vs. read-only right now
- **Editable**: Q3 Tracker (actual dates + statuses + blocker/next action fields), Open Issues
- **Read-only / computed**: Dashboard, Milestone Calendar, Weekly Status Email, Q2 Carry-over
  (tell me if any of these need to become editable too — it's a small change)

## How it works
- Node/Express backend + Postgres database (data lives in Postgres, not in the Excel file)
- Single shared password gates the whole app (set via `APP_PASSWORD` env var)
- "Export to Excel" button regenerates a `.xlsx` from current data on demand
- Every edit is logged in an `audit_log` table (who changed what, from what, to what)

## One-time setup

### 1. Push this folder to GitHub
```bash
cd faone-tracker
git init
git add .
git commit -m "Initial FAOne BDF tracker app"
git branch -M main
git remote add origin https://github.com/<your-org>/faone-bdf-tracker.git
git push -u origin main
```
Do **not** commit a `.env` file with real secrets — this repo's `.gitignore` already excludes it.

### 2. Create the Railway project
1. Go to railway.app → New Project → **Deploy from GitHub repo** → select this repo
2. Add a **Postgres** plugin to the project (Railway → New → Database → PostgreSQL).
   Railway auto-injects `DATABASE_URL` into your app's environment — no manual copying needed.
3. In your app service → Variables, add:
   - `APP_PASSWORD` = the shared password your FieldAssist team will use
   - `SESSION_SECRET` = any long random string
   - `NODE_ENV` = `production`
4. Deploy. Railway will run `npm install` then `npm start` automatically (from `package.json`).

### 3. Load the starting data (one time only)
Run this once against the Railway Postgres instance, either via Railway's web shell
for your service, or locally with the `DATABASE_URL` copied from Railway:
```bash
npm install
npm run initdb
```
This creates the tables and imports the rows currently in `FAOne_BDF_Finance_Tracker.xlsx`
(15 countries, 7 open issues, 13 Q2 carry-over rows). Re-running it is safe — it skips
seeding if the tracker table already has data.

### 4. Share the URL + password
Railway gives you a public URL (Settings → Networking → Generate Domain). Share that
URL and the `APP_PASSWORD` with whoever on your team needs access.

## Making future changes
Any edit to the code → `git push` → Railway auto-redeploys. No separate "upload to
GitHub" step needed once this is connected.

## Local development
```bash
cp .env.example .env   # fill in a local/dev DATABASE_URL and APP_PASSWORD
npm install
npm run initdb
npm start
```
Visit http://localhost:3000
