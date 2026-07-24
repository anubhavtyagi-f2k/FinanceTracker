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
async function checkSession() {
  const res = await fetch('/api/session');
  const data = await res.json();
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#user-badge').textContent = data.userName || '';
  loadTab('tracker');
}

$('#login-btn').addEventListener('click', async () => {
  const name = $('#login-name').value.trim();
  const password = $('#login-password').value;
  try {
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password })
    });
    if (!res.ok) throw new Error('Wrong password');
    checkSession();
  } catch (e) {
    $('#login-error').textContent = 'Incorrect password. Contact your FieldAssist admin.';
  }
});
$('#login-password').addEventListener('keydown', e => { if (e.key === 'Enter') $('#login-btn').click(); });

$('#logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
});

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
    else if (tab === 'email') await renderEmail(content);
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
  const rows = await (await api('/tracker')).json();
  let html = '<table><thead><tr><th>Country</th><th>FA Owner</th>';
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
  html += '</tbody></table>';
  content.innerHTML = html;

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

async function renderDashboard(content) {
  const d = await (await api('/dashboard')).json();
  let html = '<div class="card-grid">';
  html += `<div class="metric-card"><div class="label">Countries in scope</div><div class="value">${d.countries}</div></div>`;
  html += `<div class="metric-card"><div class="label">Total Q3 Value</div><div class="value">${d.totalValue.toLocaleString()}</div></div>`;
  html += '</div><table><thead><tr><th>Stage</th><th>Done</th><th>On Track</th><th>Delayed</th></tr></thead><tbody>';
  STAGES.forEach(([key, label]) => {
    const s = d.stageStatus[key];
    html += `<tr><td>${label}</td><td>${s.Done}</td><td>${s['On Track']}</td><td>${s.Delayed}</td></tr>`;
  });
  html += '</tbody></table>';
  content.innerHTML = html;
}

async function renderMilestones(content) {
  const rows = await (await api('/milestones')).json();
  let html = '<table><thead><tr><th>Stage</th><th>Offset (days)</th><th>Note</th></tr></thead><tbody>';
  rows.forEach(r => html += `<tr><td>${r.stage}</td><td>${r.offset_days}</td><td>${r.note || ''}</td></tr>`);
  html += '</tbody></table>';
  content.innerHTML = html || '<p>No milestone data yet — add rows via the database.</p>';
}

async function renderEmail(content) {
  const res = await api('/weekly-email');
  const text = await res.text();
  content.innerHTML = `<div class="email-box">${text.replace(/</g, '&lt;')}</div>`;
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
  let html = '<button class="add-btn" id="add-issue">+ Add Issue</button>';
  html += '<table><thead><tr><th>#</th><th>Issue</th><th>Detail</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead><tbody>';
  rows.forEach(r => {
    html += `<tr data-id="${r.id}"><td>${r.issue_no}</td>`;
    html += `<td><input type="text" data-field="issue" value="${(r.issue || '').replace(/"/g, '&quot;')}"></td>`;
    html += `<td><textarea data-field="detail" rows="1">${r.detail || ''}</textarea></td>`;
    html += `<td><input type="text" data-field="owner" value="${r.owner || ''}"></td>`;
    html += `<td><input type="date" data-field="due_date" value="${fmtDate(r.due_date)}"></td>`;
    html += `<td><select data-field="status">${['Open', 'Resolved'].map(s => `<option ${r.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td></tr>`;
  });
  html += '</tbody></table>';
  content.innerHTML = html;

  content.querySelectorAll('tr[data-id] [data-field]').forEach(el => {
    el.addEventListener('change', async () => {
      const id = el.closest('tr').dataset.id;
      const field = el.dataset.field;
      try {
        await api(`/issues/${id}`, { method: 'PATCH', body: JSON.stringify({ [field]: el.value }) });
        flash('Saved');
      } catch (e) { flash('Save failed: ' + e.message); }
    });
  });

  $('#add-issue').addEventListener('click', async () => {
    await api('/issues', { method: 'POST', body: JSON.stringify({ issue: 'New issue', status: 'Open' }) });
    renderIssues(content);
  });
}

checkSession();
