// Run once (or safely re-run) to create tables and seed from the original
// FAOne_BDF_Finance_Tracker.xlsx export. Usage: node db/init.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false
});

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed_data.json'), 'utf8'));

function d(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10); // 'YYYY-MM-DD HH:MM:SS' -> 'YYYY-MM-DD'
  // Guard against stray text (e.g. "[currency TBC]") that isn't an actual date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('Schema ensured.');

  // Ensure the current quarter exists (handles both fresh installs and
  // pre-existing databases that predate multi-quarter support)
  let { rows: currentQ } = await pool.query('SELECT * FROM quarters WHERE is_current = true LIMIT 1');
  let quarterId;
  if (currentQ.length === 0) {
    const { rows: inserted } = await pool.query(
      `INSERT INTO quarters (label, start_date, is_current) VALUES ($1,$2,true) RETURNING id`,
      ['Q3 FY26 (JAS 26)', '2026-07-01']
    );
    quarterId = inserted[0].id;
    console.log('Created initial quarter record.');
  } else {
    quarterId = currentQ[0].id;
  }

  // Backfill any existing tracker rows that predate quarter_id
  await pool.query('UPDATE tracker_rows SET quarter_id = $1 WHERE quarter_id IS NULL', [quarterId]);

  // Default exchange rate for USD itself (1:1), so conversions never fail.
  // Always run this and the country_rates ensure, regardless of whether
  // tracker_rows already has data.
  await pool.query(`INSERT INTO exchange_rates (currency_code, rate_to_usd) VALUES ('USD', 1) ON CONFLICT (currency_code) DO NOTHING`);

  const { rows: allCountries } = await pool.query('SELECT DISTINCT country FROM tracker_rows');
  for (const { country } of allCountries) {
    await pool.query(
      `INSERT INTO country_rates (country, currency_code, per_user_price) VALUES ($1,'USD',0) ON CONFLICT (country) DO NOTHING`,
      [country]
    );
  }
  console.log(`Ensured billing rate rows for ${allCountries.length} countries.`);

  const { rows: existing } = await pool.query('SELECT COUNT(*)::int AS c FROM tracker_rows');
  if (existing[0].c > 0) {
    console.log('tracker_rows already has data — skipping seed. Delete rows manually if you want to reseed.');
    await pool.end();
    return;
  }

  for (const r of seed.tracker) {
    await pool.query(
      `INSERT INTO tracker_rows
       (quarter_id, country, cluster, q3_value, fa_owner, bdf_owner,
        estimates_plan, estimates_actual, estimates_status,
        alignment_plan, alignment_actual, alignment_status,
        so_plan, so_actual, so_status,
        po_plan, po_actual, po_status,
        invoice_plan, invoice_actual, invoice_status,
        payment_plan, payment_actual, payment_status,
        blocker_note, next_action, action_owner, action_due)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
      [
        quarterId,
        r[0], r[1], r[2], r[3], r[4],
        d(r[5]), d(r[6]), r[7],
        d(r[8]), d(r[9]), r[10],
        d(r[11]), d(r[12]), r[13],
        d(r[14]), d(r[15]), r[16],
        d(r[17]), d(r[18]), r[19],
        d(r[20]), d(r[21]), r[22],
        r[27], r[28], r[29], d(r[30])
      ]
    );
  }
  console.log(`Seeded ${seed.tracker.length} tracker rows.`);

  const { rows: freshCountries } = await pool.query('SELECT DISTINCT country FROM tracker_rows');
  for (const { country } of freshCountries) {
    await pool.query(
      `INSERT INTO country_rates (country, currency_code, per_user_price) VALUES ($1,'USD',0) ON CONFLICT (country) DO NOTHING`,
      [country]
    );
  }

  for (const r of seed.issues) {
    await pool.query(
      `INSERT INTO open_issues (issue_no, issue, detail, owner, due_date, status)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [r[0], r[1], r[2], r[3], d(r[4]), r[5]]
    );
  }
  console.log(`Seeded ${seed.issues.length} open issues.`);

  for (const r of seed.carry) {
    await pool.query(
      `INSERT INTO q2_carryover (country, q2_po_status, invoice_raised, payment_received, note, owner, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [r[0], r[1], r[2], r[3], r[4], r[5], d(r[6])]
    );
  }
  console.log(`Seeded ${seed.carry.length} Q2 carry-over rows.`);

  const milestones = [
    ['Estimates Shared', -15, 'Bruna Alvarenga (BDF) sends country-level calculations'],
    ['Alignment Received', -7, 'Prem Anand (FA) reconciles vs agreement values, freezes numbers'],
    ['SO Issued', 2, 'Anubhav Tyagi (FA) raises SO in ERP within 2 days of alignment'],
    ['PO Received', 21, 'Prem Anand (FA) follows the local BDF team directly'],
    ['Invoice Raised', 26, 'FA Finance invoices within 5 days of PO'],
    ['Payment Received', 75, 'FA Finance chases per agreed payment terms']
  ];
  for (const [stage, offset, note] of milestones) {
    await pool.query(`INSERT INTO milestone_calendar (stage, offset_days, note) VALUES ($1,$2,$3)`, [stage, offset, note]);
  }
  console.log('Seeded milestone calendar.');

  await pool.query(`INSERT INTO settings (key, value) VALUES ('reporting_date', $1) ON CONFLICT (key) DO UPDATE SET value=$1`, ['2026-07-24']);
  await pool.query(`INSERT INTO settings (key, value) VALUES ('quarter_label', $1) ON CONFLICT (key) DO UPDATE SET value=$1`, ['Q3 FY26 (JAS 26)']);

  await pool.end();
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
