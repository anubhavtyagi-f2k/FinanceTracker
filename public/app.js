const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status} ${res.statusText || ''}`.trim());
  }
  return res;
}

function flash(msg) {
  let el = $('.save-flash');
  if (!el) {
    el = document.createElement('div');
    el.className = 'save-flash';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1500);
}

function fmtDate(v) {
  if (!v) return '';
  return String(v).slice(0, 10);
}

// ---------- Session (auth disabled — always goes straight in) ----------
let CURRENT_QUARTER = null;
let QUARTERS = [];

async function checkSession() {
  const res = await fetch('/api/session');
  const data = await res.json();
  $('#app').classList.remove('hidden');
  $('#user-badge').textContent = data.userName || '';
  await loadQuarters();
  loadTab('dashboard');
}

async function loadQuarters() {
  QUARTERS = await (await api('/quarters')).json();
  CURRENT_QUARTER = QUARTERS.find(q => q.is_current) || QUARTERS[QUARTERS.length - 1];
  $('#quarter-badge').textContent = CURRENT_QUARTER ? CURRENT_QUARTER.label : '';
}

$('#export-btn').addEventListener('click', () => { window.location.href = '/api/export'; });

// ---------- Tabs ----------
const TAB_TITLES = {
  dashboard: ['Dashboard', 'Beiersdorf × FieldAssist — FAOne billing snapshot & KPIs'],
  tracker: ['Q3 Tracker', 'PO & collection pipeline by country'],
  'po-tracker': ['PO Tracker', 'Detailed PO log and status pipeline'],
  'user-counts': ['User Counts', 'Per-country user counts driving subscription billing'],
  'one-time': ['One-time & Support', 'Setup, PM, hypercare, support retainer and ad-hoc charges'],
  milestones: ['Milestone Calendar', 'Standing cadence and step owners'],
  carryover: ['Q2 Carry-over', 'Open items carried into this quarter'],
  issues: ['Open Issues', 'Items needing an answer before numbers are clean'],
  settings: ['Settings', 'Billing rates, exchange rates, and milestone cadence']
};

$$('.side-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.side-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const [title, sub] = TAB_TITLES[btn.dataset.tab] || ['', ''];
    $('#page-title').textContent = title;
    $('#page-subtitle').textContent = sub;
    loadTab(btn.dataset.tab);
  });
});

async function loadTab(tab) {
  const content = $('#content');
  content.innerHTML = '<p>Loading…</p>';
  try {
    if (tab === 'tracker') await renderTracker(content);
    else if (tab === 'dashboard') await renderDashboard(content);
    else if (tab === 'po-tracker') await renderPoTracker(content);
    else if (tab === 'user-counts') await renderUserCounts(content);
    else if (tab === 'one-time') await renderOneTime(content);
    else if (tab === 'milestones') await renderMilestones(content);
    else if (tab === 'carryover') await renderCarryover(content);
    else if (tab === 'issues') await renderIssues(content);
    else if (tab === 'settings') await renderSettings(content);
  } catch (e) {
    content.innerHTML = `<p style="color:red">Error loading tab: ${e.message}</p>`;
  }
}

const STAGES = [
  ['estimates', 'Estimates Shared'], ['alignment', 'Alignment'], ['so', 'SO Issued'],
  ['po', 'PO Received'], ['invoice', 'Invoice Raised'], ['payment', 'Payment Received']
];

async function renderTracker(content) {
  const rows = await (await api(`/tracker?quarter_id=${CURRENT_QUARTER.id}`)).json();

  let html = '<div class="quarter-form">';
  html += `<div><label>Viewing quarter</label><select id="quarter-select">${QUARTERS.map(q => `<option value="${q.id}" ${q.id === CURRENT_QUARTER.id ? 'selected' : ''}>${q.label}</option>`).join('')}</select></div>`;
  html += '<div><label>New quarter label</label><input id="new-q-label" placeholder="e.g. Q4 FY26 (OND 26)"></div>';
  html += '<div><label>Start date</label><input id="new-q-start" type="date"></div>';
  html += '<div><button class="add-btn" id="add-quarter-btn">+ Add Quarter</button></div>';
  html += '</div>';

  html += '<div class="quarter-form">';
  html += '<div><label>Country name</label><input id="new-country-name" placeholder="e.g. Vietnam"></div>';
  html += '<div><label>FA Owner</label><input id="new-country-owner" placeholder="Owner name"></div>';
  html += '<div><button class="add-btn" id="add-country-btn">+ Add Country</button></div>';
  html += '</div>';

  html += '<div class="table-scroll"><table><thead><tr><th>Country</th><th>FA Owner</th><th>RAG</th><th>Awaiting Step</th><th>Days Late</th>';
  STAGES.forEach(([, label]) => html += `<th>${label} Actual</th><th>${label} Status</th>`);
  html += '<th>Blocker/Note</th><th>Next Action</th><th>Action Owner</th><th>Action Due</th><th></th></tr></thead><tbody>';

  rows.forEach(r => {
    html += `<tr data-id="${r.id}"><td>${r.country}</td><td>${r.fa_owner || ''}</td>`;
    html += `<td><select data-field="rag">${['Green', 'Amber', 'Red'].map(c => `<option ${r.rag === c ? 'selected' : ''}>${c}</option>`).join('')}</select></td>`;
    html += `<td><input type="text" data-field="awaiting_step" value="${r.awaiting_step || ''}"></td>`;
    html += `<td><input type="number" data-field="days_late" value="${r.days_late ?? 0}" style="width:60px"></td>`;
    STAGES.forEach(([key]) => {
      html += `<td><input type="date" data-field="${key}_actual" value="${fmtDate(r[key + '_actual'])}"></td>`;
      html += `<td><select data-field="${key}_status">
        ${['On Track', 'Done', 'Delayed'].map(s => `<option value="${s}" ${r[key + '_status'] === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select></td>`;
    });
    html += `<td><textarea data-field="blocker_note" rows="1">${r.blocker_note || ''}</textarea></td>`;
    html += `<td><textarea data-field="next_action" rows="1">${r.next_action || ''}</textarea></td>`;
    html += `<td><input type="text" data-field="action_owner" value="${r.action_owner || ''}"></td>`;
    html += `<td><input type="date" data-field="action_due" value="${fmtDate(r.action_due)}"></td>`;
    html += `<td><button class="delete-row-btn" data-del-id="${r.id}" title="Delete row">✕</button></td>`;
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  content.innerHTML = html;

  $('#add-country-btn').addEventListener('click', async () => {
    const country = $('#new-country-name').value.trim();
    const fa_owner = $('#new-country-owner').value.trim();
    if (!country) { flash('Enter a country name'); return; }
    try {
      await api('/tracker', { method: 'POST', body: JSON.stringify({ country, fa_owner, quarter_id: CURRENT_QUARTER.id }) });
      flash('Country added');
      renderTracker(content);
    } catch (e) { flash('Failed: ' + e.message); }
  });

  content.querySelectorAll('.delete-row-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this country row? This cannot be undone.')) return;
      try {
        await api(`/tracker/${btn.dataset.delId}`, { method: 'DELETE' });
        flash('Removed');
        renderTracker(content);
      } catch (e) { flash('Failed: ' + e.message); }
    });
  });

  $('#quarter-select').addEventListener('change', async (e) => {
    CURRENT_QUARTER = QUARTERS.find(q => q.id == e.target.value);
    $('#quarter-badge').textContent = CURRENT_QUARTER.label;
    renderTracker(content);
  });

  $('#add-quarter-btn').addEventListener('click', async () => {
    const label = $('#new-q-label').value.trim();
    const start_date = $('#new-q-start').value;
    if (!label || !start_date) { flash('Enter a label and start date'); return; }
    try {
      await api('/quarters', { method: 'POST', body: JSON.stringify({ label, start_date }) });
      await loadQuarters();
      flash('Quarter created');
      renderTracker(content);
    } catch (e) { flash('Failed: ' + e.message); }
  });

  content.querySelectorAll('tr[data-id] [data-field]').forEach(el => {
    el.addEventListener('change', async () => {
      const id = el.closest('tr').dataset.id;
      const field = el.dataset.field;
      try {
        await api(`/tracker/${id}`, { method: 'PATCH', body: JSON.stringify({ [field]: el.value }) });
        flash('Saved');
      } catch (e) { flash('Save failed: ' + e.message); }
    });
  });
}

let charts = {};
function destroyCharts() { Object.values(charts).forEach(c => c.destroy()); charts = {}; }

async function renderDashboard(content) {
  const d = await (await api(`/dashboard?quarter_id=${CURRENT_QUARTER.id}`)).json();
  destroyCharts();

  let html = '<div class="card-grid">';
  html += `<div class="metric-card"><div class="icon">🌍</div><div><div class="label">Countries in scope</div><div class="value">${d.countries}</div></div></div>`;
  html += `<div class="metric-card accent-green"><div class="icon">💰</div><div><div class="label">Total Q3 Value</div><div class="value">${d.totalValue.toLocaleString()}</div></div></div>`;
  html += `<div class="metric-card"><div class="icon">📦</div><div><div class="label">PO Received vs Expected</div><div class="value">${d.po.received}/${d.po.expected}</div></div></div>`;
  html += `<div class="metric-card accent-amber"><div class="icon">📄</div><div><div class="label">SO Issued vs Expected</div><div class="value">${d.so.received}/${d.so.expected}</div></div></div>`;
  html += '</div>';

  html += '<div class="card-grid">';
  html += `<div class="metric-card accent-green"><div class="icon">👥</div><div><div class="label">Subscription (USD)</div><div class="value">$${d.billing.subscriptionTotalUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div></div>`;
  html += `<div class="metric-card accent-amber"><div class="icon">🧾</div><div><div class="label">One-time & Support (USD)</div><div class="value">$${d.billing.oneTimeTotalUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div></div>`;
  html += `<div class="metric-card"><div class="icon">📑</div><div><div class="label">PO Log Total (USD)</div><div class="value">$${d.billing.poTotalUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div></div>`;
  html += '</div>';

  html += '<div class="chart-grid">';
  html += '<div class="chart-card"><h3>Country Health (RAG)</h3><canvas id="rag-chart"></canvas></div>';
  html += '<div class="chart-card"><h3>PO Received vs Expected</h3><canvas id="po-chart"></canvas></div>';
  html += '<div class="chart-card"><h3>SO Issued vs Expected</h3><canvas id="so-chart"></canvas></div>';
  html += '<div class="chart-card"><h3>Pipeline Status by Stage</h3><canvas id="stage-chart"></canvas></div>';
  html += '<div class="chart-card"><h3>PO Log Status</h3><canvas id="po-status-chart"></canvas></div>';
  html += '</div>';

  html += '<div class="chart-card"><h3>Deadlines in the next 7 days</h3><div class="deadline-list" id="deadline-list"></div></div>';

  content.innerHTML = html;

  const nivea = '#0032A0', green = '#16a34a', amber = '#d97706', red = '#dc2626', grey = '#dde3ee';

  function chartOrEmpty(canvasId, total, emptyMessage, buildFn) {
    if (total === 0) {
      const canvas = $(canvasId);
      canvas.replaceWith(Object.assign(document.createElement('p'), { style: 'color:#6b7686;font-size:13px;text-align:center;padding:40px 10px', textContent: emptyMessage }));
      return;
    }
    buildFn();
  }

  chartOrEmpty('#rag-chart', d.ragCounts.Green + d.ragCounts.Amber + d.ragCounts.Red, 'No RAG status set yet.', () => {
    charts.rag = new Chart($('#rag-chart'), {
      type: 'doughnut',
      data: {
        labels: ['Green', 'Amber', 'Red'],
        datasets: [{ data: [d.ragCounts.Green, d.ragCounts.Amber, d.ragCounts.Red], backgroundColor: [green, amber, red] }]
      },
      options: { plugins: { legend: { position: 'bottom' } } }
    });
  });

  chartOrEmpty('#po-chart', d.po.expected, 'No POs due yet this quarter.', () => {
    charts.po = new Chart($('#po-chart'), {
      type: 'pie',
      data: {
        labels: ['Received', 'Outstanding'],
        datasets: [{ data: [d.po.received, Math.max(d.po.expected - d.po.received, 0)], backgroundColor: [nivea, grey] }]
      },
      options: { plugins: { legend: { position: 'bottom' } } }
    });
  });

  chartOrEmpty('#so-chart', d.so.expected, 'No SOs due yet this quarter.', () => {
    charts.so = new Chart($('#so-chart'), {
      type: 'pie',
      data: {
        labels: ['Issued', 'Outstanding'],
        datasets: [{ data: [d.so.received, Math.max(d.so.expected - d.so.received, 0)], backgroundColor: [nivea, grey] }]
      },
      options: { plugins: { legend: { position: 'bottom' } } }
    });
  });

  charts.stage = new Chart($('#stage-chart'), {
    type: 'bar',
    data: {
      labels: STAGES.map(s => s[1]),
      datasets: [
        { label: 'Done', data: STAGES.map(s => d.stageStatus[s[0]].Done), backgroundColor: green },
        { label: 'On Track', data: STAGES.map(s => d.stageStatus[s[0]]['On Track']), backgroundColor: nivea },
        { label: 'Delayed', data: STAGES.map(s => d.stageStatus[s[0]].Delayed), backgroundColor: red }
      ]
    },
    options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }, plugins: { legend: { position: 'bottom' } } }
  });

  const poStatusLabels = Object.keys(d.billing.poStatusCounts);
  const poStatusColors = { Awaiting: amber, Raised: nivea, Received: green, Overdue: red };
  const poStatusTotal = poStatusLabels.reduce((sum, k) => sum + d.billing.poStatusCounts[k], 0);
  chartOrEmpty('#po-status-chart', poStatusTotal, 'No PO log entries yet.', () => {
    charts.poStatus = new Chart($('#po-status-chart'), {
      type: 'doughnut',
      data: {
        labels: poStatusLabels,
        datasets: [{ data: poStatusLabels.map(k => d.billing.poStatusCounts[k]), backgroundColor: poStatusLabels.map(k => poStatusColors[k]) }]
      },
      options: { plugins: { legend: { position: 'bottom' } } }
    });
  });

  const list = $('#deadline-list');
  if (d.deadlines.length === 0) {
    list.innerHTML = '<div class="deadline-row">No deadlines in the next 7 days.</div>';
  } else {
    list.innerHTML = d.deadlines.map(dl => {
      const cls = dl.daysOut < 0 ? 'days-red' : dl.daysOut <= 2 ? 'days-amber' : 'days-green';
      const label = dl.daysOut < 0 ? `${Math.abs(dl.daysOut)}d overdue` : dl.daysOut === 0 ? 'Today' : `${dl.daysOut}d left`;
      return `<div class="deadline-row"><span><strong>${dl.country}</strong> — ${dl.action || 'Action pending'} (${dl.owner || 'Unassigned'})</span><span class="days-out ${cls}">${label}</span></div>`;
    }).join('');
  }
}

async function renderMilestones(content) {
  const rows = await (await api('/milestones')).json();
  let html = '<table><thead><tr><th>Stage</th><th>Offset (days)</th><th>Note</th></tr></thead><tbody>';
  rows.forEach(r => html += `<tr><td>${r.stage}</td><td>${r.offset_days}</td><td>${r.note || ''}</td></tr>`);
  html += '</tbody></table>';
  content.innerHTML = html || '<p>No milestone data yet — add rows via the database.</p>';
}

async function renderCarryover(content) {
  const rows = await (await api('/carryover')).json();
  let html = '<table><thead><tr><th>Country</th><th>Q2 PO Status</th><th>Invoice</th><th>Payment</th><th>Note</th><th>Owner</th><th>Due</th></tr></thead><tbody>';
  rows.forEach(r => html += `<tr><td>${r.country}</td><td>${r.q2_po_status || ''}</td><td>${r.invoice_raised || ''}</td><td>${r.payment_received || ''}</td><td>${r.note || ''}</td><td>${r.owner || ''}</td><td>${fmtDate(r.due_date)}</td></tr>`);
  html += '</tbody></table>';
  content.innerHTML = html;
}

async function renderIssues(content) {
  const rows = await (await api('/issues')).json();
  const open = rows.filter(r => r.status !== 'Resolved');
  const closed = rows.filter(r => r.status === 'Resolved');

  function issueTable(list) {
    let html = '<div class="table-scroll"><table><thead><tr><th>#</th><th>Issue</th><th>Detail</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead><tbody>';
    list.forEach(r => {
      html += `<tr data-id="${r.id}"><td>${r.issue_no}</td>`;
      html += `<td><input type="text" data-field="issue" value="${(r.issue || '').replace(/"/g, '&quot;')}"></td>`;
      html += `<td><textarea data-field="detail" rows="1">${r.detail || ''}</textarea></td>`;
      html += `<td><input type="text" data-field="owner" value="${r.owner || ''}"></td>`;
      html += `<td><input type="date" data-field="due_date" value="${fmtDate(r.due_date)}"></td>`;
      html += `<td><select data-field="status">${['Open', 'Resolved'].map(s => `<option ${r.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td></tr>`;
    });
    html += '</tbody></table></div>';
    return html;
  }

  let html = '<button class="add-btn" id="add-issue">+ Add Issue</button>';
  html += `<h3>Open Issues (${open.length})</h3>`;
  html += open.length ? issueTable(open) : '<p>No open issues.</p>';
  html += `<h3 style="margin-top:24px">Closed Issues (${closed.length})</h3>`;
  html += closed.length ? issueTable(closed) : '<p>No closed issues yet.</p>';
  content.innerHTML = html;

  content.querySelectorAll('tr[data-id] [data-field]').forEach(el => {
    el.addEventListener('change', async () => {
      const id = el.closest('tr').dataset.id;
      const field = el.dataset.field;
      try {
        await api(`/issues/${id}`, { method: 'PATCH', body: JSON.stringify({ [field]: el.value }) });
        flash(field === 'status' ? 'Moved' : 'Saved');
        if (field === 'status') renderIssues(content);
      } catch (e) { flash('Save failed: ' + e.message); }
    });
  });

  $('#add-issue').addEventListener('click', async () => {
    await api('/issues', { method: 'POST', body: JSON.stringify({ issue: 'New issue', status: 'Open' }) });
    renderIssues(content);
  });
}

async function renderPoTracker(content) {
  const [rows, trackerRows] = await Promise.all([
    (await api(`/po-log?quarter_id=${CURRENT_QUARTER.id}`)).json(),
    (await api(`/tracker?quarter_id=${CURRENT_QUARTER.id}`)).json()
  ]);

  const statusCounts = { Awaiting: 0, Raised: 0, Received: 0, Overdue: 0 };
  rows.forEach(r => { if (statusCounts[r.status] !== undefined) statusCounts[r.status]++; });

  let html = '<div class="card-grid">';
  Object.entries(statusCounts).forEach(([status, count]) => {
    html += `<div class="metric-card"><div class="icon">▤</div><div><div class="label">${status}</div><div class="value">${count}</div></div></div>`;
  });
  html += '</div>';

  html += '<div class="quarter-form">';
  html += `<div><label>Country</label><select id="new-po-country">${trackerRows.map(t => `<option value="${t.country}" data-row="${t.id}">${t.country}</option>`).join('')}</select></div>`;
  html += '<div><label>PO Number</label><input id="new-po-number" placeholder="PO-00123"></div>';
  html += '<div><label>Amount</label><input id="new-po-amount" type="number" placeholder="0.00"></div>';
  html += '<div><label>Currency</label><input id="new-po-currency" placeholder="USD" value="USD" style="width:70px"></div>';
  html += '<div><button class="add-btn" id="add-po-btn">+ Add PO</button></div>';
  html += '</div>';

  html += '<div class="table-scroll"><table><thead><tr><th>Country</th><th>PO Number</th><th>Amount</th><th>Currency</th><th>Date Raised</th><th>Date Received</th><th>Status</th><th>Note</th><th></th></tr></thead><tbody>';
  rows.forEach(r => {
    html += `<tr data-id="${r.id}"><td>${r.country || ''}</td>`;
    html += `<td><input type="text" data-field="po_number" value="${r.po_number || ''}"></td>`;
    html += `<td><input type="number" data-field="amount" value="${r.amount || ''}"></td>`;
    html += `<td><input type="text" data-field="currency_code" value="${r.currency_code || 'USD'}" style="width:60px"></td>`;
    html += `<td><input type="date" data-field="date_raised" value="${fmtDate(r.date_raised)}"></td>`;
    html += `<td><input type="date" data-field="date_received" value="${fmtDate(r.date_received)}"></td>`;
    html += `<td><select data-field="status">${['Awaiting', 'Raised', 'Received', 'Overdue'].map(s => `<option ${r.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>`;
    html += `<td><input type="text" data-field="note" value="${(r.note || '').replace(/"/g, '&quot;')}"></td>`;
    html += `<td><button class="delete-row-btn" data-del-id="${r.id}">✕</button></td></tr>`;
  });
  html += '</tbody></table></div>';
  content.innerHTML = html;

  $('#add-po-btn').addEventListener('click', async () => {
    const sel = $('#new-po-country');
    const country = sel.value;
    const tracker_row_id = sel.selectedOptions[0].dataset.row;
    const po_number = $('#new-po-number').value.trim();
    const amount = $('#new-po-amount').value;
    const currency_code = $('#new-po-currency').value.trim() || 'USD';
    try {
      await api('/po-log', { method: 'POST', body: JSON.stringify({ country, tracker_row_id, po_number, amount, currency_code, quarter_id: CURRENT_QUARTER.id }) });
      flash('PO added');
      renderPoTracker(content);
    } catch (e) { flash('Failed: ' + e.message); }
  });

  content.querySelectorAll('tr[data-id] [data-field]').forEach(el => {
    el.addEventListener('change', async () => {
      const id = el.closest('tr').dataset.id;
      try {
        await api(`/po-log/${id}`, { method: 'PATCH', body: JSON.stringify({ [el.dataset.field]: el.value }) });
        flash('Saved');
        if (el.dataset.field === 'status') renderPoTracker(content);
      } catch (e) { flash('Save failed: ' + e.message); }
    });
  });

  content.querySelectorAll('.delete-row-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this PO entry?')) return;
      await api(`/po-log/${btn.dataset.delId}`, { method: 'DELETE' });
      renderPoTracker(content);
    });
  });
}

async function renderUserCounts(content) {
  const [rows, trackerRows] = await Promise.all([
    (await api(`/user-counts?quarter_id=${CURRENT_QUARTER.id}`)).json(),
    (await api(`/tracker?quarter_id=${CURRENT_QUARTER.id}`)).json()
  ]);
  const rates = await (await api('/country-rates')).json();
  const rateByCountry = {};
  rates.forEach(r => rateByCountry[r.country] = r);

  let html = '<div class="quarter-form">';
  html += `<div><label>Country</label><select id="new-uc-country">${trackerRows.map(t => `<option value="${t.country}">${t.country}</option>`).join('')}</select></div>`;
  html += '<div><label>User Count</label><input id="new-uc-count" type="number" placeholder="0"></div>';
  html += '<div><button class="add-btn" id="add-uc-btn">+ Add Row</button></div>';
  html += '</div>';

  html += '<div class="table-scroll"><table><thead><tr><th>Country</th><th>User Count</th><th>Rate/User</th><th>Currency</th><th>Subscription Charge</th><th>Effective Date</th><th></th></tr></thead><tbody>';
  rows.forEach(r => {
    const rate = rateByCountry[r.country];
    const price = rate ? Number(rate.per_user_price) : 0;
    const currency = rate ? rate.currency_code : 'USD';
    const charge = (Number(r.user_count || 0) * price).toLocaleString(undefined, { maximumFractionDigits: 2 });
    html += `<tr data-id="${r.id}"><td>${r.country}</td>`;
    html += `<td><input type="number" data-field="user_count" value="${r.user_count || 0}"></td>`;
    html += `<td>${price.toLocaleString()}</td><td>${currency}</td>`;
    html += `<td>${currency} ${charge}</td>`;
    html += `<td><input type="date" data-field="effective_date" value="${fmtDate(r.effective_date)}"></td>`;
    html += `<td><button class="delete-row-btn" data-del-id="${r.id}">✕</button></td></tr>`;
  });
  html += '</tbody></table></div>';
  html += '<p style="font-size:12px;color:#6b7686;margin-top:10px">Per-user rates are set in Settings, by country.</p>';
  content.innerHTML = html;

  $('#add-uc-btn').addEventListener('click', async () => {
    const country = $('#new-uc-country').value;
    const user_count = $('#new-uc-count').value || 0;
    try {
      await api('/user-counts', { method: 'POST', body: JSON.stringify({ country, user_count, quarter_id: CURRENT_QUARTER.id }) });
      flash('Added');
      renderUserCounts(content);
    } catch (e) { flash('Failed: ' + e.message); }
  });

  content.querySelectorAll('tr[data-id] [data-field]').forEach(el => {
    el.addEventListener('change', async () => {
      const id = el.closest('tr').dataset.id;
      try {
        await api(`/user-counts/${id}`, { method: 'PATCH', body: JSON.stringify({ [el.dataset.field]: el.value }) });
        flash('Saved');
        renderUserCounts(content);
      } catch (e) { flash('Save failed: ' + e.message); }
    });
  });

  content.querySelectorAll('.delete-row-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this row?')) return;
      await api(`/user-counts/${btn.dataset.delId}`, { method: 'DELETE' });
      renderUserCounts(content);
    });
  });
}

const ONE_TIME_CATEGORIES = ['Setup', 'Project Management', 'Hypercare', 'Support Retainer', 'Ad-hoc'];

async function renderOneTime(content) {
  const [rows, trackerRows] = await Promise.all([
    (await api(`/one-time?quarter_id=${CURRENT_QUARTER.id}`)).json(),
    (await api(`/tracker?quarter_id=${CURRENT_QUARTER.id}`)).json()
  ]);

  let html = '<div class="quarter-form">';
  html += `<div><label>Country</label><select id="new-ot-country">${trackerRows.map(t => `<option value="${t.country}">${t.country}</option>`).join('')}</select></div>`;
  html += `<div><label>Category</label><select id="new-ot-category">${ONE_TIME_CATEGORIES.map(c => `<option>${c}</option>`).join('')}</select></div>`;
  html += '<div><label>Amount</label><input id="new-ot-amount" type="number" placeholder="0.00"></div>';
  html += '<div><label>Currency</label><input id="new-ot-currency" value="USD" style="width:70px"></div>';
  html += '<div><button class="add-btn" id="add-ot-btn">+ Add Charge</button></div>';
  html += '</div>';

  html += '<div class="table-scroll"><table><thead><tr><th>Country</th><th>Category</th><th>Description</th><th>Amount</th><th>Currency</th><th>Charge Date</th><th>Status</th><th></th></tr></thead><tbody>';
  rows.forEach(r => {
    html += `<tr data-id="${r.id}"><td>${r.country || ''}</td>`;
    html += `<td><select data-field="category">${ONE_TIME_CATEGORIES.map(c => `<option ${r.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></td>`;
    html += `<td><input type="text" data-field="description" value="${(r.description || '').replace(/"/g, '&quot;')}"></td>`;
    html += `<td><input type="number" data-field="amount" value="${r.amount || ''}"></td>`;
    html += `<td><input type="text" data-field="currency_code" value="${r.currency_code || 'USD'}" style="width:60px"></td>`;
    html += `<td><input type="date" data-field="charge_date" value="${fmtDate(r.charge_date)}"></td>`;
    html += `<td><select data-field="status">${['Pending', 'Invoiced', 'Paid'].map(s => `<option ${r.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>`;
    html += `<td><button class="delete-row-btn" data-del-id="${r.id}">✕</button></td></tr>`;
  });
  html += '</tbody></table></div>';
  content.innerHTML = html;

  $('#add-ot-btn').addEventListener('click', async () => {
    const country = $('#new-ot-country').value;
    const category = $('#new-ot-category').value;
    const amount = $('#new-ot-amount').value;
    const currency_code = $('#new-ot-currency').value.trim() || 'USD';
    try {
      await api('/one-time', { method: 'POST', body: JSON.stringify({ country, category, amount, currency_code, quarter_id: CURRENT_QUARTER.id }) });
      flash('Added');
      renderOneTime(content);
    } catch (e) { flash('Failed: ' + e.message); }
  });

  content.querySelectorAll('tr[data-id] [data-field]').forEach(el => {
    el.addEventListener('change', async () => {
      const id = el.closest('tr').dataset.id;
      try {
        await api(`/one-time/${id}`, { method: 'PATCH', body: JSON.stringify({ [el.dataset.field]: el.value }) });
        flash('Saved');
      } catch (e) { flash('Save failed: ' + e.message); }
    });
  });

  content.querySelectorAll('.delete-row-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this charge?')) return;
      await api(`/one-time/${btn.dataset.delId}`, { method: 'DELETE' });
      renderOneTime(content);
    });
  });
}

async function renderSettings(content) {
  const [countryRates, exchangeRates, milestones] = await Promise.all([
    (await api('/country-rates')).json(),
    (await api('/exchange-rates')).json(),
    (await api('/milestones')).json()
  ]);

  let html = '<h3>Billing rates by country</h3>';
  html += '<div class="table-scroll"><table><thead><tr><th>Country</th><th>Currency</th><th>Per-User Price</th></tr></thead><tbody>';
  countryRates.forEach(r => {
    html += `<tr data-id="${r.id}"><td>${r.country}</td>`;
    html += `<td><input type="text" data-field="currency_code" value="${r.currency_code}" style="width:70px"></td>`;
    html += `<td><input type="number" data-field="per_user_price" value="${r.per_user_price}"></td></tr>`;
  });
  html += '</tbody></table></div>';

  html += '<h3 style="margin-top:24px">Exchange rates to USD</h3>';
  html += '<p style="font-size:12px;color:#6b7686">Used only to convert Dashboard totals — everything else stays in native currency.</p>';
  html += '<div class="quarter-form"><div><label>Currency code</label><input id="new-fx-code" placeholder="e.g. EUR" style="width:80px"></div><div><label>Rate to USD</label><input id="new-fx-rate" type="number" step="0.0001" placeholder="1.0800"></div><div><button class="add-btn" id="add-fx-btn">+ Add/Update Rate</button></div></div>';
  html += '<div class="table-scroll"><table><thead><tr><th>Currency</th><th>Rate to USD</th><th></th></tr></thead><tbody>';
  exchangeRates.forEach(r => {
    html += `<tr data-code="${r.currency_code}"><td>${r.currency_code}</td><td><input type="number" step="0.0001" data-field="rate_to_usd" value="${r.rate_to_usd}"></td>`;
    html += `<td>${r.currency_code === 'USD' ? '' : `<button class="delete-row-btn" data-del-code="${r.currency_code}">✕</button>`}</td></tr>`;
  });
  html += '</tbody></table></div>';

  html += '<h3 style="margin-top:24px">Milestone cadence (offset from quarter start, in days)</h3>';
  html += '<div class="table-scroll"><table><thead><tr><th>Stage</th><th>Offset (days)</th><th>Note</th></tr></thead><tbody>';
  milestones.forEach(m => {
    html += `<tr data-mid="${m.id}"><td>${m.stage}</td>`;
    html += `<td><input type="number" data-field="offset_days" value="${m.offset_days}"></td>`;
    html += `<td><input type="text" data-field="note" value="${(m.note || '').replace(/"/g, '&quot;')}"></td></tr>`;
  });
  html += '</tbody></table></div>';
  content.innerHTML = html;

  content.querySelectorAll('tr[data-id] [data-field]').forEach(el => {
    el.addEventListener('change', async () => {
      const id = el.closest('tr').dataset.id;
      try {
        await api(`/country-rates/${id}`, { method: 'PATCH', body: JSON.stringify({ [el.dataset.field]: el.value }) });
        flash('Saved');
      } catch (e) { flash('Save failed: ' + e.message); }
    });
  });

  content.querySelectorAll('tr[data-code] [data-field]').forEach(el => {
    el.addEventListener('change', async () => {
      const code = el.closest('tr').dataset.code;
      try {
        await api('/exchange-rates', { method: 'POST', body: JSON.stringify({ currency_code: code, rate_to_usd: el.value }) });
        flash('Saved');
      } catch (e) { flash('Save failed: ' + e.message); }
    });
  });

  content.querySelectorAll('[data-del-code]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this currency\'s exchange rate?')) return;
      await api(`/exchange-rates/${btn.dataset.delCode}`, { method: 'DELETE' });
      renderSettings(content);
    });
  });

  $('#add-fx-btn').addEventListener('click', async () => {
    const currency_code = $('#new-fx-code').value.trim().toUpperCase();
    const rate_to_usd = $('#new-fx-rate').value;
    if (!currency_code || !rate_to_usd) { flash('Enter code and rate'); return; }
    try {
      await api('/exchange-rates', { method: 'POST', body: JSON.stringify({ currency_code, rate_to_usd }) });
      flash('Rate saved');
      renderSettings(content);
    } catch (e) { flash('Failed: ' + e.message); }
  });

  content.querySelectorAll('tr[data-mid] [data-field]').forEach(el => {
    el.addEventListener('change', async () => {
      const id = el.closest('tr').dataset.mid;
      try {
        await api(`/milestones/${id}`, { method: 'PATCH', body: JSON.stringify({ [el.dataset.field]: el.value }) });
        flash('Saved');
      } catch (e) { flash('Save failed: ' + e.message); }
    });
  });
}

checkSession();
