import { signIn } from '../auth.js';
import { toast } from '../util.js';

const APP_VERSION = 'v1.0';

const COMPANY_LOGOS = [
  { code: 'WSL', name: 'PT Wana Subur Lestari' },
  { code: 'MTI', name: 'PT Mayangkara Tanaman Industri' },
  { code: 'KMF', name: 'PT Kubu Mulia Forestry' },
  { code: 'BIOS', name: 'PT Bina Ovivipari Semesta' },
  { code: 'JLA', name: 'PT Jelai Lestari Abadi' }
];

export function renderLogin(root, onSuccess) {
  // Purely cosmetic (no auth implication) — app.js persists the code of
  // whichever PT was last shown in the sidebar, so a returning user sees
  // their usual PT's logo highlighted even before signing in.
  let lastCompanyCode = null;
  try { lastCompanyCode = localStorage.getItem('ics_last_company_code'); } catch (e) { /* ignore */ }

  root.innerHTML = `
    <div class="login-screen">
      <div class="login-visual" id="loginVisual">
        <div class="login-mesh" id="loginMesh">
          <span class="login-blob b1"></span>
          <span class="login-blob b2"></span>
          <span class="login-blob b3"></span>
        </div>
        <div class="login-grid"></div>
        <svg class="login-ecg" viewBox="0 0 1200 60" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0,32 L140,32 L162,32 L178,10 L196,54 L214,20 L230,32 L420,32
                   L600,32 L622,32 L638,10 L656,54 L674,20 L690,32 L880,32
                   L1060,32 L1082,32 L1098,10 L1116,54 L1134,20 L1150,32 L1200,32" />
        </svg>
        <div class="login-visual-copy" id="loginCopy">
          <h2>Klinik Digital Terpadu</h2>
          <p>Satu sistem untuk pendaftaran pasien, rekam medis, apotek FEFO, surat sakit, dan rujukan — terhubung real-time di setiap unit klinik perusahaan.</p>
        </div>
      </div>
      <div class="login-panel">
        <div class="login-card">
          <div class="login-brand">
            <img src="assets/app-icon.png" alt="Logo">
            <h1>Inhouse Clinic System</h1>
            <p>Masuk untuk melanjutkan</p>
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
              ${COMPANY_LOGOS.map(c => `<img class="${c.code === lastCompanyCode ? 'last-used' : ''}" src="assets/logos/${c.code.toLowerCase()}.png" alt="${c.name}" title="${c.name}" onerror="this.style.display='none'">`).join('')}
            </div>
          </div>
          <div class="login-footer">
            <span>${APP_VERSION}</span>
            <span class="login-conn-dot" id="loginConnDot"></span>
            <span id="loginConnLabel"></span>
          </div>
        </div>
      </div>
    </div>
  `;

  // Subtle mouse-parallax on the mesh blobs and copy text — depth cues that
  // read as "alive"/interactive without any cartoon motion. Skipped
  // entirely under prefers-reduced-motion, and on touch devices there's no
  // hover to drive it anyway so it simply never fires.
  const visual = root.querySelector('#loginVisual');
  const mesh = root.querySelector('#loginMesh');
  const copy = root.querySelector('#loginCopy');
  if (visual && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let rafId = null, targetX = 0, targetY = 0, curX = 0, curY = 0;
    function tick() {
      curX += (targetX - curX) * 0.08;
      curY += (targetY - curY) * 0.08;
      mesh.style.transform = `translate(${curX * 1.6}px, ${curY * 1.6}px)`;
      copy.style.transform = `translate(${curX * -0.4}px, ${curY * -0.4}px)`;
      rafId = (Math.abs(targetX - curX) > 0.05 || Math.abs(targetY - curY) > 0.05) ? requestAnimationFrame(tick) : null;
    }
    visual.addEventListener('mousemove', e => {
      const r = visual.getBoundingClientRect();
      targetX = ((e.clientX - r.left) / r.width - 0.5) * 24;
      targetY = ((e.clientY - r.top) / r.height - 0.5) * 24;
      if (!rafId) rafId = requestAnimationFrame(tick);
    });
    visual.addEventListener('mouseleave', () => {
      targetX = 0; targetY = 0;
      if (!rafId) rafId = requestAnimationFrame(tick);
    });
  }

  const connDot = root.querySelector('#loginConnDot');
  const connLabel = root.querySelector('#loginConnLabel');
  function paintConn() {
    connDot.classList.toggle('online', navigator.onLine);
    connDot.classList.toggle('offline', !navigator.onLine);
    connLabel.textContent = navigator.onLine ? 'Online' : 'Tidak ada koneksi internet';
  }
  paintConn();
  window.addEventListener('online', paintConn);
  window.addEventListener('offline', paintConn);

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
