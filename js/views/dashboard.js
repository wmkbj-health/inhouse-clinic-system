import * as api from '../api.js';
import { escapeHtml, fmtDate, todayStr } from '../util.js';
import { getSelectedCompanyId, isAllCompanies, getCompanyById } from '../state.js';
import { printDashboardReport } from '../print.js';

export async function renderDashboard(root) {
  root.innerHTML = `
    <div class="view-head">
      <div><h1>Dashboard</h1><p class="desc">Ringkasan operasional klinik bulan berjalan</p></div>
      <button class="btn btn-outline" id="btnPrint">Cetak Laporan</button>
    </div>
    <div class="grid cols-4" id="statCards" style="margin-bottom:20px"></div>
    <div class="grid cols-2">
      <div class="panel"><h2>Antrian Hari Ini</h2><div id="queuePreview"></div></div>
      <div class="panel"><h2>Peringatan Apotek (Expired &amp; Safety Stock)</h2><div id="warnPreview"></div></div>
    </div>
    <div class="grid cols-2">
      <div class="panel"><h2>Top 5 Penyakit</h2><div id="topDiseases"></div></div>
      <div class="panel"><h2>Top 5 Penggunaan Obat</h2><div id="topDrugs"></div></div>
    </div>
    <div class="panel"><h2>Top 5 Penyakit per Departemen</h2><div class="table-wrap" id="topDeptDiseases"></div></div>
    <div class="panel"><h2>Monitoring Pasien Follow-up (Observasi / Rawat Inap / Sedang SKS)</h2><div id="followup"></div></div>
  `;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const monthLabel = now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

  const [kpis, queue, drugs, visits] = await Promise.all([
    api.dashboardKpis(monthStart), api.listQueueToday(), api.listDrugsWithStock(), api.listRecentVisits(300)
  ]);

  const totalKunjungan = kpis.kunjungan.reduce((s, r) => s + r.total_kunjungan, 0);
  const totalSks = kpis.sks.reduce((s, r) => s + r.total_sks, 0);
  const totalRujukan = kpis.rujukan.reduce((s, r) => s + r.total_rujukan, 0);
  const totalKk = kpis.kk.reduce((s, r) => s + r.jumlah, 0);

  const menunggu = queue.filter(q => q.status === 'menunggu').length;
  const selesai = queue.filter(q => q.status === 'selesai').length;

  root.querySelector('#statCards').innerHTML = `
    <div class="card stat primary"><div class="label">Total Kunjungan (${escapeHtml(monthLabel)})</div><div class="value">${totalKunjungan}</div><div class="hint">${queue.length} antrian hari ini (${menunggu} menunggu)</div></div>
    <div class="card stat accent"><div class="label">Total Surat Sakit</div><div class="value">${totalSks}</div><div class="hint">Bulan berjalan</div></div>
    <div class="card stat warn"><div class="label">Total Rujukan Keluar</div><div class="value">${totalRujukan}</div><div class="hint">Bulan berjalan</div></div>
    <div class="card stat danger"><div class="label">Total Kecelakaan Kerja</div><div class="value">${totalKk}</div><div class="hint">${['FA','MA','LTI'].map(t => `${t}: ${kpis.kk.find(k => k.tingkat === t)?.jumlah || 0}`).join(' • ')}</div></div>
  `;

  const queuePreview = root.querySelector('#queuePreview');
  queuePreview.innerHTML = queue.length ? queue.slice(0, 6).map(q => `
    <div class="list-row">
      <div class="main"><div class="name">${escapeHtml(q.patients?.nama || '')}</div><div class="meta">${escapeHtml(q.poli || '')}</div></div>
      <span class="badge ${q.status === 'selesai' ? 'badge-ok' : q.status === 'diperiksa' ? 'badge-info' : 'badge-warn'}">${q.status === 'selesai' ? 'Selesai' : q.status === 'diperiksa' ? 'Diperiksa' : 'Menunggu'}</span>
    </div>`).join('') : `<div class="empty">Belum ada antrian hari ini.</div>`;

  const warnDrugs = drugs.filter(d => {
    if (d.stok <= d.stok_minimum) return true;
    if (!d.nextExpiry) return false;
    const days = Math.round((new Date(d.nextExpiry) - now) / 86400000);
    return days <= 30;
  }).slice(0, 8);
  const warnPreview = root.querySelector('#warnPreview');
  warnPreview.innerHTML = warnDrugs.length ? warnDrugs.map(d => {
    const days = d.nextExpiry ? Math.round((new Date(d.nextExpiry) - now) / 86400000) : null;
    const isExpired = days !== null && days < 0;
    const label = isExpired ? 'Kadaluarsa' : days !== null && days <= 30 ? `Exp ${days} hari lagi` : 'Perlu Pesan Ulang';
    return `<div class="list-row">
      <div class="main"><div class="name">${escapeHtml(d.nama)}</div><div class="meta">Stok: ${d.stok} ${escapeHtml(d.satuan)} (min. ${d.stok_minimum})</div></div>
      <span class="badge ${isExpired ? 'badge-danger' : 'badge-warn'}">${label}</span>
    </div>`;
  }).join('') : `<div class="empty">Tidak ada peringatan stok/kadaluarsa saat ini.</div>`;

  const topDiseasesMap = {};
  kpis.topDiseases.forEach(d => { topDiseasesMap[d.kode] = (topDiseasesMap[d.kode] || { kode: d.kode, penyakit: d.penyakit, jumlah: 0 }); topDiseasesMap[d.kode].jumlah += d.jumlah; });
  const top5Diseases = Object.values(topDiseasesMap).sort((a, b) => b.jumlah - a.jumlah).slice(0, 5);
  root.querySelector('#topDiseases').innerHTML = top5Diseases.length ? top5Diseases.map((d, i) => `
    <div class="list-row"><div class="no">${i + 1}</div><div class="main"><div class="name">${escapeHtml(d.penyakit)}</div><div class="meta">${escapeHtml(d.kode)}</div></div><span class="badge badge-info">${d.jumlah}</span></div>
  `).join('') : `<div class="empty">Belum ada data.</div>`;

  const topDrugsMap = {};
  kpis.topDrugs.forEach(d => { topDrugsMap[d.nama] = (topDrugsMap[d.nama] || 0) + Number(d.jumlah); });
  const top5Drugs = Object.entries(topDrugsMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  root.querySelector('#topDrugs').innerHTML = top5Drugs.length ? top5Drugs.map(([nama, jml], i) => `
    <div class="list-row"><div class="no">${i + 1}</div><div class="main"><div class="name">${escapeHtml(nama)}</div></div><span class="badge badge-info">${jml}</span></div>
  `).join('') : `<div class="empty">Belum ada data.</div>`;

  const deptMap = {};
  kpis.topDeptDiseases.forEach(d => {
    const dept = d.departemen || 'Tidak diketahui';
    deptMap[dept] = deptMap[dept] || {};
    deptMap[dept][d.kode] = (deptMap[dept][d.kode] || { penyakit: d.penyakit, jumlah: 0 });
    deptMap[dept][d.kode].jumlah += d.jumlah;
  });
  const deptRows = Object.entries(deptMap).map(([dept, diseases]) => {
    const top = Object.values(diseases).sort((a, b) => b.jumlah - a.jumlah).slice(0, 5);
    return `<tr><td>${escapeHtml(dept)}</td><td>${top.map(t => `${escapeHtml(t.penyakit)} (${t.jumlah})`).join(', ')}</td></tr>`;
  });
  root.querySelector('#topDeptDiseases').innerHTML = deptRows.length ? `<table><thead><tr><th>Departemen</th><th>Top 5 Penyakit</th></tr></thead><tbody>${deptRows.join('')}</tbody></table>` : `<div class="empty">Belum ada data.</div>`;

  const followupVisits = visits.filter(v => ['observasi', 'rawat_inap'].includes(v.disposisi));
  root.querySelector('#followup').innerHTML = followupVisits.length ? followupVisits.slice(0, 10).map(v => `
    <div class="list-row">
      <div class="main"><div class="name">${escapeHtml(v.patients?.nama || '')}</div><div class="meta">${escapeHtml(v.patients?.departemen || '-')} • ${fmtDate(v.tanggal)} • ${v.lama_observasi_hari || 0} hari</div></div>
      <span class="badge ${v.disposisi === 'rawat_inap' ? 'badge-danger' : 'badge-warn'}">${v.disposisi === 'rawat_inap' ? 'Rawat Inap' : 'Observasi'}</span>
    </div>`).join('') : `<div class="empty">Tidak ada pasien dalam status observasi/rawat inap saat ini.</div>`;

  root.querySelector('#btnPrint').addEventListener('click', () => {
    const company = isAllCompanies() ? null : getCompanyById(getSelectedCompanyId());
    printDashboardReport(company, {
      totalKunjungan, totalSks, totalRujukan, totalKk, topDiseases: top5Diseases,
      topDrugs: top5Drugs.map(([nama, jumlah]) => ({ nama, jumlah }))
    }, monthLabel);
  });
}
