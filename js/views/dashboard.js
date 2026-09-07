import * as api from '../api.js';
import { escapeHtml, fmtDate } from '../util.js';
import { getSelectedCompanyId, isAllCompanies, getCompanyById, getCompanies } from '../state.js';
import { printDashboardReport } from '../print.js';
import { hasRole } from '../auth.js';
import { lineChart, barChart, pieChart } from '../charts.js';

const STATUS_PEGAWAI_LABEL = { karyawan_tetap: 'Karyawan Tetap', karyawan_kontrak: 'Karyawan Kontrak', mitra_kerja: 'Mitra Kerja', masyarakat: 'Masyarakat/Umum' };
const JENIS_KUNJUNGAN_LABEL = { sakit: 'Sakit', kecelakaan_kerja: 'Kecelakaan Kerja', kontrol: 'Kontrol', vitamin_mcu: 'Vitamin/MCU/Minta Obat' };
const DISPOSISI_LABEL = { rawat_jalan: 'Rawat Jalan', observasi: 'Observasi', rawat_inap: 'Rawat Inap', rujuk_keluar: 'Rujuk Keluar' };

export async function renderDashboard(root) {
  const now = new Date();
  const canSeeAttention = hasRole('dokter', 'perawat');

  root.innerHTML = `
    <div class="view-head">
      <div><h1>Dashboard</h1><p class="desc">Ringkasan operasional klinik</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-outline" id="btnExportExcel">Export Excel</button>
        <button class="btn btn-outline" id="btnPrint">Cetak Laporan</button>
      </div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
      <select id="yearFilter"></select>
      <select id="statusFilter">
        <option value="all">Semua Status Pegawai</option>
        ${Object.entries(STATUS_PEGAWAI_LABEL).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
    </div>
    <div class="grid cols-4" id="statCards" style="margin-bottom:20px"></div>
    <div class="panel"><h2>Tren Kunjungan per Bulan</h2><div id="chartKunjungan"></div></div>
    <div class="grid cols-2">
      <div class="panel"><h2>Top Five Disease (Grafik)</h2><div id="chartDiseases"></div></div>
      <div class="panel"><h2>Kecelakaan Kerja per Tingkat</h2><div id="chartKk"></div></div>
    </div>
    <div class="grid cols-2">
      <div class="panel"><h2>Jenis Kasus Pasien</h2><div id="chartJenis"></div></div>
      <div class="panel"><h2>Disposisi Pasien</h2><div id="chartDisposisi"></div></div>
    </div>
    <div class="grid cols-2">
      <div class="panel"><h2>Antrian Hari Ini</h2><div id="queuePreview"></div></div>
      <div class="panel"><h2>Peringatan Apotek (Expired &amp; Safety Stock)</h2><div id="warnPreview"></div></div>
    </div>
    <div class="grid cols-2">
      <div class="panel"><h2>Top Five Disease</h2><div id="topDiseases"></div></div>
      <div class="panel"><h2>Top 10 Medicine</h2><div id="topDrugs"></div></div>
    </div>
    <div class="panel"><h2>Top Five Disease per Departemen</h2><div class="table-wrap" id="topDeptDiseases"></div></div>
    ${isAllCompanies() ? `<div class="panel"><h2>Perbandingan Antar PT</h2><p class="desc" style="margin-bottom:10px">Total per PT untuk tahun terpilih (hanya PT yang bisa diakses akun ini).</p><div class="table-wrap" id="companyComparison"></div></div>` : ''}
    ${canSeeAttention ? `<div class="panel"><h2>Perlu Perhatian <span class="muted" id="attentionCount"></span></h2><p class="desc" style="margin-bottom:10px">Pasien dengan tanda vital abnormal, riwayat penyakit kronis, kasus LTI, observasi/rawat inap terbaru, atau masih dalam masa istirahat.</p><div id="attention"></div></div>` : ''}
  `;

  const yearSel = root.querySelector('#yearFilter');
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);
  yearSel.innerHTML = years.map(y => `<option value="${y}" ${y === now.getFullYear() ? 'selected' : ''}>${y}</option>`).join('');
  const statusSel = root.querySelector('#statusFilter');

  let lastKpis = null, lastYearLabel = '';

  async function load() {
    const year = Number(yearSel.value);
    const status = statusSel.value;
    lastYearLabel = String(year);

    const [kpis, queue, drugs, attention] = await Promise.all([
      api.dashboardYearData(year, status),
      api.listQueueToday(), api.listDrugsWithStock(),
      canSeeAttention ? api.patientsNeedingAttention() : Promise.resolve([])
    ]);
    lastKpis = kpis;

    const totalKunjungan = kpis.kunjungan.reduce((s, r) => s + r.total_kunjungan, 0);
    const totalSks = kpis.sks.reduce((s, r) => s + r.total_sks, 0);
    const totalRujukan = kpis.rujukan.reduce((s, r) => s + r.total_rujukan, 0);
    const totalKk = kpis.kk.reduce((s, r) => s + r.jumlah, 0);
    const menunggu = queue.filter(q => q.status === 'menunggu').length;

    root.querySelector('#statCards').innerHTML = `
      <div class="card stat primary"><div class="label">Total Kunjungan (${year})</div><div class="value">${totalKunjungan}</div><div class="hint">${queue.length} antrian hari ini (${menunggu} menunggu)</div></div>
      <div class="card stat accent"><div class="label">Total Surat Sakit</div><div class="value">${totalSks}</div><div class="hint">Tahun ${year}</div></div>
      <div class="card stat warn"><div class="label">Total Rujukan Keluar</div><div class="value">${totalRujukan}</div><div class="hint">Tahun ${year}</div></div>
      <div class="card stat danger"><div class="label">Total Kecelakaan Kerja</div><div class="value">${totalKk}</div><div class="hint">${['FA','MA','LTI'].map(t => `${t}: ${kpis.kk.find(k => k.tingkat === t)?.jumlah || 0}`).join(' • ')}</div></div>
    `;

    const bulanan = kpis.kunjunganBulanan || [];
    root.querySelector('#chartKunjungan').innerHTML = bulanan.length
      ? lineChart(bulanan.map(b => b.label), bulanan.map(b => b.total), { color: 'var(--primary)' })
      : `<div class="empty">Belum ada data.</div>`;

    root.querySelector('#chartKk').innerHTML = pieChart(
      ['FA', 'MA', 'LTI'].map(t => ({ label: t, value: kpis.kk.find(k => k.tingkat === t)?.jumlah || 0 }))
    );

    root.querySelector('#chartJenis').innerHTML = pieChart(
      Object.entries(JENIS_KUNJUNGAN_LABEL).map(([k, label]) => ({ label, value: kpis.jenisKunjungan?.[k] || 0 }))
    );
    root.querySelector('#chartDisposisi').innerHTML = pieChart(
      Object.entries(DISPOSISI_LABEL).map(([k, label]) => ({ label, value: kpis.disposisi?.[k] || 0 }))
    );

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
    root.querySelector('#warnPreview').innerHTML = warnDrugs.length ? warnDrugs.map(d => {
      const days = d.nextExpiry ? Math.round((new Date(d.nextExpiry) - now) / 86400000) : null;
      const isExpired = days !== null && days < 0;
      const label = isExpired ? 'Kadaluarsa' : days !== null && days <= 30 ? `Exp ${days} hari lagi` : 'Perlu Pesan Ulang';
      return `<div class="list-row">
        <div class="main"><div class="name">${escapeHtml(d.nama)}</div><div class="meta">Stok: ${d.stok} ${escapeHtml(d.satuan)} (min. ${d.stok_minimum})</div></div>
        <span class="badge ${isExpired ? 'badge-danger' : 'badge-warn'}">${label}</span>
      </div>`;
    }).join('') : `<div class="empty">Tidak ada peringatan stok/kadaluarsa saat ini.</div>`;

    const diseaseMap = {};
    kpis.topDiseases.forEach(d => { diseaseMap[d.kode] = diseaseMap[d.kode] || { kode: d.kode, penyakit: d.penyakit, jumlah: 0 }; diseaseMap[d.kode].jumlah += d.jumlah; });
    const top5Diseases = Object.values(diseaseMap).sort((a, b) => b.jumlah - a.jumlah).slice(0, 5);
    const maxDisease = Math.max(1, ...top5Diseases.map(d => d.jumlah));
    root.querySelector('#topDiseases').innerHTML = top5Diseases.length ? top5Diseases.map((d, i) => rankBar(i, d.penyakit, d.kode, d.jumlah, maxDisease)).join('') : `<div class="empty">Belum ada data.</div>`;
    root.querySelector('#chartDiseases').innerHTML = top5Diseases.length
      ? barChart(top5Diseases.map(d => ({ label: `${d.kode} — ${d.penyakit}`, value: d.jumlah })))
      : `<div class="empty">Belum ada data.</div>`;

    const drugMap = {};
    kpis.topDrugs.forEach(d => { drugMap[d.nama] = (drugMap[d.nama] || 0) + Number(d.jumlah); });
    const top10Drugs = Object.entries(drugMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const maxDrug = Math.max(1, ...top10Drugs.map(([, j]) => j));
    root.querySelector('#topDrugs').innerHTML = top10Drugs.length ? top10Drugs.map(([nama, jml], i) => rankBar(i, nama, '', jml, maxDrug)).join('') : `<div class="empty">Belum ada data.</div>`;

    const deptMap = {};
    kpis.topDeptDiseases.forEach(d => {
      const dept = d.departemen || 'Tidak diketahui';
      deptMap[dept] = deptMap[dept] || {};
      deptMap[dept][d.kode] = deptMap[dept][d.kode] || { penyakit: d.penyakit, jumlah: 0 };
      deptMap[dept][d.kode].jumlah += d.jumlah;
    });
    const deptRows = Object.entries(deptMap).map(([dept, diseases]) => {
      const top = Object.values(diseases).sort((a, b) => b.jumlah - a.jumlah).slice(0, 5);
      return `<tr><td>${escapeHtml(dept)}</td><td>${top.map(t => `${escapeHtml(t.penyakit)} (${t.jumlah})`).join(', ')}</td></tr>`;
    });
    root.querySelector('#topDeptDiseases').innerHTML = deptRows.length ? `<table><thead><tr><th>Departemen</th><th>Top Five Disease</th></tr></thead><tbody>${deptRows.join('')}</tbody></table>` : `<div class="empty">Belum ada data.</div>`;

    if (isAllCompanies()) {
      const cmpEl = root.querySelector('#companyComparison');
      try {
        const cmp = await api.dashboardCompanyComparison(year);
        const companies = getCompanies();
        const rows = companies
          .filter(c => cmp[c.id])
          .map(c => ({ c, r: cmp[c.id] }))
          .sort((a, b) => b.r.kunjungan - a.r.kunjungan);
        cmpEl.innerHTML = rows.length ? `<table>
          <thead><tr><th>PT</th><th>Kunjungan</th><th>Surat Sakit</th><th>Rujukan</th><th>Kecelakaan Kerja</th><th>— LTI</th></tr></thead>
          <tbody>${rows.map(({ c, r }) => `<tr>
            <td>${escapeHtml(c.name)}</td><td>${r.kunjungan}</td><td>${r.sks}</td><td>${r.rujukan}</td><td>${r.kk}</td><td>${r.kkLti}</td>
          </tr>`).join('')}</tbody></table>` : `<div class="empty">Belum ada data.</div>`;
      } catch (err) {
        cmpEl.innerHTML = `<div class="empty">Gagal memuat perbandingan antar PT.</div>`;
      }
    }

    if (canSeeAttention) {
      const attentionEl = root.querySelector('#attention');
      root.querySelector('#attentionCount').textContent = `(${attention.length})`;
      attentionEl.innerHTML = attention.length ? attention.slice(0, 15).map(a => `
        <div class="list-row">
          <div class="main"><div class="name">${escapeHtml(a.patient.nama)} <span class="badge badge-muted">${escapeHtml(a.patient.no_rm)}</span></div>
            <div class="meta">${escapeHtml(a.patient.departemen || '-')} • ${a.reasons.map(escapeHtml).join(' | ')}</div></div>
          <span class="badge badge-danger">Perlu Perhatian</span>
        </div>`).join('') : `<div class="empty">Tidak ada pasien yang perlu perhatian khusus saat ini.</div>`;
    }
  }

  function rankBar(i, title, sub, value, max) {
    return `<div class="list-row">
      <div class="no">${i + 1}</div>
      <div class="main">
        <div class="name">${escapeHtml(title)}</div>
        ${sub ? `<div class="meta">${escapeHtml(sub)}</div>` : ''}
        <div class="bar-track" style="margin-top:4px"><div class="bar-fill" style="width:${(value / max) * 100}%;background:var(--primary)"></div></div>
      </div>
      <span class="badge badge-info">${value}</span>
    </div>`;
  }

  yearSel.addEventListener('change', load);
  statusSel.addEventListener('change', load);

  await load();

  root.querySelector('#btnExportExcel').addEventListener('click', () => {
    if (!window.XLSX) { alert('Gagal memuat pustaka Excel. Periksa koneksi internet lalu coba lagi.'); return; }
    const company = isAllCompanies() ? 'Semua PT' : (getCompanyById(getSelectedCompanyId())?.name || '-');
    const diseaseMap = {};
    lastKpis.topDiseases.forEach(d => { diseaseMap[d.kode] = diseaseMap[d.kode] || { kode: d.kode, penyakit: d.penyakit, jumlah: 0 }; diseaseMap[d.kode].jumlah += d.jumlah; });
    const topDiseases = Object.values(diseaseMap).sort((a, b) => b.jumlah - a.jumlah);
    const drugMap = {};
    lastKpis.topDrugs.forEach(d => { drugMap[d.nama] = (drugMap[d.nama] || 0) + Number(d.jumlah); });
    const topDrugs = Object.entries(drugMap).sort((a, b) => b[1] - a[1]).map(([nama, jumlah]) => ({ Obat: nama, Jumlah: jumlah }));

    const wb = XLSX.utils.book_new();
    const summary = [
      { Metrik: 'PT', Nilai: company },
      { Metrik: 'Tahun', Nilai: lastYearLabel },
      { Metrik: 'Total Kunjungan', Nilai: lastKpis.kunjungan.reduce((s, r) => s + r.total_kunjungan, 0) },
      { Metrik: 'Total Surat Sakit', Nilai: lastKpis.sks.reduce((s, r) => s + r.total_sks, 0) },
      { Metrik: 'Total Rujukan Keluar', Nilai: lastKpis.rujukan.reduce((s, r) => s + r.total_rujukan, 0) },
      { Metrik: 'Total Kecelakaan Kerja', Nilai: lastKpis.kk.reduce((s, r) => s + r.jumlah, 0) }
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Ringkasan');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((lastKpis.kunjunganBulanan || []).map(b => ({ Bulan: b.label, Total: b.total }))), 'Kunjungan Bulanan');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(topDiseases.map(d => ({ Kode: d.kode, Penyakit: d.penyakit, Jumlah: d.jumlah }))), 'Top Disease');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(topDrugs), 'Top Obat');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((lastKpis.kk || []).map(k => ({ Tingkat: k.tingkat, Jumlah: k.jumlah }))), 'Kecelakaan Kerja');
    XLSX.writeFile(wb, `laporan-klinik-${lastYearLabel}-${company.replace(/[^\w]+/g, '_')}.xlsx`);
  });

  root.querySelector('#btnPrint').addEventListener('click', () => {
    const company = isAllCompanies() ? null : getCompanyById(getSelectedCompanyId());
    const diseaseMap = {};
    lastKpis.topDiseases.forEach(d => { diseaseMap[d.kode] = diseaseMap[d.kode] || { kode: d.kode, penyakit: d.penyakit, jumlah: 0 }; diseaseMap[d.kode].jumlah += d.jumlah; });
    const top5Diseases = Object.values(diseaseMap).sort((a, b) => b.jumlah - a.jumlah).slice(0, 5);
    const drugMap = {};
    lastKpis.topDrugs.forEach(d => { drugMap[d.nama] = (drugMap[d.nama] || 0) + Number(d.jumlah); });
    const top10Drugs = Object.entries(drugMap).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([nama, jumlah]) => ({ nama, jumlah }));
    printDashboardReport(company, {
      totalKunjungan: lastKpis.kunjungan.reduce((s, r) => s + r.total_kunjungan, 0),
      totalSks: lastKpis.sks.reduce((s, r) => s + r.total_sks, 0),
      totalRujukan: lastKpis.rujukan.reduce((s, r) => s + r.total_rujukan, 0),
      totalKk: lastKpis.kk.reduce((s, r) => s + r.jumlah, 0),
      topDiseases: top5Diseases, topDrugs: top10Drugs,
      kunjunganBulanan: lastKpis.kunjunganBulanan || [],
      kk: lastKpis.kk || [],
      jenisKunjungan: Object.entries(JENIS_KUNJUNGAN_LABEL).map(([k, label]) => ({ label, value: lastKpis.jenisKunjungan?.[k] || 0 })),
      disposisi: Object.entries(DISPOSISI_LABEL).map(([k, label]) => ({ label, value: lastKpis.disposisi?.[k] || 0 }))
    }, lastYearLabel);
  });
}
