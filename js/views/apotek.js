import * as api from '../api.js';
import { escapeHtml, fmtDate, toast, openModal, debounce, todayStr, confirmDialog } from '../util.js';
import { getDrugCategories, getSelectedCompanyId, isAllCompanies, getCompanyById, consumePendingApotekFilter } from '../state.js';
import { printStocktake, printDrugRequest } from '../print.js';
import { openSignatureModal } from '../signatures.js';

const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export async function renderApotek(root) {
  const now = new Date();
  let filterYear = now.getFullYear();
  let filterMonth = now.getMonth(); // 0-based
  const pendingWarn = consumePendingApotekFilter();

  root.innerHTML = `
    <div class="view-head">
      <div><h1>Apotek</h1><p class="desc">Obat & alat kesehatan — FEFO, harga, peringatan expired dan stok minimum</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-outline" id="btnSig">Nama Tanda Tangan</button>
        <button class="btn btn-outline" id="btnRequest">Permintaan Obat</button>
        <button class="btn btn-outline" id="btnPrint">Cetak Stocktake</button>
        <button class="btn btn-outline" id="btnTx">Penerimaan Obat (Batch Baru)</button>
        <button class="btn btn-outline" id="btnReceiptHistory">Riwayat Penerimaan</button>
        <button class="btn btn-primary" id="btnNewDrug">+ Tambah Item Obat/Alkes</button>
      </div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;align-items:center">
      <select id="monthFilter"></select>
      <select id="yearFilter"></select>
      <span class="muted" style="font-size:.8rem">Memengaruhi kolom Penerimaan/Pemakaian/Rata-rata &amp; cetak stocktake</span>
    </div>
    <div class="grid cols-3" id="apotekStats" style="margin-bottom:20px"></div>
    <div class="panel">
      <h2>Daftar Obat & Alkes (FEFO) <span class="muted" id="drugCount"></span></h2>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <input type="text" id="drugSearch" placeholder="Cari nama/kode/nama paten..." style="max-width:260px">
        <select id="drugFilter" style="max-width:200px">
          <option value="">Semua Jenis</option>
          <option value="obat">Obat</option>
          <option value="alkes">Alat Kesehatan</option>
          <option value="bhp">BHP</option>
        </select>
        <select id="drugWarnFilter" style="max-width:220px">
          <option value="">Semua Status</option>
          <option value="minimum">Perlu Pesan Ulang</option>
          <option value="expiring">Akan Kadaluarsa (30 hari)</option>
          <option value="expired">Sudah Kadaluarsa</option>
        </select>
      </div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Kode</th><th>Nama (Paten)</th><th>Jenis</th><th>Stok Awal</th><th>Penerimaan</th><th>Pemakaian</th>
          <th>Rata2/Hari</th><th>Stok Saat Ini</th><th>Exp. Terdekat</th><th>Harga Jual</th><th>Status</th><th></th>
        </tr></thead>
        <tbody id="drugRows"></tbody>
      </table></div>
    </div>
  `;

  const monthSel = root.querySelector('#monthFilter');
  monthSel.innerHTML = MONTH_NAMES.map((m, i) => `<option value="${i}" ${i === filterMonth ? 'selected' : ''}>${m}</option>`).join('');
  const yearSel = root.querySelector('#yearFilter');
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);
  yearSel.innerHTML = years.map(y => `<option value="${y}" ${y === filterYear ? 'selected' : ''}>${y}</option>`).join('');

  let drugs = [];

  async function loadAndDraw() {
    const periodFrom = `${filterYear}-${String(filterMonth + 1).padStart(2, '0')}-01`;
    const periodToDate = new Date(filterYear, filterMonth + 1, 0);
    const isCurrentMonth = filterYear === now.getFullYear() && filterMonth === now.getMonth();
    const periodTo = isCurrentMonth ? todayStr() : periodToDate.toISOString().slice(0, 10);
    const daysElapsed = isCurrentMonth ? now.getDate() : periodToDate.getDate();

    const [baseDrugs, stats] = await Promise.all([api.listDrugsWithStock(), api.drugPeriodStats(periodFrom, periodTo)]);
    drugs = baseDrugs.map(d => {
      const st = stats[d.id] || { penerimaan: 0, pemakaian: 0 };
      const stokAwal = isCurrentMonth ? Math.max(0, d.stok - st.penerimaan + st.pemakaian) : null;
      return { ...d, penerimaan: st.penerimaan, pemakaian: st.pemakaian, rataRata: st.pemakaian / daysElapsed, stokAwal };
    });
    drawAll();
  }

  function statusOf(d) {
    const days = d.nextExpiry ? daysUntil(d.nextExpiry) : null;
    if (days !== null && days < 0) return { key: 'expired', label: 'Kadaluarsa', cls: 'badge-danger' };
    if (days !== null && days <= 30) return { key: 'expiring', label: `Exp ${days} hari lagi`, cls: 'badge-warn' };
    if (d.stok <= d.stok_minimum) return { key: 'minimum', label: 'Perlu Pesan Ulang', cls: 'badge-warn' };
    return { key: 'ok', label: 'Aman', cls: 'badge-ok' };
  }
  function daysUntil(dateStr) {
    const target = new Date(dateStr + 'T00:00:00');
    const nowD = new Date(); nowD.setHours(0, 0, 0, 0);
    return Math.round((target - nowD) / 86400000);
  }

  function drawStats() {
    const minimum = drugs.filter(d => d.stok <= d.stok_minimum);
    const expiringOrExpired = drugs.filter(d => d.nextExpiry && daysUntil(d.nextExpiry) <= 30);
    root.querySelector('#apotekStats').innerHTML = `
      <div class="card stat primary"><div class="label">Total Item</div><div class="value">${drugs.length}</div></div>
      <div class="card stat warn"><div class="label">Perlu Pesan Ulang</div><div class="value">${minimum.length}</div><div class="hint">Stok ≤ batas minimum</div></div>
      <div class="card stat danger"><div class="label">Kadaluarsa / Akan Kadaluarsa</div><div class="value">${expiringOrExpired.length}</div><div class="hint">Dalam 30 hari ke depan atau sudah lewat</div></div>
    `;
    root.querySelector('#drugCount').textContent = `(${drugs.length})`;
  }

  const rows = root.querySelector('#drugRows');
  function drawRows(list) {
    if (!list.length) { rows.innerHTML = `<tr><td colspan="12" class="empty">Tidak ada data obat/alkes.</td></tr>`; return; }
    rows.innerHTML = list.map(d => {
      const st = statusOf(d);
      return `<tr>
        <td>${escapeHtml(d.kode)}</td>
        <td>${escapeHtml(d.nama)}${d.nama_paten ? `<div class="muted" style="font-size:.72rem">${escapeHtml(d.nama_paten)}</div>` : ''}</td>
        <td>${d.jenis}</td>
        <td>${d.stokAwal ?? '-'}</td>
        <td>${d.penerimaan}</td>
        <td>${d.pemakaian}</td>
        <td>${d.rataRata.toFixed(2)}</td>
        <td>${d.stok} ${escapeHtml(d.satuan)}</td>
        <td>${d.nextExpiry ? fmtDate(d.nextExpiry) : '-'}</td>
        <td>Rp ${Number(d.hargaJual || 0).toLocaleString('id-ID')}</td>
        <td><span class="badge ${st.cls}">${st.label}</span></td>
        <td style="display:flex;gap:4px">
          <button class="btn btn-sm btn-outline" data-batch="${d.id}">Batch</button>
          <button class="btn btn-sm btn-outline" data-edit="${d.id}">Edit</button>
          <button class="btn btn-sm btn-danger" data-hapus="${d.id}">Hapus</button>
        </td>
      </tr>`;
    }).join('');
    rows.querySelectorAll('[data-batch]').forEach(btn => btn.addEventListener('click', () => {
      openBatchModal(drugs.find(x => x.id === btn.dataset.batch), loadAndDraw);
    }));
    rows.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => {
      openDrugModal(drugs.find(x => x.id === btn.dataset.edit), loadAndDraw);
    }));
    rows.querySelectorAll('[data-hapus]').forEach(btn => btn.addEventListener('click', async () => {
      const d = drugs.find(x => x.id === btn.dataset.hapus);
      if (!confirmDialog(`Hapus item "${d.nama}" dari master data?`)) return;
      try {
        await api.deleteDrug(d.id);
        toast('Item dihapus');
        loadAndDraw();
      } catch (err) {
        toast(err.message || 'Gagal menghapus item', 'err');
      }
    }));
  }

  function applyFilters() {
    const q = root.querySelector('#drugSearch').value.trim().toLowerCase();
    const jenis = root.querySelector('#drugFilter').value;
    const warn = root.querySelector('#drugWarnFilter').value;
    drawRows(drugs.filter(d => {
      if (q && !(d.nama.toLowerCase().includes(q) || (d.kode || '').toLowerCase().includes(q) || (d.nama_paten || '').toLowerCase().includes(q))) return false;
      if (jenis && d.jenis !== jenis) return false;
      if (warn && statusOf(d).key !== warn) return false;
      return true;
    }));
  }

  function drawAll() { drawStats(); applyFilters(); }

  root.querySelector('#drugSearch').addEventListener('input', debounce(applyFilters, 200));
  root.querySelector('#drugFilter').addEventListener('change', applyFilters);
  root.querySelector('#drugWarnFilter').addEventListener('change', applyFilters);
  monthSel.addEventListener('change', () => { filterMonth = Number(monthSel.value); loadAndDraw(); });
  yearSel.addEventListener('change', () => { filterYear = Number(yearSel.value); loadAndDraw(); });

  root.querySelector('#btnNewDrug').addEventListener('click', () => openDrugModal(null, loadAndDraw));
  root.querySelector('#btnTx').addEventListener('click', () => openReceiveModal(drugs, loadAndDraw));
  root.querySelector('#btnReceiptHistory').addEventListener('click', () => {
    const periodFrom = `${filterYear}-${String(filterMonth + 1).padStart(2, '0')}-01`;
    const periodToDate = new Date(filterYear, filterMonth + 1, 0);
    const isCurrentMonth = filterYear === now.getFullYear() && filterMonth === now.getMonth();
    const periodTo = isCurrentMonth ? todayStr() : periodToDate.toISOString().slice(0, 10);
    openReceiptHistoryModal(periodFrom, periodTo, `${MONTH_NAMES[filterMonth]} ${filterYear}`);
  });
  root.querySelector('#btnRequest').addEventListener('click', () => openDrugRequestModal(drugs));
  root.querySelector('#btnSig').addEventListener('click', () => {
    const sel = getSelectedCompanyId();
    openSignatureModal(sel === 'all' ? null : sel);
  });
  root.querySelector('#btnPrint').addEventListener('click', () => openStocktakePrintModal(drugs, filterMonth, filterYear));

  await loadAndDraw();

  if (pendingWarn) {
    root.querySelector('#drugWarnFilter').value = pendingWarn;
    applyFilters();
    root.querySelector('.panel').scrollIntoView({ behavior: 'smooth' });
  }
}

function openStocktakePrintModal(drugs, filterMonth, filterYear) {
  openModal('Cetak Stocktake', `
    <p class="desc" style="margin-bottom:14px">Pilih jenis item yang ingin dicetak:</p>
    <div style="display:flex;gap:10px;justify-content:center">
      <button class="btn btn-primary" id="btnObat">Stocktake Obat</button>
      <button class="btn btn-primary" id="btnAlkes">Stocktake Alkes / BHP</button>
    </div>
  `, {
    onMount: async (body, close) => {
      const company = isAllCompanies() ? null : getCompanyById(getSelectedCompanyId());
      const sig = company ? await api.getPrintSignatures(company.id) : {};
      const periodLabel = `${['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'][filterMonth]} ${filterYear}`;
      body.querySelector('#btnObat').addEventListener('click', () => {
        printStocktake(drugs.filter(d => d.jenis === 'obat'), company, periodLabel, 'Obat', sig);
        close();
      });
      body.querySelector('#btnAlkes').addEventListener('click', () => {
        printStocktake(drugs.filter(d => d.jenis !== 'obat'), company, periodLabel, 'Alkes & BHP', sig);
        close();
      });
    }
  });
}

function openBatchModal(drug, onDone) {
  openModal(`Batch: ${drug.nama}`, `
    <div class="table-wrap"><table>
      <thead><tr><th>No. Batch</th><th>Diterima</th><th>Sisa</th><th>Expired</th><th>Harga Beli</th><th>Harga Jual</th><th>Supplier</th><th></th></tr></thead>
      <tbody>
        ${drug.batches.map(b => `<tr>
          <td>${escapeHtml(b.no_batch || '-')}</td>
          <td>${fmtDate(b.tanggal_terima)}</td>
          <td>${b.qty_sisa}</td>
          <td>${b.tanggal_expired ? fmtDate(b.tanggal_expired) : '-'}</td>
          <td>Rp ${Number(b.harga_beli).toLocaleString('id-ID')}</td>
          <td>Rp ${Number(b.harga_jual).toLocaleString('id-ID')}</td>
          <td>${escapeHtml(b.supplier || '-')}</td>
          <td><button class="btn btn-sm btn-outline" data-koreksi="${b.id}">Koreksi Stok</button></td>
        </tr>`).join('') || `<tr><td colspan="8" class="empty">Belum ada batch (stok kosong).</td></tr>`}
      </tbody>
    </table></div>
    <p class="desc" style="margin-top:10px">Batch dengan tanggal expired paling dekat akan otomatis dipakai lebih dulu (FEFO) saat obat diresepkan ke pasien. Gunakan "Koreksi Stok" untuk menyesuaikan hasil stok opname (selisih hilang/rusak/temuan).</p>
  `, {
    onMount: (body, close) => {
      body.querySelectorAll('[data-koreksi]').forEach(btn => btn.addEventListener('click', () => {
        openAdjustModal(drug, btn.dataset.koreksi, () => { close(); onDone(); });
      }));
    }
  });
}

function openAdjustModal(drug, batchId, onDone) {
  openModal('Koreksi Stok (Hasil Opname)', `
    <form id="adjForm">
      <div class="field" style="margin-bottom:12px"><label>Selisih Stok * (isi negatif jika berkurang, positif jika bertambah)</label><input type="number" name="qty" required placeholder="mis. -3 atau 5"></div>
      <div class="field" style="margin-bottom:12px"><label>Keterangan *</label><input name="keterangan" required placeholder="mis. Hasil stok opname bulanan, rusak, dsb."></div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button type="button" class="btn btn-outline" id="cancelBtn">Batal</button>
        <button type="submit" class="btn btn-primary">Simpan Koreksi</button>
      </div>
    </form>
  `, {
    onMount: (body, close) => {
      body.querySelector('#cancelBtn').addEventListener('click', close);
      body.querySelector('#adjForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api.adjustStock(drug.batches.find(b => b.id === batchId).company_id, drug.id, batchId, Number(fd.get('qty')), fd.get('keterangan').trim());
          toast('Koreksi stok tersimpan');
          close();
          onDone();
        } catch (err) {
          toast(err.message || 'Gagal menyimpan koreksi', 'err');
        }
      });
    }
  });
}

function openDrugModal(drug, onDone) {
  const cats = getDrugCategories();
  const isEdit = !!drug;
  openModal(isEdit ? 'Edit Item Obat/Alkes' : 'Tambah Item Obat/Alkes', `
    <form id="drugForm" class="form-grid">
      <div class="field"><label>Kode *</label><input name="kode" required placeholder="mis. AB020" value="${escapeHtml(drug?.kode || '')}" ${isEdit ? 'disabled' : ''}></div>
      <div class="field"><label>Nama Generik *</label><input name="nama" required value="${escapeHtml(drug?.nama || '')}"></div>
      <div class="field full"><label>Nama Paten / Brand (opsional)</label><input name="nama_paten" placeholder="mis. Panadol, Sanmol, dsb." value="${escapeHtml(drug?.nama_paten || '')}"></div>
      <div class="field"><label>Jenis *</label>
        <select name="jenis">
          <option value="obat" ${drug?.jenis === 'obat' ? 'selected' : ''}>Obat</option>
          <option value="alkes" ${drug?.jenis === 'alkes' ? 'selected' : ''}>Alat Kesehatan</option>
          <option value="bhp" ${drug?.jenis === 'bhp' ? 'selected' : ''}>BHP (Bahan Habis Pakai)</option>
        </select>
      </div>
      <div class="field"><label>Kategori</label>
        <select name="kategori_id"><option value="">-</option>${cats.map(c => `<option value="${c.id}" ${drug?.kategori_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Satuan</label><input name="satuan" value="${escapeHtml(drug?.satuan || 'pcs')}"></div>
      <div class="field"><label>Stok Minimum (batas pesan ulang) *</label><input type="number" name="stok_minimum" min="0" value="${drug?.stok_minimum ?? 10}" required></div>
      <div class="field full" style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">
        <button type="button" class="btn btn-outline" id="cancelBtn">Batal</button>
        <button type="submit" class="btn btn-primary">Simpan</button>
      </div>
    </form>
  `, {
    onMount: (body, close) => {
      body.querySelector('#cancelBtn').addEventListener('click', close);
      body.querySelector('#drugForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const payload = {
          nama: fd.get('nama').trim(), nama_paten: fd.get('nama_paten').trim() || null, jenis: fd.get('jenis'),
          kategori_id: fd.get('kategori_id') || null, satuan: fd.get('satuan').trim() || 'pcs',
          stok_minimum: Number(fd.get('stok_minimum'))
        };
        try {
          if (isEdit) {
            await api.updateDrug(drug.id, payload);
            toast('Item diperbarui');
          } else {
            payload.kode = fd.get('kode').trim();
            await api.createDrug(payload);
            toast('Item obat/alkes ditambahkan. Lakukan "Penerimaan Obat" untuk mengisi stok awal.');
          }
          close();
          onDone();
        } catch (err) {
          toast(err.message || 'Gagal menyimpan: kode mungkin sudah dipakai', 'err');
        }
      });
    }
  });
}

function openReceiveModal(drugs, onDone) {
  const sel = getSelectedCompanyId();
  const companyId = sel === 'all' ? null : sel;
  openModal('Penerimaan Obat / Batch Baru', `
    <form id="rxForm" class="form-grid">
      ${!companyId ? `<p class="desc full" style="grid-column:1/-1">Pilih PT terlebih dahulu di sidebar (tidak bisa "Semua PT") sebelum mencatat penerimaan obat.</p>` : ''}
      <div class="field full"><label>Obat/Alkes *</label>
        <select name="drugId" required>${drugs.map(d => `<option value="${d.id}">${escapeHtml(d.nama)} (${escapeHtml(d.kode)})</option>`).join('')}</select>
      </div>
      <div class="field"><label>No. Batch</label><input name="noBatch"></div>
      <div class="field"><label>Jumlah Diterima *</label><input type="number" name="qty" min="1" value="1" required></div>
      <div class="field"><label>Tanggal Terima *</label><input type="date" name="tanggal" value="${todayStr()}" required></div>
      <div class="field"><label>Tanggal Expired</label><input type="date" name="tanggalExpired"></div>
      <div class="field"><label>Harga Beli</label><input type="number" name="hargaBeli" min="0" value="0"></div>
      <div class="field"><label>Harga Jual</label><input type="number" name="hargaJual" min="0" value="0"></div>
      <div class="field full"><label>Supplier</label><input name="supplier"></div>
      <div class="field full"><label>Nama Penerima *</label><input name="namaPenerima" required placeholder="Nama petugas yang menerima obat"></div>
      <div class="field full" style="display:flex;justify-content:flex-end;gap:8px">
        <button type="button" class="btn btn-outline" id="cancelBtn">Batal</button>
        <button type="submit" class="btn btn-primary" ${!companyId ? 'disabled' : ''}>Simpan Penerimaan</button>
      </div>
    </form>
  `, {
    onMount: (body, close) => {
      body.querySelector('#cancelBtn').addEventListener('click', close);
      body.querySelector('#rxForm').addEventListener('submit', async e => {
        e.preventDefault();
        if (!companyId) return;
        const fd = new FormData(e.target);
        try {
          await api.receiveBatch(companyId, fd.get('drugId'), {
            qty: Number(fd.get('qty')), noBatch: fd.get('noBatch').trim(), tanggal: fd.get('tanggal'),
            tanggalExpired: fd.get('tanggalExpired') || null, hargaBeli: Number(fd.get('hargaBeli')) || 0,
            hargaJual: Number(fd.get('hargaJual')) || 0, supplier: fd.get('supplier').trim(),
            namaPenerima: fd.get('namaPenerima').trim()
          });
          toast('Penerimaan obat tersimpan');
          close();
          onDone();
        } catch (err) {
          toast(err.message || 'Gagal menyimpan penerimaan', 'err');
        }
      });
    }
  });
}

async function openReceiptHistoryModal(fromDate, toDate, periodLabel) {
  const receipts = await api.listDrugReceipts(fromDate, toDate);
  openModal(`Riwayat Penerimaan Obat — ${escapeHtml(periodLabel)}`, `
    <div class="table-wrap"><table>
      <thead><tr><th>Tanggal</th><th>Obat/Alkes</th><th>Jumlah</th><th>Nama Penerima</th><th>Sumber/Supplier</th></tr></thead>
      <tbody>
        ${receipts.length ? receipts.map(r => `<tr>
          <td>${fmtDate(r.tanggal)}</td>
          <td>${escapeHtml(r.drugs?.nama || '-')}</td>
          <td>${r.jumlah} ${escapeHtml(r.drugs?.satuan || '')}</td>
          <td>${escapeHtml(r.nama_penerima || '-')}</td>
          <td>${escapeHtml(r.sumber || '-')}</td>
        </tr>`).join('') : `<tr><td colspan="5" class="empty">Belum ada penerimaan obat pada periode ini.</td></tr>`}
      </tbody>
    </table></div>
  `);
}

function openDrugRequestModal(drugs) {
  const sel = getSelectedCompanyId();
  const companyId = sel === 'all' ? null : sel;
  if (!companyId) { toast('Pilih PT terlebih dahulu (tidak bisa "Semua PT")', 'err'); return; }
  const selected = [];
  const reorderDefaults = drugs.filter(d => d.stok <= d.stok_minimum);

  openModal('Formulir Permintaan Pengadaan Obat/Alkes', `
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <select id="itemPick" style="flex:2">${drugs.map(d => `<option value="${d.id}">${escapeHtml(d.nama)} (stok: ${d.stok})</option>`).join('')}</select>
      <input type="number" id="itemQty" min="1" value="10" style="flex:1">
      <button type="button" class="btn btn-outline btn-sm" id="itemAddBtn">+ Tambah</button>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Item</th><th>Stok Saat Ini</th><th>Jumlah Diminta</th><th></th></tr></thead><tbody id="reqRows"></tbody></table></div>
    <div class="field full" style="margin-top:12px"><label>Catatan</label><textarea id="reqNote"></textarea></div>
    <div class="grid cols-2" style="margin-top:10px">
      <div class="field"><label>Diminta oleh</label><input id="reqBy"></div>
      <div class="field"><label>Disetujui oleh</label><input id="reqApprove"></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
      <button type="button" class="btn btn-outline" id="cancelBtn">Batal</button>
      <button type="button" class="btn btn-primary" id="saveBtn">Simpan &amp; Cetak</button>
    </div>
  `, {
    onMount: (body, close) => {
      reorderDefaults.forEach(d => selected.push({ drugId: d.id, nama: d.nama, satuan: d.satuan, stok: d.stok, qty: Math.max(d.stok_minimum * 2 - d.stok, 1) }));
      const reqRows = body.querySelector('#reqRows');
      function draw() {
        reqRows.innerHTML = selected.map((s, i) => `<tr>
          <td>${escapeHtml(s.nama)}</td><td>${s.stok}</td><td>${s.qty}</td>
          <td><button type="button" class="btn btn-sm btn-outline" data-i="${i}">Hapus</button></td>
        </tr>`).join('') || `<tr><td colspan="4" class="empty">Belum ada item ditambahkan</td></tr>`;
        reqRows.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { selected.splice(Number(b.dataset.i), 1); draw(); }));
      }
      draw();
      body.querySelector('#itemAddBtn').addEventListener('click', () => {
        const sel2 = body.querySelector('#itemPick');
        const d = drugs.find(x => x.id === sel2.value);
        const qty = Number(body.querySelector('#itemQty').value) || 1;
        if (!d) return;
        const existing = selected.find(s => s.drugId === d.id);
        if (existing) existing.qty += qty;
        else selected.push({ drugId: d.id, nama: d.nama, satuan: d.satuan, stok: d.stok, qty });
        draw();
      });
      body.querySelector('#cancelBtn').addEventListener('click', close);
      body.querySelector('#saveBtn').addEventListener('click', async () => {
        if (!selected.length) { toast('Tambahkan minimal satu item', 'err'); return; }
        try {
          const nomor = await api.nextNomorPermintaan(companyId);
          const items = selected.map(s => ({ drug_id: s.drugId, nama: s.nama, satuan: s.satuan, stok_saat_ini: s.stok, jumlah_diminta: s.qty, keterangan: '' }));
          const payload = {
            company_id: companyId, nomor_permintaan: nomor, items,
            keterangan: body.querySelector('#reqNote').value.trim(),
            diminta_oleh: body.querySelector('#reqBy').value.trim(),
            disetujui_oleh: body.querySelector('#reqApprove').value.trim()
          };
          const row = await api.createDrugRequest(payload);
          const sig = await api.getPrintSignatures(companyId);
          toast('Permintaan obat tersimpan');
          close();
          printDrugRequest(row, items, getCompanyById(companyId), sig);
        } catch (err) {
          toast(err.message || 'Gagal menyimpan permintaan', 'err');
        }
      });
    }
  });
}
