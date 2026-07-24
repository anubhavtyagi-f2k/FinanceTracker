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
let ACTIVE_TAB = 'dashboard';

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
  const sel = $('#global-quarter-select');
  sel.innerHTML = QUARTERS.map(q => `<option value="${q.id}" ${q.id === CURRENT_QUARTER.id ? 'selected' : ''}>${q.label}</option>`).join('');
}

$('#global-quarter-select').addEventListener('change', async e => {
  CURRENT_QUARTER = QUARTERS.find(q => q.id == e.target.value);
  await loadTab(ACTIVE_TAB);
});

$('#global-add-quarter-btn').addEventListener('click', () => {
  $('#add-quarter-popover').classList.toggle('hidden');
});

$('#confirm-add-quarter-btn').addEventListener('click', async () => {
  const label = $('#new-q-label').value.trim();
  const start_date = $('#new-q-start').value;
  if (!label || !start_date) { flash('Enter a label and start date'); return; }
  try {
    await api('/quarters', { method: 'POST', body: JSON.stringify({ label, start_date }) });
    await loadQuarters();
    $('#add-quarter-popover').classList.add('hidden');
    $('#new-q-label').value = '';
    $('#new-q-start').value = '';
    flash('Quarter created');
    await loadTab(ACTIVE_TAB);
  } catch (e) { flash('Failed: ' + e.message); }
});

document.addEventListener('click', e => {
  const popover = $('#add-quarter-popover');
  if (!popover.classList.contains('hidden') && !popover.contains(e.target) && e.target.id !== 'global-add-quarter-btn') {
    popover.classList.add('hidden');
  }
});

$('#export-btn').addEventListener('click', () => { window.location.href = '/api/export'; });

// ---------- Tabs ----------
const TAB_TITLES = {
  dashboard: ['Dashboard', 'Beiersdorf × FieldAssist — FAOne billing snapshot & KPIs'],
  'country-view': ['Country View', 'Everything for one country in one place'],
  tracker: ['Q3 Tracker', 'PO & collection pipeline by country'],
  'po-tracker': ['PO Tracker', 'Detailed PO log and status pipeline'],
  'user-counts': ['User Counts', 'Per-country user counts driving subscription billing'],
  'user-growth': ['User Growth', 'Quarter-over-quarter user growth and decline by country'],
  'one-time': ['One-time & Support', 'Setup, PM, hypercare, support retainer and ad-hoc charges'],
  reconciliation: ['Billing Reconciliation', 'Carry-forward balances and suggested PO amounts, linked to Subscription and One-time/Support'],
  milestones: ['Milestone Calendar', 'Standing cadence and step owners'],
  carryover: ['Q2 Carry-over', 'Open items carried into this quarter'],
  issues: ['Open Issues', 'Items needing an answer before numbers are clean'],
  settings: ['Settings', 'Billing rates, exchange rates, and milestone cadence']
};

$$('.side-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.side-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ACTIVE_TAB = btn.dataset.tab;
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
    else if (tab === 'country-view') await renderCountryView(content);
    else if (tab === 'po-tracker') await renderPoTracker(content);
    else if (tab === 'user-counts') await renderUserCounts(content);
    else if (tab === 'user-growth') await renderUserGrowth(content);
    else if (tab === 'one-time') await renderOneTime(content);
    else if (tab === 'reconciliation') await renderReconciliation(content);
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
  html += '<div><label>Country name</label><input id="new-country-name" placeholder="e.g. Vietnam"></div>';
  html += '<div><label>FA Owner</label><input id="new-country-owner" placeholder="Owner name"></div>';
  html += '<div><button class="add-btn" id="add-country-btn">+ Add Country</button></div>';
  html += '</div>';

  html += '<div class="table-scroll"><table><thead><tr><th>Country</th><th>FA Owner</th><th>Q3 Value</th><th>RAG</th><th>Awaiting Step</th><th>Days Late</th>';
  STAGES.forEach(([, label]) => html += `<th>${label} Actual</th><th>${label} Status</th>`);
  html += '<th>Blocker/Note</th><th>Next Action</th><th>Action Owner</th><th>Action Due</th><th></th></tr></thead><tbody>';

  rows.forEach(r => {
    html += `<tr data-id="${r.id}"><td>${r.country}</td><td>${r.fa_owner || ''}</td>`;
    html += `<td><input type="number" data-field="q3_value" value="${r.q3_value || 0}" style="width:100px"></td>`;
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
  html += `<div class="metric-card accent-green"><div class="icon">💰</div><div><div class="label">Total Quarter Value (USD)</div><div class="value">$${d.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div></div>`;
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
  html += '<div class="chart-card"><h3>PO Log Status</h3><canvas id="po-status-chart"></canvas></div>';
  html += '</div>';

  html += '<div class="chart-card chart-card-wide"><h3>Pipeline Status by Stage</h3><canvas id="stage-chart"></canvas></div>';

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
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }, y: { stacked: true } },
      plugins: { legend: { position: 'bottom' } }
    }
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

  const realRows = rows.filter(r => !r.is_placeholder);
  const placeholderRows = rows.filter(r => r.is_placeholder);
  const statusCounts = { Awaiting: 0, Raised: 0, Received: 0, Overdue: 0 };
  realRows.forEach(r => { if (statusCounts[r.status] !== undefined) statusCounts[r.status]++; });

  let html = '<div class="card-grid">';
  Object.entries(statusCounts).forEach(([status, count]) => {
    html += `<div class="metric-card"><div class="icon">▤</div><div><div class="label">${status}</div><div class="value">${count}</div></div></div>`;
  });
  html += '</div>';
  if (placeholderRows.length) {
    html += `<p style="color:#6b7686;font-size:13px;margin-top:-8px">${placeholderRows.length} entr${placeholderRows.length === 1 ? 'y is' : 'ies are'} still placeholder data (shown with a badge below) and excluded from the counts above and from Dashboard totals.</p>`;
  }

  html += '<div class="quarter-form">';
  html += `<div><label>Country</label><select id="new-po-country">${trackerRows.map(t => `<option value="${t.country}" data-row="${t.id}">${t.country}</option>`).join('')}</select></div>`;
  html += '<div><label>PO Number</label><input id="new-po-number" placeholder="PO-00123"></div>';
  html += '<div><label>Amount</label><input id="new-po-amount" type="number" placeholder="0.00"></div>';
  html += '<div><label>Currency</label><input id="new-po-currency" placeholder="USD" value="USD" style="width:70px"></div>';
  html += '<div><button class="add-btn" id="add-po-btn">+ Add PO</button></div>';
  html += '</div>';
  html += '<p id="po-suggestion-note" style="color:#6b7686;font-size:13px;margin-top:-8px"></p>';

  html += '<div class="table-scroll"><table><thead><tr><th>Country</th><th>PO Number</th><th>Amount</th><th>Currency</th><th>Date Raised</th><th>Date Received</th><th>Status</th><th>Note</th><th></th></tr></thead><tbody>';
  rows.forEach(r => {
    html += `<tr data-id="${r.id}" style="${r.is_placeholder ? 'background:#fffbeb' : ''}"><td>${r.country || ''} ${r.is_placeholder ? '<span class="status-pill status-OnTrack" style="background:#fef3c7;color:#d97706">Placeholder</span>' : ''}</td>`;
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

  async function loadSuggestion() {
    const country = $('#new-po-country').value;
    if (!country) return;
    try {
      const s = await (await api(`/suggested-po/${encodeURIComponent(country)}?quarter_id=${CURRENT_QUARTER.id}`)).json();
      $('#new-po-amount').value = s.suggestedAmount.toFixed(2);
      $('#new-po-currency').value = s.currency;
      $('#po-suggestion-note').textContent =
        `Suggested from: Subscription ${s.currency} ${s.subscription.toLocaleString()} + One-time/Support ${s.currency} ${s.oneTime.toLocaleString()} + Carry-forward ${s.currency} ${s.carryForward.toLocaleString()}. Edit the amount above to override.`;
    } catch (e) { /* leave fields as-is if this fails */ }
  }
  $('#new-po-country').addEventListener('change', loadSuggestion);
  loadSuggestion();

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
        if (['status', 'po_number', 'amount', 'currency_code'].includes(el.dataset.field)) renderPoTracker(content);
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

async function renderCountryView(content) {
  const [trackerRows, poRows, userCounts, oneTime, carryover, countryRates] = await Promise.all([
    (await api(`/tracker?quarter_id=${CURRENT_QUARTER.id}`)).json(),
    (await api(`/po-log?quarter_id=${CURRENT_QUARTER.id}`)).json(),
    (await api(`/user-counts?quarter_id=${CURRENT_QUARTER.id}`)).json(),
    (await api(`/one-time?quarter_id=${CURRENT_QUARTER.id}`)).json(),
    (await api('/carryover')).json(),
    (await api('/country-rates')).json()
  ]);

  if (trackerRows.length === 0) {
    content.innerHTML = '<p>No countries in this quarter yet.</p>';
    return;
  }

  let html = '<div class="quarter-form">';
  html += `<div><label>Country</label><select id="cv-country-select">${trackerRows.map(t => `<option value="${t.country}">${t.country}</option>`).join('')}</select></div>`;
  html += '</div>';
  html += '<div id="cv-body"></div>';
  content.innerHTML = html;

  function draw(country) {
    const t = trackerRows.find(r => r.country === country);
    const rate = countryRates.find(r => r.country === country);
    const myPo = poRows.filter(r => r.country === country);
    const myUc = userCounts.filter(r => r.country === country);
    const myOt = oneTime.filter(r => r.country === country);
    const myCarry = carryover.filter(r => r.country === country);

    const ragColor = t.rag === 'Green' ? 'status-Done' : t.rag === 'Amber' ? 'status-OnTrack' : 'status-Delayed';
    const poTotal = myPo.filter(r => !r.is_placeholder).reduce((s, r) => s + Number(r.amount || 0), 0);
    const otTotal = myOt.reduce((s, r) => s + Number(r.amount || 0), 0);
    const userCount = myUc.reduce((s, r) => s + Number(r.user_count || 0), 0);
    const subCharge = rate ? userCount * Number(rate.per_user_price || 0) : 0;
    const currency = rate ? rate.currency_code : 'USD';

    let b = '<div class="card-grid">';
    b += `<div class="metric-card"><div class="icon">🚩</div><div><div class="label">RAG Status</div><div class="value"><span class="status-pill ${ragColor}">${t.rag || 'Not set'}</span></div></div></div>`;
    b += `<div class="metric-card accent-green"><div class="icon">💰</div><div><div class="label">Q3 Value</div><div class="value">${Number(t.q3_value || 0).toLocaleString()}</div></div></div>`;
    b += `<div class="metric-card"><div class="icon">📦</div><div><div class="label">PO Log Total</div><div class="value">${currency} ${poTotal.toLocaleString()}</div></div></div>`;
    b += `<div class="metric-card accent-amber"><div class="icon">🧾</div><div><div class="label">One-time & Support</div><div class="value">${currency} ${otTotal.toLocaleString()}</div></div></div>`;
    b += '</div>';

    b += `<p style="color:#6b7686;font-size:13px">FA Owner: <strong>${t.fa_owner || '—'}</strong> · BDF Owner: <strong>${t.bdf_owner || '—'}</strong> · Awaiting Step: <strong>${t.awaiting_step || '—'}</strong> · Days Late: <strong>${t.days_late ?? 0}</strong> · Carry-forward: <strong>${currency} ${Number(t.carry_forward_amount || 0).toLocaleString()}</strong></p>`;
    b += `<p style="color:#6b7686;font-size:13px">Suggested PO amount this quarter: <strong>${currency} ${(subCharge + otTotal + Number(t.carry_forward_amount || 0)).toLocaleString()}</strong> (Subscription + One-time/Support + Carry-forward)</p>`;

    b += '<h3>Pipeline stages</h3><div class="table-scroll"><table><thead><tr><th>Stage</th><th>Plan</th><th>Actual</th><th>Status</th></tr></thead><tbody>';
    STAGES.forEach(([key, label]) => {
      b += `<tr><td>${label}</td><td>${fmtDate(t[key + '_plan'])}</td><td>${fmtDate(t[key + '_actual'])}</td><td>${t[key + '_status'] || ''}</td></tr>`;
    });
    b += '</tbody></table></div>';

    if (t.blocker_note || t.next_action) {
      b += `<p style="margin-top:12px"><strong>Blocker:</strong> ${t.blocker_note || '—'}<br><strong>Next action:</strong> ${t.next_action || '—'} (${t.action_owner || 'unassigned'}, due ${fmtDate(t.action_due) || '—'})</p>`;
    }

    b += '<h3 style="margin-top:24px">PO Log entries</h3>';
    b += myPo.length
      ? '<div class="table-scroll"><table><thead><tr><th>PO Number</th><th>Amount</th><th>Currency</th><th>Date Raised</th><th>Date Received</th><th>Status</th></tr></thead><tbody>' +
        myPo.map(r => `<tr${r.is_placeholder ? ' style="background:#fffbeb"' : ''}><td>${r.po_number || ''} ${r.is_placeholder ? '<span class="status-pill" style="background:#fef3c7;color:#d97706">Placeholder</span>' : ''}</td><td>${r.amount || ''}</td><td>${r.currency_code}</td><td>${fmtDate(r.date_raised)}</td><td>${fmtDate(r.date_received)}</td><td>${r.status}</td></tr>`).join('') +
        '</tbody></table></div>'
      : '<p>No PO log entries for this country.</p>';

    b += '<h3 style="margin-top:24px">User Counts & Subscription</h3>';
    b += myUc.length
      ? `<p>Total users: <strong>${userCount}</strong> × ${currency} ${rate ? rate.per_user_price : 0}/user = <strong>${currency} ${subCharge.toLocaleString()}</strong></p>`
      : '<p>No user count entries for this country.</p>';

    b += '<h3 style="margin-top:24px">One-time & Support charges</h3>';
    b += myOt.length
      ? '<div class="table-scroll"><table><thead><tr><th>Category</th><th>Description</th><th>Amount</th><th>Currency</th><th>Date</th><th>Status</th></tr></thead><tbody>' +
        myOt.map(r => `<tr><td>${r.category}</td><td>${r.description || ''}</td><td>${r.amount || ''}</td><td>${r.currency_code}</td><td>${fmtDate(r.charge_date)}</td><td>${r.status}</td></tr>`).join('') +
        '</tbody></table></div>'
      : '<p>No one-time or support charges for this country.</p>';

    if (myCarry.length) {
      b += '<h3 style="margin-top:24px">Q2 Carry-over</h3><div class="table-scroll"><table><thead><tr><th>Q2 PO Status</th><th>Invoice</th><th>Payment</th><th>Note</th><th>Owner</th><th>Due</th></tr></thead><tbody>';
      b += myCarry.map(r => `<tr><td>${r.q2_po_status || ''}</td><td>${r.invoice_raised || ''}</td><td>${r.payment_received || ''}</td><td>${r.note || ''}</td><td>${r.owner || ''}</td><td>${fmtDate(r.due_date)}</td></tr>`).join('');
      b += '</tbody></table></div>';
    }

    $('#cv-body').innerHTML = b;
  }

  $('#cv-country-select').addEventListener('change', e => draw(e.target.value));
  draw(trackerRows[0].country);
}

async function renderReconciliation(content) {
  const trackerRows = await (await api(`/tracker?quarter_id=${CURRENT_QUARTER.id}`)).json();

  if (trackerRows.length === 0) {
    content.innerHTML = '<p>No countries in this quarter yet.</p>';
    return;
  }

  let html = '<p style="color:#6b7686;font-size:13px;margin-bottom:16px">Carry-forward is a fresh balance each quarter — positive means the country still owes from last quarter, negative means they overpaid (credit). It combines with Subscription and One-time/Support to suggest each PO amount in PO Tracker.</p>';
  html += '<div class="table-scroll"><table><thead><tr><th>Country</th><th>Subscription</th><th>One-time/Support</th><th>Carry-forward</th><th>Suggested PO Amount</th></tr></thead><tbody>';
  trackerRows.forEach(r => {
    html += `<tr data-id="${r.id}" data-country="${r.country}"><td>${r.country}</td>`;
    html += `<td class="recon-sub">…</td><td class="recon-ot">…</td>`;
    html += `<td><input type="number" data-field="carry_forward_amount" value="${r.carry_forward_amount ?? 0}" title="Positive = still owed from last quarter, negative = credit/overpaid"></td>`;
    html += `<td class="recon-suggested">…</td></tr>`;
  });
  html += '</tbody></table></div>';
  content.innerHTML = html;

  // Pull the linked figures (Subscription + One-time/Support) per country
  // from the same suggested-po endpoint PO Tracker uses, so both stay in sync.
  content.querySelectorAll('tr[data-country]').forEach(async tr => {
    const country = tr.dataset.country;
    try {
      const s = await (await api(`/suggested-po/${encodeURIComponent(country)}?quarter_id=${CURRENT_QUARTER.id}`)).json();
      tr.querySelector('.recon-sub').textContent = `${s.currency} ${s.subscription.toLocaleString()}`;
      tr.querySelector('.recon-ot').textContent = `${s.currency} ${s.oneTime.toLocaleString()}`;
      tr.querySelector('.recon-suggested').innerHTML = `<strong>${s.currency} ${s.suggestedAmount.toLocaleString()}</strong>`;
    } catch (e) { /* leave placeholders if this fails */ }
  });

  content.querySelectorAll('tr[data-id] [data-field]').forEach(el => {
    el.addEventListener('change', async () => {
      const id = el.closest('tr').dataset.id;
      const country = el.closest('tr').dataset.country;
      try {
        await api(`/tracker/${id}`, { method: 'PATCH', body: JSON.stringify({ [el.dataset.field]: el.value }) });
        flash('Saved');
        const s = await (await api(`/suggested-po/${encodeURIComponent(country)}?quarter_id=${CURRENT_QUARTER.id}`)).json();
        el.closest('tr').querySelector('.recon-suggested').innerHTML = `<strong>${s.currency} ${s.suggestedAmount.toLocaleString()}</strong>`;
      } catch (e) { flash('Save failed: ' + e.message); }
    });
  });
}

async function renderUserGrowth(content) {
  const d = await (await api('/user-growth')).json();
  destroyCharts();

  if (d.quarters.length < 2) {
    content.innerHTML = '<p>Need at least 2 quarters with user count data to show growth trends. Add another quarter and enter user counts to see this.</p>';
    return;
  }

  let html = '<div class="quarter-form">';
  html += `<div style="min-width:260px"><label>Filter countries (none = show total)</label><select id="growth-country-filter" multiple size="4" style="width:100%">${d.countries.map(c => `<option value="${c}">${c}</option>`).join('')}</select></div>`;
  html += '</div>';

  html += '<div class="chart-card" style="margin-bottom:20px"><h3>User count over time</h3><canvas id="growth-chart" style="height:280px"></canvas></div>';

  const latestTransition = d.transitions[d.transitions.length - 1];
  html += `<h3>Growth vs ${latestTransition.fromLabel} → ${latestTransition.toLabel}</h3>`;
  html += '<div class="quarter-form"><div><label>Compare quarters</label><select id="transition-select">';
  d.transitions.forEach((t, i) => {
    html += `<option value="${i}" ${i === d.transitions.length - 1 ? 'selected' : ''}>${t.fromLabel} → ${t.toLabel}</option>`;
  });
  html += '</select></div></div>';
  html += '<div id="growth-table-wrap"></div>';

  content.innerHTML = html;

  function renderGrowthTable(transitionIndex) {
    const t = d.transitions[transitionIndex];
    const sorted = [...t.changes].sort((a, b) => b.absoluteChange - a.absoluteChange);
    let tHtml = '<div class="table-scroll"><table><thead><tr><th>Country</th><th>' + t.fromLabel + '</th><th>' + t.toLabel + '</th><th>Change</th><th>% Change</th></tr></thead><tbody>';
    sorted.forEach(c => {
      const isNew = c.fromCount === 0 && c.toCount > 0;
      const pct = isNew ? 'New' : `${c.percentChange >= 0 ? '+' : ''}${c.percentChange.toFixed(1)}%`;
      const cls = c.absoluteChange > 0 ? 'status-Done' : c.absoluteChange < 0 ? 'status-Delayed' : 'status-OnTrack';
      tHtml += `<tr><td>${c.country}</td><td>${c.fromCount}</td><td>${c.toCount}</td><td><span class="status-pill ${cls}">${c.absoluteChange >= 0 ? '+' : ''}${c.absoluteChange}</span></td><td>${pct}</td></tr>`;
    });
    tHtml += '</tbody></table></div>';

    const growers = sorted.filter(c => c.absoluteChange > 0).slice(0, 3);
    const decliners = sorted.filter(c => c.absoluteChange < 0).slice(-3).reverse();
    tHtml += '<div class="card-grid" style="margin-top:16px">';
    tHtml += `<div class="metric-card accent-green"><div class="icon">📈</div><div><div class="label">Top Growing</div><div class="value" style="font-size:14px">${growers.length ? growers.map(g => `${g.country} (+${g.absoluteChange})`).join(', ') : '—'}</div></div></div>`;
    tHtml += `<div class="metric-card" style="border-left-color:#dc2626"><div class="icon">📉</div><div><div class="label">Top Declining</div><div class="value" style="font-size:14px">${decliners.length ? decliners.map(g => `${g.country} (${g.absoluteChange})`).join(', ') : '—'}</div></div></div>`;
    tHtml += '</div>';

    $('#growth-table-wrap').innerHTML = tHtml;
  }

  function renderGrowthChart(selectedCountries) {
    const labels = d.quarters.map(q => q.label);
    let datasets;
    const palette = ['#0032A0', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

    if (selectedCountries.length === 0) {
      const totals = d.quarters.map(q => d.countries.reduce((sum, c) => sum + (d.series[c][q.id] ?? 0), 0));
      datasets = [{ label: 'Total users', data: totals, borderColor: '#0032A0', backgroundColor: '#0032A0', tension: 0.2 }];
    } else {
      datasets = selectedCountries.map((country, i) => ({
        label: country,
        data: d.quarters.map(q => d.series[country][q.id] ?? null),
        borderColor: palette[i % palette.length],
        backgroundColor: palette[i % palette.length],
        tension: 0.2,
        spanGaps: true
      }));
    }

    if (charts.growth) charts.growth.destroy();
    charts.growth = new Chart($('#growth-chart'), {
      type: 'line',
      data: { labels, datasets },
      options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom' } } }
    });
  }

  renderGrowthChart([]);
  renderGrowthTable(d.transitions.length - 1);

  $('#growth-country-filter').addEventListener('change', e => {
    const selected = Array.from(e.target.selectedOptions).map(o => o.value);
    renderGrowthChart(selected);
  });

  $('#transition-select').addEventListener('change', e => {
    renderGrowthTable(Number(e.target.value));
  });
}

checkSession();
