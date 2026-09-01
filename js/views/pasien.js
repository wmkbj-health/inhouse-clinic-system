import * as api from '../api.js';
import { el, escapeHtml, fmtDate, toast, openModal, debounce, confirmDialog, todayStr } from '../util.js';
import { getCompanies, getCompanyById, getSelectedCompanyId, isAllCompanies, getDiseaseCodes, fmtAge } from '../state.js';
import { printPatientCard, printMedicalConsentForm } from '../print.js';
import { hasRole } from '../auth.js';
import { VITAL_FIELDS, evaluateVitals, CHRONIC_DISEASE_OPTIONS } from '../clinical.js';

const STATUS_LABEL = { menunggu: 'Menunggu', diperiksa: 'Diperiksa', selesai: 'Selesai' };
const STATUS_BADGE = { menunggu: 'badge-warn', diperiksa: 'badge-info', selesai: 'badge-ok' };
const STATUS_PEGAWAI_LABEL = { karyawan_tetap: 'Karyawan Tetap', karyawan_kontrak: 'Karyawan Kontrak', mitra_kerja: 'Mitra Kerja', masyarakat: 'Masyarakat/Umum' };

export async function renderPasien(root) {
  root.innerHTML = `
    <div class="view-head">
      <div><h1>Pasien</h1><p class="desc">Antrian, pendaftaran, dan pemeriksaan pasien (SOAP)</p></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline" id="tabQueueBtn">Antrian</button>
        <button class="btn btn-outline" id="tabListBtn">Daftar Pasien</button>
        <button class="btn btn-primary" id="btnNewPatient">+ Pasien Baru</button>
      </div>
    </div>
    <div id="tabBody"></div>
  `;

  let activeTab = 'queue';
  const tabBody = root.querySelector('#tabBody');
  const queueBtn = root.querySelector('#tabQueueBtn');
  const listBtn = root.querySelector('#tabListBtn');

  function setActive(tab) {
    activeTab = tab;
    queueBtn.classList.toggle('btn-primary', tab === 'queue');
    queueBtn.classList.toggle('btn-outline', tab !== 'queue');
    listBtn.classList.toggle('btn-primary', tab === 'list');
    listBtn.classList.toggle('btn-outline', tab !== 'list');
    if (tab === 'queue') renderQueueTab(tabBody);
    else renderPatientListTab(tabBody);
  }

  queueBtn.addEventListener('click', () => setActive('queue'));
  listBtn.addEventListener('click', () => setActive('list'));
  root.querySelector('#btnNewPatient').addEventListener('click', () => openNewPatientModal(() => setActive('queue')));

  setActive('queue');
}

async function renderQueueTab(container) {
  container.innerHTML = `<div class="panel"><h2>Antrian Hari Ini <span class="muted" id="queueCount"></span></h2><div id="queueList"></div></div>`;
  const list = container.querySelector('#queueList');
  const all = await api.listQueueToday();
  container.querySelector('#queueCount').textContent = `(${all.length})`;

  if (!all.length) {
    list.innerHTML = `<div class="empty">Belum ada antrian hari ini. Klik "+ Pasien Baru" untuk mendaftarkan pasien.</div>`;
    return;
  }

  list.innerHTML = '';
  all.forEach((q, i) => {
    const row = el(`
      <div class="list-row">
        <div class="no">${i + 1}</div>
        <div class="main">
          <div class="name">${escapeHtml(q.patients?.nama || '')} <span class="badge badge-muted">${escapeHtml(q.patients?.no_rm || '')}</span></div>
          <div class="meta">${escapeHtml(q.poli || 'Poli Umum')} • ${escapeHtml(q.keluhan || '-')}</div>
        </div>
        <span class="badge ${STATUS_BADGE[q.status]}">${STATUS_LABEL[q.status]}</span>
        <div style="display:flex;gap:6px">
          ${q.status !== 'selesai' ? `<button class="btn btn-sm btn-primary" data-action="periksa">Periksa</button>` : `<button class="btn btn-sm btn-outline" data-action="lihat">Lihat</button>`}
          <button class="btn btn-sm btn-outline" data-action="hapus">Hapus</button>
        </div>
      </div>`);
    row.querySelector('[data-action="periksa"]')?.addEventListener('click', async () => {
      await api.updateQueueStatus(q.id, 'diperiksa');
      openSoapModal(q, () => renderQueueTab(container));
    });
    row.querySelector('[data-action="lihat"]')?.addEventListener('click', () => toast('Pemeriksaan sudah selesai. Lihat riwayat di Daftar Pasien.'));
    row.querySelector('[data-action="hapus"]')?.addEventListener('click', async () => {
      if (!confirmDialog(`Hapus antrian ${q.patients?.nama}?`)) return;
      await api.deleteQueueItem(q.id);
      renderQueueTab(container);
    });
    list.appendChild(row);
  });
}

async function renderPatientListTab(container) {
  container.innerHTML = `
    <div class="panel">
      <h2>Daftar Pasien <span class="muted" id="patCount"></span></h2>
      <div class="field" style="max-width:320px;margin-bottom:12px"><input type="text" id="patSearch" placeholder="Cari nama / No. RM / NIK..."></div>
      <div class="table-wrap"><table>
        <thead><tr><th>No. RM</th><th>Nama</th><th>Usia</th><th>JK</th><th>Departemen</th><th>Status Pegawai</th><th>PT</th><th></th></tr></thead>
        <tbody id="patRows"></tbody>
      </table></div>
    </div>`;
  const rows = container.querySelector('#patRows');

  async function draw(search) {
    const list = await api.listPatients(search);
    container.querySelector('#patCount').textContent = `(${list.length})`;
    if (!list.length) { rows.innerHTML = `<tr><td colspan="8" class="empty">Tidak ada pasien.</td></tr>`; return; }
    rows.innerHTML = list.map(p => `
      <tr data-detail="${p.id}" style="cursor:pointer">
        <td>${escapeHtml(p.no_rm)}</td>
        <td>${escapeHtml(p.nama)}</td>
        <td>${fmtAge(p.tgl_lahir)}</td>
        <td>${p.jenis_kelamin}</td>
        <td>${escapeHtml(p.departemen || '-')}</td>
        <td><span class="badge badge-info">${STATUS_PEGAWAI_LABEL[p.status_pegawai] || p.status_pegawai}</span></td>
        <td>${escapeHtml(p.companies?.code || '-')}</td>
        <td style="display:flex;gap:6px">
          <button class="btn btn-sm btn-outline" data-daftar="${p.id}">Antrian</button>
        </td>
      </tr>`).join('');

    rows.querySelectorAll('tr[data-detail]').forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      const p = list.find(x => x.id === tr.dataset.detail);
      openPatientDetailModal(p, () => draw(container.querySelector('#patSearch').value.trim()));
    }));
    rows.querySelectorAll('[data-daftar]').forEach(btn => btn.addEventListener('click', async e => {
      e.stopPropagation();
      const p = list.find(x => x.id === btn.dataset.daftar);
      const q = await api.addToQueue(p.company_id, p, '', p.status_pegawai === 'mitra_kerja' ? 'Poli Kecelakaan Kerja / Umum' : 'Poli Umum');
      const posisi = await api.queuePositionToday(p.company_id, q.id);
      toast(`${p.nama} masuk antrian — Nomor Antrian: ${posisi}`);
    }));
  }
  draw();

  container.querySelector('#patSearch').addEventListener('input', debounce(e => draw(e.target.value.trim()), 250));
}

function openPatientDetailModal(patient, onChange) {
  openModal(`Detail Pasien: ${patient.nama}`, `
    <div class="grid cols-2" style="margin-bottom:14px">
      <div><b>No. RM</b><div>${escapeHtml(patient.no_rm)}</div></div>
      <div><b>NIK</b><div>${escapeHtml(patient.nik || '-')}</div></div>
      <div><b>Usia</b><div>${fmtAge(patient.tgl_lahir)} (${fmtDate(patient.tgl_lahir)})</div></div>
      <div><b>Jenis Kelamin</b><div>${patient.jenis_kelamin === 'L' ? 'Laki-laki' : 'Perempuan'}</div></div>
      <div><b>Jabatan</b><div>${escapeHtml(patient.jabatan || '-')}</div></div>
      <div><b>Departemen</b><div>${escapeHtml(patient.departemen || '-')}</div></div>
      <div><b>Status Pegawai</b><div>${STATUS_PEGAWAI_LABEL[patient.status_pegawai] || patient.status_pegawai}</div></div>
      <div><b>PT</b><div>${escapeHtml(patient.companies?.name || '-')}</div></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      <button class="btn btn-sm btn-primary" id="btnDaftarAntrian">+ Antrian</button>
      <button class="btn btn-sm btn-outline" id="btnCetakKartu">Cetak Kartu</button>
      <button class="btn btn-sm btn-outline" id="btnEditPasien">Edit</button>
      <button class="btn btn-sm btn-outline" id="btnConsent">Persetujuan/Penolakan Medis</button>
      <button class="btn btn-sm btn-danger" id="btnHapusPasien">Hapus</button>
    </div>
    <h2 style="font-size:.95rem;margin-bottom:8px">Riwayat Kunjungan</h2>
    <div class="table-wrap" id="visitHistory"><div class="empty">Memuat...</div></div>
  `, {
    onMount: async (body, close) => {
      body.querySelector('#btnDaftarAntrian').addEventListener('click', async () => {
        const q = await api.addToQueue(patient.company_id, patient, '', patient.status_pegawai === 'mitra_kerja' ? 'Poli Kecelakaan Kerja / Umum' : 'Poli Umum');
        const posisi = await api.queuePositionToday(patient.company_id, q.id);
        toast(`${patient.nama} masuk antrian — Nomor Antrian: ${posisi}`);
      });
      body.querySelector('#btnCetakKartu').addEventListener('click', () => printPatientCard(patient, patient.companies));
      body.querySelector('#btnEditPasien').addEventListener('click', () => { close(); openEditPatientModal(patient, onChange); });
      body.querySelector('#btnConsent').addEventListener('click', () => { close(); openConsentModal(patient); });
      body.querySelector('#btnHapusPasien').addEventListener('click', async () => {
        if (!confirmDialog(`Hapus data pasien ${patient.nama}? Tindakan ini permanen.`)) return;
        try {
          await api.deletePatient(patient.id);
          toast('Data pasien dihapus');
          close();
          onChange();
        } catch (err) {
          toast(err.message || 'Gagal menghapus pasien', 'err');
        }
      });

      const visits = await api.getVisitsByPatient(patient.id);
      const histEl = body.querySelector('#visitHistory');
      histEl.innerHTML = visits.length ? `<table>
        <thead><tr><th>Tanggal</th><th>Jenis</th><th>Diagnosa</th><th>Disposisi</th><th>Biaya</th></tr></thead>
        <tbody>${visits.map(v => `<tr>
          <td>${fmtDate(v.tanggal)}</td><td>${escapeHtml(v.jenis_kunjungan)}</td>
          <td>${(v.diagnosa || []).map(d => escapeHtml(d.code)).join(', ') || '-'}</td>
          <td>${escapeHtml(v.disposisi)}</td><td>Rp ${Number(v.biaya_total || 0).toLocaleString('id-ID')}</td>
        </tr>`).join('')}</tbody></table>` : `<div class="empty">Belum ada riwayat kunjungan.</div>`;
    }
  });
}

function openEditPatientModal(patient, onDone) {
  openModal('Edit Data Pasien', `
    <form id="editPatientForm" class="form-grid">
      <div class="field"><label>Nama Lengkap *</label><input name="nama" value="${escapeHtml(patient.nama)}" required></div>
      <div class="field"><label>NIK</label><input name="nik" maxlength="16" value="${escapeHtml(patient.nik || '')}"></div>
      <div class="field"><label>Tanggal Lahir *</label><input type="date" name="tgl_lahir" value="${patient.tgl_lahir}" required></div>
      <div class="field"><label>Jenis Kelamin *</label>
        <select name="jenis_kelamin" required>
          <option value="L" ${patient.jenis_kelamin === 'L' ? 'selected' : ''}>Laki-laki</option>
          <option value="P" ${patient.jenis_kelamin === 'P' ? 'selected' : ''}>Perempuan</option>
        </select>
      </div>
      <div class="field full"><label>Alamat / Tempat Tinggal</label><input name="tempat_tinggal" value="${escapeHtml(patient.tempat_tinggal || '')}"></div>
      <div class="field"><label>No. HP</label><input name="no_hp" value="${escapeHtml(patient.no_hp || '')}"></div>
      <div class="field"><label>Jabatan / Pekerjaan</label><input name="jabatan" value="${escapeHtml(patient.jabatan || '')}"></div>
      <div class="field"><label>Departemen</label><input name="departemen" value="${escapeHtml(patient.departemen || '')}"></div>
      <div class="field"><label>Status Pegawai *</label>
        <select name="status_pegawai" required>
          ${Object.entries(STATUS_PEGAWAI_LABEL).map(([v, l]) => `<option value="${v}" ${patient.status_pegawai === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="field full"><label>Riwayat Penyakit Kronis (butuh treatment berkala)</label>
        <div class="checkline" style="flex-wrap:wrap">
          ${CHRONIC_DISEASE_OPTIONS.map(opt => `<label style="font-weight:400;font-size:.82rem"><input type="checkbox" name="kronis" value="${escapeHtml(opt)}" ${(patient.riwayat_kronis || []).includes(opt) ? 'checked' : ''}> ${escapeHtml(opt)}</label>`).join('')}
        </div>
      </div>
      <div class="field full" style="display:flex;justify-content:flex-end;gap:8px">
        <button type="button" class="btn btn-outline" id="cancelBtn">Batal</button>
        <button type="submit" class="btn btn-primary">Simpan Perubahan</button>
      </div>
    </form>
  `, {
    onMount: (body, close) => {
      body.querySelector('#cancelBtn').addEventListener('click', close);
      body.querySelector('#editPatientForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api.updatePatient(patient.id, {
            nama: fd.get('nama').trim(), nik: fd.get('nik').trim() || null, tgl_lahir: fd.get('tgl_lahir'),
            jenis_kelamin: fd.get('jenis_kelamin'), tempat_tinggal: fd.get('tempat_tinggal').trim(),
            no_hp: fd.get('no_hp').trim(), jabatan: fd.get('jabatan').trim(), departemen: fd.get('departemen').trim(),
            status_pegawai: fd.get('status_pegawai'), riwayat_kronis: fd.getAll('kronis')
          });
          toast('Data pasien diperbarui');
          close();
          onDone();
        } catch (err) {
          toast(err.message || 'Gagal memperbarui data pasien', 'err');
        }
      });
    }
  });
}

function openNewPatientModal(onDone) {
  const companies = getCompanies();
  const sel = getSelectedCompanyId();
  const lockedCompany = !isAllCompanies();
  const defaultCompany = lockedCompany ? sel : companies[0]?.id;

  openModal('Pendaftaran Pasien Baru', `
    <form id="newPatientForm" class="form-grid">
      <div class="field"><label>PT / Perusahaan *</label>
        ${lockedCompany
          ? `<input value="${escapeHtml(getCompanyById(sel)?.name || '')}" disabled><input type="hidden" name="company_id" value="${sel}">`
          : `<select name="company_id" required>${companies.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select>`}
      </div>
      <div class="field"><label>Nama Lengkap *</label><input name="nama" required></div>
      <div class="field"><label>NIK</label><input name="nik" maxlength="16"></div>
      <div class="field"><label>Tanggal Lahir *</label><input type="date" name="tgl_lahir" required></div>
      <div class="field"><label>Usia (otomatis)</label><input id="ageDisplay" disabled placeholder="Isi tanggal lahir..."></div>
      <div class="field"><label>Jenis Kelamin *</label>
        <select name="jenis_kelamin" required><option value="L">Laki-laki</option><option value="P">Perempuan</option></select>
      </div>
      <div class="field"><label>Status Pernikahan</label>
        <select name="status_pernikahan"><option value="Belum Kawin">Belum Kawin</option><option value="Kawin">Kawin</option><option value="Cerai">Cerai</option></select>
      </div>
      <div class="field full"><label>Alamat / Tempat Tinggal (Camp/Barak)</label><input name="tempat_tinggal"></div>
      <div class="field"><label>No. HP</label><input name="no_hp"></div>
      <div class="field"><label>Jabatan / Pekerjaan</label><input name="jabatan"></div>
      <div class="field"><label>Departemen</label><input name="departemen" placeholder="Harvesting, Plantation, Office, dst."></div>
      <div class="field"><label>Status Pegawai *</label>
        <select name="status_pegawai" id="statusPegawai" required>
          <option value="karyawan_tetap">Karyawan Tetap</option>
          <option value="karyawan_kontrak">Karyawan Kontrak</option>
          <option value="mitra_kerja">Mitra Kerja (Kontraktor)</option>
          <option value="masyarakat">Masyarakat / Umum</option>
        </select>
      </div>
      <div id="mitraBlock" style="display:none" class="grid cols-2" style="grid-column:1/-1">
        <div class="field"><label>Nama PT Mitra</label><input name="nama_pt_mitra"></div>
        <div class="field"><label>Lokasi Kerja / Asal</label><input name="lokasi_kerja"></div>
      </div>
      <div class="field full"><label>Keluhan saat ini</label><input name="keluhan" placeholder="mis. Demam, batuk, luka tangan..."></div>
      <div class="field full" style="display:flex;justify-content:flex-end;gap:8px">
        <button type="button" class="btn btn-outline" id="cancelBtn">Batal</button>
        <button type="submit" class="btn btn-primary">Daftar & Masuk Antrian</button>
      </div>
    </form>
  `, {
    onMount: (body, close) => {
      body.querySelector('#cancelBtn').addEventListener('click', close);
      body.querySelector('[name=tgl_lahir]').addEventListener('input', e => {
        body.querySelector('#ageDisplay').value = e.target.value ? fmtAge(e.target.value) : '';
      });
      body.querySelector('#statusPegawai').addEventListener('change', e => {
        body.querySelector('#mitraBlock').style.display = e.target.value === 'mitra_kerja' ? 'grid' : 'none';
      });
      body.querySelector('#newPatientForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const companyId = fd.get('company_id');
        const no_rm = await api.nextRmNumber(companyId);
        try {
          const patient = await api.createPatient({
            company_id: companyId, no_rm,
            nama: fd.get('nama').trim(), nik: fd.get('nik').trim() || null,
            tgl_lahir: fd.get('tgl_lahir'), jenis_kelamin: fd.get('jenis_kelamin'),
            status_pernikahan: fd.get('status_pernikahan'), tempat_tinggal: fd.get('tempat_tinggal').trim(),
            no_hp: fd.get('no_hp').trim(), jabatan: fd.get('jabatan').trim(), departemen: fd.get('departemen').trim(),
            status_pegawai: fd.get('status_pegawai'), nama_pt_mitra: fd.get('nama_pt_mitra')?.trim() || null,
            lokasi_kerja: fd.get('lokasi_kerja')?.trim() || null
          });
          const q = await api.addToQueue(companyId, patient, fd.get('keluhan').trim(), 'Poli Umum');
          const posisi = await api.queuePositionToday(companyId, q.id);
          close();
          onDone();
          openRegistrationSuccessModal(patient, posisi);
        } catch (err) {
          toast(err.message || 'Gagal mendaftarkan pasien', 'err');
        }
      });
    }
  });
}

function openRegistrationSuccessModal(patient, posisi) {
  openModal('Pendaftaran Berhasil', `
    <div style="text-align:center;padding:10px 0 20px">
      <div style="font-size:.85rem;color:var(--muted);margin-bottom:6px">Nomor Antrian</div>
      <div style="font-size:3rem;font-weight:800;color:var(--primary);line-height:1">${posisi}</div>
      <div style="margin-top:10px;font-weight:600">${escapeHtml(patient.nama)}</div>
      <div style="font-size:.85rem;color:var(--muted)">No. RM: ${escapeHtml(patient.no_rm)}</div>
    </div>
    <div style="display:flex;justify-content:center;gap:8px">
      <button type="button" class="btn btn-outline" id="btnCetak">Cetak Kartu Pasien</button>
      <button type="button" class="btn btn-primary" id="btnTutup">Selesai</button>
    </div>
  `, {
    onMount: (body, close) => {
      body.querySelector('#btnCetak').addEventListener('click', () => printPatientCard(patient, patient.companies || getCompanyById(patient.company_id)));
      body.querySelector('#btnTutup').addEventListener('click', close);
    }
  });
}

async function openSoapModal(queueItem, onDone) {
  const patient = await api.getPatient(queueItem.patient_id);
  const drugs = await api.listDrugsWithStock();
  const diseaseCodes = getDiseaseCodes();
  const icdSelected = [];
  const obatSelected = [];

  openModal(`Pemeriksaan: ${patient.nama}`, `
    <form id="soapForm">
      <div class="grid cols-2" style="margin-bottom:14px">
        <div class="field"><label>No. RM</label><input value="${escapeHtml(patient.no_rm)}" disabled></div>
        <div class="field"><label>Jenis Kunjungan</label>
          <select name="jenisKunjungan" id="jenisKunjungan">
            <option value="sakit">Sakit</option>
            <option value="kecelakaan_kerja">Kecelakaan Kerja</option>
            <option value="kontrol">Kontrol</option>
            <option value="vitamin_mcu">Vitamin / MCU / Minta Obat</option>
          </select>
        </div>
      </div>

      <div id="kerjaBlock" style="display:none">
        <div class="panel" style="background:var(--surface-2)">
          <h2>Detail Kecelakaan Kerja</h2>
          <div class="grid cols-3">
            <div class="field"><label>Tingkat Keparahan *</label>
              <select name="tingkat" id="tingkatKK">
                <option value="FA">First Aid (FA) — 0 hari istirahat</option>
                <option value="MA">Medical Aid (MA) — 1-3 hari istirahat</option>
                <option value="LTI">Lost Time Injury (LTI) — &gt;3 hari istirahat</option>
              </select>
            </div>
            <div class="field"><label>Tanggal Kejadian</label><input type="date" name="tanggalKejadian" value="${todayStr()}"></div>
            <div class="field"><label>Jam Kejadian</label><input type="time" name="jamKejadian"></div>
          </div>
          <div class="grid cols-2">
            <div class="field"><label>Penyebab / Terkena</label><input name="terkena" placeholder="mis. Benturan mesin, chainsaw, dll"></div>
            <div class="field"><label>Lokasi Kejadian</label><input name="lokasiKejadian"></div>
          </div>
          <div class="field full"><label>Kronologi Kejadian</label><textarea name="kronologi"></textarea></div>
          <div class="field full"><label>Tindakan</label><textarea name="tindakan"></textarea></div>
        </div>
      </div>

      <div class="grid cols-2">
        <div class="field full"><label>S — Subjective (keluhan pasien)</label><textarea name="subjective">${escapeHtml(queueItem.keluhan || '')}</textarea></div>
      </div>

      <div class="field full">
        <label>O — Objective: Tanda Vital</label>
        <div class="grid cols-4" id="vitalsGrid">
          ${VITAL_FIELDS.map(f => `
            <div class="field"><label>${escapeHtml(f.label)} (${escapeHtml(f.unit)})</label><input type="number" step="any" data-vital="${f.key}"></div>
          `).join('')}
        </div>
        <div id="vitalsAlert" style="display:none;margin-top:8px" class="badge badge-danger"></div>
      </div>
      <div class="field full"><label>Pemeriksaan Fisik Lainnya</label><textarea name="objective" placeholder="Temuan pemeriksaan fisik lain di luar tanda vital..."></textarea></div>

      <div class="field full">
        <label>A — Assessment (Diagnosa)</label>
        <input type="text" id="icdSearch" placeholder="Cari kode ICD-10 atau nama penyakit, mis. J00 atau flu...">
        <div class="icd-search-results" id="icdResults" style="display:none"></div>
        <div class="icd-tags" id="icdTags"></div>
      </div>

      <div class="field full"><label>P — Plan (rencana tatalaksana)</label><textarea name="plan"></textarea></div>

      <div class="grid cols-2">
        <div class="field"><label>Disposisi *</label>
          <select name="disposisi">
            <option value="rawat_jalan">Rawat Jalan</option>
            <option value="observasi">Observasi</option>
            <option value="rawat_inap">Rawat Inap</option>
            <option value="rujuk_keluar">Rujuk Keluar</option>
          </select>
        </div>
        <div class="field"><label>Lama Observasi/Rawat Inap (hari)</label><input type="number" name="lamaObservasi" min="0" value="0"></div>
      </div>

      <div class="field full" style="display:flex;align-items:center;gap:10px">
        <label style="display:flex;align-items:center;gap:6px;font-weight:400"><input type="checkbox" id="sksCheckbox"> Terbitkan Surat Keterangan Sakit (SKS)</label>
      </div>
      <div id="sksBlock" style="display:none" class="grid cols-2">
        <div class="field"><label>Mulai Istirahat</label><input type="date" name="sksMulai"></div>
        <div class="field"><label>Sampai Tanggal</label><input type="date" name="sksSelesai"></div>
        <div class="field full muted" id="sksHint" style="font-size:.78rem"></div>
      </div>

      <div class="field full">
        <label>Obat / Alkes Diberikan (FEFO otomatis)</label>
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <select id="obatPick" style="flex:2">${drugs.map(d => `<option value="${d.id}" data-harga="${d.hargaJual}" data-stok="${d.stok}">${escapeHtml(d.nama)} (stok: ${d.stok})</option>`).join('') || '<option value="">Belum ada data obat</option>'}</select>
          <input type="number" id="obatQty" min="1" value="1" style="flex:1">
          <button type="button" class="btn btn-outline btn-sm" id="obatAddBtn">+ Tambah</button>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Obat</th><th>Qty</th><th>Estimasi Biaya</th><th></th></tr></thead><tbody id="obatRows"></tbody></table></div>
        <div style="text-align:right;margin-top:6px;font-weight:700">Total Estimasi Biaya: <span id="totalBiaya">Rp 0</span></div>
      </div>

      <div class="field full"><label>Dokter / Petugas Pemeriksa</label><input name="dokter"></div>

      <div class="field full" style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">
        <button type="button" class="btn btn-outline" id="cancelBtn">Batal</button>
        <button type="submit" class="btn btn-primary">Simpan & Selesai</button>
      </div>
    </form>
  `, {
    onMount: (body, close) => {
      body.querySelector('#cancelBtn').addEventListener('click', close);

      const vitalsAlert = body.querySelector('#vitalsAlert');
      function collectVitals() {
        const vitals = {};
        body.querySelectorAll('[data-vital]').forEach(input => {
          if (input.value !== '') vitals[input.dataset.vital] = Number(input.value);
        });
        return vitals;
      }
      function checkVitals() {
        const flags = evaluateVitals(collectVitals());
        if (flags.length) {
          vitalsAlert.style.display = '';
          vitalsAlert.textContent = `⚠ Nilai abnormal: ${flags.map(f => `${f.label} ${f.value}${f.unit} (${f.direction === 'high' ? 'tinggi' : 'rendah'})`).join(', ')}`;
        } else {
          vitalsAlert.style.display = 'none';
        }
      }
      body.querySelectorAll('[data-vital]').forEach(input => input.addEventListener('input', checkVitals));

      const kerjaBlock = body.querySelector('#kerjaBlock');
      body.querySelector('#jenisKunjungan').addEventListener('change', e => {
        kerjaBlock.style.display = e.target.value === 'kecelakaan_kerja' ? '' : 'none';
        if (e.target.value === 'kecelakaan_kerja') applyKkSksRule();
      });
      const sksCheckbox = body.querySelector('#sksCheckbox');
      const sksBlock = body.querySelector('#sksBlock');
      sksCheckbox.addEventListener('change', e => {
        sksBlock.style.display = e.target.checked ? 'grid' : 'none';
      });

      const KK_SKS_RULE = {
        FA: { hari: 0, hint: 'First Aid (FA): tidak memerlukan hari istirahat.' },
        MA: { hari: 3, hint: 'Medical Aid (MA): pedoman istirahat 1-3 hari. Sesuaikan tanggal bila perlu.' },
        LTI: { hari: 7, hint: 'Lost Time Injury (LTI): istirahat lebih dari 3 hari. Sesuaikan tanggal sesuai rekomendasi medis.' }
      };
      function applyKkSksRule() {
        const tingkat = body.querySelector('#tingkatKK').value;
        const rule = KK_SKS_RULE[tingkat];
        if (!rule) return;
        body.querySelector('#sksHint').textContent = rule.hint;
        if (rule.hari === 0) {
          sksCheckbox.checked = false;
          sksBlock.style.display = 'none';
        } else {
          sksCheckbox.checked = true;
          sksBlock.style.display = 'grid';
          const mulai = todayStr();
          const selesai = new Date();
          selesai.setDate(selesai.getDate() + rule.hari);
          body.querySelector('[name=sksMulai]').value = mulai;
          body.querySelector('[name=sksSelesai]').value = selesai.toISOString().slice(0, 10);
        }
      }
      body.querySelector('#tingkatKK').addEventListener('change', applyKkSksRule);

      const icdTags = body.querySelector('#icdTags');
      function drawIcdTags() {
        icdTags.innerHTML = icdSelected.map((d, i) => `
          <span class="icd-tag"><b>${escapeHtml(d.code)}</b> ${escapeHtml(d.desc)} <button type="button" data-i="${i}">&times;</button></span>
        `).join('') || '<span class="muted" style="font-size:.8rem">Belum ada diagnosa dipilih</span>';
        icdTags.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { icdSelected.splice(Number(b.dataset.i), 1); drawIcdTags(); }));
      }
      drawIcdTags();

      const icdSearch = body.querySelector('#icdSearch');
      const icdResults = body.querySelector('#icdResults');
      icdSearch.addEventListener('input', debounce(() => {
        const results = api.searchDiseaseCodes(diseaseCodes, icdSearch.value, 15);
        if (!results.length) { icdResults.style.display = 'none'; return; }
        icdResults.style.display = '';
        icdResults.innerHTML = results.map(r => `<div class="icd-item" data-code="${escapeHtml(r.code)}" data-desc="${escapeHtml(r.desc)}"><b>${escapeHtml(r.code)}</b> — ${escapeHtml(r.desc)} <span class="muted">(${escapeHtml(r.category)})</span></div>`).join('');
        icdResults.querySelectorAll('.icd-item').forEach(item => item.addEventListener('click', () => {
          const code = item.dataset.code, desc = item.dataset.desc;
          if (!icdSelected.some(d => d.code === code)) icdSelected.push({ code, desc });
          icdSearch.value = '';
          icdResults.style.display = 'none';
          drawIcdTags();
        }));
      }, 150));

      const obatRows = body.querySelector('#obatRows');
      const totalBiaya = body.querySelector('#totalBiaya');
      function drawObat() {
        let total = 0;
        obatRows.innerHTML = obatSelected.map((o, i) => {
          const sub = o.qty * o.harga;
          total += sub;
          return `<tr><td>${escapeHtml(o.nama)}</td><td>${o.qty}</td><td>Rp ${sub.toLocaleString('id-ID')}</td><td><button type="button" class="btn btn-sm btn-outline" data-i="${i}">Hapus</button></td></tr>`;
        }).join('') || `<tr><td colspan="4" class="empty">Belum ada obat ditambahkan</td></tr>`;
        totalBiaya.textContent = 'Rp ' + total.toLocaleString('id-ID');
        obatRows.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { obatSelected.splice(Number(b.dataset.i), 1); drawObat(); }));
      }
      drawObat();

      body.querySelector('#obatAddBtn').addEventListener('click', () => {
        const sel = body.querySelector('#obatPick');
        if (!sel.value) return;
        const opt = sel.selectedOptions[0];
        const drug = drugs.find(d => d.id === sel.value);
        const qty = Number(body.querySelector('#obatQty').value) || 1;
        const stokTersedia = Number(opt.dataset.stok);
        const existingQty = obatSelected.filter(o => o.drugId === drug.id).reduce((s, o) => s + o.qty, 0);
        if (existingQty + qty > stokTersedia) { toast('Jumlah melebihi stok tersedia', 'err'); return; }
        const existing = obatSelected.find(o => o.drugId === drug.id);
        if (existing) existing.qty += qty;
        else obatSelected.push({ drugId: drug.id, nama: drug.nama, qty, harga: Number(opt.dataset.harga) });
        drawObat();
      });

      body.querySelector('#soapForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        if (!icdSelected.length && !confirmDialog('Belum ada diagnosa dipilih. Simpan tanpa diagnosa?')) return;

        const jenisKunjungan = fd.get('jenisKunjungan');
        const visitPayload = {
          company_id: patient.company_id, patient_id: patient.id, queue_id: queueItem.id,
          jenis_kunjungan: jenisKunjungan, subjective: fd.get('subjective').trim(), objective: fd.get('objective').trim(),
          diagnosa: icdSelected, plan: fd.get('plan').trim(), disposisi: fd.get('disposisi'),
          lama_observasi_hari: Number(fd.get('lamaObservasi')) || 0, dokter: fd.get('dokter').trim(),
          vitals: collectVitals()
        };
        if (jenisKunjungan === 'kecelakaan_kerja') {
          visitPayload.kecelakaan_kerja = {
            tingkat: fd.get('tingkat'), tanggalKejadian: fd.get('tanggalKejadian'), jamKejadian: fd.get('jamKejadian'),
            terkena: fd.get('terkena').trim(), lokasiKejadian: fd.get('lokasiKejadian').trim(),
            kronologi: fd.get('kronologi').trim(), tindakan: fd.get('tindakan').trim()
          };
        }

        try {
          const visit = await api.createVisit(visitPayload, obatSelected.map(o => ({ drugId: o.drugId, qty: o.qty })));
          await api.updateQueueStatus(queueItem.id, 'selesai');

          if (body.querySelector('#sksCheckbox').checked) {
            const nomorSurat = await api.nextNomorSurat(patient.company_id, 'SKS');
            await api.createSickNote({
              company_id: patient.company_id, patient_id: patient.id, visit_id: visit.id, nomor_surat: nomorSurat,
              diagnosa: icdSelected.map(d => d.desc).join(', '), tanggal_mulai: fd.get('sksMulai') || null,
              tanggal_selesai: fd.get('sksSelesai') || null, dokter: fd.get('dokter').trim()
            });
          }

          toast(`Pemeriksaan tersimpan. Total biaya: Rp ${Number(visit.biaya_total || 0).toLocaleString('id-ID')}`);
          close();
          onDone();
        } catch (err) {
          toast(err.message || 'Gagal menyimpan pemeriksaan', 'err');
        }
      });
    }
  });
}

function openConsentModal(patient) {
  openModal('Form Persetujuan / Penolakan Tindakan Medis', `
    <form id="consentForm">
      <div class="field" style="margin-bottom:12px"><label>Jenis *</label>
        <select name="tipe"><option value="persetujuan">Persetujuan (Informed Consent)</option><option value="penolakan">Penolakan Tindakan</option></select>
      </div>
      <div class="field" style="margin-bottom:12px"><label>Tindakan/Prosedur Medis *</label><input name="tindakan" required placeholder="mis. Jahit luka, rujuk observasi, dsb."></div>
      <div class="field" style="margin-bottom:12px"><label>Penjelasan Risiko yang Disampaikan</label><textarea name="penjelasanRisiko"></textarea></div>
      <div class="grid cols-2">
        <div class="field"><label>Nama Saksi</label><input name="namaSaksi"></div>
        <div class="field"><label>Nama Petugas Medis</label><input name="namaPetugas"></div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
        <button type="button" class="btn btn-outline" id="cancelBtn">Batal</button>
        <button type="submit" class="btn btn-primary">Simpan &amp; Cetak</button>
      </div>
    </form>
  `, {
    onMount: (body, close) => {
      body.querySelector('#cancelBtn').addEventListener('click', close);
      body.querySelector('#consentForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const form = {
          tanggal: todayStr(), tindakan: fd.get('tindakan').trim(), penjelasanRisiko: fd.get('penjelasanRisiko').trim(),
          namaSaksi: fd.get('namaSaksi').trim(), namaPetugas: fd.get('namaPetugas').trim()
        };
        try {
          await api.createConsentForm({
            company_id: patient.company_id, patient_id: patient.id, tipe: fd.get('tipe'),
            tindakan: form.tindakan, penjelasan_risiko: form.penjelasanRisiko,
            nama_saksi: form.namaSaksi, nama_petugas: form.namaPetugas, tanggal: form.tanggal
          });
          const sig = await api.getPrintSignatures(patient.company_id);
          toast('Form tersimpan');
          close();
          printMedicalConsentForm(patient, patient.companies || getCompanyById(patient.company_id), fd.get('tipe'), form, sig);
        } catch (err) {
          toast(err.message || 'Gagal menyimpan form', 'err');
        }
      });
    }
  });
}
