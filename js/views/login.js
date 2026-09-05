import { signIn } from '../auth.js';
import { toast } from '../util.js';

const COMPANY_LOGOS = [
  { code: 'WSL', name: 'PT Wana Subur Lestari' },
  { code: 'MTI', name: 'PT Mayangkara Tanaman Industri' },
  { code: 'KMF', name: 'PT Kubu Mulia Forestry' },
  { code: 'BIOS', name: 'PT Bina Ovivipari Semesta' },
  { code: 'JLA', name: 'PT Jelai Lestari Abadi' }
];

export function renderLogin(root, onSuccess) {
  root.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="login-brand">
          <img src="assets/app-icon.png" alt="Logo">
          <h1>Inhouse Clinic System</h1>
          <p>Klinik Digital Terpadu — Masuk untuk melanjutkan</p>
        </div>
        <form id="loginForm">
          <div class="field" style="margin-bottom:14px"><label>Email</label><input type="email" name="email" required autocomplete="username" placeholder="nama@klinik.com"></div>
          <div class="field" style="margin-bottom:18px"><label>Kata Sandi</label><input type="password" name="password" required autocomplete="current-password" placeholder="••••••••"></div>
          <button type="submit" class="btn btn-primary" style="width:100%">Masuk</button>
        </form>
        <p class="login-hint">Belum punya akun? Hubungi dokter/admin klinik Anda untuk dibuatkan akses.</p>
        <div class="login-companies">
          <div class="login-companies-label">Melayani kesehatan karyawan di</div>
          <div class="login-companies-row">
            ${COMPANY_LOGOS.map(c => `<img src="assets/logos/${c.code.toLowerCase()}.png" alt="${c.name}" title="${c.name}" onerror="this.style.display='none'">`).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
  root.querySelector('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Memproses...';
    const fd = new FormData(e.target);
    try {
      await signIn(fd.get('email').trim(), fd.get('password'));
      onSuccess();
    } catch (err) {
      toast(err.message || 'Login gagal', 'err');
      btn.disabled = false;
      btn.textContent = 'Masuk';
    }
  });
}
