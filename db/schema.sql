-- FAOne BDF Q3 Tracker schema
-- Mirrors the original Excel tabs. "Plan" dates come from Milestone Calendar
-- offsets; "Actual" dates + notes are the only things users edit day-to-day.

CREATE TABLE IF NOT EXISTS tracker_rows (
  id SERIAL PRIMARY KEY,
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

  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT
);

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
