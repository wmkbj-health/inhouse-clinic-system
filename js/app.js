import { renderDashboard } from './views/dashboard.js';
import { renderApotek } from './views/apotek.js';
import { renderPasien } from './views/pasien.js';
import { renderRujukan } from './views/rujukan.js';
import { renderKecelakaan } from './views/kecelakaan.js';
import { renderSuratSakit } from './views/suratsakit.js';
import { renderAkun } from './views/akun.js';
import { renderLogin } from './views/login.js';
import { initAuth, isLoggedIn, getProfile, hasRole, signOut, ROLE_LABEL } from './auth.js';
import { loadReferenceData, stockAlerts, dataCompletenessIssues, searchPatientsGlobal } from './api.js';
import { getCompanies, getSelectedCompanyId, setSelectedCompanyId, sortByCompanyOrder, companyLogoUrl, setPendingApotekFilter, setPendingPatientOpen, fmtAge } from './state.js';
import { startRealtimeSync, stopRealtimeSync } from './realtime.js';
import { escapeHtml, openModal, debounce } from './util.js';
import { notifyBrowser } from './browserNotify.js';

const ROUTES = {
  dashboard: { label: 'Dashboard', icon: '&#9632;', render: renderDashboard, roles: ['dokter', 'perawat', 'viewer'] },
  pasien: { label: 'Pasien', icon: '&#9679;', render: renderPasien, roles: ['dokter', 'perawat'] },
  apotek: { label: 'Apotek', icon: '&#9733;', render: renderApotek, roles: ['dokter', 'perawat'] },
  kecelakaan: { label: 'Kecelakaan Kerja', icon: '&#9888;', render: renderKecelakaan, roles: ['dokter', 'perawat'] },
  rujukan: { label: 'Rujukan', icon: '&#8594;', render: renderRujukan, roles: ['dokter', 'perawat'] },
  suratsakit: { label: 'Surat Sakit', icon: '&#9998;', render: renderSuratSakit, roles: ['dokter', 'perawat'] },
  akun: { label: 'Akun & Log Aktivitas', icon: '&#9881;', render: renderAkun, roles: ['dokter'] }
};

const appRoot = document.getElementById('app-root');

let shellListenersBound = false;

async function boot() {
  await initAuth();
  if (!isLoggedIn()) {
    renderLoginScreen();
    return;
  }
  await loadReferenceData();
  renderShell();
}

function renderLoginScreen() {
  appRoot.innerHTML = `<div id="loginRoot"></div>`;
  renderLogin(document.getElementById('loginRoot'), boot);
}

function renderShell() {
  const profile = getProfile();
  appRoot.innerHTML = `
    <div class="app">
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <img src="assets/app-icon.png" alt="Logo">
          <div><div class="name">Inhouse Clinic System</div><div class="sub">Klinik Digital Terpadu</div></div>
        </div>
        <div id="companyBadge"></div>
        <button class="notif-btn notif-btn-sidebar" id="notifBtnSidebar" aria-label="Notifikasi" hidden>&#128276; <span id="notifLabel">Notifikasi</span><span class="notif-dot" hidden></span></button>
        <div class="field" style="margin-bottom:14px">
          <label style="color:rgba(255,255,255,.8)">Perusahaan</label>
          <div class="company-switcher" id="companySwitcher"></div>
        </div>
        <div class="global-search" id="globalSearch">
          <input type="text" id="globalSearchInput" placeholder="Cari pasien (nama/No. RM/NIK)...">
          <div class="global-search-results" id="globalSearchResults" hidden></div>
        </div>
        <nav class="nav" id="nav"></nav>
        <div class="sidebar-foot">
          Masuk sebagai <b>${profile.full_name}</b> (${ROLE_LABEL[profile.role]})<br>
          <button id="logoutBtn" class="btn btn-outline btn-sm" style="margin-top:8px;width:100%;color:#fff;border-color:rgba(255,255,255,.4)">Keluar</button>
        </div>
      </aside>
      <div class="main">
        <div id="connStatus" hidden></div>
        <div id="alertBanner"></div>
        <div class="view" id="view-root"></div>
      </div>
    </div>
  `;

  const companies = sortByCompanyOrder(profile.company_scope ? getCompanies().filter(c => profile.company_scope.includes(c.id)) : getCompanies());
  const canShowAll = !profile.company_scope || companies.length > 1;
  const currentSel = companies.some(c => c.id === getSelectedCompanyId()) || (canShowAll && getSelectedCompanyId() === 'all')
    ? getSelectedCompanyId() : (canShowAll ? 'all' : companies[0]?.id);
  setSelectedCompanyId(currentSel);
  mountCompanySwitcher(document.getElementById('companySwitcher'), companies, canShowAll, id => {
    setSelectedCompanyId(id);
    renderCompanyBadge();
    route();
    renderAlertBanner();
  });
  renderCompanyBadge();

  buildNav();
  document.getElementById('logoutBtn').addEventListener('click', async () => { stopRealtimeSync(); await signOut(); boot(); });

  // Patient-level search — never exposed to "viewer" (dashboard-only,
  // no per-patient data, per the role model everywhere else in this app).
  const searchEl = document.getElementById('globalSearch');
  if (hasRole('dokter', 'perawat')) mountGlobalSearch(searchEl);
  else searchEl.hidden = true;

  if (hasRole('dokter', 'perawat')) {
    document.querySelectorAll('.notif-btn').forEach(btn => {
      btn.hidden = false;
      btn.addEventListener('click', openNotificationPanel);
    });
  }

  if (!shellListenersBound) {
    // Bound once for the lifetime of the page — renderShell() itself re-runs
    // on every login, and a plain addEventListener here would otherwise
    // stack a new global handler each time (each re-firing route() once per
    // stale login), compounding into real sluggishness on a shared device
    // that gets logged in/out repeatedly through the day.
    window.addEventListener('hashchange', route);
    window.addEventListener('online', renderConnStatus);
    window.addEventListener('offline', renderConnStatus);
    shellListenersBound = true;
  }
  renderConnStatus();
  route();
  renderAlertBanner();
  refreshNotifications();

  if (hasRole('dokter', 'perawat')) {
    startRealtimeSync(() => {
      // Skip while a modal is open so a remote update never yanks a form
      // the user is actively filling in out from under them.
      if (document.querySelector('.modal-bg')) return;
      route();
      renderAlertBanner();
      refreshNotifications();
    });
  }
}

// navigator.onLine only reflects "has a network interface", not "Supabase is
// reachable" — but this is a purely online (no offline write queue) app, so
// the one thing that actually matters to warn about is exactly what onLine
// tells us: don't trust the form you're filling in to save right now.
function renderConnStatus() {
  const el = document.getElementById('connStatus');
  if (!el) return;
  if (navigator.onLine) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `<div class="conn-status-offline">&#9888; Tidak ada koneksi internet — perubahan yang Anda buat sekarang <b>tidak akan tersimpan</b> sampai koneksi kembali.</div>`;
}

function mountGlobalSearch(container) {
  const input = container.querySelector('#globalSearchInput');
  const results = container.querySelector('#globalSearchResults');

  function renderResults(list) {
    if (!list.length) { results.innerHTML = `<div class="gs-empty">Tidak ditemukan</div>`; results.hidden = false; return; }
    results.innerHTML = list.map(p => `
      <button type="button" class="gs-item" data-id="${p.id}">
        <div class="gs-name">${escapeHtml(p.nama)} <span class="badge badge-muted">${escapeHtml(p.no_rm)}</span></div>
        <div class="gs-meta">${fmtAge(p.tgl_lahir)} • ${escapeHtml(p.departemen || '-')} • ${escapeHtml(p.companies?.code || '-')}</div>
      </button>`).join('');
    results.hidden = false;
    results.querySelectorAll('[data-id]').forEach(btn => btn.addEventListener('click', () => {
      setPendingPatientOpen(btn.dataset.id);
      results.hidden = true;
      input.value = '';
      if (location.hash === '#pasien') route();
      else location.hash = '#pasien';
    }));
  }

  const doSearch = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { results.hidden = true; results.innerHTML = ''; return; }
    try {
      renderResults(await searchPatientsGlobal(q));
    } catch (err) {
      results.hidden = true;
    }
  }, 300);

  input.addEventListener('input', doSearch);
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) doSearch(); });
  document.addEventListener('click', e => { if (!container.contains(e.target)) results.hidden = true; });
}

let lastCompletenessIssues = null;
let lastCompletenessCount = null;

async function refreshNotifications() {
  const dots = document.querySelectorAll('.notif-dot');
  if (!dots.length || !hasRole('dokter', 'perawat')) return;
  try {
    lastCompletenessIssues = await dataCompletenessIssues();
    const n = lastCompletenessIssues.total;
    dots.forEach(dot => {
      dot.hidden = !n;
      if (n) dot.textContent = n > 99 ? '99+' : String(n);
    });
    if (lastCompletenessCount !== null && n > lastCompletenessCount) {
      notifyBrowser('Data pasien/obat kurang lengkap', `${n} data perlu dilengkapi.`);
    }
    lastCompletenessCount = n;
  } catch (err) {
    dots.forEach(dot => { dot.hidden = true; });
  }
}

function openNotificationPanel() {
  const issues = lastCompletenessIssues;
  const section = (title, items, fmt) => !items || !items.length ? '' : `
    <div class="notif-section">
      <h4>${escapeHtml(title)} <span class="notif-count">${items.length}</span></h4>
      <ul>${items.slice(0, 20).map(it => `<li>${fmt(it)}</li>`).join('')}</ul>
      ${items.length > 20 ? `<div class="notif-more">+${items.length - 20} lainnya</div>` : ''}
    </div>`;
  const body = !issues || !issues.total
    ? `<div class="empty">Tidak ada data yang kurang lengkap saat ini. Semua data pasien dan obat sudah lengkap.</div>`
    : `
      ${section('Pasien tanpa NIK', issues.missingNik, p => `${escapeHtml(p.nama)} <small>(${escapeHtml(p.no_rm || '-')})</small>`)}
      ${section('Pasien tanpa Departemen', issues.missingDept, p => `${escapeHtml(p.nama)} <small>(${escapeHtml(p.no_rm || '-')})</small>`)}
      ${section('Pasien tanpa No. HP', issues.missingPhone, p => `${escapeHtml(p.nama)} <small>(${escapeHtml(p.no_rm || '-')})</small>`)}
      ${section('Obat tanpa Kategori', issues.missingCategory, d => escapeHtml(d.nama))}
    `;
  openModal('Notifikasi Data Kurang Lengkap', body);
}

let lastAlertSig = null;

async function renderAlertBanner() {
  const el = document.getElementById('alertBanner');
  if (!el || !hasRole('dokter', 'perawat')) { if (el) el.innerHTML = ''; return; }
  try {
    const alerts = await stockAlerts();
    if (!alerts.total) { el.innerHTML = ''; return; }
    // Keyed by exactly which items are flagged (not just the counts), so a
    // banner someone dismissed this session stays dismissed only as long as
    // the underlying alert set is unchanged — any new/different item still
    // pops the banner back up rather than hiding it silently.
    const sigOf = list => list.map(d => d.id).sort().join(',');
    const sig = `${getSelectedCompanyId()}|${sigOf(alerts.expired)}|${sigOf(alerts.expiringSoon)}|${sigOf(alerts.reorder)}`;
    if (lastAlertSig !== null && sig !== lastAlertSig) {
      notifyBrowser('Peringatan Apotek', `${alerts.expired.length} kadaluarsa, ${alerts.expiringSoon.length} akan kadaluarsa, ${alerts.reorder.length} perlu pesan ulang.`);
    }
    lastAlertSig = sig;
    let dismissed = [];
    try { dismissed = JSON.parse(sessionStorage.getItem('ics_dismissed_alerts') || '[]'); } catch (e) { /* ignore */ }
    if (dismissed.includes(sig)) { el.innerHTML = ''; return; }

    const chip = (n, label, type) => n ? `<button type="button" class="alert-chip" data-warn="${type}">${n} ${escapeHtml(label)}</button>` : '';
    el.innerHTML = `
      <div class="alert-banner">
        <span>&#9888; <b>Peringatan Apotek:</b></span>
        ${chip(alerts.expired.length, 'sudah kadaluarsa', 'expired')}
        ${chip(alerts.expiringSoon.length, 'akan kadaluarsa ≤30 hari', 'expiring')}
        ${chip(alerts.reorder.length, 'perlu pesan ulang', 'minimum')}
        <button type="button" class="alert-dismiss" id="alertDismiss" title="Sembunyikan untuk sesi ini">&times;</button>
      </div>`;
    el.querySelectorAll('[data-warn]').forEach(btn => btn.addEventListener('click', () => {
      setPendingApotekFilter(btn.dataset.warn);
      location.hash = '#apotek';
      route();
    }));
    el.querySelector('#alertDismiss').addEventListener('click', () => {
      try {
        const list = JSON.parse(sessionStorage.getItem('ics_dismissed_alerts') || '[]');
        list.push(sig);
        sessionStorage.setItem('ics_dismissed_alerts', JSON.stringify(list.slice(-20)));
      } catch (e) { /* ignore */ }
      el.innerHTML = '';
    });
  } catch (err) {
    el.innerHTML = '';
  }
}

function renderCompanyBadge() {
  const el = document.getElementById('companyBadge');
  if (!el) return;
  const sel = getSelectedCompanyId();
  const company = getCompanies().find(c => c.id === sel);
  if (company) { try { localStorage.setItem('ics_last_company_code', company.code); } catch (e) { /* ignore */ } }
  el.innerHTML = company
    ? `<div class="company-badge"><img src="${companyLogoUrl(company)}" alt="${escapeHtml(company.name)}" onerror="this.style.display='none'"><div><div class="cb-name">${escapeHtml(company.name)}</div><div class="cb-code">${escapeHtml(company.code)}</div></div></div>`
    : '';
}

function mountCompanySwitcher(el, companies, canShowAll, onPick) {
  if (!el) return;
  el.innerHTML = `
    <button type="button" class="company-switcher-btn" id="csBtn">
      <span id="csLabel"></span><span class="cs-caret">&#9662;</span>
    </button>
    <div class="company-switcher-panel" id="csPanel" hidden>
      ${canShowAll ? `<div class="cs-item" data-id="all"><span class="cs-all-ic">&#9673;</span> Semua PT</div>` : ''}
      ${companies.map(c => `<div class="cs-item" data-id="${c.id}"><img src="${companyLogoUrl(c)}" onerror="this.style.visibility='hidden'"> ${escapeHtml(c.name)}</div>`).join('')}
    </div>
  `;
  const btn = el.querySelector('#csBtn');
  const label = el.querySelector('#csLabel');
  const panel = el.querySelector('#csPanel');
  function updateLabel() {
    const current = getSelectedCompanyId();
    label.textContent = current === 'all' ? 'Semua PT' : (companies.find(c => c.id === current)?.name || 'Pilih PT');
  }
  updateLabel();
  btn.addEventListener('click', () => { panel.hidden = !panel.hidden; });
  bindOutsideClickOnce();
  el.querySelectorAll('.cs-item').forEach(item => item.addEventListener('click', () => {
    panel.hidden = true;
    onPick(item.dataset.id);
    updateLabel();
  }));
}

let outsideClickBound = false;
function bindOutsideClickOnce() {
  // Bound once and re-reads the live #companySwitcher/#csPanel each click,
  // instead of closing over the elements from whichever renderShell() call
  // happened to mount it — the previous version rebuilt this closure (and
  // added a fresh permanent document listener) on every login.
  if (outsideClickBound) return;
  outsideClickBound = true;
  document.addEventListener('click', e => {
    const panel = document.getElementById('csPanel');
    const switcherEl = document.getElementById('companySwitcher');
    if (panel && !panel.hidden && switcherEl && !switcherEl.contains(e.target)) panel.hidden = true;
  });
}

function buildNav() {
  const navEl = document.getElementById('nav');
  navEl.innerHTML = Object.entries(ROUTES).filter(([, r]) => hasRole(...r.roles)).map(([key, r]) =>
    `<a href="#${key}" data-key="${key}"><span class="ic">${r.icon}</span>${r.label}</a>`
  ).join('');
}

async function route() {
  const key = (location.hash || '#dashboard').slice(1);
  let entry = ROUTES[key];
  if (!entry || !hasRole(...entry.roles)) entry = ROUTES.dashboard;
  const navEl = document.getElementById('nav');
  navEl.querySelectorAll('a').forEach(a => a.classList.toggle('active', a.dataset.key === Object.keys(ROUTES).find(k => ROUTES[k] === entry)));
  const root = document.getElementById('view-root');
  root.innerHTML = '<div class="loading-state"><span class="spinner"></span> Memuat...</div>';
  try {
    await entry.render(root);
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="panel"><p>Terjadi kesalahan saat memuat halaman ini: ${err.message || err}</p></div>`;
  }
}

boot();

// The service worker itself does no caching (see service-worker.js) — it
// only exists so the app is installable as a PWA. A new version therefore
// never masks stale CSS/JS the way a caching SW can; we still surface an
// "update available" toast rather than forcing location.reload(), so a
// deploy landing mid-click never gets mistaken for the app "not responding".
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./service-worker.js');
      const notifyUpdateReady = worker => {
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast(() => { worker.postMessage('SKIP_WAITING'); });
          }
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateToast(() => reg.waiting.postMessage('SKIP_WAITING'));
      reg.addEventListener('updatefound', () => { if (reg.installing) notifyUpdateReady(reg.installing); });

      let reloadedOnce = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadedOnce) return;
        reloadedOnce = true;
        location.reload();
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
      setInterval(() => reg.update().catch(() => {}), 5 * 60 * 1000);
    } catch (err) { /* SW unsupported or blocked; app still works without it */ }
  });
}

function showUpdateToast(onUpdate) {
  if (document.querySelector('.update-toast')) return;
  const bar = document.createElement('div');
  bar.className = 'update-toast';
  bar.innerHTML = `<span>Versi baru tersedia.</span><button type="button" class="btn btn-sm btn-primary">Perbarui</button>`;
  bar.querySelector('button').addEventListener('click', () => { bar.remove(); onUpdate(); });
  document.body.appendChild(bar);
}
