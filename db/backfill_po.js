// One-time backfill: populates po_log using data already in tracker_rows
// (Q3 Value as the PO amount, PO Plan/Actual dates, PO status mapped across).
// Safe to re-run — skips countries that already have a po_log entry for
// the current quarter. Usage: node db/backfill_po.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('proxy.rlwy.net') ? { rejectUnauthorized: false } : false
});

function mapStatus(poStatus, poPlan, poActual) {
  if (poStatus === 'Done' || poActual) return 'Received';
  if (poStatus === 'Delayed') return 'Overdue';
  if (poPlan && new Date(poPlan) <= new Date()) return 'Raised';
  return 'Awaiting';
}

async function main() {
  const { rows: current } = await pool.query('SELECT id FROM quarters WHERE is_current = true LIMIT 1');
  if (!current.length) { console.error('No current quarter found — run npm run initdb first.'); process.exit(1); }
  const quarterId = current[0].id;

  const { rows: existing } = await pool.query('SELECT COUNT(*)::int AS c FROM po_log WHERE quarter_id = $1', [quarterId]);
  if (existing[0].c > 0) {
    console.log(`po_log already has ${existing[0].c} entries for this quarter — skipping to avoid duplicates. Delete existing rows first if you want to redo this.`);
    await pool.end();
    return;
  }

  const { rows: tracker } = await pool.query(
    `SELECT * FROM tracker_rows WHERE quarter_id = $1 AND country != 'TOTAL' ORDER BY country`,
    [quarterId]
  );

  let count = 0;
  for (const r of tracker) {
    const status = mapStatus(r.po_status, r.po_plan, r.po_actual);
    await pool.query(
      `INSERT INTO po_log (tracker_row_id, quarter_id, country, po_number, amount, currency_code, date_raised, date_received, status, note, is_placeholder, updated_by)
       VALUES ($1,$2,$3,$4,$5,'USD',$6,$7,$8,$9,true,'backfill script')`,
      [r.id, quarterId, r.country, `${r.country}-Q3-PO`, r.q3_value, r.po_plan, r.po_actual, status, 'Backfilled from Q3 Tracker Q3 Value — confirm PO number and currency']
    );
    count++;
  }
  console.log(`Backfilled ${count} PO log entries from the Q3 Tracker.`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
