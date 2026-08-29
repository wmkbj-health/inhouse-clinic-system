import * as api from '../api.js';
import { escapeHtml, fmtDate, debounce } from '../util.js';

const TINGKAT_INFO = {
  FA: { label: 'First Aid (FA)', cls: 'badge-ok', desc: 'Cedera ringan, penanganan pertolongan pertama tanpa rujukan medis lanjutan.' },
  MA: { label: 'Medical Aid (MA)', cls: 'badge-warn', desc: 'Memerlukan penanganan medis lebih lanjut namun pekerja tetap dapat bekerja.' },
  LTI: { label: 'Lost Time Injury (LTI)', cls: 'badge-danger', desc: 'Kecelakaan mengakibatkan hilangnya hari kerja / tidak dapat bekerja sementara.' }
};

export async function renderKecelakaan(root) {
  root.innerHTML = `
    <div class="view-head">
      <div><h1>Kecelakaan Kerja</h1><p class="desc">Rekap dan klasifikasi tingkat kecelakaan kerja: First Aid (FA), Medical Aid (MA), Lost Time Injury (LTI)</p></div>
    </div>
    <div class="grid cols-3" id="stats" style="margin-bottom:20px"></div>
    <div class="panel">
      <h2>Riwayat Kasus Kecelakaan Kerja <span class="muted" id="count"></span></h2>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <input type="text" id="search" placeholder="Cari nama pasien..." style="max-width:260px">
        <select id="tingkatFilter" style="max-width:220px">
          <option value="">Semua Tingkat</option>
          <option value="FA">First Aid (FA)</option>
          <option value="MA">Medical Aid (MA)</option>
          <option value="LTI">Lost Time Injury (LTI)</option>
        </select>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Tgl</th><th>Nama Pasien</th><th>Departemen</th><th>Tingkat</th><th>Diagnosa</th><th>Terkena</th><th>Kronologi</th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </div>
  `;

  const cases = await api.listKecelakaanKerja();
  const counts = { FA: 0, MA: 0, LTI: 0 };
  cases.forEach(c => { const t = c.kecelakaan_kerja?.tingkat; if (t) counts[t] = (counts[t] || 0) + 1; });

  root.querySelector('#stats').innerHTML = Object.entries(TINGKAT_INFO).map(([key, info]) => `
    <div class="card stat"><div class="label">${info.label}</div><div class="value">${counts[key] || 0}</div><div class="hint">${info.desc}</div></div>
  `).join('');

  root.querySelector('#count').textContent = `(${cases.length})`;
  const rows = root.querySelector('#rows');

  function draw(list) {
    if (!list.length) { rows.innerHTML = `<tr><td colspan="7" class="empty">Belum ada kasus kecelakaan kerja tercatat.</td></tr>`; return; }
    rows.innerHTML = list.map(v => {
      const kk = v.kecelakaan_kerja || {};
      const info = TINGKAT_INFO[kk.tingkat] || {};
      return `<tr>
        <td>${fmtDate(kk.tanggalKejadian || v.tanggal)}</td>
        <td>${escapeHtml(v.patients?.nama || '(pasien dihapus)')}</td>
        <td>${escapeHtml(v.patients?.departemen || '-')}</td>
        <td><span class="badge ${info.cls}">${info.label || kk.tingkat || '-'}</span></td>
        <td>${(v.diagnosa || []).map(d => escapeHtml(d.code)).join(', ') || '-'}</td>
        <td>${escapeHtml(kk.terkena || '-')}</td>
        <td style="white-space:normal;max-width:280px">${escapeHtml(kk.kronologi || '-')}</td>
      </tr>`;
    }).join('');
  }
  draw(cases);

  function applyFilters() {
    const q = root.querySelector('#search').value.trim().toLowerCase();
    const tingkat = root.querySelector('#tingkatFilter').value;
    draw(cases.filter(v => {
      if (q && !(v.patients?.nama || '').toLowerCase().includes(q)) return false;
      if (tingkat && v.kecelakaan_kerja?.tingkat !== tingkat) return false;
      return true;
    }));
  }
  root.querySelector('#search').addEventListener('input', debounce(applyFilters, 200));
  root.querySelector('#tingkatFilter').addEventListener('change', applyFilters);
}
