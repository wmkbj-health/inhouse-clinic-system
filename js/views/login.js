import { signIn } from '../auth.js';
import { toast } from '../util.js';

export function renderLogin(root, onSuccess) {
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px">
      <div class="panel" style="max-width:380px;width:100%">
        <div style="text-align:center;margin-bottom:18px">
          <img src="assets/icon.svg" alt="Logo" style="width:64px;height:64px;margin-bottom:10px">
          <h1 style="font-size:1.2rem">Inhouse Clinic System</h1>
          <p class="desc" style="margin-top:4px">Masuk untuk melanjutkan</p>
        </div>
        <form id="loginForm">
          <div class="field" style="margin-bottom:12px"><label>Email</label><input type="email" name="email" required autocomplete="username"></div>
          <div class="field" style="margin-bottom:16px"><label>Kata Sandi</label><input type="password" name="password" required autocomplete="current-password"></div>
          <button type="submit" class="btn btn-primary" style="width:100%">Masuk</button>
        </form>
        <p class="desc" style="margin-top:14px;text-align:center;font-size:.78rem">Belum punya akun? Hubungi dokter/admin klinik Anda untuk dibuatkan akses.</p>
      </div>
    </div>
  `;
  root.querySelector('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Memproses...';
    const fd = new FormData(e.target);
    try {
      await signIn(fd.get('email').trim(), fd.get('password'));
      onSuccess();
    } catch (err) {
      toast(err.message || 'Login gagal', 'err');
      btn.disabled = false;
      btn.textContent = 'Masuk';
    }
  });
}
