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
$$('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadTab(btn.dataset.tab);
  });
});

async function loadTab(tab) {
  const content = $('#content');
  content.innerHTML = '<p>Loading…</p>';
  try {
    if (tab === 'tracker') await renderTracker(content);
    else if (tab === 'dashboard') await renderDashboard(content);
    else if (tab === 'milestones') await renderMilestones(content);
    else if (tab === 'carryover') await renderCarryover(content);
    else if (tab === 'issues') await renderIssues(content);
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

  html += '<div class="table-scroll"><table><thead><tr><th>Country</th><th>FA Owner</th>';
  STAGES.forEach(([, label]) => html += `<th>${label} Actual</th><th>${label} Status</th>`);
  html += '<th>Blocker/Note</th><th>Next Action</th><th>Action Owner</th><th>Action Due</th></tr></thead><tbody>';

  rows.forEach(r => {
    html += `<tr data-id="${r.id}"><td>${r.country}</td><td>${r.fa_owner || ''}</td>`;
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
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  content.innerHTML = html;

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
  html += `<div class="metric-card"><div class="label">Countries in scope</div><div class="value">${d.countries}</div></div>`;
  html += `<div class="metric-card"><div class="label">Total Q3 Value</div><div class="value">${d.totalValue.toLocaleString()}</div></div>`;
  html += `<div class="metric-card"><div class="label">PO Received vs Expected</div><div class="value">${d.po.received}/${d.po.expected}</div></div>`;
  html += `<div class="metric-card"><div class="label">SO Issued vs Expected</div><div class="value">${d.so.received}/${d.so.expected}</div></div>`;
  html += '</div>';

  html += '<div class="chart-grid">';
  html += '<div class="chart-card"><h3>PO Received vs Expected</h3><canvas id="po-chart"></canvas></div>';
  html += '<div class="chart-card"><h3>SO Issued vs Expected</h3><canvas id="so-chart"></canvas></div>';
  html += '<div class="chart-card"><h3>Pipeline Status by Stage</h3><canvas id="stage-chart"></canvas></div>';
  html += '</div>';

  html += '<div class="chart-card"><h3>Deadlines in the next 7 days</h3><div class="deadline-list" id="deadline-list"></div></div>';

  content.innerHTML = html;

  const nivea = '#0032A0', green = '#16a34a', amber = '#d97706', red = '#dc2626', grey = '#dde3ee';

  charts.po = new Chart($('#po-chart'), {
    type: 'pie',
    data: {
      labels: ['Received', 'Outstanding'],
      datasets: [{ data: [d.po.received, Math.max(d.po.expected - d.po.received, 0)], backgroundColor: [nivea, grey] }]
    },
    options: { plugins: { legend: { position: 'bottom' } } }
  });

  charts.so = new Chart($('#so-chart'), {
    type: 'pie',
    data: {
      labels: ['Issued', 'Outstanding'],
      datasets: [{ data: [d.so.received, Math.max(d.so.expected - d.so.received, 0)], backgroundColor: [nivea, grey] }]
    },
    options: { plugins: { legend: { position: 'bottom' } } }
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

checkSession();
