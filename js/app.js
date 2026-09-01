import { renderDashboard } from './views/dashboard.js';
import { renderApotek } from './views/apotek.js';
import { renderPasien } from './views/pasien.js';
import { renderRujukan } from './views/rujukan.js';
import { renderKecelakaan } from './views/kecelakaan.js';
import { renderSuratSakit } from './views/suratsakit.js';
import { renderAkun } from './views/akun.js';
import { renderLogin } from './views/login.js';
import { initAuth, isLoggedIn, getProfile, hasRole, signOut, ROLE_LABEL } from './auth.js';
import { loadReferenceData, stockAlerts, dataCompletenessIssues } from './api.js';
import { getCompanies, getSelectedCompanyId, setSelectedCompanyId, sortByCompanyOrder, companyLogoUrl, setPendingApotekFilter } from './state.js';
import { startRealtimeSync, stopRealtimeSync } from './realtime.js';
import { escapeHtml, openModal } from './util.js';

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
          <img src="assets/icon.svg" alt="Logo">
          <div><div class="name">Inhouse Clinic System</div><div class="sub">Klinik Digital Terpadu</div></div>
        </div>
        <div id="companyBadge"></div>
        <button class="notif-btn notif-btn-sidebar" id="notifBtnSidebar" aria-label="Notifikasi" hidden>&#128276; <span id="notifLabel">Notifikasi</span><span class="notif-dot" hidden></span></button>
        <div class="field" style="margin-bottom:14px">
          <label style="color:rgba(255,255,255,.8)">Perusahaan</label>
          <div class="company-switcher" id="companySwitcher"></div>
        </div>
        <nav class="nav" id="nav"></nav>
        <div class="sidebar-foot">
          Masuk sebagai <b>${profile.full_name}</b> (${ROLE_LABEL[profile.role]})<br>
          <button id="logoutBtn" class="btn btn-outline btn-sm" style="margin-top:8px;width:100%;color:#fff;border-color:rgba(255,255,255,.4)">Keluar</button>
        </div>
      </aside>
      <div class="main">
        <div class="topbar">
          <div class="brand"><img src="assets/icon.svg" alt="Logo" style="width:30px;height:30px"><b>Inhouse Clinic System</b></div>
          <div class="topbar-actions">
            <button class="notif-btn" id="notifBtn" aria-label="Notifikasi" hidden>&#128276;<span class="notif-dot" hidden></span></button>
            <button class="menu-btn" id="menuBtn" aria-label="Menu">&#9776;</button>
          </div>
        </div>
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
  document.getElementById('menuBtn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  if (hasRole('dokter', 'perawat')) {
    document.querySelectorAll('.notif-btn').forEach(btn => {
      btn.hidden = false;
      btn.addEventListener('click', openNotificationPanel);
    });
  }

  window.addEventListener('hashchange', route);
  route();
  renderAlertBanner();
  refreshNotifications();

  if (hasRole('dokter', 'perawat')) {
    startRealtimeSync(() => { route(); renderAlertBanner(); refreshNotifications(); });
  }
}

let lastCompletenessIssues = null;

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

async function renderAlertBanner() {
  const el = document.getElementById('alertBanner');
  if (!el || !hasRole('dokter', 'perawat')) { if (el) el.innerHTML = ''; return; }
  try {
    const alerts = await stockAlerts();
    if (!alerts.total) { el.innerHTML = ''; return; }
    const chip = (n, label, type) => n ? `<button type="button" class="alert-chip" data-warn="${type}">${n} ${escapeHtml(label)}</button>` : '';
    el.innerHTML = `
      <div class="alert-banner">
        <span>&#9888; <b>Peringatan Apotek:</b></span>
        ${chip(alerts.expired.length, 'sudah kadaluarsa', 'expired')}
        ${chip(alerts.expiringSoon.length, 'akan kadaluarsa ≤30 hari', 'expiring')}
        ${chip(alerts.reorder.length, 'perlu pesan ulang', 'minimum')}
      </div>`;
    el.querySelectorAll('[data-warn]').forEach(btn => btn.addEventListener('click', () => {
      setPendingApotekFilter(btn.dataset.warn);
      location.hash = '#apotek';
      route();
    }));
  } catch (err) {
    el.innerHTML = '';
  }
}

function renderCompanyBadge() {
  const el = document.getElementById('companyBadge');
  if (!el) return;
  const sel = getSelectedCompanyId();
  const company = getCompanies().find(c => c.id === sel);
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
  document.addEventListener('click', e => { if (!el.contains(e.target)) panel.hidden = true; });
  el.querySelectorAll('.cs-item').forEach(item => item.addEventListener('click', () => {
    panel.hidden = true;
    onPick(item.dataset.id);
    updateLabel();
  }));
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
  document.getElementById('sidebar').classList.remove('open');
  const root = document.getElementById('view-root');
  root.innerHTML = '<div class="empty">Memuat...</div>';
  try {
    await entry.render(root);
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="panel"><p>Terjadi kesalahan saat memuat halaman ini: ${err.message || err}</p></div>`;
  }
}

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}
