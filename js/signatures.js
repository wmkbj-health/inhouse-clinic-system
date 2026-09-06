import * as api from './api.js';
import { openModal, toast, escapeHtml } from './util.js';

export const DOC_TYPES = {
  rujukan: 'Surat Rujukan',
  sks: 'Surat Keterangan Sakit',
  consent: 'Form Persetujuan / Penolakan Medis',
  stocktake: 'Stocktake Obat & Alkes',
  drug_request: 'Permintaan Pengadaan Obat'
};

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

// docType: which document's tab is preselected when the modal opens; the
// user can still switch to any other document type from the same modal —
// all of them are edited and saved together in one go.
export async function openSignatureModal(companyId, docType = 'rujukan', onSaved) {
  if (!companyId) { toast('Pilih PT terlebih dahulu (tidak bisa "Semua PT")', 'err'); return; }
  const sig = await api.getPrintSignatures(companyId);
  const byType = {};
  for (const type of Object.keys(DOC_TYPES)) {
    const rows = sig.signatures?.[type] || sig.signatures?.default;
    byType[type] = (rows && rows.length ? rows : DEFAULT_ROWS).map(r => ({ ...r }));
  }

  openModal('Kolom Tanda Tangan Dokumen Cetak', `
    <p class="desc" style="margin-bottom:12px">Setiap jenis surat/laporan punya kolom tanda tangannya sendiri — atur satu per satu lewat menu di bawah, lalu simpan semuanya sekaligus.</p>
    <div class="field" style="margin-bottom:14px;max-width:340px">
      <label>Jenis Dokumen</label>
      <select id="sigDocType">${Object.entries(DOC_TYPES).map(([v, l]) => `<option value="${v}" ${v === docType ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>
    </div>
    <form id="sigForm">
      <div id="sigRows" class="sig-rows"></div>
      <button type="button" class="btn btn-outline btn-sm" id="sigAddBtn" style="margin:10px 0 16px">+ Tambah Kolom Tanda Tangan</button>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button type="button" class="btn btn-outline" id="cancelBtn">Batal</button>
        <button type="submit" class="btn btn-primary">Simpan Semua</button>
      </div>
    </form>
  `, {
    onMount: (body, close) => {
      const typeSelect = body.querySelector('#sigDocType');
      const rowsEl = body.querySelector('#sigRows');
      let currentType = docType;
      let idx = 0;

      function bindRemove() {
        rowsEl.querySelectorAll('.sig-remove').forEach(btn => {
          btn.onclick = () => {
            if (rowsEl.querySelectorAll('.sig-row').length <= 1) { toast('Minimal 1 kolom tanda tangan', 'err'); return; }
            btn.closest('.sig-row').remove();
          };
        });
      }

      function collectCurrent() {
        byType[currentType] = [...rowsEl.querySelectorAll('.sig-row')].map(r => ({
          label: r.querySelector('[name=label]').value.trim(),
          nama: r.querySelector('[name=nama]').value.trim()
        })).filter(r => r.label || r.nama);
      }

      function drawRows(type) {
        currentType = type;
        idx = byType[type].length;
        rowsEl.innerHTML = byType[type].map(rowHtml).join('');
        bindRemove();
      }
      drawRows(currentType);

      typeSelect.addEventListener('change', () => {
        collectCurrent();
        drawRows(typeSelect.value);
      });

      body.querySelector('#sigAddBtn').addEventListener('click', () => {
        rowsEl.insertAdjacentHTML('beforeend', rowHtml({ label: '', nama: '' }, idx++));
        bindRemove();
      });

      body.querySelector('#cancelBtn').addEventListener('click', close);
      body.querySelector('#sigForm').addEventListener('submit', async e => {
        e.preventDefault();
        collectCurrent();
        try {
          await api.savePrintSignatures(companyId, { signatures: byType });
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
