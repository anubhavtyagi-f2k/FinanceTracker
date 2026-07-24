-- FAOne BDF Q3 Tracker schema
-- Mirrors the original Excel tabs. "Plan" dates come from Milestone Calendar
-- offsets; "Actual" dates + notes are the only things users edit day-to-day.

CREATE TABLE IF NOT EXISTS quarters (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL,          -- e.g. 'Q3 FY26 (JAS 26)'
  start_date DATE NOT NULL,
  is_current BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tracker_rows (
  id SERIAL PRIMARY KEY,
  quarter_id INTEGER REFERENCES quarters(id),
  country TEXT NOT NULL,
  cluster TEXT,
  q3_value NUMERIC,
  fa_owner TEXT,
  bdf_owner TEXT,

  estimates_plan DATE,
  estimates_actual DATE,
  estimates_status TEXT DEFAULT 'On Track',

  alignment_plan DATE,
  alignment_actual DATE,
  alignment_status TEXT DEFAULT 'On Track',

  so_plan DATE,
  so_actual DATE,
  so_status TEXT DEFAULT 'On Track',

  po_plan DATE,
  po_actual DATE,
  po_status TEXT DEFAULT 'On Track',

  invoice_plan DATE,
  invoice_actual DATE,
  invoice_status TEXT DEFAULT 'On Track',

  payment_plan DATE,
  payment_actual DATE,
  payment_status TEXT DEFAULT 'On Track',

  blocker_note TEXT,
  next_action TEXT,
  action_owner TEXT,
  action_due DATE,

  awaiting_step TEXT,
  current_step_due DATE,
  days_late INTEGER,
  rag TEXT,           -- Green / Amber / Red health status per the original sheet
  carry_forward_amount NUMERIC DEFAULT 0,  -- unpaid (+) or overpaid (-) balance rolled into this quarter, set fresh each quarter

  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT
);

-- Migration-safe: adds quarter_id and the sheet columns that were originally
-- missed (Awaiting Step, Current Step Due, Days Late, RAG) to a tracker_rows
-- table that may already exist.
ALTER TABLE tracker_rows ADD COLUMN IF NOT EXISTS quarter_id INTEGER REFERENCES quarters(id);
ALTER TABLE tracker_rows ADD COLUMN IF NOT EXISTS awaiting_step TEXT;
ALTER TABLE tracker_rows ADD COLUMN IF NOT EXISTS current_step_due DATE;
ALTER TABLE tracker_rows ADD COLUMN IF NOT EXISTS days_late INTEGER;
ALTER TABLE tracker_rows ADD COLUMN IF NOT EXISTS rag TEXT;
ALTER TABLE tracker_rows ADD COLUMN IF NOT EXISTS carry_forward_amount NUMERIC DEFAULT 0;

CREATE TABLE IF NOT EXISTS milestone_calendar (
  id SERIAL PRIMARY KEY,
  stage TEXT NOT NULL,          -- Estimates Shared / Alignment Received / SO Issued / PO Received / Invoice Raised / Payment Received
  offset_days INTEGER NOT NULL, -- offset from quarter start
  note TEXT
);

CREATE TABLE IF NOT EXISTS open_issues (
  id SERIAL PRIMARY KEY,
  issue_no INTEGER,
  issue TEXT NOT NULL,
  detail TEXT,
  owner TEXT,
  due_date DATE,
  status TEXT DEFAULT 'Open',
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS q2_carryover (
  id SERIAL PRIMARY KEY,
  country TEXT NOT NULL,
  q2_po_status TEXT,
  invoice_raised TEXT,
  payment_received TEXT,
  note TEXT,
  owner TEXT,
  due_date DATE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
-- e.g. ('reporting_date','2026-07-24'), ('quarter_label','Q3 FY26 (JAS 26)')

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  table_name TEXT,
  row_id INTEGER,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT,
  changed_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Billing additions ----------

CREATE TABLE IF NOT EXISTS po_log (
  id SERIAL PRIMARY KEY,
  tracker_row_id INTEGER REFERENCES tracker_rows(id) ON DELETE SET NULL,
  quarter_id INTEGER REFERENCES quarters(id),
  country TEXT,
  po_number TEXT,
  amount NUMERIC,
  currency_code TEXT DEFAULT 'USD',
  date_raised DATE,
  date_received DATE,
  status TEXT DEFAULT 'Awaiting',   -- Awaiting / Raised / Received / Overdue
  note TEXT,
  is_placeholder BOOLEAN DEFAULT false,  -- true = backfilled stand-in data, excluded from billing totals
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT
);

ALTER TABLE po_log ADD COLUMN IF NOT EXISTS is_placeholder BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS user_counts (
  id SERIAL PRIMARY KEY,
  quarter_id INTEGER REFERENCES quarters(id),
  country TEXT NOT NULL,
  user_count INTEGER DEFAULT 0,
  effective_date DATE,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS one_time_support (
  id SERIAL PRIMARY KEY,
  quarter_id INTEGER REFERENCES quarters(id),
  country TEXT,
  category TEXT,   -- Setup / Project Management / Hypercare / Support Retainer / Ad-hoc
  description TEXT,
  amount NUMERIC,
  currency_code TEXT DEFAULT 'USD',
  charge_date DATE,
  status TEXT DEFAULT 'Pending',
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS country_rates (
  id SERIAL PRIMARY KEY,
  country TEXT NOT NULL UNIQUE,
  currency_code TEXT NOT NULL DEFAULT 'USD',
  per_user_price NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exchange_rates (
  currency_code TEXT PRIMARY KEY,
  rate_to_usd NUMERIC NOT NULL,  -- 1 unit of currency_code = rate_to_usd USD
  updated_at TIMESTAMPTZ DEFAULT now()
);
