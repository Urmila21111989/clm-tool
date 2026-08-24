const API = '/api/contracts';
const PARENT_ALLOWED = { NDA: [], MSA: [], SOW: ['MSA'], CHANGE_ORDER: ['SOW', 'MSA'], AMENDMENT: ['SOW', 'MSA'] };

function abbrev(t) { return { NDA: 'NDA', MSA: 'MSA', SOW: 'SOW', CHANGE_ORDER: 'CO', AMENDMENT: 'AMD', UNKNOWN: '?' }[t] || '?'; }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ---- Tabs ----
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'create') loadParentOptions();
    if (tab.dataset.tab === 'lineage') loadLineageOptions();
  });
});

// ---- Ledger ----
async function loadLedger() {
  const q = document.getElementById('ledgerSearch').value.trim();
  const type = document.getElementById('ledgerTypeFilter').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (type) params.set('doc_type', type);

  const res = await fetch(`${API}?${params}`);
  const rows = await res.json();
  const body = document.getElementById('ledgerBody');
  const empty = document.getElementById('ledgerEmpty');

  if (!rows.length) { body.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  const byId = {};
  rows.forEach(r => byId[r.id] = r);

  body.innerHTML = rows.map(r => {
    const parentTitle = r.parent_id && byId[r.parent_id] ? byId[r.parent_id].title : (r.parent_id ? '(linked)' : '—');
    const nearSla = r.sla_date && new Date(r.sla_date) < new Date(Date.now() + 7 * 86400000);
    return `<tr>
      <td data-label="Type"><span class="stamp ${r.doc_type}">${abbrev(r.doc_type)}</span></td>
      <td data-label="Title">${escapeHtml(r.title)}</td>
      <td data-label="Parent">${escapeHtml(parentTitle)}</td>
      <td data-label="Effective">${r.effective_date ? String(r.effective_date).slice(0, 10) : '—'}</td>
      <td data-label="SLA date" class="${nearSla ? 'sla-near' : ''}">${r.sla_date ? String(r.sla_date).slice(0, 10) : '—'}</td>
      <td data-label="Status">${escapeHtml(r.status)}</td>
      <td data-label=""><button class="ghost" onclick="deleteContract('${r.id}')">Delete</button></td>
    </tr>`;
  }).join('');
}

async function deleteContract(id) {
  if (!confirm('Delete this contract record?')) return;
  await fetch(`${API}/${id}`, { method: 'DELETE' });
  loadLedger();
}

document.getElementById('ledgerSearch').addEventListener('input', debounce(loadLedger, 300));
document.getElementById('ledgerTypeFilter').addEventListener('change', loadLedger);
document.getElementById('ledgerRefresh').addEventListener('click', loadLedger);

// ---- Create ----
async function loadParentOptions() {
  const res = await fetch(API);
  const all = await res.json();
  const docType = document.getElementById('f_doc_type').value;
  const allowed = PARENT_ALLOWED[docType] || [];
  const sel = document.getElementById('f_parent_id');
  sel.innerHTML = '<option value="">None</option>' + all
    .filter(c => allowed.includes(c.doc_type))
    .map(c => `<option value="${c.id}">${escapeHtml(c.title)} (${c.doc_type})</option>`).join('');
}
document.getElementById('f_doc_type').addEventListener('change', loadParentOptions);

document.getElementById('addAttrBtn').addEventListener('click', () => {
  const row = document.createElement('div');
  row.className = 'attr-row';
  row.innerHTML = `<input type="text" placeholder="Field name (e.g. counterparty)" class="attr-key">
    <input type="text" placeholder="Value" class="attr-val">
    <button type="button" class="ghost" onclick="this.parentElement.remove()">Remove</button>`;
  document.getElementById('attrsList').appendChild(row);
});

document.getElementById('createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('createError');
  errBox.style.display = 'none';

  const attrs = {};
  document.querySelectorAll('.attr-row').forEach(row => {
    const k = row.querySelector('.attr-key').value.trim();
    const v = row.querySelector('.attr-val').value.trim();
    if (k) attrs[k] = v;
  });

  const interested = document.getElementById('f_interested_emails').value.split(',').map(s => s.trim()).filter(Boolean);

  const payload = {
    doc_type: document.getElementById('f_doc_type').value,
    title: document.getElementById('f_title').value.trim(),
    parent_id: document.getElementById('f_parent_id').value || null,
    status: document.getElementById('f_status').value,
    effective_date: document.getElementById('f_effective_date').value || null,
    sla_date: document.getElementById('f_sla_date').value || null,
    approver_email: document.getElementById('f_approver_email').value.trim() || null,
    interested_emails: interested,
    attributes: attrs,
    content_text: document.getElementById('f_content_text').value || null,
    source: 'manual',
  };

  if (!payload.title) { errBox.textContent = 'Enter a title before saving.'; errBox.style.display = 'block'; return; }

  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    errBox.textContent = body.error || 'Could not save this contract — check the fields and try again.';
    errBox.style.display = 'block';
    return;
  }

  document.getElementById('createForm').reset();
  document.getElementById('attrsList').innerHTML = '';
  loadParentOptions();
  loadLedger();
  document.querySelector('.tab[data-tab="ledger"]').click();
});

// ---- Lineage ----
async function loadLineageOptions() {
  const res = await fetch(API);
  const all = await res.json();
  const sel = document.getElementById('lineageSelect');
  sel.innerHTML = '<option value="">Choose a contract</option>' +
    all.map(c => `<option value="${c.id}">${escapeHtml(c.title)} (${c.doc_type})</option>`).join('');
}

document.getElementById('lineageSelect').addEventListener('change', async (e) => {
  const id = e.target.value;
  const view = document.getElementById('lineageView');
  if (!id) { view.innerHTML = ''; return; }
  const res = await fetch(`${API}/${id}`);
  const c = await res.json();
  view.innerHTML = `
    ${c.parent ? `<div class="lineage-node parent"><span class="stamp ${c.parent.doc_type}">${abbrev(c.parent.doc_type)}</span> ${escapeHtml(c.parent.title)} <span class="hint">(parent)</span></div>` : ''}
    <div class="lineage-node current"><span class="stamp ${c.doc_type}">${abbrev(c.doc_type)}</span> ${escapeHtml(c.title)} <span class="hint">(selected)</span></div>
    ${c.children.length ? c.children.map(ch => `<div class="lineage-node child"><span class="stamp ${ch.doc_type}">${abbrev(ch.doc_type)}</span> ${escapeHtml(ch.title)}</div>`).join('') : '<div class="hint" style="margin-left:16px;">No child documents yet.</div>'}
  `;
});

// ---- Ask ----
document.getElementById('askBtn').addEventListener('click', async () => {
  const query = document.getElementById('askInput').value.trim();
  const history = document.getElementById('askHistory');
  if (!query) return;

  const entry = document.createElement('div');
  entry.className = 'ask-entry';
  entry.innerHTML = `
    <div class="ask-question">${escapeHtml(query)}</div>
    <div class="ask-answer">Thinking…</div>
    <div class="ask-matches"></div>
  `;
  history.prepend(entry); // newest question appears at the top
  document.getElementById('askInput').value = '';

  try {
    const res = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Search failed.');
    entry.querySelector('.ask-answer').textContent = data.answer;
    entry.querySelector('.ask-matches').innerHTML = data.matched.map(m => `<span class="stamp ${m.doc_type}" style="margin:4px;">${abbrev(m.doc_type)}</span> ${escapeHtml(m.title)}`).join('<br>');
  } catch (err) {
    entry.querySelector('.ask-answer').textContent = "Couldn't complete that search — " + err.message;
  }
});

loadLedger();
loadParentOptions();
