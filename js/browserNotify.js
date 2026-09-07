// Best-effort desktop notifications via the browser Notification API.
//
// This is NOT server push: it only fires while this browser tab/window is
// open (backgrounded is fine, closed is not) and only after the user has
// explicitly opted in from Akun & Log Aktivitas, since Chrome/Firefox block
// silent/auto permission prompts anyway. True push-when-closed or WhatsApp
// delivery would need a backend push service (e.g. Web Push + VAPID, or a
// WhatsApp Business API integration) — out of scope for this static PWA.
const PREF_KEY = 'ics_browser_notif_enabled';

export function isBrowserNotifSupported() {
  return typeof Notification !== 'undefined';
}

export function isBrowserNotifEnabled() {
  return isBrowserNotifSupported() && Notification.permission === 'granted' && localStorage.getItem(PREF_KEY) === '1';
}

export async function enableBrowserNotif() {
  if (!isBrowserNotifSupported()) throw new Error('Browser ini tidak mendukung notifikasi.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Izin notifikasi ditolak. Aktifkan lewat pengaturan situs di browser Anda.');
  localStorage.setItem(PREF_KEY, '1');
}

export function disableBrowserNotif() {
  localStorage.setItem(PREF_KEY, '0');
}

export function notifyBrowser(title, body) {
  if (!isBrowserNotifEnabled()) return;
  // Only nudge when the tab isn't the one the user is actively looking at —
  // no point popping a desktop notification for something already on screen.
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  try {
    const n = new Notification(title, { body, icon: 'assets/app-icon-192.png' });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (err) { /* ignore — e.g. permission revoked mid-session */ }
}
