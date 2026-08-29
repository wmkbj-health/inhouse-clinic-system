import { renderDashboard } from './views/dashboard.js';
import { renderApotek } from './views/apotek.js';
import { renderPasien } from './views/pasien.js';
import { renderRujukan } from './views/rujukan.js';
import { renderKecelakaan } from './views/kecelakaan.js';
import { renderSuratSakit } from './views/suratsakit.js';
import { renderAkun } from './views/akun.js';
import { renderLogin } from './views/login.js';
import { initAuth, isLoggedIn, getProfile, hasRole, signOut, ROLE_LABEL } from './auth.js';
import { loadReferenceData, stockAlerts } from './api.js';
import { getCompanies, getSelectedCompanyId, setSelectedCompanyId } from './state.js';
import { startRealtimeSync, stopRealtimeSync } from './realtime.js';
import { escapeHtml } from './util.js';

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
        <div class="field" style="margin-bottom:10px">
          <label style="color:rgba(255,255,255,.8)">Perusahaan</label>
          <select id="companySelect" style="background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.25)"></select>
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
          <button class="menu-btn" id="menuBtn" aria-label="Menu">&#9776;</button>
        </div>
        <div id="alertBanner"></div>
        <div class="view" id="view-root"></div>
      </div>
    </div>
  `;

  const companies = getCompanies();
  const allowed = profile.company_scope ? companies.filter(c => profile.company_scope.includes(c.id)) : companies;
  const companySelect = document.getElementById('companySelect');
  const options = [];
  if (!profile.company_scope || allowed.length > 1) options.push(`<option value="all">Semua PT</option>`);
  options.push(...allowed.map(c => `<option value="${c.id}">${c.name}</option>`));
  companySelect.innerHTML = options.join('');
  const currentSel = getSelectedCompanyId();
  companySelect.value = allowed.some(c => c.id === currentSel) ? currentSel : (companySelect.querySelector('option')?.value || 'all');
  setSelectedCompanyId(companySelect.value);
  companySelect.addEventListener('change', () => {
    setSelectedCompanyId(companySelect.value);
    route();
    renderAlertBanner();
  });

  buildNav();
  document.getElementById('logoutBtn').addEventListener('click', async () => { stopRealtimeSync(); await signOut(); boot(); });
  document.getElementById('menuBtn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  window.addEventListener('hashchange', route);
  route();
  renderAlertBanner();

  if (hasRole('dokter', 'perawat')) {
    startRealtimeSync(() => { route(); renderAlertBanner(); });
  }
}

async function renderAlertBanner() {
  const el = document.getElementById('alertBanner');
  if (!el || !hasRole('dokter', 'perawat')) { if (el) el.innerHTML = ''; return; }
  try {
    const alerts = await stockAlerts();
    if (!alerts.total) { el.innerHTML = ''; return; }
    const parts = [];
    if (alerts.expired.length) parts.push(`${alerts.expired.length} obat/alkes sudah kadaluarsa`);
    if (alerts.expiringSoon.length) parts.push(`${alerts.expiringSoon.length} akan kadaluarsa dalam 30 hari`);
    if (alerts.reorder.length) parts.push(`${alerts.reorder.length} perlu pesan ulang (stok minimum)`);
    el.innerHTML = `
      <div class="alert-banner">
        <span>&#9888; <b>Peringatan Apotek:</b> ${parts.map(escapeHtml).join(' • ')}</span>
        <a href="#apotek" class="btn btn-sm btn-outline">Lihat Apotek</a>
      </div>`;
  } catch (err) {
    el.innerHTML = '';
  }
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
