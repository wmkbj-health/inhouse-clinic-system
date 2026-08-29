export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtCurrency(n) {
  return 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

export function toast(msg, type = 'ok') {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const t = el(`<div class="toast ${type}">${escapeHtml(msg)}</div>`);
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

export function openModal(title, bodyHtml, { onMount } = {}) {
  const bg = el(`<div class="modal-bg">
    <div class="modal">
      <div class="modal-head"><h2>${escapeHtml(title)}</h2><button class="modal-close">&times;</button></div>
      <div class="modal-body">${bodyHtml}</div>
    </div>
  </div>`);
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.querySelector('.modal-close').addEventListener('click', close);
  bg.addEventListener('click', e => { if (e.target === bg) close(); });
  if (onMount) onMount(bg.querySelector('.modal-body'), close);
  return { close, root: bg.querySelector('.modal-body') };
}

export function confirmDialog(msg) {
  return window.confirm(msg);
}

export function mountPatientPicker(container, patients, onPick) {
  container.innerHTML = `
    <input type="text" id="patPickSearch" placeholder="Cari nama / No. RM...">
    <div class="icd-search-results" id="patPickResults" style="display:none"></div>
    <input type="hidden" id="patPickId">
    <div id="patPickSelected" style="margin-top:8px;font-size:.85rem;color:var(--muted)"></div>
  `;
  const search = container.querySelector('#patPickSearch');
  const results = container.querySelector('#patPickResults');
  const selected = container.querySelector('#patPickSelected');
  search.addEventListener('input', debounce(() => {
    const q = search.value.trim().toLowerCase();
    if (!q) { results.style.display = 'none'; return; }
    const matches = patients.filter(p => p.nama.toLowerCase().includes(q) || p.no_rm.toLowerCase().includes(q)).slice(0, 12);
    if (!matches.length) { results.style.display = 'none'; return; }
    results.style.display = '';
    results.innerHTML = matches.map(p => `<div class="icd-item" data-id="${p.id}"><b>${escapeHtml(p.no_rm)}</b> — ${escapeHtml(p.nama)}</div>`).join('');
    results.querySelectorAll('.icd-item').forEach(item => item.addEventListener('click', () => {
      const p = patients.find(x => x.id === item.dataset.id);
      container.querySelector('#patPickId').value = p.id;
      selected.textContent = `Dipilih: ${p.nama} (${p.no_rm})`;
      search.value = '';
      results.style.display = 'none';
      onPick(p);
    }));
  }, 150));
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function debounce(fn, ms = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
