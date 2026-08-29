import * as api from '../api.js';
import { escapeHtml, fmtDate, toast, openModal, debounce, todayStr } from '../util.js';
import { getDrugCategories, getSelectedCompanyId, isAllCompanies, getCompanyById } from '../state.js';
import { printStocktake } from '../print.js';

export async function renderApotek(root) {
  root.innerHTML = `
    <div class="view-head">
      <div><h1>Apotek</h1><p class="desc">Obat & alat kesehatan — FEFO, harga, peringatan expired dan stok minimum</p></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline" id="btnPrint">Cetak Stocktake</button>
        <button class="btn btn-outline" id="btnTx">Penerimaan Obat (Batch Baru)</button>
        <button class="btn btn-primary" id="btnNewDrug">+ Tambah Item Obat/Alkes</button>
      </div>
    </div>
    <div class="grid cols-3" id="apotekStats" style="margin-bottom:20px"></div>
    <div class="panel">
      <h2>Daftar Obat & Alkes (FEFO) <span class="muted" id="drugCount"></span></h2>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <input type="text" id="drugSearch" placeholder="Cari nama/kode..." style="max-width:260px">
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
        <thead><tr><th>Kode</th><th>Nama</th><th>Jenis</th><th>Stok (semua batch)</th><th>Exp. Terdekat (FEFO)</th><th>Harga Jual</th><th>Status</th><th></th></tr></thead>
        <tbody id="drugRows"></tbody>
      </table></div>
    </div>
  `;

  const drugs = await api.listDrugsWithStock();

  function statusOf(d) {
    const days = d.nextExpiry ? daysUntil(d.nextExpiry) : null;
    if (days !== null && days < 0) return { key: 'expired', label: 'Kadaluarsa', cls: 'badge-danger' };
    if (days !== null && days <= 30) return { key: 'expiring', label: `Exp ${days} hari lagi`, cls: 'badge-warn' };
    if (d.stok <= d.stok_minimum) return { key: 'minimum', label: 'Perlu Pesan Ulang', cls: 'badge-warn' };
    return { key: 'ok', label: 'Aman', cls: 'badge-ok' };
  }
  function daysUntil(dateStr) {
    const target = new Date(dateStr + 'T00:00:00');
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.round((target - now) / 86400000);
  }

  const minimum = drugs.filter(d => d.stok <= d.stok_minimum);
  const expiringOrExpired = drugs.filter(d => d.nextExpiry && daysUntil(d.nextExpiry) <= 30);
  root.querySelector('#apotekStats').innerHTML = `
    <div class="card stat primary"><div class="label">Total Item</div><div class="value">${drugs.length}</div></div>
    <div class="card stat warn"><div class="label">Perlu Pesan Ulang</div><div class="value">${minimum.length}</div><div class="hint">Stok ≤ batas minimum</div></div>
    <div class="card stat danger"><div class="label">Kadaluarsa / Akan Kadaluarsa</div><div class="value">${expiringOrExpired.length}</div><div class="hint">Dalam 30 hari ke depan atau sudah lewat</div></div>
  `;
  root.querySelector('#drugCount').textContent = `(${drugs.length})`;

  const rows = root.querySelector('#drugRows');
  function draw(list) {
    if (!list.length) { rows.innerHTML = `<tr><td colspan="8" class="empty">Tidak ada data obat/alkes.</td></tr>`; return; }
    rows.innerHTML = list.map(d => {
      const st = statusOf(d);
      return `<tr>
        <td>${escapeHtml(d.kode)}</td>
        <td>${escapeHtml(d.nama)}<div class="muted" style="font-size:.72rem">${escapeHtml(d.drug_categories?.name || '')}</div></td>
        <td>${d.jenis}</td>
        <td>${d.stok} ${escapeHtml(d.satuan)}</td>
        <td>${d.nextExpiry ? fmtDate(d.nextExpiry) : '-'}</td>
        <td>Rp ${Number(d.hargaJual || 0).toLocaleString('id-ID')}</td>
        <td><span class="badge ${st.cls}">${st.label}</span></td>
        <td><button class="btn btn-sm btn-outline" data-batch="${d.id}">Lihat Batch</button></td>
      </tr>`;
    }).join('');
    rows.querySelectorAll('[data-batch]').forEach(btn => btn.addEventListener('click', () => {
      const d = drugs.find(x => x.id === btn.dataset.batch);
      openBatchModal(d, () => renderApotek(root));
    }));
  }
  draw(drugs);

  function applyFilters() {
    const q = root.querySelector('#drugSearch').value.trim().toLowerCase();
    const jenis = root.querySelector('#drugFilter').value;
    const warn = root.querySelector('#drugWarnFilter').value;
    draw(drugs.filter(d => {
      if (q && !(d.nama.toLowerCase().includes(q) || (d.kode || '').toLowerCase().includes(q))) return false;
      if (jenis && d.jenis !== jenis) return false;
      if (warn && statusOf(d).key !== warn) return false;
      return true;
    }));
  }
  root.querySelector('#drugSearch').addEventListener('input', debounce(applyFilters, 200));
  root.querySelector('#drugFilter').addEventListener('change', applyFilters);
  root.querySelector('#drugWarnFilter').addEventListener('change', applyFilters);

  root.querySelector('#btnNewDrug').addEventListener('click', () => openDrugModal(() => renderApotek(root)));
  root.querySelector('#btnTx').addEventListener('click', () => openReceiveModal(drugs, () => renderApotek(root)));
  root.querySelector('#btnPrint').addEventListener('click', () => {
    const company = isAllCompanies() ? null : getCompanyById(getSelectedCompanyId());
    printStocktake(drugs, company, new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }));
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

function openDrugModal(onDone) {
  const cats = getDrugCategories();
  openModal('Tambah Item Obat/Alkes', `
    <form id="drugForm" class="form-grid">
      <div class="field"><label>Kode *</label><input name="kode" required placeholder="mis. AB020"></div>
      <div class="field"><label>Nama *</label><input name="nama" required></div>
      <div class="field"><label>Jenis *</label>
        <select name="jenis"><option value="obat">Obat</option><option value="alkes">Alat Kesehatan</option><option value="bhp">BHP (Bahan Habis Pakai)</option></select>
      </div>
      <div class="field"><label>Kategori</label>
        <select name="kategori_id"><option value="">-</option>${cats.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Satuan</label><input name="satuan" value="pcs"></div>
      <div class="field"><label>Stok Minimum (batas pesan ulang) *</label><input type="number" name="stok_minimum" min="0" value="10" required></div>
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
        try {
          await api.createDrug({
            kode: fd.get('kode').trim(), nama: fd.get('nama').trim(), jenis: fd.get('jenis'),
            kategori_id: fd.get('kategori_id') || null, satuan: fd.get('satuan').trim() || 'pcs',
            stok_minimum: Number(fd.get('stok_minimum'))
          });
          toast('Item obat/alkes ditambahkan. Lakukan "Penerimaan Obat" untuk mengisi stok awal.');
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
            hargaJual: Number(fd.get('hargaJual')) || 0, supplier: fd.get('supplier').trim()
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
