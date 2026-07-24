require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('proxy.rlwy.net') ? { rejectUnauthorized: false } : false
});

const app = express();
app.use(express.json());

app.use(session({
  store: new pgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'change-me-in-railway-env-vars',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 14, httpOnly: true, secure: process.env.NODE_ENV === 'production' }
}));

// ---- Auth disabled: app is open to anyone with the link ----
function requireAuth(req, res, next) {
  req.session.authed = true;
  req.session.userName = req.session.userName || 'FieldAssist user';
  next();
}

app.post('/api/login', (req, res) => {
  req.session.authed = true;
  req.session.userName = (req.body.name || 'FieldAssist user').trim();
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/session', (req, res) => {
  res.json({ authed: !!(req.session && req.session.authed), userName: req.session.userName || null });
});

app.use('/api', requireAuth, require('./routes/api')(pool));

// ---- Static frontend ----
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FAOne BDF Tracker running on port ${PORT}`));
