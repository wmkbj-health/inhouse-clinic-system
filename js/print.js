import { escapeHtml, fmtDate } from './util.js';
import { fmtAge } from './state.js';

const BASE_STYLE = `
  body{font-family:Arial,sans-serif;padding:32px;color:#111}
  h2{text-align:center;margin-bottom:2px}
  .center{text-align:center;color:#555;margin-bottom:20px;font-size:.85rem}
  table{width:100%;border-collapse:collapse;margin:14px 0}
  td,th{padding:6px 4px;vertical-align:top;font-size:.9rem}
  .label{width:190px;font-weight:600}
  .sign{margin-top:50px;display:flex;justify-content:flex-end}
  .sign div{text-align:center;font-size:.9rem}
  .report-table th,.report-table td{border:1px solid #999;padding:5px 7px;font-size:.8rem}
  .report-table{border-collapse:collapse}
  .box{border:1px solid #999;padding:10px;border-radius:6px;margin:10px 0}
  .checkline{display:flex;gap:20px;margin:14px 0}
  .checkline label{display:flex;align-items:center;gap:6px;font-size:.9rem}
`;

function openPrint(title, bodyHtml) {
  const win = window.open('', '_blank');
  win.document.write(`<html><head><title>${escapeHtml(title)}</title><style>${BASE_STYLE}</style></head><body>${bodyHtml}<script>window.print()</script></body></html>`);
  win.document.close();
}

function letterhead(company, subtitle) {
  return `<h2>${escapeHtml(company?.name || 'Inhouse Clinic System')}</h2><div class="center">${escapeHtml(subtitle)}</div>`;
}

export function printReferral(r, patient, company) {
  openPrint(`Surat Rujukan - ${patient?.nama || ''}`, `
    ${letterhead(company, 'SURAT RUJUKAN')}
    <table>
      <tr><td class="label">Nomor</td><td>: RJK-${r.id.slice(0, 8).toUpperCase()}/${new Date(r.created_at).getFullYear()}</td></tr>
      <tr><td class="label">Tanggal</td><td>: ${fmtDate(r.tanggal)}</td></tr>
      <tr><td class="label">Kepada Yth.</td><td>: ${escapeHtml(r.faskes_tujuan)}</td></tr>
    </table>
    <p>Dengan hormat, mohon pemeriksaan dan penanganan lebih lanjut terhadap pasien berikut:</p>
    <table>
      <tr><td class="label">Nama Pasien</td><td>: ${escapeHtml(patient?.nama || '-')}</td></tr>
      <tr><td class="label">No. RM / NIK</td><td>: ${escapeHtml(patient?.no_rm || '-')} / ${escapeHtml(patient?.nik || '-')}</td></tr>
      <tr><td class="label">Tanggal Lahir / Usia</td><td>: ${fmtDate(patient?.tgl_lahir)} (${fmtAge(patient?.tgl_lahir)})</td></tr>
      <tr><td class="label">Jenis Kelamin</td><td>: ${patient?.jenis_kelamin === 'L' ? 'Laki-laki' : 'Perempuan'}</td></tr>
      <tr><td class="label">Departemen / Jabatan</td><td>: ${escapeHtml(patient?.departemen || '-')} / ${escapeHtml(patient?.jabatan || '-')}</td></tr>
      <tr><td class="label">Diagnosa / Keluhan</td><td>: ${escapeHtml(r.diagnosa)}</td></tr>
      <tr><td class="label">Alasan Rujukan</td><td>: ${escapeHtml(r.alasan_rujukan || '-')}</td></tr>
    </table>
    <p>Demikian surat rujukan ini dibuat untuk dapat ditindaklanjuti. Atas kerjasamanya kami ucapkan terima kasih.</p>
    <div class="sign"><div>Dokter Perujuk,<br><br><br><br>${escapeHtml(r.dokter_perujuk || '(...........................)')}</div></div>
  `);
}

export function printSickNote(n, patient, company) {
  openPrint(`Surat Keterangan Sakit - ${patient?.nama || ''}`, `
    ${letterhead(company, 'SURAT KETERANGAN SAKIT')}
    <p style="text-align:center">Nomor: ${escapeHtml(n.nomor_surat)}</p>
    <p>Yang bertanda tangan di bawah ini, dokter/petugas pemeriksa pada klinik ${escapeHtml(company?.name || '')}, menerangkan bahwa:</p>
    <table>
      <tr><td class="label">Nama</td><td>: ${escapeHtml(patient?.nama || '-')}</td></tr>
      <tr><td class="label">No. RM / NIK</td><td>: ${escapeHtml(patient?.no_rm || '-')} / ${escapeHtml(patient?.nik || '-')}</td></tr>
      <tr><td class="label">Departemen / Jabatan</td><td>: ${escapeHtml(patient?.departemen || '-')} / ${escapeHtml(patient?.jabatan || '-')}</td></tr>
      <tr><td class="label">Diagnosa</td><td>: ${escapeHtml(n.diagnosa || '-')}</td></tr>
    </table>
    <p>Berdasarkan hasil pemeriksaan, yang bersangkutan dinyatakan perlu istirahat / tidak dapat bekerja selama:</p>
    <p style="text-align:center;font-weight:700;margin:14px 0">${fmtDate(n.tanggal_mulai)} sampai dengan ${fmtDate(n.tanggal_selesai)}</p>
    ${n.catatan ? `<p>Catatan: ${escapeHtml(n.catatan)}</p>` : ''}
    <p>Demikian surat keterangan ini dibuat dengan sebenarnya untuk dapat dipergunakan sebagaimana mestinya.</p>
    <div class="sign"><div>Dokter Pemeriksa,<br><br><br><br>${escapeHtml(n.dokter || '(...........................)')}</div></div>
  `);
}

export function printPatientCard(patient, company) {
  openPrint(`Kartu Pasien - ${patient.nama}`, `
    <div style="max-width:400px;margin:0 auto;border:2px solid #1565c0;border-radius:12px;padding:18px">
      <div style="text-align:center;font-weight:700;color:#1565c0">${escapeHtml(company?.name || '')}</div>
      <div style="text-align:center;font-size:.8rem;color:#555;margin-bottom:12px">KARTU BEROBAT PASIEN</div>
      <table>
        <tr><td class="label" style="width:120px">Nama</td><td>: ${escapeHtml(patient.nama)}</td></tr>
        <tr><td class="label">No. RM / NIK</td><td>: ${escapeHtml(patient.no_rm)} / ${escapeHtml(patient.nik || '-')}</td></tr>
        <tr><td class="label">Jenis Kelamin</td><td>: ${patient.jenis_kelamin === 'L' ? 'Laki-laki' : 'Perempuan'}</td></tr>
        <tr><td class="label">Tanggal Lahir</td><td>: ${fmtDate(patient.tgl_lahir)}</td></tr>
        <tr><td class="label">Departemen</td><td>: ${escapeHtml(patient.departemen || '-')}</td></tr>
        <tr><td class="label">Jabatan</td><td>: ${escapeHtml(patient.jabatan || '-')}</td></tr>
        <tr><td class="label">Asal PT / Lokasi Kerja</td><td>: ${escapeHtml(patient.nama_pt_mitra || company?.name || '-')} / ${escapeHtml(patient.lokasi_kerja || patient.tempat_tinggal || '-')}</td></tr>
      </table>
    </div>
  `);
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
    <div class="sign"><div>Dokter Perusahaan,<br><br><br><br>${escapeHtml(payload.dokter || '(...........................)')}</div></div>
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

export function printMedicalConsentForm(patient, company, type) {
  const isConsent = type === 'persetujuan';
  openPrint(`Form ${isConsent ? 'Persetujuan' : 'Penolakan'} Tindakan Medis`, `
    ${letterhead(company, `FORM ${isConsent ? 'PERSETUJUAN' : 'PENOLAKAN'} TINDAKAN MEDIS`)}
    <table>
      <tr><td class="label">Nama Pasien</td><td>: ${escapeHtml(patient?.nama || '..........................')}</td></tr>
      <tr><td class="label">No. RM / NIK</td><td>: ${escapeHtml(patient?.no_rm || '-')} / ${escapeHtml(patient?.nik || '-')}</td></tr>
      <tr><td class="label">Umur</td><td>: ${patient ? fmtAge(patient.tgl_lahir) : '..........................'}</td></tr>
    </table>
    <p style="margin-top:10px">Saya yang bertanda tangan di bawah ini menyatakan telah mendapatkan penjelasan yang cukup dari petugas medis mengenai tindakan/prosedur medis yang akan/tidak akan dilakukan, termasuk tujuan, manfaat, risiko, dan alternatif yang tersedia, dan dengan ini menyatakan:</p>
    <div class="box"><b>${isConsent ? 'MENYETUJUI' : 'MENOLAK'}</b> untuk dilakukan tindakan medis: <br><br>..........................................................................................</div>
    <div class="checkline" style="margin-top:40px">
      <div style="text-align:center;flex:1">Pasien / Wali,<br><br><br><br>(...........................)</div>
      <div style="text-align:center;flex:1">Saksi,<br><br><br><br>(...........................)</div>
      <div style="text-align:center;flex:1">Petugas Medis,<br><br><br><br>(...........................)</div>
    </div>
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
    <h3 style="margin-top:20px">Top 5 Penyakit</h3>
    <table class="report-table"><thead><tr><th>Kode</th><th>Penyakit</th><th>Jumlah</th></tr></thead>
      <tbody>${kpis.topDiseases.map(d => `<tr><td>${escapeHtml(d.kode)}</td><td>${escapeHtml(d.penyakit)}</td><td>${d.jumlah}</td></tr>`).join('')}</tbody></table>
    <h3 style="margin-top:20px">Top 5 Penggunaan Obat</h3>
    <table class="report-table"><thead><tr><th>Obat</th><th>Jumlah</th></tr></thead>
      <tbody>${kpis.topDrugs.map(d => `<tr><td>${escapeHtml(d.nama)}</td><td>${d.jumlah}</td></tr>`).join('')}</tbody></table>
  `);
}

export function printStocktake(drugs, company, periodLabel) {
  openPrint('Stocktake Obat & Alkes', `
    ${letterhead(company, `STOCKTAKE OBAT & ALKES — ${escapeHtml(periodLabel)}`)}
    <table class="report-table">
      <thead><tr><th>Kode</th><th>Nama</th><th>Jenis</th><th>Stok</th><th>Exp. Terdekat</th><th>Status</th></tr></thead>
      <tbody>
        ${drugs.map(d => `<tr>
          <td>${escapeHtml(d.kode)}</td><td>${escapeHtml(d.nama)}</td><td>${escapeHtml(d.jenis)}</td>
          <td>${d.stok} ${escapeHtml(d.satuan)}</td><td>${d.nextExpiry ? fmtDate(d.nextExpiry) : '-'}</td>
          <td>${d.stok <= d.stok_minimum ? 'PERLU PESAN ULANG' : 'AMAN'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  `);
}
