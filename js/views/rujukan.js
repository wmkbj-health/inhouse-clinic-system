import * as api from '../api.js';
import { escapeHtml, fmtDate, toast, openModal, mountPatientPicker, todayStr } from '../util.js';
import { printReferral } from '../print.js';

export async function renderRujukan(root) {
  root.innerHTML = `
    <div class="view-head">
      <div><h1>Rujukan</h1><p class="desc">Surat rujukan pasien ke fasilitas kesehatan lain</p></div>
      <button class="btn btn-primary" id="btnNew">+ Buat Rujukan</button>
    </div>
    <div class="panel">
      <h2>Riwayat Rujukan <span class="muted" id="count"></span></h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Tanggal</th><th>No. RM</th><th>Nama Pasien</th><th>Faskes Tujuan</th><th>Diagnosa</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </div>
  `;

  const referrals = await api.listReferrals();
  root.querySelector('#count').textContent = `(${referrals.length})`;

  const rows = root.querySelector('#rows');
  if (!referrals.length) {
    rows.innerHTML = `<tr><td colspan="6" class="empty">Belum ada data rujukan.</td></tr>`;
  } else {
    rows.innerHTML = referrals.map(r => `<tr>
        <td>${fmtDate(r.tanggal)}</td>
        <td>${escapeHtml(r.patients?.no_rm || '-')}</td>
        <td>${escapeHtml(r.patients?.nama || '(pasien dihapus)')}</td>
        <td>${escapeHtml(r.faskes_tujuan)}</td>
        <td>${escapeHtml(r.diagnosa)}</td>
        <td><button class="btn btn-sm btn-outline" data-print="${r.id}">Cetak</button></td>
      </tr>`).join('');
    rows.querySelectorAll('[data-print]').forEach(btn => btn.addEventListener('click', async () => {
      const r = referrals.find(x => x.id === btn.dataset.print);
      const patient = await api.getPatient(r.patient_id);
      const sig = await api.getPrintSignatures(r.company_id);
      printReferral(r, patient, patient.companies, sig);
    }));
  }

  root.querySelector('#btnNew').addEventListener('click', () => openReferralModal(() => renderRujukan(root)));
}

async function openReferralModal(onDone) {
  const patients = await api.listPatients();
  let pickedPatient = null;
  openModal('Buat Surat Rujukan', `
    <form id="refForm">
      <div class="field full"><label>Pasien *</label><div id="patPicker"></div></div>
      <div class="grid cols-2" style="margin-top:12px">
        <div class="field"><label>Tanggal *</label><input type="date" name="tanggal" value="${todayStr()}" required></div>
        <div class="field"><label>Faskes Tujuan *</label><input name="faskesTujuan" placeholder="mis. RS Umum Daerah..." required></div>
      </div>
      <div class="field full"><label>Diagnosa / Keluhan *</label><input name="diagnosa" required></div>
      <div class="field full"><label>Alasan Rujukan / Catatan Klinis</label><textarea name="alasanRujukan"></textarea></div>
      <div class="field full"><label>Dokter Perujuk</label><input name="dokterPerujuk"></div>
      <div class="field full" style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">
        <button type="button" class="btn btn-outline" id="cancelBtn">Batal</button>
        <button type="submit" class="btn btn-primary">Simpan Rujukan</button>
      </div>
    </form>
  `, {
    onMount: (body, close) => {
      mountPatientPicker(body.querySelector('#patPicker'), patients, p => { pickedPatient = p; });
      body.querySelector('#cancelBtn').addEventListener('click', close);
      body.querySelector('#refForm').addEventListener('submit', async e => {
        e.preventDefault();
        if (!pickedPatient) { toast('Pilih pasien terlebih dahulu', 'err'); return; }
        const fd = new FormData(e.target);
        try {
          await api.createReferral({
            company_id: pickedPatient.company_id, patient_id: pickedPatient.id, tanggal: fd.get('tanggal'),
            faskes_tujuan: fd.get('faskesTujuan').trim(), diagnosa: fd.get('diagnosa').trim(),
            alasan_rujukan: fd.get('alasanRujukan').trim(), dokter_perujuk: fd.get('dokterPerujuk').trim()
          });
          toast('Rujukan tersimpan');
          close();
          onDone();
        } catch (err) {
          toast(err.message || 'Gagal menyimpan rujukan', 'err');
        }
      });
    }
  });
}
