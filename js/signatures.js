import * as api from './api.js';
import { openModal, toast, escapeHtml } from './util.js';

export async function openSignatureModal(companyId, onSaved) {
  if (!companyId) { toast('Pilih PT terlebih dahulu (tidak bisa "Semua PT")', 'err'); return; }
  const sig = await api.getPrintSignatures(companyId);
  openModal('Nama untuk Tanda Tangan Dokumen Cetak', `
    <p class="desc" style="margin-bottom:12px">Nama ini akan otomatis muncul pada dokumen cetak (stocktake, rujukan, SKS, form persetujuan/penolakan, permintaan obat) untuk PT ini.</p>
    <form id="sigForm">
      <div class="field" style="margin-bottom:12px"><label>Nama Dokter</label><input name="nama_dokter" value="${escapeHtml(sig.nama_dokter || '')}"></div>
      <div class="field" style="margin-bottom:12px"><label>Nama Apoteker / Petugas Farmasi</label><input name="nama_apoteker" value="${escapeHtml(sig.nama_apoteker || '')}"></div>
      <div class="field" style="margin-bottom:12px"><label>Nama Admin/HRD</label><input name="nama_admin_hrd" value="${escapeHtml(sig.nama_admin_hrd || '')}"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button type="button" class="btn btn-outline" id="cancelBtn">Batal</button>
        <button type="submit" class="btn btn-primary">Simpan</button>
      </div>
    </form>
  `, {
    onMount: (body, close) => {
      body.querySelector('#cancelBtn').addEventListener('click', close);
      body.querySelector('#sigForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api.savePrintSignatures(companyId, {
            nama_dokter: fd.get('nama_dokter').trim(), nama_apoteker: fd.get('nama_apoteker').trim(), nama_admin_hrd: fd.get('nama_admin_hrd').trim()
          });
          toast('Nama tanda tangan tersimpan');
          close();
          onSaved?.();
        } catch (err) {
          toast(err.message || 'Gagal menyimpan', 'err');
        }
      });
    }
  });
}
