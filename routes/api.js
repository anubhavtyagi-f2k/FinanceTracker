const express = require('express');
const ExcelJS = require('exceljs');

module.exports = function (pool) {
  const router = express.Router();

  // ---------- helpers ----------
  async function logChange(table, rowId, field, oldVal, newVal, user) {
    if (String(oldVal ?? '') === String(newVal ?? '')) return;
    await pool.query(
      `INSERT INTO audit_log (table_name, row_id, field, old_value, new_value, changed_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [table, rowId, field, oldVal, newVal, user]
    );
  }

  const TRACKER_EDITABLE_FIELDS = [
    'estimates_actual', 'estimates_status',
    'alignment_actual', 'alignment_status',
    'so_actual', 'so_status',
    'po_actual', 'po_status',
    'invoice_actual', 'invoice_status',
    'payment_actual', 'payment_status',
    'blocker_note', 'next_action', 'action_owner', 'action_due'
  ];

  // ---------- Quarters ----------
  router.get('/quarters', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM quarters ORDER BY start_date');
    res.json(rows);
  });

  router.post('/quarters', async (req, res) => {
    const { label, start_date } = req.body;
    if (!label || !start_date) return res.status(400).json({ error: 'label and start_date are required' });

    const { rows: milestones } = await pool.query('SELECT * FROM milestone_calendar');
    const offsetFor = stage => {
      const m = milestones.find(m => m.stage.toLowerCase().startsWith(stage));
      return m ? m.offset_days : 0;
    };
    const addDays = (dateStr, days) => {
      const d = new Date(dateStr);
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    };

    await pool.query('UPDATE quarters SET is_current = false');
    const { rows: qInsert } = await pool.query(
      `INSERT INTO quarters (label, start_date, is_current) VALUES ($1,$2,true) RETURNING *`,
      [label, start_date]
    );
    const quarterId = qInsert[0].id;

    // Carry forward the country/owner list from the most recent quarter,
    // with fresh plan dates from the milestone cadence and blank actuals.
    const { rows: prevRows } = await pool.query(
      `SELECT * FROM tracker_rows WHERE quarter_id = (
         SELECT id FROM quarters WHERE id != $1 ORDER BY start_date DESC LIMIT 1
       )`, [quarterId]
    );

    for (const r of prevRows) {
      await pool.query(
        `INSERT INTO tracker_rows
         (quarter_id, country, cluster, q3_value, fa_owner, bdf_owner,
          estimates_plan, estimates_status, alignment_plan, alignment_status,
          so_plan, so_status, po_plan, po_status, invoice_plan, invoice_status,
          payment_plan, payment_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'On Track',$8,'On Track',$9,'On Track',$10,'On Track',$11,'On Track',$12,'On Track')`,
        [
          quarterId, r.country, r.cluster, r.q3_value, r.fa_owner, r.bdf_owner,
          addDays(start_date, offsetFor('estimates')),
          addDays(start_date, offsetFor('alignment')),
          addDays(start_date, offsetFor('so')),
          addDays(start_date, offsetFor('po')),
          addDays(start_date, offsetFor('invoice')),
          addDays(start_date, offsetFor('payment'))
        ]
      );
    }

    res.json({ ...qInsert[0], rowsCreated: prevRows.length });
  });

  // ---------- Q3 Tracker (editable) ----------
  router.get('/tracker', async (req, res) => {
    const quarterId = req.query.quarter_id;
    const q = quarterId
      ? await pool.query('SELECT * FROM tracker_rows WHERE quarter_id = $1 ORDER BY country', [quarterId])
      : await pool.query(`SELECT * FROM tracker_rows WHERE quarter_id = (SELECT id FROM quarters WHERE is_current = true LIMIT 1) ORDER BY country`);
    res.json(q.rows);
  });

  router.patch('/tracker/:id', async (req, res) => {
    const id = req.params.id;
    const updates = req.body; // { field: value, ... }
    const fields = Object.keys(updates).filter(f => TRACKER_EDITABLE_FIELDS.includes(f));
    if (fields.length === 0) return res.status(400).json({ error: 'No editable fields provided' });

    const { rows: current } = await pool.query('SELECT * FROM tracker_rows WHERE id=$1', [id]);
    if (!current.length) return res.status(404).json({ error: 'Row not found' });

    const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const values = fields.map(f => updates[f]);
    values.push(id);

    await pool.query(
      `UPDATE tracker_rows SET ${setClause}, updated_at = now(), updated_by = $${values.length + 1} WHERE id = $${values.length}`,
      [...values, req.session.userName]
    );

    for (const f of fields) {
      await logChange('tracker_rows', id, f, current[0][f], updates[f], req.session.userName);
    }
    const { rows: updated } = await pool.query('SELECT * FROM tracker_rows WHERE id=$1', [id]);
    res.json(updated[0]);
  });

  // ---------- Open Issues (editable) ----------
  router.get('/issues', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM open_issues ORDER BY issue_no');
    res.json(rows);
  });

  router.patch('/issues/:id', async (req, res) => {
    const id = req.params.id;
    const allowed = ['issue', 'detail', 'owner', 'due_date', 'status'];
    const fields = Object.keys(req.body).filter(f => allowed.includes(f));
    if (fields.length === 0) return res.status(400).json({ error: 'No editable fields provided' });

    const { rows: current } = await pool.query('SELECT * FROM open_issues WHERE id=$1', [id]);
    if (!current.length) return res.status(404).json({ error: 'Not found' });

    const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const values = fields.map(f => req.body[f]);
    values.push(id);
    await pool.query(
      `UPDATE open_issues SET ${setClause}, updated_at = now(), updated_by = $${values.length + 1} WHERE id = $${values.length}`,
      [...values, req.session.userName]
    );
    for (const f of fields) await logChange('open_issues', id, f, current[0][f], req.body[f], req.session.userName);
    const { rows: updated } = await pool.query('SELECT * FROM open_issues WHERE id=$1', [id]);
    res.json(updated[0]);
  });

  router.post('/issues', async (req, res) => {
    const { rows: maxRow } = await pool.query('SELECT COALESCE(MAX(issue_no),0)+1 AS n FROM open_issues');
    const { issue, detail, owner, due_date, status } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO open_issues (issue_no, issue, detail, owner, due_date, status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [maxRow[0].n, issue, detail, owner, due_date || null, status || 'Open']
    );
    res.json(rows[0]);
  });

  // ---------- Read-only views ----------
  router.get('/milestones', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM milestone_calendar ORDER BY offset_days');
    res.json(rows);
  });

  router.get('/carryover', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM q2_carryover ORDER BY country');
    res.json(rows);
  });

  router.get('/settings', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM settings');
    const obj = {};
    rows.forEach(r => obj[r.key] = r.value);
    res.json(obj);
  });

  // ---------- Dashboard (computed) ----------
  router.get('/dashboard', async (req, res) => {
    const quarterId = req.query.quarter_id;
    const { rows } = quarterId
      ? await pool.query('SELECT * FROM tracker_rows WHERE quarter_id = $1', [quarterId])
      : await pool.query(`SELECT * FROM tracker_rows WHERE quarter_id = (SELECT id FROM quarters WHERE is_current = true LIMIT 1)`);

    const { rows: qRows } = await pool.query('SELECT * FROM quarters WHERE is_current = true LIMIT 1');
    const today = new Date();

    const stages = ['estimates', 'alignment', 'so', 'po', 'invoice', 'payment'];
    const stageStatus = {};
    stages.forEach(s => stageStatus[s] = { Done: 0, 'On Track': 0, Delayed: 0 });

    let totalValue = 0;
    // "Expected by now" = plan date has passed (or today); "Received" = actual is filled in
    let soExpected = 0, soReceived = 0, poExpected = 0, poReceived = 0;
    const deadlines = [];

    rows.forEach(r => {
      totalValue += Number(r.q3_value || 0);
      stages.forEach(s => {
        const st = r[`${s}_status`] || 'On Track';
        if (stageStatus[s][st] !== undefined) stageStatus[s][st]++;
      });

      if (r.so_plan && new Date(r.so_plan) <= today) {
        soExpected++;
        if (r.so_actual) soReceived++;
      }
      if (r.po_plan && new Date(r.po_plan) <= today) {
        poExpected++;
        if (r.po_actual) poReceived++;
      }

      if (r.action_due) {
        const daysOut = Math.ceil((new Date(r.action_due) - today) / 86400000);
        if (daysOut <= 7) {
          deadlines.push({
            country: r.country,
            action: r.next_action,
            owner: r.action_owner,
            due: r.action_due,
            daysOut
          });
        }
      }
    });

    deadlines.sort((a, b) => a.daysOut - b.daysOut);

    res.json({
      countries: rows.length,
      totalValue,
      stageStatus,
      po: { expected: poExpected, received: poReceived },
      so: { expected: soExpected, received: soReceived },
      deadlines,
      quarterLabel: qRows[0] ? qRows[0].label : ''
    });
  });

  // ---------- Weekly status email (auto-generated text) ----------
  router.get('/weekly-email', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM tracker_rows ORDER BY country');
    const { rows: settingsRows } = await pool.query('SELECT * FROM settings');
    const settings = {};
    settingsRows.forEach(r => settings[r.key] = r.value);

    const redFlags = rows.filter(r => [r.estimates_status, r.alignment_status, r.so_status, r.po_status, r.invoice_status, r.payment_status].includes('Delayed'));
    const lines = [];
    lines.push(`Subject: BDF || FAOne status || ${settings.quarter_label || ''} || week of ${new Date().toISOString().slice(0, 10)}`);
    lines.push('');
    lines.push('Hi Bruna, Saurabh,');
    lines.push('');
    lines.push(`Status across ${rows.length} countries as of ${settings.reporting_date || ''}.`);
    if (redFlags.length) {
      lines.push('');
      lines.push('Countries needing attention:');
      redFlags.forEach(r => lines.push(`- ${r.country}: ${r.blocker_note || 'delayed stage — see tracker'}`));
    }
    lines.push('');
    lines.push('Full detail in the tracker.');
    res.type('text/plain').send(lines.join('\n'));
  });

  // ---------- Excel export ----------
  router.get('/export', async (req, res) => {
    const wb = new ExcelJS.Workbook();
    const { rows: tracker } = await pool.query(`SELECT * FROM tracker_rows WHERE quarter_id = (SELECT id FROM quarters WHERE is_current = true LIMIT 1) ORDER BY country`);
    const { rows: issues } = await pool.query('SELECT * FROM open_issues ORDER BY issue_no');
    const { rows: carry } = await pool.query('SELECT * FROM q2_carryover ORDER BY country');

    const ws = wb.addWorksheet('Q3 Tracker');
    ws.addRow(['Country', 'Cluster', 'Q3 Value', 'FA Owner', 'BDF Owner',
      'Estimates Plan', 'Estimates Actual', 'Estimates Status',
      'Alignment Plan', 'Alignment Actual', 'Alignment Status',
      'SO Plan', 'SO Actual', 'SO Status',
      'PO Plan', 'PO Actual', 'PO Status',
      'Invoice Plan', 'Invoice Actual', 'Invoice Status',
      'Payment Plan', 'Payment Actual', 'Payment Status',
      'Blocker/Note', 'Next Action', 'Action Owner', 'Action Due']);
    tracker.forEach(r => ws.addRow([
      r.country, r.cluster, r.q3_value, r.fa_owner, r.bdf_owner,
      r.estimates_plan, r.estimates_actual, r.estimates_status,
      r.alignment_plan, r.alignment_actual, r.alignment_status,
      r.so_plan, r.so_actual, r.so_status,
      r.po_plan, r.po_actual, r.po_status,
      r.invoice_plan, r.invoice_actual, r.invoice_status,
      r.payment_plan, r.payment_actual, r.payment_status,
      r.blocker_note, r.next_action, r.action_owner, r.action_due
    ]));

    const wsIssues = wb.addWorksheet('Open Issues');
    wsIssues.addRow(['#', 'Issue', 'Detail', 'Owner', 'Due', 'Status']);
    issues.forEach(r => wsIssues.addRow([r.issue_no, r.issue, r.detail, r.owner, r.due_date, r.status]));

    const wsCarry = wb.addWorksheet('Q2 Carry-over');
    wsCarry.addRow(['Country', 'Q2 PO Status', 'Invoice Raised', 'Payment Received', 'Note', 'Owner', 'Due']);
    carry.forEach(r => wsCarry.addRow([r.country, r.q2_po_status, r.invoice_raised, r.payment_received, r.note, r.owner, r.due_date]));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=FAOne_BDF_Tracker_Export_${new Date().toISOString().slice(0, 10)}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  });

  return router;
};
