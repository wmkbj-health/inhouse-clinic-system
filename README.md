# Inhouse Clinic System

Aplikasi manajemen klinik multi-perusahaan — bisa diinstal di HP maupun laptop (PWA), dengan database cloud (Supabase/PostgreSQL), login multi-akun berbasis peran (dokter / perawat / viewer), dan mengelola data 5 PT sekaligus dari satu aplikasi.

> **Status: Fase 1.** Modul inti (dashboard, pasien/SOAP, apotek FEFO, rujukan, surat sakit, kecelakaan kerja, akun & log aktivitas) sudah lengkap dan teruji. Modul lanjutan yang belum digarap di fase ini: portal self-registration karyawan + layar antrean real-time, modul MCU/Fitness-to-Work terpisah, dan integrasi SATUSEHAT. Lihat bagian **Roadmap** di bawah.

## Fitur Fase 1

- **Dashboard** — total kunjungan, top 5 penyakit (keseluruhan & per departemen), top 5 obat terpakai, total SKS, total rujukan keluar, total kecelakaan kerja (FA/MA/LTI), monitoring pasien observasi/rawat inap, dan peringatan otomatis stok minimum & obat kadaluarsa. Bisa dilihat per-PT atau gabungan semua PT, dan dicetak sebagai laporan.
- **Pasien** — antrian harian, pendaftaran dengan identitas lengkap (NIK/RM, usia otomatis dari tanggal lahir, jabatan, departemen, status pegawai tetap/kontrak/mitra kerja beserta asal PT mitra), kartu pasien tercetak otomatis saat pendaftaran, dan pemeriksaan SOAP dengan pencarian diagnosa **ICD-10**, disposisi (rawat jalan/observasi/rawat inap/rujuk keluar), penerbitan SKS langsung dari SOAP, dan obat yang diresepkan otomatis mengurangi stok apotek (FEFO) serta menghitung biaya total otomatis dari harga obat.
- **Kecelakaan Kerja** — klasifikasi tingkat **First Aid (FA)**, **Medical Aid (MA)**, **Lost Time Injury (LTI)** dengan kronologi kejadian, terekam otomatis dari SOAP dan direkap di halaman tersendiri.
- **Apotek** — manajemen obat & alkes dengan sistem **batch dan FEFO** (First-Expired-First-Out: batch dengan kadaluarsa terdekat otomatis dipakai lebih dulu), setiap batch punya tanggal kadaluarsa dan harga sendiri (barang yang sama bisa punya beberapa batch dengan expired berbeda), penerimaan obat, koreksi stok (hasil opname), serta peringatan stok minimum dan kadaluarsa.
- **Rujukan & Surat Keterangan Sakit** — dibuat dari data pasien yang sudah terdaftar, dengan nomor surat otomatis dan cetak siap pakai.
- **Multi-PT** — mengelola **PT Wana Subur Lestari, PT Mayangkara Tanaman Industri, PT Kubu Mulia Forestry, PT Bina Ovivipari Semesta, PT Jelai Lestari Abadi** dari satu aplikasi. Pilih satu PT atau "Semua PT" dari sidebar; seluruh data, dashboard, dan laporan mengikuti pilihan ini.
- **Multi-akun berbasis peran:**
  | Peran | Dashboard | Pasien/Apotek/Rujukan/SKS/Kec. Kerja | Buat Akun | Log Aktivitas |
  |---|---|---|---|---|
  | **Dokter** | ✅ | ✅ | ✅ | ✅ |
  | **Perawat** | ✅ | ✅ | ❌ | ❌ |
  | **Viewer** | ✅ (agregat, tanpa rekam medis pasien) | ❌ | ❌ | ❌ |

  Pembatasan ini ditegakkan **dua lapis**: di tampilan (menu disembunyikan) *dan* di database (Row Level Security Supabase) — jadi tidak bisa dilewati walau seseorang mengubah alamat halaman secara manual.
- **Cetak otomatis:** kartu pasien, form rujukan, SKS, surat rekomendasi dokter perusahaan, data kunjungan pasien, laporan dashboard (per PT/semua PT), stocktake obat & alkes, dan form persetujuan/penolakan tindakan medis.
- **Kode diagnosa & obat:** menggunakan **ICD-10** (bukan kode internal ad-hoc) dan nomenklatur obat generik standar (mengikuti pola Formularium Nasional), supaya data klinis Anda tetap kompatibel dengan sistem kesehatan nasional/internasional lain di masa depan (termasuk kalau nanti integrasi SATUSEHAT).
- **Medical alert otomatis** — pita peringatan merah muncul di atas setiap halaman (untuk dokter/perawat) begitu ada obat/alkes yang sudah kadaluarsa, akan kadaluarsa dalam 30 hari, atau stoknya sudah di titik pesan-ulang (safety stock) — tidak perlu buka menu Apotek dulu untuk tahu.
- **Sinkron real-time** — begitu satu pengguna menyimpan pasien/kunjungan/stok obat, pengguna lain yang sedang membuka aplikasi (di HP/laptop lain, PT yang sama) otomatis melihat data terbaru dalam hitungan detik lewat Supabase Realtime, tanpa perlu refresh manual.

## Arsitektur

- **Frontend:** HTML/CSS/JavaScript murni (tanpa framework/build step) — mudah dipelihara, cepat dimuat, bisa langsung diedit di file apapun. PWA (bisa diinstal di HP & laptop, ada ikon & splash sendiri).
- **Backend:** [Supabase](https://supabase.com) (PostgreSQL + Auth + Row Level Security + Edge Functions), tier gratis.
- **Kenapa Supabase gratis tapi bukan "selamanya tanpa syarat":** tier gratis Supabase tidak memungut biaya, tapi **project akan di-pause otomatis jika tidak ada aktivitas API selama ~7 hari berturut-turut** (tinggal klik "Restore" di dashboard Supabase untuk mengaktifkan lagi — data tidak hilang, tapi ada jeda beberapa menit). Untuk klinik yang dipakai setiap hari kerja ini praktis tidak jadi masalah. Backup otomatis di tier gratis juga hanya disimpan beberapa hari ke belakang (bukan point-in-time recovery jangka panjang) — jadi tetap disarankan sesekali mengekspor data penting (lihat bagian Backup di bawah). Jika ke depan volume data/pengguna bertambah besar dan Anda ingin jaminan uptime lebih kuat, upgrade ke Supabase Pro (berbayar, mulai ~USD 25/bulan) adalah opsi natural tanpa perlu migrasi data.
- **Hosting:** GitHub Pages (gratis permanen, sudah dipakai sejak Fase 0).

---

## Panduan Setup dari Nol (Wajib Dilakukan Sekali di Awal)

Ikuti urutan ini persis. Semua langkah dilakukan lewat klik di browser — tidak ada yang wajib pakai terminal/CLI (opsi CLI disediakan sebagai alternatif di Langkah 3 bagi yang terbiasa).

### Langkah 1 — Buka project Supabase Anda

1. Buka [supabase.com/dashboard](https://supabase.com/dashboard) dan login.
2. Klik project dengan referensi **`dgodxrbcgdbthhotisbq`** (ini project yang sudah dikonfigurasi ke aplikasi ini).

### Langkah 2 — Terapkan skema database (tabel, keamanan, 5 PT)

1. Di sidebar kiri project, klik ikon **SQL Editor** (ikon `</>`).
2. Klik **New query**.
3. Buka file [`supabase/schema.sql`](supabase/schema.sql) di repo GitHub ini. Klik tombol **Raw**, lalu **select all (Ctrl+A) dan copy (Ctrl+C)** seluruh isinya.
4. Tempel ke kotak SQL Editor di Supabase, lalu klik **Run** (atau Ctrl+Enter). Tunggu sampai muncul "Success. No rows returned".
5. Buat query baru lagi (**New query**), buka file [`supabase/seed_diseases_drugs.sql`](supabase/seed_diseases_drugs.sql), copy semua isinya, tempel, **Run**. Ini mengisi ~294 kode diagnosa ICD-10 dan ~99 item obat/alkes generik sebagai titik awal (bisa ditambah/diedit kapan saja lewat menu Apotek di aplikasi).
6. Verifikasi: klik menu **Table Editor** di sidebar kiri — Anda akan melihat tabel `companies` sudah berisi 5 baris (PT Anda), `disease_codes` berisi ratusan baris, dan `drugs` berisi puluhan baris.

### Langkah 3 — Deploy Edge Function untuk pembuatan akun

Pembuatan akun pengguna baru (hanya bisa dilakukan dokter) butuh sedikit kode yang berjalan di server Supabase (bukan di browser) supaya kata sandi & hak admin tidak pernah terekspos. ini disebut **Edge Function**, masih gratis (500.000 pemanggilan/bulan).

**Opsi A — lewat dashboard, tanpa install apa pun (disarankan):**

1. Di sidebar kiri, klik **Edge Functions**.
2. Klik **Deploy a new function** → pilih **Via Editor** / **Create function from scratch**.
3. Beri nama function: `create-user` (harus persis ini).
4. Buka file [`supabase/functions/create-user/index.ts`](supabase/functions/create-user/index.ts) di repo, copy seluruh isinya.
5. Hapus kode contoh bawaan di editor Supabase, tempel kode yang sudah dicopy.
6. Klik **Deploy**. Tunggu sampai statusnya **Active**.

**Opsi B — lewat terminal (Supabase CLI), untuk yang terbiasa:**
```
npm install -g supabase
supabase login
cd inhouse-clinic-system
supabase link --project-ref dgodxrbcgdbthhotisbq
supabase functions deploy create-user
```

Keduanya sama-sama otomatis memakai Service Role Key project Anda di sisi server — Anda tidak perlu menyalin key itu ke mana pun.

### Langkah 4 — Aktifkan Realtime (sinkron otomatis antar pengguna)

`schema.sql` di Langkah 2 sudah memasukkan tabel-tabel utama (`queue`, `visits`, `drug_batches`, dst.) ke publikasi Realtime lewat perintah `alter publication supabase_realtime add table ...`. Untuk memverifikasi:

1. Sidebar kiri → **Database** → **Replication**.
2. Pastikan tabel `queue`, `visits`, `drug_batches`, `stock_transactions`, `patients`, `sick_notes`, `referrals` tercentang di bawah kolom **supabase_realtime**. Jika ada yang belum tercentang, klik untuk mengaktifkannya secara manual.

### Langkah 5 — Buat akun dokter pertama (bootstrap)

Akun pertama tidak bisa dibuat lewat aplikasi (pembuatan akun hanya bisa dilakukan oleh dokter yang *sudah* login — masalah "ayam dan telur" khusus untuk akun pertama). Buat sekali secara manual:

1. Sidebar kiri → **Authentication** → **Users** → tombol **Add user** → **Create new user**.
2. Isi email & password dokter pertama. Centang **Auto Confirm User**. Klik **Create user**.
3. Klik user yang baru dibuat, salin **User UID**-nya (format `xxxxxxxx-xxxx-...`).
4. Kembali ke **SQL Editor** → **New query**, jalankan (ganti `<UID>` dan `<NAMA DOKTER>`):
   ```sql
   insert into profiles (id, full_name, role, company_scope, active)
   values ('<UID>', '<NAMA DOKTER>', 'dokter', null, true);
   ```
   `company_scope = null` berarti akun ini bisa akses **semua PT**. Setelah ini, dokter tersebut bisa login ke aplikasi dan membuat akun dokter/perawat/viewer lain langsung dari menu **Akun & Log Aktivitas** — tidak perlu lagi lewat SQL Editor.

### Langkah 6 — Hosting di GitHub Pages (gratis permanen)

1. Buka repository Anda di GitHub → **Settings → Pages**.
2. **Build and deployment → Source**: pilih **Deploy from a branch**, pilih branch aktif dan folder `/ (root)`.
3. Simpan. Setelah 1–2 menit, aplikasi online di `https://<username>.github.io/<repo>/inhouse-clinic-system/`.

### Langkah 7 — Login pertama & install sebagai aplikasi (PWA)

1. Buka URL aplikasi Anda, login dengan akun dokter dari Langkah 5.
2. **HP (Android/Chrome):** menu titik tiga → *Add to Home screen*.
3. **HP (iPhone/Safari):** tombol Share → *Add to Home Screen*.
4. **Laptop (Chrome/Edge):** klik ikon *Install* di address bar.

Setelah Langkah 1–7 selesai (sekali saja), aplikasi siap dipakai sehari-hari oleh semua akun yang dibuat dokter — data otomatis sinkron real-time ke semua perangkat yang login.

---

## Alur Pemakaian Harian

1. Pilih **PT** di sidebar (atau "Semua PT" untuk melihat gabungan — tergantung akses akun Anda).
2. **Dashboard** — cek ringkasan pagi: antrian, peringatan apotek, top penyakit/obat bulan berjalan.
3. **Pasien → "+ Pasien Baru"** — daftarkan pasien (usia terisi otomatis), kartu pasien langsung tercetak, otomatis masuk antrian.
4. Klik **"Periksa"** pada antrian → isi SOAP, pilih jenis kunjungan (sakit/kecelakaan kerja/kontrol/vitamin-MCU), cari diagnosa ICD-10, catat obat (stok & biaya otomatis terhitung dari Apotek), tentukan disposisi, centang SKS bila perlu → **Simpan & Selesai**.
5. **Apotek** — tambah item baru, catat "Penerimaan Obat" untuk mengisi batch & stok, gunakan "Koreksi Stok" saat ada selisih hasil opname.
6. **Rujukan / Surat Sakit / Kecelakaan Kerja** — riwayat otomatis terisi dari data SOAP, tinggal cetak bila perlu surat terpisah.
7. **Akun & Log Aktivitas** (khusus dokter) — kelola akses perawat/viewer baru dan pantau log aktivitas sistem.

## Sinkronisasi & Backup Data — Apa yang Nyata, Apa yang Ada Batasnya

**Sinkron antar user/perangkat: real-time, sudah aktif.** Begitu Langkah 4 di atas selesai, setiap perubahan (pasien baru, kunjungan, stok obat, dst.) langsung terkirim lewat Supabase Realtime ke semua sesi aplikasi yang sedang terbuka (dokter/perawat) — muncul toast "Data diperbarui" dan tampilan ikut ter-refresh, tanpa reload manual, dari HP maupun laptop, PT yang sama.

**Backup: aman, tapi bukan "real-time" dalam arti point-in-time recovery.** Ini bagian yang perlu jujur disampaikan:
- Supabase tier gratis membuat **backup harian otomatis**, disimpan sekitar 7 hari ke belakang (cek **Database → Backups** di dashboard). Ini cukup untuk memulihkan dari kesalahan/insiden dalam seminggu terakhir, tapi bukan cadangan jangka panjang.
- Untuk cadangan tambahan yang Anda kendalikan sendiri dan bisa disimpan selamanya: gunakan tombol **"Unduh Backup Data (.json)"** di menu **Akun & Log Aktivitas** (khusus dokter) — jalankan sesekali (mis. tiap akhir bulan) dan simpan hasilnya ke Google Drive/email.
- Kalau butuh jaminan backup point-in-time yang sesungguhnya (bisa mundur ke detik mana pun dalam 7–30 hari terakhir), itu fitur **Supabase Pro** (berbayar, mulai ~USD 25/bulan) — di luar cakupan tier gratis.

## Roadmap (Belum Dikerjakan di Fase Ini)

Skala penuh permintaan awal jauh lebih besar dari yang realistis diselesaikan sekaligus. Bagian berikut sengaja ditunda ke fase berikutnya:

- Portal self-registration karyawan (booking online / pindai barcode ID pegawai) + layar antrean digital real-time (berbeda dari sinkron data — ini layar tampilan antrean publik).
- Modul K3 terstruktur terpisah: riwayat MCU, status Fitness to Work, form pelaporan Penyakit Akibat Kerja (PAK).
- Medical alert untuk **riwayat alergi/kondisi kronis pasien** saat rekam medis dibuka (yang sudah berjalan sekarang: alert stok/kadaluarsa obat di seluruh halaman — ini soal riwayat medis per pasien, item terpisah).
- Integrasi API SATUSEHAT Kementerian Kesehatan.
- Ekspor laporan format baku Dinas Kesehatan.

Beri tahu prioritas berikutnya, dan ini bisa langsung dikerjakan di sesi lanjutan.

---

## Struktur Proyek

```
inhouse-clinic-system/
├── index.html
├── manifest.json
├── service-worker.js
├── css/style.css
├── assets/icon.svg
├── supabase/
│   ├── schema.sql                  # Skema tabel + Row Level Security
│   ├── seed_diseases_drugs.sql     # Data awal ICD-10 & master obat
│   └── functions/create-user/      # Edge Function pembuatan akun (dokter-only)
└── js/
    ├── app.js            # Router, shell aplikasi, pemilih PT
    ├── auth.js           # Login, sesi, peran pengguna
    ├── api.js            # Semua query ke Supabase (FEFO, dashboard, dsb.)
    ├── state.js          # State PT aktif & cache data referensi
    ├── print.js          # Semua template cetak
    ├── realtime.js       # Sinkron real-time antar user/perangkat
    ├── util.js           # Fungsi bantu UI
    ├── supabaseClient.js # Inisialisasi klien Supabase
    ├── supabase-config.js# URL & anon key project Supabase Anda
    └── views/             # Setiap halaman/fitur aplikasi
```
