import * as api from '../api.js';
import { escapeHtml, fmtDate, toast, openModal, mountPatientPicker, todayStr } from '../util.js';
import { printSickNote } from '../print.js';

export async function renderSuratSakit(root) {
  root.innerHTML = `
    <div class="view-head">
      <div><h1>Surat Keterangan Sakit</h1><p class="desc">Penerbitan dan riwayat surat keterangan istirahat sakit pasien</p></div>
      <button class="btn btn-primary" id="btnNew">+ Buat Surat</button>
    </div>
    <div class="panel">
      <h2>Riwayat Surat <span class="muted" id="count"></span></h2>
      <div class="table-wrap"><table>
        <thead><tr><th>No. Surat</th><th>Tanggal</th><th>Nama Pasien</th><th>Istirahat</th><th>Diagnosa</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </div>
  `;

  const notes = await api.listSickNotes();
  root.querySelector('#count').textContent = `(${notes.length})`;

  const rows = root.querySelector('#rows');
  if (!notes.length) {
    rows.innerHTML = `<tr><td colspan="6" class="empty">Belum ada surat keterangan sakit.</td></tr>`;
  } else {
    rows.innerHTML = notes.map(n => `<tr>
        <td>${escapeHtml(n.nomor_surat)}</td>
        <td>${fmtDate(n.tanggal)}</td>
        <td>${escapeHtml(n.patients?.nama || '(pasien dihapus)')}</td>
        <td>${fmtDate(n.tanggal_mulai)} s/d ${fmtDate(n.tanggal_selesai)}</td>
        <td>${escapeHtml(n.diagnosa || '-')}</td>
        <td><button class="btn btn-sm btn-outline" data-print="${n.id}">Cetak</button></td>
      </tr>`).join('');
    rows.querySelectorAll('[data-print]').forEach(btn => btn.addEventListener('click', async () => {
      const n = notes.find(x => x.id === btn.dataset.print);
      const patient = await api.getPatient(n.patient_id);
      printSickNote(n, patient, patient.companies);
    }));
  }

  root.querySelector('#btnNew').addEventListener('click', () => openSickNoteModal(() => renderSuratSakit(root)));
}

async function openSickNoteModal(onDone) {
  const patients = await api.listPatients();
  let pickedPatient = null;
  openModal('Buat Surat Keterangan Sakit', `
    <form id="snForm">
      <div class="field full"><label>Pasien *</label><div id="patPicker"></div></div>
      <div class="grid cols-2" style="margin-top:12px">
        <div class="field"><label>Tanggal Surat *</label><input type="date" name="tanggal" value="${todayStr()}" required></div>
        <div class="field"><label>Diagnosa *</label><input name="diagnosa" required></div>
        <div class="field"><label>Mulai Istirahat *</label><input type="date" name="tanggalMulai" value="${todayStr()}" required></div>
        <div class="field"><label>Sampai Tanggal *</label><input type="date" name="tanggalSelesai" value="${todayStr()}" required></div>
      </div>
      <div class="field full"><label>Catatan Tambahan</label><textarea name="catatan"></textarea></div>
      <div class="field full"><label>Dokter Pemeriksa</label><input name="dokter"></div>
      <div class="field full" style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">
        <button type="button" class="btn btn-outline" id="cancelBtn">Batal</button>
        <button type="submit" class="btn btn-primary">Simpan Surat</button>
      </div>
    </form>
  `, {
    onMount: (body, close) => {
      mountPatientPicker(body.querySelector('#patPicker'), patients, p => { pickedPatient = p; });
      body.querySelector('#cancelBtn').addEventListener('click', close);
      body.querySelector('#snForm').addEventListener('submit', async e => {
        e.preventDefault();
        if (!pickedPatient) { toast('Pilih pasien terlebih dahulu', 'err'); return; }
        const fd = new FormData(e.target);
        if (fd.get('tanggalSelesai') < fd.get('tanggalMulai')) { toast('Tanggal selesai tidak boleh sebelum tanggal mulai', 'err'); return; }
        try {
          const nomorSurat = await api.nextNomorSurat(pickedPatient.company_id, 'SKS');
          await api.createSickNote({
            company_id: pickedPatient.company_id, patient_id: pickedPatient.id, nomor_surat: nomorSurat,
            tanggal: fd.get('tanggal'), diagnosa: fd.get('diagnosa').trim(), tanggal_mulai: fd.get('tanggalMulai'),
            tanggal_selesai: fd.get('tanggalSelesai'), catatan: fd.get('catatan').trim(), dokter: fd.get('dokter').trim()
          });
          toast('Surat keterangan sakit tersimpan');
          close();
          onDone();
        } catch (err) {
          toast(err.message || 'Gagal menyimpan surat', 'err');
        }
      });
    }
  });
}
