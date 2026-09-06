import * as api from '../api.js';
import { escapeHtml, fmtDate, toast, openModal, debounce, todayStr, confirmDialog } from '../util.js';
import { getDrugCategories, getSelectedCompanyId, isAllCompanies, getCompanyById, consumePendingApotekFilter } from '../state.js';
import { printStocktake, printDrugRequest, printExpiryWriteoff, printRko } from '../print.js';
import { openSignatureModal } from '../signatures.js';

const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

// Downscales+compresses a photo client-side before it's stored as a data
// URI (no Supabase Storage bucket in this project, so attachments live in a
// jsonb column) — a few full-resolution phone photos would otherwise bloat
// that column and the page that has to load it.
function downscaleImage(file, maxDim = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

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
        <button class="btn btn-outline" id="btnRko">RKO</button>
        <button class="btn btn-outline" id="btnPrint">Cetak Stocktake</button>
        <button class="btn btn-outline" id="btnTx">Penerimaan Obat (Batch Baru)</button>
        <button class="btn btn-outline" id="btnReceiptHistory">Riwayat Penerimaan</button>
        <button class="btn btn-outline" id="btnExpiryWriteoff">Berita Acara Kadaluwarsa</button>
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
  // Grouped by golongan/kategori, sorted alphabetically both by kategori
  // name and by item name within each kategori — a flat kode-ordered list
  // made it hard to eyeball "what's in stock for X golongan".
  function drawRows(list) {
    if (!list.length) { rows.innerHTML = `<tr><td colspan="12" class="empty">Tidak ada data obat/alkes.</td></tr>`; return; }
    const byCategory = {};
    for (const d of list) {
      const cat = d.drug_categories?.name || 'Tanpa Kategori';
      (byCategory[cat] = byCategory[cat] || []).push(d);
    }
    const categories = Object.keys(byCategory).sort((a, b) => a.localeCompare(b, 'id'));
    rows.innerHTML = categories.map(cat => {
      const items = byCategory[cat].sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
      return `<tr class="drug-cat-row"><td colspan="12"><b>${escapeHtml(cat.toUpperCase())}</b></td></tr>` + items.map(d => {
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
    }).join('');
    rows.querySelectorAll('[data-batch]').forEach(btn => btn.addEventListener('click', () => {
      openBatchModal(drugs.find(x => x.id === btn.dataset.batch), loadAndDraw);
    }));
    rows.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => {
      openDrugModal(drugs.find(x => x.id === btn.dataset.edit), loadAndDraw, drugs);
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

  root.querySelector('#btnNewDrug').addEventListener('click', () => openDrugModal(null, loadAndDraw, drugs));
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
    openSignatureModal(sel === 'all' ? null : sel, 'stocktake');
  });
  root.querySelector('#btnPrint').addEventListener('click', () => openStocktakePrintModal(drugs, filterMonth, filterYear));
  root.querySelector('#btnExpiryWriteoff').addEventListener('click', () => openExpiryWriteoffModal(drugs, loadAndDraw));
  root.querySelector('#btnRko').addEventListener('click', () => openRkoModal(drugs));

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
      const now = new Date();
      const periodFrom = `${filterYear}-${String(filterMonth + 1).padStart(2, '0')}-01`;
      const periodToDate = new Date(filterYear, filterMonth + 1, 0);
      const isCurrentMonth = filterYear === now.getFullYear() && filterMonth === now.getMonth();
      const periodTo = isCurrentMonth ? todayStr() : periodToDate.toISOString().slice(0, 10);
      const [batchStats, stocktakeDrugs] = await Promise.all([
        api.batchPeriodStats(periodFrom, periodTo),
        api.stocktakeBatches(periodTo)
      ]);
      body.querySelector('#btnObat').addEventListener('click', () => {
        printStocktake(stocktakeDrugs.filter(d => d.jenis === 'obat'), company, periodLabel, 'Obat', sig, batchStats, isCurrentMonth);
        close();
      });
      body.querySelector('#btnAlkes').addEventListener('click', () => {
        printStocktake(stocktakeDrugs.filter(d => d.jenis !== 'obat'), company, periodLabel, 'Alkes & BHP', sig, batchStats, isCurrentMonth);
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

// Next free code for a category: {kode prefix}{3-digit sequence}, continuing
// from whatever is already in use for that category (e.g. AB007 exists ->
// suggests AB008) rather than always starting at 001.
function nextDrugCode(categoryCode, drugs) {
  if (!categoryCode) return '';
  const prefix = categoryCode.toUpperCase();
  let max = 0;
  for (const d of drugs) {
    const m = /^([A-Z]+)(\d+)$/.exec((d.kode || '').toUpperCase());
    if (m && m[1] === prefix) max = Math.max(max, Number(m[2]));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

function openDrugModal(drug, onDone, drugs = []) {
  const cats = getDrugCategories();
  const isEdit = !!drug;
  openModal(isEdit ? 'Edit Item Obat/Alkes' : 'Tambah Item Obat/Alkes', `
    <form id="drugForm" class="form-grid">
      <div class="field"><label>Kode ${isEdit ? '' : '(otomatis sesuai kategori, bisa diubah)'}</label><input name="kode" required placeholder="Pilih kategori dahulu, atau isi manual" value="${escapeHtml(drug?.kode || '')}" ${isEdit ? 'disabled' : ''}></div>
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
        <select name="kategori_id" id="kategoriSelect"><option value="">-</option>${cats.map(c => `<option value="${c.id}" data-code="${escapeHtml(c.code)}" ${drug?.kategori_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)} (${escapeHtml(c.code)})</option>`).join('')}</select>
      </div>
      <div class="field"><label>Satuan</label><input name="satuan" value="${escapeHtml(drug?.satuan || 'pcs')}"></div>
      <div class="field"><label>Sediaan</label>
        <select name="sediaan">
          <option value="">-</option>
          ${['Oral', 'Topikal', 'Injeksi', 'Tetes', 'Inhalasi', 'Suppositoria', 'Lainnya'].map(v => `<option value="${v}" ${drug?.sediaan === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Stok Minimum (batas pesan ulang) *</label><input type="number" name="stok_minimum" min="0" value="${drug?.stok_minimum ?? 10}" required></div>
      <div class="field full" style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">
        <button type="button" class="btn btn-outline" id="cancelBtn">Batal</button>
        <button type="submit" class="btn btn-primary">Simpan</button>
      </div>
    </form>
  `, {
    onMount: (body, close) => {
      if (!isEdit) {
        const kodeInput = body.querySelector('[name=kode]');
        let lastAuto = '';
        body.querySelector('#kategoriSelect').addEventListener('change', e => {
          const opt = e.target.selectedOptions[0];
          const suggestion = nextDrugCode(opt?.dataset.code, drugs);
          if (!kodeInput.value.trim() || kodeInput.value.trim() === lastAuto) {
            kodeInput.value = suggestion;
            lastAuto = suggestion;
          }
        });
      }
      body.querySelector('#cancelBtn').addEventListener('click', close);
      body.querySelector('#drugForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const payload = {
          nama: fd.get('nama').trim(), nama_paten: fd.get('nama_paten').trim() || null, jenis: fd.get('jenis'),
          kategori_id: fd.get('kategori_id') || null, satuan: fd.get('satuan').trim() || 'pcs',
          sediaan: fd.get('sediaan') || null,
          stok_minimum: Number(fd.get('stok_minimum'))
        };
        // Same name within the same kategori is almost always the same item
        // registered twice by mistake — different expiry batches belong on
        // ONE item via "Penerimaan Obat", not as separate master records.
        // A same-named item in a DIFFERENT kategori (e.g. regular stock vs.
        // a dedicated P3K kategori) is a deliberate, separately-tracked
        // item, so that's not flagged.
        if (!isEdit) {
          const dup = drugs.find(d => d.nama.trim().toLowerCase() === payload.nama.toLowerCase() && d.kategori_id === payload.kategori_id);
          if (dup && !confirmDialog(`"${dup.nama}" sudah ada di kategori ini (kode ${dup.kode}). Untuk menambah stok/batch baru dengan tanggal expired berbeda, gunakan "Penerimaan Obat" pada item yang sudah ada, bukan menambah item baru. Tetap buat item baru terpisah?`)) return;
        }
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

// ---------------- Berita Acara Kadaluwarsa (expiry write-off) ----------------
function openExpiryWriteoffModal(drugs, onDone) {
  const sel = getSelectedCompanyId();
  const companyId = sel === 'all' ? null : sel;
  let activeTab = 'baru';

  openModal('Berita Acara Kadaluwarsa Obat/Alkes', `
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button type="button" class="btn btn-outline" id="tabBaruBtn">Buat Baru</button>
      <button type="button" class="btn btn-outline" id="tabRiwayatBtn">Riwayat</button>
    </div>
    <div id="ewBody"></div>
  `, {
    onMount: (body, close) => {
      const ewBody = body.querySelector('#ewBody');
      const tabBaruBtn = body.querySelector('#tabBaruBtn');
      const tabRiwayatBtn = body.querySelector('#tabRiwayatBtn');

      function setTab(tab) {
        activeTab = tab;
        tabBaruBtn.classList.toggle('btn-primary', tab === 'baru');
        tabBaruBtn.classList.toggle('btn-outline', tab !== 'baru');
        tabRiwayatBtn.classList.toggle('btn-primary', tab === 'riwayat');
        tabRiwayatBtn.classList.toggle('btn-outline', tab !== 'riwayat');
        if (tab === 'baru') drawForm(); else drawHistory();
      }
      tabBaruBtn.addEventListener('click', () => setTab('baru'));
      tabRiwayatBtn.addEventListener('click', () => setTab('riwayat'));

      function drawForm() {
        if (!companyId) { ewBody.innerHTML = `<p class="desc">Pilih PT terlebih dahulu di sidebar (tidak bisa "Semua PT") untuk membuat Berita Acara.</p>`; return; }
        const today = new Date();
        const expiredLines = [];
        drugs.forEach(d => {
          (d.batches || []).forEach(b => {
            if (b.tanggal_expired && new Date(b.tanggal_expired) < today && Number(b.qty_sisa) > 0) {
              expiredLines.push({ drug: d, batch: b });
            }
          });
        });

        ewBody.innerHTML = `
          <div class="grid cols-3" style="margin-bottom:14px">
            <div class="field"><label>Jenis *</label>
              <select id="ewJenis"><option value="obat">Obat</option><option value="alkes">Alat Kesehatan</option><option value="bhp">BHP</option></select>
            </div>
            <div class="field"><label>Tanggal *</label><input type="date" id="ewTanggal" value="${todayStr()}"></div>
            <div class="field"><label>Dibuat oleh</label><input id="ewDibuat" placeholder="Apoteker/Petugas"></div>
            <div class="field"><label>Disaksikan oleh</label><input id="ewSaksi"></div>
            <div class="field"><label>Dimusnahkan oleh</label><input id="ewMusnah"></div>
            <div class="field"><label>Keterangan</label><input id="ewKet" placeholder="mis. cara pemusnahan"></div>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th></th><th>Item</th><th>No. Batch</th><th>Exp</th><th>Stok Tersisa</th><th>Jumlah Dimusnahkan</th></tr></thead>
            <tbody id="ewRows"></tbody>
          </table></div>

          <div class="field full" style="margin-top:16px">
            <label>Lampiran Foto (dokumentasi pemusnahan)</label>
            <input type="file" id="ewPhotoInput" accept="image/*" multiple>
            <div class="photo-gallery" id="ewGallery"></div>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
            <button type="button" class="btn btn-outline" id="ewCancel">Batal</button>
            <button type="button" class="btn btn-primary" id="ewSave">Simpan & Cetak Berita Acara</button>
          </div>
        `;

        const photos = [];
        const galleryEl = ewBody.querySelector('#ewGallery');
        function drawGallery() {
          galleryEl.innerHTML = photos.map((src, i) => `
            <div class="photo-thumb"><img src="${src}"><button type="button" data-i="${i}">&times;</button></div>
          `).join('');
          galleryEl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { photos.splice(Number(b.dataset.i), 1); drawGallery(); }));
        }
        ewBody.querySelector('#ewPhotoInput').addEventListener('change', async e => {
          const files = Array.from(e.target.files || []);
          for (const file of files) {
            try { photos.push(await downscaleImage(file)); } catch { /* skip unreadable file */ }
          }
          e.target.value = '';
          drawGallery();
        });

        const rowsEl = ewBody.querySelector('#ewRows');
        const jenisSelect = ewBody.querySelector('#ewJenis');
        function drawRows() {
          const jenis = jenisSelect.value;
          const filtered = expiredLines.filter(l => l.drug.jenis === jenis);
          rowsEl.innerHTML = filtered.length ? filtered.map((l, i) => `
            <tr data-i="${i}">
              <td><input type="checkbox" class="ewChk" checked></td>
              <td>${escapeHtml(l.drug.nama)}</td>
              <td>${escapeHtml(l.batch.no_batch || '-')}</td>
              <td>${fmtDate(l.batch.tanggal_expired)}</td>
              <td>${l.batch.qty_sisa} ${escapeHtml(l.drug.satuan)}</td>
              <td><input type="number" class="ewQty" min="0" max="${l.batch.qty_sisa}" value="${l.batch.qty_sisa}" style="width:90px"></td>
            </tr>`).join('') : `<tr><td colspan="6" class="empty">Tidak ada batch ${jenis} yang sudah kadaluarsa saat ini.</td></tr>`;
          rowsEl.__lines = filtered;
        }
        drawRows();
        jenisSelect.addEventListener('change', drawRows);

        ewBody.querySelector('#ewCancel').addEventListener('click', close);
        ewBody.querySelector('#ewSave').addEventListener('click', async () => {
          const lines = rowsEl.__lines || [];
          const trs = [...rowsEl.querySelectorAll('tr[data-i]')];
          const items = [];
          trs.forEach(tr => {
            const i = Number(tr.dataset.i);
            const checked = tr.querySelector('.ewChk').checked;
            const qty = Number(tr.querySelector('.ewQty').value);
            if (checked && qty > 0) {
              const l = lines[i];
              items.push({ drugId: l.drug.id, batchId: l.batch.id, nama: l.drug.nama, satuan: l.drug.satuan, qty });
            }
          });
          if (!items.length) { toast('Pilih minimal satu item untuk dimusnahkan', 'err'); return; }
          try {
            const nomor = await api.nextNomorBeritaAcara(companyId);
            const payload = {
              company_id: companyId, nomor_berita_acara: nomor, tanggal: ewBody.querySelector('#ewTanggal').value,
              jenis: jenisSelect.value, keterangan: ewBody.querySelector('#ewKet').value.trim() || null,
              dibuat_oleh: ewBody.querySelector('#ewDibuat').value.trim() || null,
              disaksikan_oleh: ewBody.querySelector('#ewSaksi').value.trim() || null,
              dimusnahkan_oleh: ewBody.querySelector('#ewMusnah').value.trim() || null,
              foto_urls: photos
            };
            await api.createExpiryWriteoff(payload, items);
            const company = getCompanyById(companyId);
            const sig = await api.getPrintSignatures(companyId);
            toast('Berita Acara Kadaluwarsa tersimpan, stok sudah dikurangi otomatis');
            close();
            onDone();
            printExpiryWriteoff({ ...payload, items }, company, sig);
          } catch (err) {
            toast(err.message || 'Gagal menyimpan Berita Acara', 'err');
          }
        });
      }

      async function drawHistory() {
        ewBody.innerHTML = `<div class="empty">Memuat...</div>`;
        const rows = await api.listExpiryWriteoffs();
        ewBody.innerHTML = rows.length ? `<div class="table-wrap"><table>
          <thead><tr><th>No. Berita Acara</th><th>Tanggal</th><th>Jenis</th><th>Jumlah Item</th><th>Foto</th><th></th></tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td>${escapeHtml(r.nomor_berita_acara)}</td><td>${fmtDate(r.tanggal)}</td><td>${escapeHtml(r.jenis)}</td>
            <td>${(r.expiry_writeoff_items || []).length}</td>
            <td>${(r.foto_urls || []).length ? `<span class="badge badge-info">${r.foto_urls.length} foto</span>` : '<span class="muted">-</span>'}</td>
            <td><button class="btn btn-sm btn-outline" data-view="${r.id}">Lihat/Cetak</button></td>
          </tr>`).join('')}</tbody>
        </table></div>` : `<div class="empty">Belum ada Berita Acara Kadaluwarsa.</div>`;
        ewBody.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', async () => {
          const r = rows.find(x => x.id === btn.dataset.view);
          const company = getCompanyById(r.company_id);
          const sig = await api.getPrintSignatures(r.company_id);
          const items = (r.expiry_writeoff_items || []).map(it => ({
            drugId: it.drug_id, batchId: it.batch_id, nama: it.drugs?.nama || '-', satuan: it.drugs?.satuan || it.satuan, qty: it.qty
          }));
          printExpiryWriteoff({ ...r, items }, company, sig);
        }));
      }

      setTab('baru');
    }
  });
}

// ---------------- RKO (Rencana Kebutuhan Obat) ----------------
async function openRkoModal(drugs) {
  const sel = getSelectedCompanyId();
  const companyId = sel === 'all' ? null : sel;
  const usage = await api.rkoUsageStats();

  const rows = drugs.filter(d => d.jenis === 'obat').map(d => {
    const u = usage[d.id] || { rataRata: 0, stokMinimal: 0, stokMaksimal: 0 };
    const saran = Math.max(0, Math.round(u.stokMaksimal - d.stok));
    return {
      id: d.id, nama: d.nama, satuan: d.satuan, stokAktual: d.stok,
      rataRata: u.rataRata, stokMinimal: u.stokMinimal, stokMaksimal: u.stokMaksimal,
      saranOrder: saran, hargaSatuan: d.hargaJual || 0
    };
  }).sort((a, b) => b.saranOrder - a.saranOrder);

  openModal('RKO — Rencana Kebutuhan Obat', `
    <p class="desc" style="margin-bottom:12px">Dihitung otomatis dari rata-rata pemakaian 12 bulan terakhir (stok minimal = rata-rata × 2 bulan, stok maksimal = rata-rata × 5 bulan). Kolom "Jumlah Order" bisa diedit manual sebelum dicetak.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Nama Obat</th><th>Satuan</th><th>Rata2/Bulan</th><th>Stok Minimal</th><th>Stok Maksimal</th><th>Stok Aktual</th><th>Jumlah Order</th><th>Harga Satuan</th><th>Total</th></tr></thead>
      <tbody id="rkoRows"></tbody>
    </table></div>
    <div style="text-align:right;margin-top:10px;font-weight:700">Total Estimasi Biaya: <span id="rkoTotal">Rp 0</span></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
      <button type="button" class="btn btn-outline" id="rkoCancel">Tutup</button>
      <button type="button" class="btn btn-primary" id="rkoPrint">Cetak RKO</button>
    </div>
  `, {
    onMount: (body, close) => {
      const rowsEl = body.querySelector('#rkoRows');
      const totalEl = body.querySelector('#rkoTotal');
      function drawTotal() {
        const total = rows.reduce((s, r) => s + r.saranOrder * r.hargaSatuan, 0);
        totalEl.textContent = 'Rp ' + total.toLocaleString('id-ID');
      }
      rowsEl.innerHTML = rows.map((r, i) => `
        <tr data-i="${i}">
          <td>${escapeHtml(r.nama)}</td><td>${escapeHtml(r.satuan)}</td>
          <td>${r.rataRata.toFixed(1)}</td><td>${Math.round(r.stokMinimal)}</td><td>${Math.round(r.stokMaksimal)}</td>
          <td>${r.stokAktual}</td>
          <td><input type="number" class="rkoQty" min="0" value="${r.saranOrder}" style="width:90px"></td>
          <td>Rp ${r.hargaSatuan.toLocaleString('id-ID')}</td>
          <td class="rkoLineTotal">Rp ${(r.saranOrder * r.hargaSatuan).toLocaleString('id-ID')}</td>
        </tr>`).join('');
      drawTotal();
      rowsEl.querySelectorAll('tr[data-i]').forEach(tr => {
        const i = Number(tr.dataset.i);
        tr.querySelector('.rkoQty').addEventListener('input', e => {
          rows[i].saranOrder = Number(e.target.value) || 0;
          tr.querySelector('.rkoLineTotal').textContent = 'Rp ' + (rows[i].saranOrder * rows[i].hargaSatuan).toLocaleString('id-ID');
          drawTotal();
        });
      });
      body.querySelector('#rkoCancel').addEventListener('click', close);
      body.querySelector('#rkoPrint').addEventListener('click', () => {
        printRko(rows, companyId ? getCompanyById(companyId) : null, new Date().getFullYear());
      });
    }
  });
}
