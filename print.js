import { escapeHtml, fmtDate } from './util.js';
import { fmtAge, companyLogoUrl } from './state.js';

const BASE_STYLE = `
  body{font-family:Arial,sans-serif;padding:32px;color:#111}
  h2{text-align:center;margin-bottom:2px}
  .center{text-align:center;color:#555;margin-bottom:20px;font-size:.85rem}
  .head{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:4px}
  .head img{height:52px;width:auto;object-fit:contain}
  table{width:100%;border-collapse:collapse;margin:14px 0}
  td,th{padding:6px 4px;vertical-align:top;font-size:.9rem}
  .label{width:190px;font-weight:600}
  .sign{margin-top:50px;display:flex;justify-content:space-around;gap:20px}
  .sign div{text-align:center;font-size:.9rem}
  .sign .line{margin-top:55px;border-top:1px solid #333;padding-top:4px;min-width:160px}
  .report-table th,.report-table td{border:1px solid #999;padding:5px 7px;font-size:.8rem}
  .report-table{border-collapse:collapse}
  .box{border:1px solid #999;padding:10px;border-radius:6px;margin:10px 0}
  .checkline{display:flex;gap:20px;margin:14px 0}
  .checkline label{display:flex;align-items:center;gap:6px;font-size:.9rem}
  .tembusan{margin-top:30px;font-size:.8rem;color:#333}
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

// Extra custom signature columns configured per-PT (Apotek > Nama Tanda Tangan),
// appended after each document's own primary signer(s) so users control the
// count/labels/names of signature columns freely.
function extraSigners(sig) {
  return (sig?.signatures || []).filter(s => s.label || s.nama).map(s => ({ label: s.label || 'Tanda Tangan', name: s.nama || '' }));
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
    ${signBlock([{ label: 'Dokter Perujuk', name: r.dokter_perujuk || '' }, ...extraSigners(sig)])}
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
    ${signBlock([{ label: 'Dokter Pemeriksa', name: n.dokter || '' }, ...extraSigners(sig)])}
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
      ...extraSigners(sig)
    ])}
  `);
}

export function printDashboardReport(company, kpis, periodLabel) {
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
    <h3 style="margin-top:20px">Top Five Disease</h3>
    <table class="report-table"><thead><tr><th>Kode</th><th>Penyakit</th><th>Jumlah</th></tr></thead>
      <tbody>${kpis.topDiseases.map(d => `<tr><td>${escapeHtml(d.kode)}</td><td>${escapeHtml(d.penyakit)}</td><td>${d.jumlah}</td></tr>`).join('')}</tbody></table>
    <h3 style="margin-top:20px">Top 10 Medicine</h3>
    <table class="report-table"><thead><tr><th>Obat</th><th>Jumlah</th></tr></thead>
      <tbody>${kpis.topDrugs.map(d => `<tr><td>${escapeHtml(d.nama)}</td><td>${d.jumlah}</td></tr>`).join('')}</tbody></table>
  `);
}

export function printStocktake(drugs, company, periodLabel, jenisLabel, sig = {}) {
  openPrint(`Stocktake ${jenisLabel}`, `
    ${letterhead(company, `STOCKTAKE ${escapeHtml(jenisLabel.toUpperCase())} — ${escapeHtml(periodLabel)}`)}
    <table class="report-table">
      <thead><tr><th>Kode</th><th>Nama</th><th>Nama Paten</th><th>Stok Awal</th><th>Penerimaan</th><th>Pemakaian</th><th>Rata2/Hari</th><th>Stok Akhir</th><th>Exp. Terdekat</th><th>Status</th></tr></thead>
      <tbody>
        ${drugs.map(d => `<tr>
          <td>${escapeHtml(d.kode)}</td><td>${escapeHtml(d.nama)}</td><td>${escapeHtml(d.nama_paten || '-')}</td>
          <td>${d.stokAwal ?? '-'}</td><td>${d.penerimaan ?? 0}</td><td>${d.pemakaian ?? 0}</td><td>${(d.rataRata ?? 0).toFixed(2)}</td>
          <td>${d.stok} ${escapeHtml(d.satuan)}</td><td>${d.nextExpiry ? fmtDate(d.nextExpiry) : '-'}</td>
          <td>${d.stok <= d.stok_minimum ? 'PERLU PESAN ULANG' : 'AMAN'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${signBlock(extraSigners(sig).length ? extraSigners(sig) : [
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
      ...extraSigners(sig)
    ])}
  `);
}
