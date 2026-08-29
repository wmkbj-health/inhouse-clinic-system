import * as api from '../api.js';
import { el, escapeHtml, fmtDate, toast, openModal, debounce, confirmDialog, todayStr } from '../util.js';
import { getCompanies, getCompanyById, getSelectedCompanyId, isAllCompanies, getDiseaseCodes, fmtAge } from '../state.js';
import { printPatientCard } from '../print.js';
import { hasRole } from '../auth.js';

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
  root.querySelector('#btnNewPatient').addEventListener('click', () => openNewPatientModal(() => setActive(activeTab)));

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
      <tr>
        <td>${escapeHtml(p.no_rm)}</td>
        <td>${escapeHtml(p.nama)}</td>
        <td>${fmtAge(p.tgl_lahir)}</td>
        <td>${p.jenis_kelamin}</td>
        <td>${escapeHtml(p.departemen || '-')}</td>
        <td><span class="badge badge-info">${STATUS_PEGAWAI_LABEL[p.status_pegawai] || p.status_pegawai}</span></td>
        <td>${escapeHtml(p.companies?.code || '-')}</td>
        <td style="display:flex;gap:6px">
          <button class="btn btn-sm btn-outline" data-daftar="${p.id}">Antrian</button>
          <button class="btn btn-sm btn-outline" data-cetak="${p.id}">Kartu</button>
        </td>
      </tr>`).join('');
    rows.querySelectorAll('[data-daftar]').forEach(btn => btn.addEventListener('click', async () => {
      const p = list.find(x => x.id === btn.dataset.daftar);
      await api.addToQueue(p.company_id, p, '', p.status_pegawai === 'mitra_kerja' ? 'Poli Kecelakaan Kerja / Umum' : 'Poli Umum');
      toast(`${p.nama} ditambahkan ke antrian`);
    }));
    rows.querySelectorAll('[data-cetak]').forEach(btn => btn.addEventListener('click', () => {
      const p = list.find(x => x.id === btn.dataset.cetak);
      printPatientCard(p, p.companies);
    }));
  }
  draw();

  container.querySelector('#patSearch').addEventListener('input', debounce(e => draw(e.target.value.trim()), 250));
}

function openNewPatientModal(onDone) {
  const companies = getCompanies();
  const sel = getSelectedCompanyId();
  const defaultCompany = isAllCompanies() ? companies[0]?.id : sel;

  openModal('Pendaftaran Pasien Baru', `
    <form id="newPatientForm" class="form-grid">
      <div class="field"><label>PT / Perusahaan *</label>
        <select name="company_id" required>${companies.map(c => `<option value="${c.id}" ${c.id === defaultCompany ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
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
          await api.addToQueue(companyId, patient, fd.get('keluhan').trim(), 'Poli Umum');
          toast(`Pasien ${patient.nama} terdaftar dengan No. RM ${no_rm}`);
          printPatientCard(patient, getCompanyById(companyId));
          close();
          onDone();
        } catch (err) {
          toast(err.message || 'Gagal mendaftarkan pasien', 'err');
        }
      });
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
              <select name="tingkat">
                <option value="FA">First Aid (FA)</option>
                <option value="MA">Medical Aid (MA)</option>
                <option value="LTI">Lost Time Injury (LTI)</option>
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
        <div class="field full"><label>O — Objective (pemeriksaan fisik/tanda vital)</label><textarea name="objective"></textarea></div>
      </div>

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
      const kerjaBlock = body.querySelector('#kerjaBlock');
      body.querySelector('#jenisKunjungan').addEventListener('change', e => {
        kerjaBlock.style.display = e.target.value === 'kecelakaan_kerja' ? '' : 'none';
      });
      body.querySelector('#sksCheckbox').addEventListener('change', e => {
        body.querySelector('#sksBlock').style.display = e.target.checked ? 'grid' : 'none';
      });

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
          lama_observasi_hari: Number(fd.get('lamaObservasi')) || 0, dokter: fd.get('dokter').trim()
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
