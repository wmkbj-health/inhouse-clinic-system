import { listProfiles, updateProfile, createUserAccount, listActivityLog, exportSnapshot } from '../api.js';
import { getCompanies } from '../state.js';
import { escapeHtml, toast, openModal, confirmDialog } from '../util.js';
import { ROLE_LABEL, getProfile } from '../auth.js';

export async function renderAkun(root) {
  root.innerHTML = `
    <div class="view-head">
      <div><h1>Akun & Log Aktivitas</h1><p class="desc">Manajemen pengguna dan riwayat aktivitas sistem (khusus dokter)</p></div>
      <button class="btn btn-primary" id="btnNewUser">+ Buat Akun</button>
    </div>
    <div class="panel">
      <h2>Daftar Akun Pengguna</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Nama</th><th>Role</th><th>Akses PT</th><th>Status</th><th></th></tr></thead>
        <tbody id="userRows"></tbody>
      </table></div>
    </div>
    <div class="panel">
      <h2>Log Aktivitas Terbaru</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Entitas</th><th>Detail</th></tr></thead>
        <tbody id="logRows"></tbody>
      </table></div>
    </div>
    <div class="panel">
      <h2>Backup Data</h2>
      <p class="desc" style="margin-bottom:12px">Data utama sudah tersimpan aman di Supabase dengan backup harian bawaan. Gunakan tombol ini sesekali (mis. tiap akhir bulan) untuk menyimpan salinan cadangan tambahan yang Anda kendalikan sendiri (Google Drive, email, dsb).</p>
      <button class="btn btn-outline" id="btnBackup">Unduh Backup Data (.json)</button>
    </div>
  `;

  const companies = getCompanies();
  const companyName = id => companies.find(c => c.id === id)?.name || id;

  const [profiles, logs] = await Promise.all([listProfiles(), listActivityLog()]);

  const userRows = root.querySelector('#userRows');
  userRows.innerHTML = profiles.map(p => `
    <tr>
      <td>${escapeHtml(p.full_name)}</td>
      <td><span class="badge badge-info">${ROLE_LABEL[p.role] || p.role}</span></td>
      <td>${p.company_scope ? p.company_scope.map(companyName).join(', ') : '<span class="badge badge-ok">Semua PT</span>'}</td>
      <td><span class="badge ${p.active ? 'badge-ok' : 'badge-danger'}">${p.active ? 'Aktif' : 'Nonaktif'}</span></td>
      <td>${p.id !== getProfile().id ? `<button class="btn btn-sm btn-outline" data-toggle="${p.id}" data-active="${p.active}">${p.active ? 'Nonaktifkan' : 'Aktifkan'}</button>` : '<span class="muted" style="font-size:.78rem">Akun Anda</span>'}</td>
    </tr>`).join('') || `<tr><td colspan="5" class="empty">Belum ada akun lain.</td></tr>`;

  userRows.querySelectorAll('[data-toggle]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.toggle;
    const active = btn.dataset.active === 'true';
    if (!confirmDialog(`${active ? 'Nonaktifkan' : 'Aktifkan'} akun ini?`)) return;
    await updateProfile(id, { active: !active });
    toast('Status akun diperbarui');
    renderAkun(root);
  }));

  const logRows = root.querySelector('#logRows');
  logRows.innerHTML = logs.map(l => `
    <tr>
      <td>${new Date(l.created_at).toLocaleString('id-ID')}</td>
      <td>${escapeHtml(l.profiles?.full_name || '-')}</td>
      <td>${escapeHtml(l.action)}</td>
      <td>${escapeHtml(l.entity)}</td>
      <td style="white-space:normal;max-width:320px;font-size:.78rem;color:var(--muted)">${escapeHtml(JSON.stringify(l.detail || {}))}</td>
    </tr>`).join('') || `<tr><td colspan="5" class="empty">Belum ada log aktivitas.</td></tr>`;

  root.querySelector('#btnNewUser').addEventListener('click', () => openNewUserModal(companies, () => renderAkun(root)));

  root.querySelector('#btnBackup').addEventListener('click', async e => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Menyiapkan backup...';
    try {
      const snapshot = await exportSnapshot();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-inhouse-clinic-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Backup berhasil diunduh');
    } catch (err) {
      toast(err.message || 'Gagal membuat backup', 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Unduh Backup Data (.json)';
    }
  });
}

function openNewUserModal(companies, onDone) {
  openModal('Buat Akun Baru', `
    <form id="userForm">
      <div class="field" style="margin-bottom:12px"><label>Nama Lengkap *</label><input name="full_name" required></div>
      <div class="field" style="margin-bottom:12px"><label>Email *</label><input type="email" name="email" required></div>
      <div class="field" style="margin-bottom:12px"><label>Kata Sandi Awal *</label><input type="password" name="password" minlength="6" required></div>
      <div class="field" style="margin-bottom:12px"><label>Role *</label>
        <select name="role">
          <option value="dokter">Dokter (akses penuh)</option>
          <option value="perawat" selected>Perawat (semua kecuali buat akun & log aktivitas)</option>
          <option value="viewer">Viewer (hanya dashboard)</option>
        </select>
      </div>
      <div class="field" style="margin-bottom:12px"><label>Akses PT (kosongkan = semua PT)</label>
        <select name="company_scope" multiple style="min-height:110px">
          ${companies.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button type="button" class="btn btn-outline" id="cancelBtn">Batal</button>
        <button type="submit" class="btn btn-primary">Buat Akun</button>
      </div>
    </form>
  `, {
    onMount: (body, close) => {
      body.querySelector('#cancelBtn').addEventListener('click', close);
      body.querySelector('#userForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const scope = Array.from(body.querySelector('[name=company_scope]').selectedOptions).map(o => o.value);
        try {
          await createUserAccount({
            email: fd.get('email').trim(), password: fd.get('password'),
            full_name: fd.get('full_name').trim(), role: fd.get('role'), company_scope: scope
          });
          toast('Akun berhasil dibuat');
          close();
          onDone();
        } catch (err) {
          toast(err.message || 'Gagal membuat akun', 'err');
        }
      });
    }
  });
}
