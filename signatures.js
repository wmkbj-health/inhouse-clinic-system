import * as api from './api.js';
import { openModal, toast, escapeHtml } from './util.js';

const DEFAULT_ROWS = [
  { label: 'Dokter', nama: '' },
  { label: 'Apoteker / Petugas Farmasi', nama: '' },
  { label: 'Admin/HRD', nama: '' }
];

function rowHtml(row, idx) {
  return `
    <div class="sig-row" data-idx="${idx}">
      <div class="field"><label>Label / Jabatan</label><input name="label" value="${escapeHtml(row.label || '')}" placeholder="mis. Dokter Pemeriksa"></div>
      <div class="field"><label>Nama</label><input name="nama" value="${escapeHtml(row.nama || '')}" placeholder="mis. dr. Contoh"></div>
      <button type="button" class="btn btn-outline btn-sm sig-remove" title="Hapus baris">&times;</button>
    </div>`;
}

export async function openSignatureModal(companyId, onSaved) {
  if (!companyId) { toast('Pilih PT terlebih dahulu (tidak bisa "Semua PT")', 'err'); return; }
  const sig = await api.getPrintSignatures(companyId);
  let rows = (sig.signatures && sig.signatures.length) ? sig.signatures.map(r => ({ ...r })) : DEFAULT_ROWS.map(r => ({ ...r }));

  openModal('Kolom Tanda Tangan Dokumen Cetak', `
    <p class="desc" style="margin-bottom:12px">Atur jumlah, label/jabatan, dan nama untuk kolom tanda tangan yang akan muncul pada dokumen cetak (stocktake, rujukan, SKS, form persetujuan/penolakan, permintaan obat) untuk PT ini. Tambah atau hapus baris sesuai kebutuhan.</p>
    <form id="sigForm">
      <div id="sigRows" class="sig-rows">${rows.map(rowHtml).join('')}</div>
      <button type="button" class="btn btn-outline btn-sm" id="sigAddBtn" style="margin:10px 0 16px">+ Tambah Kolom Tanda Tangan</button>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button type="button" class="btn btn-outline" id="cancelBtn">Batal</button>
        <button type="submit" class="btn btn-primary">Simpan</button>
      </div>
    </form>
  `, {
    onMount: (body, close) => {
      const rowsEl = body.querySelector('#sigRows');
      let idx = rows.length;

      function bindRemove() {
        rowsEl.querySelectorAll('.sig-remove').forEach(btn => {
          btn.onclick = () => {
            if (rowsEl.querySelectorAll('.sig-row').length <= 1) { toast('Minimal 1 kolom tanda tangan', 'err'); return; }
            btn.closest('.sig-row').remove();
          };
        });
      }
      bindRemove();

      body.querySelector('#sigAddBtn').addEventListener('click', () => {
        rowsEl.insertAdjacentHTML('beforeend', rowHtml({ label: '', nama: '' }, idx++));
        bindRemove();
      });

      body.querySelector('#cancelBtn').addEventListener('click', close);
      body.querySelector('#sigForm').addEventListener('submit', async e => {
        e.preventDefault();
        const collected = [...rowsEl.querySelectorAll('.sig-row')].map(r => ({
          label: r.querySelector('[name=label]').value.trim(),
          nama: r.querySelector('[name=nama]').value.trim()
        })).filter(r => r.label || r.nama);
        try {
          await api.savePrintSignatures(companyId, { signatures: collected });
          toast('Kolom tanda tangan tersimpan');
          close();
          onSaved?.();
        } catch (err) {
          toast(err.message || 'Gagal menyimpan', 'err');
        }
      });
    }
  });
}
