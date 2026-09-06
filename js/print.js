import { escapeHtml, fmtDate } from './util.js';
import { fmtAge, companyLogoUrl } from './state.js';
import { lineChart, barChart, pieChart } from './charts.js';

const BASE_STYLE = `
  body{font-family:Arial,sans-serif;padding:32px;color:#111}
  h2{text-align:center;margin-bottom:2px}
  .center{text-align:center;color:#555;margin-bottom:20px;font-size:.85rem}
  .head{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:4px}
  .head img{height:52px;width:auto;object-fit:contain}
  table{width:100%;border-collapse:collapse;margin:14px 0}
  td,th{padding:6px 4px;vertical-align:top;font-size:.9rem}
  .label{width:190px;font-weight:600}
  .sign{margin-top:50px;display:flex;flex-wrap:wrap;justify-content:center;gap:30px 20px}
  .sign div{text-align:center;font-size:.9rem;flex:0 0 auto;width:150px}
  .sign .line{margin-top:55px;border-top:1px solid #333;padding-top:4px;width:150px;word-wrap:break-word}
  .report-table th,.report-table td{border:1px solid #999;padding:5px 7px;font-size:.8rem}
  .report-table{border-collapse:collapse}
  .stocktake-cat td{background:#eef1f5}
  .st-aman{background:#c8e6c9;font-weight:700;text-align:center}
  .st-soon{background:#ffe0b2;font-weight:700;text-align:center}
  .st-exp{background:#ffcdd2;font-weight:700;text-align:center}
  .photo-print-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:10px}
  .photo-print-grid figure{margin:0;border:1px solid #ccc;border-radius:8px;overflow:hidden;background:#fafafa}
  .photo-print-grid img{width:100%;height:150px;object-fit:cover;display:block}
  .photo-print-grid figcaption{text-align:center;font-size:.72rem;color:#555;padding:4px 0}
  .box{border:1px solid #999;padding:10px;border-radius:6px;margin:10px 0}
  .checkline{display:flex;gap:20px;margin:14px 0}
  .checkline label{display:flex;align-items:center;gap:6px;font-size:.9rem}
  .tembusan{margin-top:30px;font-size:.8rem;color:#333}
  .report-section{margin-top:26px}
  .chart{width:100%;max-width:640px;height:auto;display:block;margin:0 auto}
  .chart-pie{width:auto;max-width:220px}
  .chart-grid{stroke:#ddd;stroke-width:1}
  .chart-axis-x,.chart-axis-y{font-size:9px;fill:#555}
  .chart-axis-y{text-anchor:end}
  .chart-bar-value{font-size:10px;font-weight:700;fill:#111}
  .chart-pie-wrap{display:flex;align-items:center;gap:20px;flex-wrap:wrap;justify-content:center;padding:6px 0}
  .chart-legend{display:flex;flex-direction:column;gap:6px;font-size:.82rem}
  .chart-legend-item{display:flex;align-items:center;gap:8px}
  .chart-legend-dot{width:10px;height:10px;border-radius:3px;flex-shrink:0}
  .report-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:20px}
`;

function openPrint(title, bodyHtml) {
  const win = window.open('', '_blank');
  win.document.write(`<html><head><title>${escapeHtml(title)}</title><style>${BASE_STYLE}</style></head><body>${bodyHtml}<script>window.print()</script></body></html>`);
  win.document.close();
}

function letterhead(company, subtitle) {
  const logo = company ? `<img src="${companyLogoUrl(company)}" onerror="this.style.display='none'">` : '';
  return `
    <div class="head">${logo}<h2>${escapeHtml(company?.name || 'Inhouse Clinic System')}</h2></div>
    <div class="center">Klinik Inhouse • ${escapeHtml(subtitle)}</div>`;
}

function signBlock(items) {
  // items: [{ label, name }]
  return `<div class="sign">${items.map(it => `
    <div>${escapeHtml(it.label)},<div class="line">${escapeHtml(it.name || '(...........................)')}</div></div>
  `).join('')}</div>`;
}

// Extra custom signature columns configured per document type ("Atur Tanda
// Tangan" on each surat/laporan), appended after that document's own
// primary signer(s). Each docType (rujukan/sks/consent/stocktake/
// drug_request) keeps its own independent rows; `default` is the fallback
// for signatures saved before per-document configuration existed.
function extraSigners(sig, docType) {
  const rows = sig?.signatures?.[docType] || sig?.signatures?.default || [];
  return rows.filter(s => s.label || s.nama).map(s => ({ label: s.label || 'Tanda Tangan', name: s.nama || '' }));
}

export function printReferral(r, patient, company, sig = {}) {
  openPrint(`Surat Rujukan - ${patient?.nama || ''}`, `
    ${letterhead(company, 'SURAT RUJUKAN PASIEN')}
    <table>
      <tr><td class="label">Nomor</td><td>: RJK-${r.id.slice(0, 8).toUpperCase()}/${new Date(r.created_at).getFullYear()}</td></tr>
      <tr><td class="label">Tanggal</td><td>: ${fmtDate(r.tanggal)}</td></tr>
      <tr><td class="label">Kepada Yth. Sejawat di</td><td>: ${escapeHtml(r.faskes_tujuan)}</td></tr>
    </table>
    <p>Dengan hormat, mohon pemeriksaan dan penatalaksanaan lebih lanjut terhadap pasien berikut:</p>
    <table>
      <tr><td class="label">Nama Pasien</td><td>: ${escapeHtml(patient?.nama || '-')}</td></tr>
      <tr><td class="label">No. RM / NIK</td><td>: ${escapeHtml(patient?.no_rm || '-')} / ${escapeHtml(patient?.nik || '-')}</td></tr>
      <tr><td class="label">Tanggal Lahir / Usia</td><td>: ${fmtDate(patient?.tgl_lahir)} (${fmtAge(patient?.tgl_lahir)})</td></tr>
      <tr><td class="label">Jenis Kelamin</td><td>: ${patient?.jenis_kelamin === 'L' ? 'Laki-laki' : 'Perempuan'}</td></tr>
      <tr><td class="label">Departemen / Jabatan</td><td>: ${escapeHtml(patient?.departemen || '-')} / ${escapeHtml(patient?.jabatan || '-')}</td></tr>
      <tr><td class="label">Anamnesis &amp; Diagnosis Kerja</td><td>: ${escapeHtml(r.diagnosa)}</td></tr>
      <tr><td class="label">Terapi/Tindakan yang Sudah Diberikan</td><td>: ${escapeHtml(r.alasan_rujukan || '-')}</td></tr>
      <tr><td class="label">Alasan &amp; Tujuan Rujukan</td><td>: Mohon evaluasi dan tatalaksana lebih lanjut sesuai indikasi</td></tr>
    </table>
    <p>Demikian surat rujukan ini dibuat untuk dapat ditindaklanjuti. Atas kerjasamanya kami ucapkan terima kasih.</p>
    ${signBlock([{ label: 'Dokter Perujuk', name: r.dokter_perujuk || '' }, ...extraSigners(sig, 'rujukan')])}
  `);
}

export function printSickNote(n, patient, company, sig = {}, includeDiagnosis = false) {
  openPrint(`Surat Keterangan Sakit - ${patient?.nama || ''}`, `
    ${letterhead(company, 'SURAT KETERANGAN SAKIT')}
    <p style="text-align:center">Nomor: ${escapeHtml(n.nomor_surat)}</p>
    <p>Yang bertanda tangan di bawah ini, dokter/petugas pemeriksa pada klinik ${escapeHtml(company?.name || '')}, menerangkan bahwa:</p>
    <table>
      <tr><td class="label">Nama</td><td>: ${escapeHtml(patient?.nama || '-')}</td></tr>
      <tr><td class="label">No. RM / NIK</td><td>: ${escapeHtml(patient?.no_rm || '-')} / ${escapeHtml(patient?.nik || '-')}</td></tr>
      <tr><td class="label">Jabatan</td><td>: ${escapeHtml(patient?.jabatan || '-')}</td></tr>
      <tr><td class="label">Departemen</td><td>: ${escapeHtml(patient?.departemen || '-')}</td></tr>
      ${includeDiagnosis && n.diagnosa ? `<tr><td class="label">Diagnosa</td><td>: ${escapeHtml(n.diagnosa)}</td></tr>` : ''}
    </table>
    <p>Berdasarkan hasil pemeriksaan, yang bersangkutan dinyatakan perlu istirahat / tidak dapat bekerja selama:</p>
    <p style="text-align:center;font-weight:700;margin:14px 0">${fmtDate(n.tanggal_mulai)} sampai dengan ${fmtDate(n.tanggal_selesai)}</p>
    ${n.catatan ? `<p>Catatan: ${escapeHtml(n.catatan)}</p>` : ''}
    <p>Demikian surat keterangan ini dibuat dengan sebenarnya untuk dapat dipergunakan sebagaimana mestinya.</p>
    ${signBlock([{ label: 'Dokter Pemeriksa', name: n.dokter || '' }, ...extraSigners(sig, 'sks')])}
    <div class="tembusan">Tembusan: HRD ${escapeHtml(company?.name || '')}</div>
  `);
}

export function printPatientCardFront(patient, company) {
  const logo = company ? `<img src="${companyLogoUrl(company)}" style="width:34px;height:34px;object-fit:contain" onerror="this.style.display='none'">` : '';
  return `
    <div class="pc-card">
      <div class="pc-head">${logo}<div><div class="pc-company">${escapeHtml(company?.name || 'Inhouse Clinic System')}</div><div class="pc-sub">KARTU BEROBAT PASIEN</div></div></div>
      <div class="pc-body">
        <div class="pc-row"><span>Nama</span><b>${escapeHtml(patient.nama)}</b></div>
        <div class="pc-row"><span>No. RM / NIK</span><b>${escapeHtml(patient.no_rm)} / ${escapeHtml(patient.nik || '-')}</b></div>
        <div class="pc-row"><span>TTL</span><b>${fmtDate(patient.tgl_lahir)}</b></div>
        <div class="pc-row"><span>Departemen</span><b>${escapeHtml(patient.departemen || '-')}</b></div>
        <div class="pc-row"><span>Jabatan</span><b>${escapeHtml(patient.jabatan || '-')}</b></div>
        <div class="pc-row"><span>Asal / Lokasi</span><b>${escapeHtml(patient.nama_pt_mitra || company?.name || '-')} / ${escapeHtml(patient.lokasi_kerja || patient.tempat_tinggal || '-')}</b></div>
      </div>
    </div>`;
}

export function printPatientCardBack(company) {
  return `
    <div class="pc-card pc-back">
      <div class="pc-back-title">KETENTUAN PASIEN BEROBAT</div>
      <ol>
        <li>Bawa kartu ini setiap kali berobat ke klinik.</li>
        <li>Datang sesuai jam pelayanan klinik yang berlaku.</li>
        <li>Sampaikan keluhan dengan jelas kepada petugas medis.</li>
        <li>Ikuti anjuran dan terapi yang diberikan oleh dokter/petugas medis.</li>
        <li>Kartu hilang/rusak wajib segera dilaporkan ke petugas klinik.</li>
        <li>Data rekam medis bersifat rahasia dan dilindungi sesuai ketentuan yang berlaku.</li>
      </ol>
      <div class="pc-back-foot">${escapeHtml(company?.name || 'Inhouse Clinic System')} — Klinik Inhouse</div>
    </div>`;
}

export function printPatientCard(patient, company) {
  const win = window.open('', '_blank');
  win.document.write(`<html><head><title>Kartu Pasien - ${escapeHtml(patient.nama)}</title><style>
    ${BASE_STYLE}
    body{padding:16px;display:flex;flex-direction:column;align-items:center;gap:14px}
    .pc-card{width:340px;min-height:200px;border-radius:14px;padding:16px;box-sizing:border-box;
      background:linear-gradient(135deg,#eef5fb,#ffffff);border:1px solid #c7d7e6;box-shadow:0 2px 8px rgba(0,0,0,.08)}
    .pc-head{display:flex;align-items:center;gap:10px;border-bottom:2px solid #1565c0;padding-bottom:8px;margin-bottom:10px}
    .pc-company{font-weight:700;font-size:.85rem;color:#1565c0;line-height:1.2}
    .pc-sub{font-size:.65rem;color:#666;letter-spacing:.03em}
    .pc-row{display:flex;justify-content:space-between;gap:10px;font-size:.75rem;padding:3px 0;border-bottom:1px dashed #dde6ef}
    .pc-row span{color:#667}
    .pc-back{background:#f7f9fb}
    .pc-back-title{font-weight:700;text-align:center;margin-bottom:10px;color:#1565c0;font-size:.82rem}
    .pc-back ol{font-size:.68rem;padding-left:18px;line-height:1.6;color:#333}
    .pc-back-foot{text-align:center;font-size:.62rem;color:#888;margin-top:10px}
  </style></head><body>
    ${printPatientCardFront(patient, company)}
    ${printPatientCardBack(company)}
    <p style="font-size:.7rem;color:#888">Cetak dua sisi (duplex) agar sisi depan &amp; belakang menyatu pada satu kartu.</p>
    <script>window.print()</script>
  </body></html>`);
  win.document.close();
}

export function printCompanyDoctorRecommendation(patient, company, payload) {
  openPrint(`Surat Rekomendasi Dokter Perusahaan - ${patient.nama}`, `
    ${letterhead(company, 'SURAT REKOMENDASI DOKTER PERUSAHAAN')}
    <table>
      <tr><td class="label">Nama</td><td>: ${escapeHtml(patient.nama)}</td></tr>
      <tr><td class="label">No. RM / NIK</td><td>: ${escapeHtml(patient.no_rm)} / ${escapeHtml(patient.nik || '-')}</td></tr>
      <tr><td class="label">Departemen / Jabatan</td><td>: ${escapeHtml(patient.departemen || '-')} / ${escapeHtml(patient.jabatan || '-')}</td></tr>
      <tr><td class="label">Status Pegawai</td><td>: ${escapeHtml(payload.statusPegawai || '-')}</td></tr>
    </table>
    <div class="box">
      <b>Rekomendasi:</b>
      <p style="margin-top:6px">${escapeHtml(payload.rekomendasi || '-')}</p>
    </div>
    <p>Tanggal Pemeriksaan: ${fmtDate(payload.tanggal)}</p>
    ${signBlock([{ label: 'Dokter Perusahaan', name: payload.dokter }])}
  `);
}

export function printVisitData(visits, company, periodLabel) {
  openPrint('Data Kunjungan Pasien', `
    ${letterhead(company, `DATA KUNJUNGAN PASIEN — ${escapeHtml(periodLabel)}`)}
    <table class="report-table">
      <thead><tr><th>Tgl</th><th>Nama</th><th>No. RM</th><th>Dept</th><th>Jenis</th><th>Diagnosa</th><th>Disposisi</th><th>Biaya</th></tr></thead>
      <tbody>
        ${visits.map(v => `<tr>
          <td>${fmtDate(v.tanggal)}</td>
          <td>${escapeHtml(v.patients?.nama || '-')}</td>
          <td>${escapeHtml(v.patients?.no_rm || '-')}</td>
          <td>${escapeHtml(v.patients?.departemen || '-')}</td>
          <td>${escapeHtml(v.jenis_kunjungan)}</td>
          <td>${(v.diagnosa || []).map(d => escapeHtml(d.code)).join(', ')}</td>
          <td>${escapeHtml(v.disposisi)}</td>
          <td>Rp ${Number(v.biaya_total || 0).toLocaleString('id-ID')}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  `);
}

export function printMedicalConsentForm(patient, company, type, form = {}, sig = {}) {
  const isConsent = type === 'persetujuan';
  openPrint(`Form ${isConsent ? 'Persetujuan' : 'Penolakan'} Tindakan Medis`, `
    ${letterhead(company, `FORM ${isConsent ? 'PERSETUJUAN' : 'PENOLAKAN'} TINDAKAN MEDIS`)}
    <table>
      <tr><td class="label">Nama Pasien</td><td>: ${escapeHtml(patient?.nama || '..........................')}</td></tr>
      <tr><td class="label">No. RM / NIK</td><td>: ${escapeHtml(patient?.no_rm || '-')} / ${escapeHtml(patient?.nik || '-')}</td></tr>
      <tr><td class="label">Umur</td><td>: ${patient ? fmtAge(patient.tgl_lahir) : '..........................'}</td></tr>
      <tr><td class="label">Tanggal</td><td>: ${fmtDate(form.tanggal) || '..........................'}</td></tr>
    </table>
    <p style="margin-top:10px">Saya yang bertanda tangan di bawah ini menyatakan telah mendapatkan penjelasan yang cukup dari petugas medis mengenai tindakan/prosedur medis yang akan/tidak akan dilakukan, termasuk tujuan, manfaat, risiko, dan alternatif yang tersedia (${escapeHtml(form.penjelasanRisiko || 'sebagaimana dijelaskan lisan')}), dan dengan ini menyatakan:</p>
    <div class="box"><b>${isConsent ? 'MENYETUJUI' : 'MENOLAK'}</b> untuk dilakukan tindakan medis: <br><br>${escapeHtml(form.tindakan || '..........................................................................................')}</div>
    ${signBlock([
      { label: 'Pasien / Wali', name: '' },
      { label: 'Saksi', name: form.namaSaksi },
      { label: 'Petugas Medis', name: form.namaPetugas || '' },
      ...extraSigners(sig, 'consent')
    ])}
  `);
}

// Full management-facing report: KPI summary, then every chart shown on the
// dashboard screen re-rendered at print resolution (same inline-SVG chart
// functions, just with print-safe colors — see the chart-* classes in
// BASE_STYLE), so this can go straight into a presentation to perusahaan
// without extra work.
export function printDashboardReport(company, kpis, periodLabel) {
  const bulanan = kpis.kunjunganBulanan || [];
  const kkChart = ['FA', 'MA', 'LTI'].map(t => ({ label: t, value: kpis.kk?.find(k => k.tingkat === t)?.jumlah || 0 }));
  openPrint('Laporan Dashboard Klinik', `
    ${letterhead(company, `LAPORAN OPERASIONAL KLINIK — ${escapeHtml(periodLabel)}`)}
    <table class="report-table">
      <tbody>
        <tr><td>Total Kunjungan</td><td>${kpis.totalKunjungan}</td></tr>
        <tr><td>Total Surat Keterangan Sakit</td><td>${kpis.totalSks}</td></tr>
        <tr><td>Total Rujukan Keluar</td><td>${kpis.totalRujukan}</td></tr>
        <tr><td>Total Kecelakaan Kerja</td><td>${kpis.totalKk}</td></tr>
      </tbody>
    </table>

    ${bulanan.length ? `<div class="report-section"><h3>Tren Kunjungan per Bulan</h3>${lineChart(bulanan.map(b => b.label), bulanan.map(b => b.total))}</div>` : ''}

    <div class="report-section"><h3>Top Five Disease</h3>
      ${kpis.topDiseases.length ? barChart(kpis.topDiseases.map(d => ({ label: `${d.kode} — ${d.penyakit}`, value: d.jumlah }))) : ''}
      <table class="report-table"><thead><tr><th>Kode</th><th>Penyakit</th><th>Jumlah</th></tr></thead>
        <tbody>${kpis.topDiseases.map(d => `<tr><td>${escapeHtml(d.kode)}</td><td>${escapeHtml(d.penyakit)}</td><td>${d.jumlah}</td></tr>`).join('')}</tbody></table>
    </div>

    <div class="report-section"><h3>Top 10 Medicine</h3>
    <table class="report-table"><thead><tr><th>Obat</th><th>Jumlah</th></tr></thead>
      <tbody>${kpis.topDrugs.map(d => `<tr><td>${escapeHtml(d.nama)}</td><td>${d.jumlah}</td></tr>`).join('')}</tbody></table>
    </div>

    <div class="report-section report-grid-2">
      <div><h3>Jenis Kasus Pasien</h3>${pieChart(kpis.jenisKunjungan || [])}</div>
      <div><h3>Disposisi Pasien</h3>${pieChart(kpis.disposisi || [])}</div>
    </div>
    <div class="report-section"><h3>Kecelakaan Kerja per Tingkat</h3>${pieChart(kkChart)}</div>
  `);
}

// Status is computed purely from expiry, matching the klinik's own stock
// report: sudah lewat -> KADALUWARSA, dalam 90 hari -> <3 BULAN, else AMAN.
function expiryStatus(tanggalExpired) {
  if (!tanggalExpired) return { label: 'AMAN', cls: 'st-aman' };
  const days = Math.round((new Date(tanggalExpired) - new Date()) / 86400000);
  if (days < 0) return { label: 'KADALUWARSA', cls: 'st-exp' };
  if (days <= 90) return { label: '<3 BULAN', cls: 'st-soon' };
  return { label: 'AMAN', cls: 'st-aman' };
}

// One row per BATCH (not per drug) grouped by kategori: two batches of the
// same drug with different expiry dates are two separate, fully-reconciled
// rows (Stok Awal + Masuk - Keluar = Stok Akhir), matching the klinik's
// reference stock report format. isCurrentMonth controls whether Stok Awal
// can be reverse-derived from today's qty_sisa (only valid for the month
// still in progress — a past month's qty_sisa no longer reflects that
// month's ending balance once later transactions have happened).
export function printStocktake(drugs, company, periodLabel, jenisLabel, sig = {}, batchStats = {}, isCurrentMonth = true) {
  const byCategory = {};
  for (const d of drugs) {
    const cat = d.drug_categories?.name || 'Tanpa Kategori';
    (byCategory[cat] = byCategory[cat] || []).push(d);
  }
  const categories = Object.keys(byCategory).sort((a, b) => a.localeCompare(b, 'id'));
  let no = 0;
  const body = categories.map(cat => {
    const items = byCategory[cat].sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
    const rowsHtml = items.flatMap(d => (d.batches.length ? d.batches : [null]).map(b => {
      no++;
      const stats = b ? (batchStats[b.id] || { masuk: 0, keluar: 0 }) : { masuk: 0, keluar: 0 };
      const stokAkhir = b ? Number(b.qty_sisa) : 0;
      const stokAwal = isCurrentMonth ? Math.max(0, stokAkhir - stats.masuk + stats.keluar) : null;
      const st = expiryStatus(b?.tanggal_expired);
      return `<tr>
        <td>${no}</td><td>${escapeHtml(d.kode)}</td>
        <td>${escapeHtml(d.nama)}${d.nama_paten ? ` <span style="color:#666">(${escapeHtml(d.nama_paten)})</span>` : ''}</td>
        <td>${escapeHtml(d.satuan)}</td><td>${escapeHtml(d.sediaan || '-')}</td>
        <td>Rp ${Number(b?.harga_jual || 0).toLocaleString('id-ID')}</td>
        <td>${stokAwal ?? '-'}</td><td>${stats.masuk}</td><td>${stats.keluar}</td><td>${stokAkhir}</td>
        <td>${d.stok_minimum}</td><td>${b?.tanggal_expired ? fmtDate(b.tanggal_expired) : '-'}</td>
        <td class="${st.cls}">${st.label}</td>
      </tr>`;
    })).join('');
    return `<tr class="stocktake-cat"><td colspan="13"><b>${escapeHtml(cat.toUpperCase())}</b></td></tr>${rowsHtml}`;
  }).join('');
  openPrint(`Stocktake ${jenisLabel}`, `
    ${letterhead(company, `STOCKTAKE ${escapeHtml(jenisLabel.toUpperCase())} — ${escapeHtml(periodLabel)}`)}
    <table class="report-table">
      <thead><tr>
        <th>No</th><th>Kode</th><th>Nama</th><th>Satuan</th><th>Sediaan</th><th>Harga Satuan</th>
        <th>Stok Awal</th><th>Stok Masuk</th><th>Stok Keluar</th><th>Stok Akhir</th><th>Stok Minimum</th><th>Expired Date</th><th>Status</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${signBlock(extraSigners(sig, 'stocktake').length ? extraSigners(sig, 'stocktake') : [
      { label: 'Dibuat oleh (Apoteker/Petugas)', name: '' },
      { label: 'Diketahui oleh (Dokter)', name: '' }
    ])}
  `);
}

export function printDrugRequest(request, drugItems, company, sig = {}) {
  openPrint(`Permintaan Obat - ${request.nomor_permintaan}`, `
    ${letterhead(company, 'FORMULIR PERMINTAAN PENGADAAN OBAT & ALKES')}
    <table>
      <tr><td class="label">Nomor</td><td>: ${escapeHtml(request.nomor_permintaan)}</td></tr>
      <tr><td class="label">Tanggal</td><td>: ${fmtDate(request.tanggal)}</td></tr>
    </table>
    <table class="report-table">
      <thead><tr><th>Nama Item</th><th>Satuan</th><th>Stok Saat Ini</th><th>Jumlah Diminta</th><th>Keterangan</th></tr></thead>
      <tbody>${drugItems.map(it => `<tr>
        <td>${escapeHtml(it.nama)}</td><td>${escapeHtml(it.satuan || '-')}</td><td>${it.stok_saat_ini}</td>
        <td><b>${it.jumlah_diminta}</b></td><td>${escapeHtml(it.keterangan || '-')}</td>
      </tr>`).join('')}</tbody>
    </table>
    ${request.keterangan ? `<p>Catatan: ${escapeHtml(request.keterangan)}</p>` : ''}
    ${signBlock([
      { label: 'Diminta oleh', name: request.diminta_oleh || '' },
      { label: 'Disetujui oleh', name: request.disetujui_oleh || '' },
      ...extraSigners(sig, 'drug_request')
    ])}
  `);
}

export function printExpiryWriteoff(writeoff, company, sig = {}) {
  const totalNilai = writeoff.items.reduce((s, it) => s + (it.qty * (it.harga_satuan || 0)), 0);
  openPrint(`Berita Acara Kadaluwarsa - ${writeoff.nomor_berita_acara}`, `
    ${letterhead(company, 'BERITA ACARA PEMUSNAHAN OBAT/ALKES KADALUWARSA')}
    <table>
      <tr><td class="label">Nomor</td><td>: ${escapeHtml(writeoff.nomor_berita_acara)}</td></tr>
      <tr><td class="label">Tanggal</td><td>: ${fmtDate(writeoff.tanggal)}</td></tr>
      <tr><td class="label">Jenis</td><td>: ${escapeHtml((writeoff.jenis || '').toUpperCase())}</td></tr>
    </table>
    <p>Pada tanggal tersebut di atas, telah dilakukan pemusnahan/penarikan terhadap obat/alat kesehatan yang telah kadaluwarsa dengan rincian sebagai berikut:</p>
    <table class="report-table">
      <thead><tr><th>Nama Item</th><th>Jumlah</th><th>Satuan</th></tr></thead>
      <tbody>${writeoff.items.map(it => `<tr>
        <td>${escapeHtml(it.nama)}</td><td>${it.qty}</td><td>${escapeHtml(it.satuan || '-')}</td>
      </tr>`).join('')}</tbody>
    </table>
    ${writeoff.keterangan ? `<p>Keterangan/Cara Pemusnahan: ${escapeHtml(writeoff.keterangan)}</p>` : ''}
    <p>Stok item-item di atas telah dikurangi secara otomatis dari sistem apotek pada saat Berita Acara ini dibuat, sehingga tidak menimbulkan selisih stok di kemudian hari.</p>
    ${(writeoff.foto_urls || []).length ? `
      <div class="report-section">
        <h3>Lampiran Dokumentasi Foto</h3>
        <div class="photo-print-grid">
          ${writeoff.foto_urls.map((src, i) => `<figure><img src="${src}"><figcaption>Dokumentasi ${i + 1}</figcaption></figure>`).join('')}
        </div>
      </div>` : ''}
    ${signBlock([
      { label: 'Dibuat oleh', name: writeoff.dibuat_oleh || '' },
      { label: 'Disaksikan oleh', name: writeoff.disaksikan_oleh || '' },
      { label: 'Dimusnahkan oleh', name: writeoff.dimusnahkan_oleh || '' },
      ...extraSigners(sig, 'stocktake')
    ])}
  `);
}

export function printRko(rows, company, year) {
  const total = rows.reduce((s, r) => s + r.saranOrder * r.hargaSatuan, 0);
  openPrint(`RKO ${year}`, `
    ${letterhead(company, `RENCANA KEBUTUHAN OBAT (RKO) — TAHUN ${year}`)}
    <table class="report-table">
      <thead><tr><th>Nama Obat</th><th>Satuan</th><th>Rata2 Pemakaian/Bulan</th><th>Stok Minimal</th><th>Stok Maksimal</th><th>Stok Aktual</th><th>Jumlah Order</th><th>Harga Satuan</th><th>Total</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${escapeHtml(r.nama)}</td><td>${escapeHtml(r.satuan)}</td>
        <td>${r.rataRata.toFixed(1)}</td><td>${Math.round(r.stokMinimal)}</td><td>${Math.round(r.stokMaksimal)}</td>
        <td>${r.stokAktual}</td><td><b>${r.saranOrder}</b></td>
        <td>Rp ${r.hargaSatuan.toLocaleString('id-ID')}</td><td>Rp ${(r.saranOrder * r.hargaSatuan).toLocaleString('id-ID')}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="8" style="text-align:right;font-weight:700">Total Estimasi Biaya</td><td style="font-weight:700">Rp ${total.toLocaleString('id-ID')}</td></tr></tfoot>
    </table>
    ${signBlock([
      { label: 'Dibuat oleh (Apoteker/Petugas)', name: '' },
      { label: 'Diketahui oleh (Dokter)', name: '' }
    ])}
  `);
}

const RESEP_STYLE = `
  body{font-family:'Times New Roman',Times,serif;padding:40px;color:#111}
  .resep-head{text-align:center;font-weight:700;line-height:1.5}
  .resep-head .name{font-size:1.15rem}
  .resep-rule{border:none;border-top:2px solid #111;margin:14px 0 22px}
  .resep-date{text-align:right;margin-bottom:22px}
  .resep-rx{font-size:2rem;font-style:italic;font-family:Georgia,serif;margin-bottom:18px}
  .resep-lines{min-height:280px;font-size:1.02rem;line-height:2.2}
  .resep-line b{display:inline-block;min-width:26px}
  .resep-foot{margin-top:30px;font-size:.98rem}
  .resep-foot .row{display:flex;gap:8px;margin-bottom:6px}
  .resep-foot .row span:first-child{width:60px}
  .resep-warn{text-align:center;font-weight:700;margin-top:26px}
`;

// Matches the klinik's own resep pad layout (dokter identity block, ruled
// line, R/ symbol, prescription lines, Pro/Umur footer, the standard
// "Obat jangan diganti tanpa ijin dokter" notice) — auto-printed right
// after a SOAP visit that dispenses medication, so no one has to
// hand-write a resep for something the system already just recorded.
export function printResep(patient, dokter, obatLines) {
  const win = window.open('', '_blank');
  const tanggal = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  win.document.write(`<html><head><title>Resep - ${escapeHtml(patient?.nama || '')}</title><style>${RESEP_STYLE}</style></head><body>
    <div class="resep-head">
      <div class="name">dr. ${escapeHtml(dokter.nama || '..........................')}</div>
      <div>Praktik Mandiri</div>
      <div>SIP : ${escapeHtml(dokter.sip || '..........................')}</div>
      <div>${escapeHtml(dokter.alamat || '')}</div>
    </div>
    <hr class="resep-rule">
    <div class="resep-date">${escapeHtml(dokter.kota || '..........................')}, ${tanggal}</div>
    <div class="resep-rx">R/</div>
    <div class="resep-lines">
      ${obatLines.map(o => `<div class="resep-line">${escapeHtml(o.nama)} <b>No. ${o.qty}</b></div>`).join('') || ''}
    </div>
    <div class="resep-foot">
      <div class="row"><span>Pro</span><span>: ${escapeHtml(patient?.nama || '')}</span></div>
      <div class="row"><span>Umur</span><span>: ${patient ? fmtAge(patient.tgl_lahir) : ''}</span></div>
    </div>
    <div class="resep-warn">Obat jangan diganti tanpa ijin dokter</div>
    <script>window.print()</script>
  </body></html>`);
  win.document.close();
}
