import { signIn } from '../auth.js';
import { toast } from '../util.js';

const COMPANY_LOGOS = [
  { code: 'WSL', name: 'PT Wana Subur Lestari' },
  { code: 'MTI', name: 'PT Mayangkara Tanaman Industri' },
  { code: 'KMF', name: 'PT Kubu Mulia Forestry' },
  { code: 'BIOS', name: 'PT Bina Ovivipari Semesta' },
  { code: 'JLA', name: 'PT Jelai Lestari Abadi' }
];

// Acacia mangium plantation silhouette (the actual HTI species these
// companies grow) as inline SVG rather than raster images, so the forest
// can be laid out procedurally in three swaying parallax rows at any
// screen width instead of one fixed-size tiled PNG per layer.
function acaciaForestSvg() {
  const layers = [
    { count: 14, y: 190, minR: 22, maxR: 34, color: '#0c3f2c', opacity: 0.55, dur: 9 },
    { count: 12, y: 220, minR: 30, maxR: 46, color: '#0f5236', opacity: 0.78, dur: 7.5 },
    { count: 9, y: 255, minR: 42, maxR: 60, color: '#12613f', opacity: 1, dur: 6 }
  ];
  const width = 1600;
  let seed = 42;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

  const trees = layers.map((layer, li) => {
    const spacing = width / layer.count;
    const items = Array.from({ length: layer.count }, (_, i) => {
      const cx = i * spacing + spacing * (0.3 + rand() * 0.4);
      const r = layer.minR + rand() * (layer.maxR - layer.minR);
      const trunkH = r * 0.9;
      const delay = (rand() * layer.dur).toFixed(2);
      return `
        <g class="acacia-tree" style="transform-origin:${cx.toFixed(1)}px ${layer.y}px;animation-duration:${layer.dur}s;animation-delay:-${delay}s">
          <rect x="${(cx - r * 0.045).toFixed(1)}" y="${layer.y - trunkH * 0.15}" width="${(r * 0.09).toFixed(1)}" height="${(trunkH * 1.15).toFixed(1)}" fill="#3b2a1a" opacity="${layer.opacity}"/>
          <ellipse cx="${cx.toFixed(1)}" cy="${(layer.y - trunkH).toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 0.62).toFixed(1)}" fill="${layer.color}" opacity="${layer.opacity}"/>
          <ellipse cx="${(cx - r * 0.5).toFixed(1)}" cy="${(layer.y - trunkH * 0.8).toFixed(1)}" rx="${(r * 0.55).toFixed(1)}" ry="${(r * 0.4).toFixed(1)}" fill="${layer.color}" opacity="${layer.opacity * 0.92}"/>
          <ellipse cx="${(cx + r * 0.5).toFixed(1)}" cy="${(layer.y - trunkH * 0.8).toFixed(1)}" rx="${(r * 0.55).toFixed(1)}" ry="${(r * 0.4).toFixed(1)}" fill="${layer.color}" opacity="${layer.opacity * 0.92}"/>
        </g>`;
    }).join('');
    return `<g class="acacia-layer" data-layer="${li}">${items}</g>`;
  }).join('');

  return `
    <svg class="login-bg-forest" viewBox="0 0 ${width} 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      ${trees}
    </svg>`;
}

export function renderLogin(root, onSuccess) {
  root.innerHTML = `
    <div class="login-screen">
      <div class="login-bg-sun"></div>
      <div class="login-bg-clouds">
        <span class="cloud c1"></span><span class="cloud c2"></span><span class="cloud c3"></span>
      </div>
      <div class="login-bg-sparkle">
        ${Array.from({ length: 14 }).map((_, i) => `<span class="spark s${i % 7}"></span>`).join('')}
      </div>
      ${acaciaForestSvg()}
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
